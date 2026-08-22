#!/usr/bin/env node
// Smoke-tests the PACKAGED application: launches the real built exe, drives it
// over the Chrome DevTools Protocol, and asserts it actually starts and
// renders rather than merely that its source compiled.
//
// This project deliberately runs no lint and no test gate in CI (see
// AGENTS.md and .github/workflows/release.yml) — those are opinions about
// code style. This is different in kind: it is the one check that answers
// whether the artifact about to be handed to a user actually works. Twice
// already this project shipped something that looked entirely fine in source
// and was dead on arrival at runtime — a dynamically-linked ffmpeg that only
// worked on the machine that built it, and a dialog built on
// `window.prompt()`, which Electron does not implement. Neither defect is
// visible by reading code or by any lint/type check. This is the test that
// would have caught both, and it is intentionally allowed to fail the
// release: an installer whose application will not launch is worse than no
// release at all.
//
// Usage: node scripts/smoke-test.mjs
// Exit code 0 on pass, non-zero on any failed assertion.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Which packaged build to drive. Defaults to the normal output directory;
// SMOKE_APP_DIR points it at another one, which is how a verification run
// gets past a previous build whose files Windows still has locked.
const APP_DIR = process.env.SMOKE_APP_DIR
  ? path.resolve(process.env.SMOKE_APP_DIR)
  : path.join(REPO_ROOT, "app", "dist", "win-unpacked");
const APP_EXE = path.join(APP_DIR, "yt-dlp Studio.exe");
const BUILT_RENDERER = path.join(REPO_ROOT, "app", "out", "renderer", "index.html");
const PACKAGED_ASAR = path.join(APP_DIR, "resources", "app.asar");
const RESOURCES_DIR = path.join(APP_DIR, "resources");
const BIN_DIR = path.join(RESOURCES_DIR, "bin");

const EXPECTED_TITLE = "yt-dlp Studio";
const EXPECTED_SHELL_COPY = ["Paste a link", "Pick a quality", "Download"];
// A known fabricated queue row that used to render on a completely fresh
// profile. The app ships with no seeded data, so this string — or any of its
// distinctive fragments — must never appear on first launch.
const KNOWN_FABRICATED_STRINGS = ["Big Buck Bunny"];

const results = [];
let overallOk = true;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) overallOk = false;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? " — " + detail : ""}`);
}

function fail(name, detail) {
  record(name, false, detail);
}

function pass(name, detail) {
  record(name, true, detail);
}

// ---------------------------------------------------------------------------
// Step 1: locate the packaged app
// ---------------------------------------------------------------------------

function assertPackagedAppExists() {
  if (!fs.existsSync(APP_EXE)) {
    fail(
      "Packaged app exists",
      `not found at "${APP_EXE}". Run "npx electron-vite build" then ` +
        `"npx electron-builder --win squirrel" from app/, or run build-installer.bat, ` +
        `to produce app/dist/win-unpacked/.`
    );
    return false;
  }
  pass("Packaged app exists", APP_EXE);

  // The packaged app is a SNAPSHOT of app/out taken by electron-builder. Running
  // `electron-vite build` refreshes app/out and leaves the package untouched, so
  // a renderer fix can land, type-check, build cleanly -- and this suite will
  // still be driving the previous build, reporting green about code that is no
  // longer in the tree. Measured once: the package was four hours behind app/out
  // and a full pass was reported against it.
  //
  // Nothing about that is visible from inside the run. The app launches, every
  // assertion passes, and the only tell is a fix that appears to change nothing.
  if (fs.existsSync(PACKAGED_ASAR) && fs.existsSync(BUILT_RENDERER)) {
    const packagedAt = fs.statSync(PACKAGED_ASAR).mtimeMs;
    const builtAt = fs.statSync(BUILT_RENDERER).mtimeMs;
    if (builtAt > packagedAt) {
      const behind = Math.round((builtAt - packagedAt) / 1000);
      fail(
        "Packaged app is current with app/out",
        `the package is ${behind}s behind app/out/renderer/index.html, so this run ` +
          `would verify a stale build. Repackage first: ` +
          `cd app && npx electron-builder --win squirrel`,
      );
      return false;
    }
    pass("Packaged app is current with app/out");
  }

  return true;
}

// ---------------------------------------------------------------------------
// Step 2: bundled binaries resolve and run
// ---------------------------------------------------------------------------

function assertBundledBinariesRun() {
  const checks = [
    { name: "yt-dlp.exe", flag: "--version" },
    { name: "ffmpeg.exe", flag: "-version" },
    { name: "ffprobe.exe", flag: "-version" },
  ];
  for (const { name, flag } of checks) {
    const p = path.join(BIN_DIR, name);
    if (!fs.existsSync(p)) {
      fail(`Bundled binary present: ${name}`, `missing at "${p}"`);
      continue;
    }
    try {
      const out = execFileSync(p, [flag], { encoding: "utf8", timeout: 15000 });
      const firstLine = out.split(/\r?\n/)[0] || "(empty output)";
      pass(`Bundled binary runs: ${name} ${flag}`, firstLine.slice(0, 120));
    } catch (err) {
      fail(
        `Bundled binary runs: ${name} ${flag}`,
        `exited with error: ${err.message.split("\n")[0]}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Step 3: launch with remote debugging + a fresh, disposable profile
