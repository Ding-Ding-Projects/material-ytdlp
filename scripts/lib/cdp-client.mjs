// Minimal Chrome DevTools Protocol client over a hand-rolled RFC 6455 WebSocket.
//
// Hand-rolled on purpose. Node's built-in WebSocket HANGS on Chromium's
// handshake -- this project hit that twice before writing this -- and pulling in
// a dependency for one socket is not worth it.
//
// Extracted from scripts/smoke-test.mjs so anything that needs to DRIVE the app
// (not merely assert about it) can reuse the same client rather than growing a
// second, subtly different copy.

import net from "node:net";
import crypto from "node:crypto";

export class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map(); // event name -> Set<fn>
    this._recvBuf = "";
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
  }

  _emit(event, payload) {
    const set = this.listeners.get(event);
    if (set) for (const fn of set) fn(payload);
  }

  connect(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const u = new URL(this.wsUrl);
      const key = crypto.randomBytes(16).toString("base64");
      const socket = net.createConnection(
        { host: u.hostname, port: Number(u.port) || 80 },
        () => {
          const req =
            `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
            `Host: ${u.host}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\n` +
            `Sec-WebSocket-Version: 13\r\n\r\n`;
          socket.write(req);
        }
      );
      this.socket = socket;
      let handshakeDone = false;
      let headerBuf = Buffer.alloc(0);

      const t = setTimeout(() => {
        if (!handshakeDone) {
          socket.destroy();
          reject(new Error(`CDP WebSocket handshake to ${this.wsUrl} timed out`));
        }
      }, timeoutMs);

      socket.on("data", (chunk) => {
        if (!handshakeDone) {
          headerBuf = Buffer.concat([headerBuf, chunk]);
          const idx = headerBuf.indexOf("\r\n\r\n");
          if (idx === -1) return;
          const header = headerBuf.slice(0, idx).toString("utf8");
          if (!/^HTTP\/1\.1 101/i.test(header)) {
            clearTimeout(t);
            socket.destroy();
            reject(new Error(`CDP handshake rejected: ${header.split("\r\n")[0]}`));
            return;
          }
          handshakeDone = true;
          clearTimeout(t);
          const rest = headerBuf.slice(idx + 4);
          if (rest.length) this._onFrameData(rest);
          resolve();
          return;
        }
        this._onFrameData(chunk);
      });

      socket.on("error", (err) => {
        if (!handshakeDone) {
          clearTimeout(t);
          reject(err);
        }
      });
      socket.on("close", () => {
        this._emit("close", null);
      });
    });
  }

  _onFrameData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const frame = this._tryParseFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.slice(frame.totalLength);
      if (frame.opcode === 0x1) {
        // text frame
        let msg;
        try {
          msg = JSON.parse(frame.payload.toString("utf8"));
        } catch {
          continue;
        }
        this._handleMessage(msg);
      } else if (frame.opcode === 0x8) {
        this._emit("close", null);
      }
      // ignore ping/pong/binary
    }
  }

  _tryParseFrame(buf) {
    if (buf.length < 2) return null;
    const byte1 = buf[0];
    const opcode = byte1 & 0x0f;
    const byte2 = buf[1];
    const masked = (byte2 & 0x80) !== 0;
    let payloadLen = byte2 & 0x7f;
    let offset = 2;
    if (payloadLen === 126) {
      if (buf.length < offset + 2) return null;
      payloadLen = buf.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLen === 127) {
      if (buf.length < offset + 8) return null;
      payloadLen = Number(buf.readBigUInt64BE(offset));
      offset += 8;
    }
    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.slice(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + payloadLen) return null;
    let payload = buf.slice(offset, offset + payloadLen);
    if (masked && maskKey) {
      const unmasked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
      payload = unmasked;
    }
    return { opcode, payload, totalLength: offset + payloadLen };
  }

  _encodeFrame(text) {
    const payload = Buffer.from(text, "utf8");
    const maskKey = crypto.randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ maskKey[i % 4];

    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81; // FIN + text opcode
      header[1] = 0x80 | payload.length; // masked
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    return Buffer.concat([header, maskKey, masked]);
  }

  _handleMessage(msg) {
    if (typeof msg.id === "number" && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (typeof msg.method === "string") {
      this._emit(msg.method, msg.params);
    }
  }

  send(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.socket.write(this._encodeFrame(JSON.stringify({ id, method, params })));
    });
  }

  close() {
    try {
      this.socket?.destroy();
    } catch {
      // ignore
    }
  }
}