// ---------------------------------------------------------------------------

async function findFreePort(candidates) {
  for (const port of candidates) {
    const free = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, "127.0.0.1", () => {
        srv.close(() => resolve(true));
      });
    });
    if (free) return port;
  }
  return null;
}

async function fetchJson(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function waitForPageTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastList = null;
  while (Date.now() < deadline) {
    const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    if (Array.isArray(list)) {
      lastList = list;
      const page = list.find(
        (t) => t.type === "page" && typeof t.webSocketDebuggerUrl === "string"
      );
      if (page) return page;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `no page target appeared on port ${port} within ${timeoutMs}ms. ` +
      `Last /json/list response: ${JSON.stringify(lastList)}`
  );
}

// Minimal hand-rolled WebSocket client for the Chrome DevTools Protocol.
// Node's built-in `WebSocket` (global, undici-backed) has been observed
// hanging indefinitely on Chromium's handshake in this environment — the
// connection opens, the upgrade response arrives, and no 'open' event ever
// fires. A raw client that speaks the RFC 6455 handshake and frame format by
// hand avoids that hang entirely and was verified to work reliably here.
class CdpClient {
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

function killProcessTree(pid) {
  if (!pid) return;
  try {
    execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: 15000,
    });
  } catch {
    // Process may have already exited; that is fine.
  }
}

async function main() {
  console.log("=== yt-dlp Studio smoke test ===");
  console.log(`App: ${APP_EXE}`);

  if (!assertPackagedAppExists()) {
    printSummaryAndExit();
    return;
  }

  assertBundledBinariesRun();

  const port = await findFreePort([9333, 9334, 9335, 9336, 9337]);
  if (!port) {
    fail("Find a free debugging port", "ports 9333-9337 were all busy");
    printSummaryAndExit();
    return;
  }

  // A fresh profile is the right default -- it is what proves the app works for
  // a new user. But it also means this suite never sees a defect that only
  // appears once real state has been persisted, which is exactly the shape of a
  // bug reported from a running install and not reproducible here.
  //
  // SMOKE_SEED_PROFILE points at an existing profile to COPY (never to use in
  // place -- the run would mutate the user's own state).
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-studio-smoke-"));
  if (process.env.SMOKE_SEED_PROFILE) {
    const seed = path.resolve(process.env.SMOKE_SEED_PROFILE);
    if (fs.existsSync(seed)) {
      fs.cpSync(seed, profileDir, { recursive: true, force: true, errorOnExist: false });
      console.log(`[seed] copied profile from ${seed}`);
    } else {
      console.log(`[seed] SMOKE_SEED_PROFILE not found: ${seed}`);
    }
  }
  let child = null;
  let cdp = null;
  const consoleErrors = [];
  const uncaughtExceptions = [];
  const externalRequests = [];

  try {
    child = spawn(
      APP_EXE,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        "--no-sandbox",
        "--disable-gpu-sandbox",
      ],
      { stdio: "ignore", detached: false }
    );

    child.on("error", (err) => {
      fail("Launch packaged app", err.message);
    });

    let target;
    try {
      target = await waitForPageTarget(port, 60000);
      pass("Page target appears over CDP", target.url || target.title || "(unnamed)");
    } catch (err) {
      fail("Page target appears over CDP", err.message);
      printSummaryAndExit();
      return;
    }

    cdp = new CdpClient(target.webSocketDebuggerUrl);
    try {
      await cdp.connect(15000);
      pass("CDP WebSocket connects");
    } catch (err) {
      fail("CDP WebSocket connects", err.message);
      printSummaryAndExit();
      return;
    }

    // A caught-and-logged error is still a broken app. The design's own runtime
    // wraps every lifecycle call in try/catch and console.errors whatever comes
    // out, so a method that throws on its very first statement never reaches
    // Runtime.exceptionThrown and this suite reported a clean 12/12 while the
    // renderer was throwing 476 times per reload. Nothing was visible on screen,
    // and the only real symptom was that settings silently never saved.
    //
    // So watch console.error too. A gate that only sees UNCAUGHT errors cannot
    // see the ones a framework politely catches, which are most of them.
    cdp.on("Runtime.consoleAPICalled", (params) => {
      if (params?.type !== "error") return;
      const text = (params.args || [])
        .map((a) => a?.description || a?.value || a?.unserializableValue || "")
        .filter(Boolean)
        .join(" ")
        .trim();
      consoleErrors.push(text || "console.error with no readable payload");
    });

    cdp.on("Runtime.exceptionThrown", (params) => {
      const detail = params?.exceptionDetails;
      const text =
        detail?.exception?.description || detail?.text || JSON.stringify(detail) || "unknown";
      uncaughtExceptions.push(text);
    });

    cdp.on("Network.requestWillBeSent", (params) => {
      const url = params?.request?.url || "";
      if (!url.startsWith("file://") && !url.startsWith("devtools://") && !url.startsWith("data:")) {
        externalRequests.push(url);
      }
    });

    try {
      await cdp.send("Runtime.enable");
      await cdp.send("Network.enable");
      await cdp.send("Page.enable");
    } catch (err) {
      fail("Enable CDP domains (Runtime/Network/Page)", err.message);
    }

    // Give the renderer a moment to finish its initial paint/script work
    // before we start asserting on it.
    await new Promise((r) => setTimeout(r, 3000));

    // --- Assertion: #dc-root exists with children ---
    try {
      const evalResult = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const el = document.getElementById('dc-root');
          if (!el) return { ok: false, reason: 'no element with id dc-root' };
          return { ok: el.children.length > 0, childCount: el.children.length };
        })()`,
        returnByValue: true,
      });
      const v = evalResult?.result?.value;
      if (v?.ok) pass("#dc-root exists and has children", `childCount=${v.childCount}`);
      else fail("#dc-root exists and has children", JSON.stringify(v));
    } catch (err) {
      fail("#dc-root exists and has children", err.message);
    }

    // --- Assertion: document title ---
    try {
      const evalResult = await cdp.send("Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
      });
      const title = evalResult?.result?.value;
      if (title === EXPECTED_TITLE) pass("Document title is correct", title);
      else fail("Document title is correct", `expected "${EXPECTED_TITLE}", got "${title}"`);
    } catch (err) {
      fail("Document title is correct", err.message);
    }

    // --- Assertion: recognisable shell copy in body text ---
    try {
      const evalResult = await cdp.send("Runtime.evaluate", {
        expression: "document.body ? document.body.innerText : ''",
        returnByValue: true,
      });
      const bodyText = evalResult?.result?.value || "";
      const missing = EXPECTED_SHELL_COPY.filter((s) => !bodyText.includes(s));
      if (missing.length === 0) {
        pass("Recognisable shell copy is present", EXPECTED_SHELL_COPY.join(" / "));
      } else {
        fail("Recognisable shell copy is present", `missing fragments: ${missing.join(", ")}`);
      }

      // --- Assertion: fresh profile has no fabricated data ---
      const foundFabricated = KNOWN_FABRICATED_STRINGS.filter((s) => bodyText.includes(s));
      if (foundFabricated.length === 0) {
        pass("Fresh profile has no fabricated queue rows");
      } else {
        fail(
          "Fresh profile has no fabricated queue rows",
          `found known-fabricated string(s): ${foundFabricated.join(", ")}`
        );
      }
    } catch (err) {
      fail("Recognisable shell copy is present", err.message);
      fail("Fresh profile has no fabricated queue rows", err.message);
    }

    // Let any deferred exceptions / network requests surface before judging them.
    await new Promise((r) => setTimeout(r, 2000));

    // --- Assertion: zero uncaught exceptions ---
    if (uncaughtExceptions.length === 0) {
      pass("Zero uncaught exceptions");
    } else {
      fail("Zero uncaught exceptions", uncaughtExceptions.slice(0, 5).join(" | "));
    }

    // --- Assertion: zero console errors ---
    // Deliberately has no allowlist. The moment one exists, the entry that
    // matters gets added to it by whoever is in a hurry.
    if (consoleErrors.length === 0) {
      pass("Zero console errors");
    } else {
      const unique = [...new Set(consoleErrors)];
      fail(
        "Zero console errors",
        `${consoleErrors.length} logged (${unique.length} distinct): ` +
          unique.slice(0, 3).join(" | "),
      );
    }

    // --- Assertion: zero external network requests ---
    if (externalRequests.length === 0) {
      pass("Zero external network requests (app works offline)");
    } else {
      fail(
        "Zero external network requests (app works offline)",
        externalRequests.slice(0, 5).join(" | ")
      );
    }
  } catch (err) {
    fail("Smoke test run completed without an unexpected error", err.message || String(err));
  } finally {
    try {
      cdp?.close();
    } catch {
      // ignore
    }
    killProcessTree(child?.pid);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  printSummaryAndExit();
}

function printSummaryAndExit() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log("");
  console.log(`=== Summary: ${passed} passed, ${failed} failed ===`);
  if (!overallOk) {
    console.log("SMOKE TEST FAILED");
    process.exitCode = 1;
  } else {
    console.log("SMOKE TEST PASSED");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exitCode = 1;
});
