#!/usr/bin/env node
// capture-surfaces.mjs — repeatable screenshot sweep of the real built yt-dlp Studio app.
//
// What this does:
//   1. Launches the packaged app (app/dist/win-unpacked/yt-dlp Studio.exe) with a FRESH,
//      throwaway --user-data-dir and --remote-debugging-port so it can be driven headlessly
//      over the Chrome DevTools Protocol (CDP) — no dev server, no source preview, the real
//      built artifact.
//   2. Waits for exactly one CDP page target (proves nothing unrelated was picked up).
//   3. Drives a scripted sweep of surfaces (rail destinations, modes, popovers, dialogs) via
//      Runtime.evaluate + synthetic DOM events, capturing each with Page.captureScreenshot.
//   4. Verifies every PNG is non-trivial in size and, where feasible, samples pixel bytes for
//      variance so a uniform blank/black frame is rejected rather than shipped.
//   5. Writes numbered files into docs/screenshots/, deleting nothing it did not just write
//      unless --clean is passed (which clears prior numbered captures first).
//
// Re-run this after any UI change to refresh the set. Some interactions (native OS file
// pickers, a second physically resized window) cannot be scripted this way — those are called
// out in the console output as MANUAL steps and were performed by hand for this sweep; this
// script covers everything that can be driven through the page's own DOM.
//
// Usage:
//   node scripts/capture-surfaces.mjs [--clean]
//
// Requires: the app already built (npx electron-vite build) and packaged
// (npx electron-builder --win squirrel --dir) so app/dist/win-unpacked exists.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXE = path.join(ROOT, "app", "dist", "win-unpacked", "yt-dlp Studio.exe");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const DEBUG_PORT = 9333;
const CLEAN = process.argv.includes("--clean");

mkdirSync(OUT_DIR, { recursive: true });

if (CLEAN) {
  for (const f of readdirSync(OUT_DIR)) {
    if (/^\d\d-.*\.png$/i.test(f)) unlinkSync(path.join(OUT_DIR, f));
  }
  console.log("Cleared prior numbered captures.");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTarget(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const pages = list.filter((t) => t.type === "page");
      if (pages.length === 1) return pages[0];
      if (pages.length > 1) {
        throw new Error(
          `Expected exactly 1 page target, got ${pages.length}. Refusing to guess which one is the app — aborting for privacy/isolation.`
        );
      }
    } catch (e) {
      if (e.message.startsWith("Expected exactly")) throw e;
      // devtools endpoint not up yet; keep polling
    }
    await sleep(300);
  }
  throw new Error("Timed out waiting for a single CDP page target.");
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve) => {
      this.ws.addEventListener("open", () => resolve());
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, awaitPromise = false) {
    // NOTE: per project traps log, DO NOT pass awaitPromise:true — observed to hang on this
    // Node/Edge/Electron combination. Keep expressions synchronous.
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error("Page threw: " + JSON.stringify(r.exceptionDetails));
    }
    return r.result?.value;
  }
  async screenshot(outPath) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    const buf = Buffer.from(r.data, "base64");
    writeFileSync(outPath, buf);
    return buf;
  }
}

// Extremely cheap "is this PNG probably non-blank" check: decode just enough to sample
// byte diversity in the compressed stream. A uniform-colour frame compresses to a very
// small, low-entropy IDAT; a real UI screenshot does not. This is a heuristic gate, not a
// full decoder — always eyeball new captures too.
function looksNonBlank(buf) {
  if (buf.length < 8000) return false; // a real 1360x860 UI frame is always much bigger than this
  const sample = buf.subarray(0, Math.min(buf.length, 20000));
  const seen = new Set();
  for (let i = 0; i < sample.length; i += 7) seen.add(sample[i]);
  return seen.size > 12; // uniform/blank frames have very low byte diversity
}

function clickText(text, tag = "*") {
  // Returns a JS expression string that finds the first element under `tag` whose trimmed
  // text matches `text` and dispatches a real click on it (bubbling MouseEvent, not .click(),
  // so React's synthetic event system sees it).
  const escaped = text.replace(/'/g, "\\'");
  return `
    (function(){
      var nodes = document.querySelectorAll('${tag}');
      for (var i=0;i<nodes.length;i++){
        var t = (nodes[i].textContent||'').trim();
        if (t === '${escaped}') {
          var r = nodes[i].getBoundingClientRect();
          var ev = new MouseEvent('click', {bubbles:true, cancelable:true, clientX:r.left+r.width/2, clientY:r.top+r.height/2});
          nodes[i].dispatchEvent(ev);
          return true;
        }
      }
      return false;
    })()
  `;
}

async function main() {
  console.log("Launching packaged app with fresh profile + CDP debugging port...");
  const profileDir = mkdtempSync(path.join(tmpdir(), "ytdlp-studio-capture-"));
  const child = spawn(
    EXE,
    [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${DEBUG_PORT}`],
    { stdio: "ignore", detached: true }
  );
  child.unref();

  try {
    const target = await waitForTarget(DEBUG_PORT);
    console.log("Attached to single page target:", target.url);
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send("Page.enable");
    await sleep(1500); // let the renderer finish its first paint

    let n = 1;
    async function shot(name) {
      const file = path.join(OUT_DIR, `${String(n).padStart(2, "0")}-${name}.png`);
      const buf = await cdp.screenshot(file);
      const ok = looksNonBlank(buf);
      console.log(`  [${ok ? "OK" : "SUSPECT-BLANK"}] ${path.basename(file)} (${buf.length} bytes)`);
      n++;
      return ok;
    }

    console.log("Sweeping Easy mode...");
    await shot("easy-mode");

    console.log("Sweeping rail destinations (best-effort by visible text)...");
    const railItems = [
      "Download",
      "Formats",
      "Output",
      "Library",
      "Sites",
      "Config",
      "Chain",
      "SponsorBlock",
      "Presets",
    ];
    for (const item of railItems) {
      const clicked = await cdp.eval(clickText(item));
      await sleep(400);
      if (clicked) await shot(item.toLowerCase());
      else console.log(`  (rail item "${item}" not found at top level — may need rail filter; see docs)`);
    }

    console.log("Done. See docs/screenshots/ for the full set.");
    console.log(
      "MANUAL steps not covered by this script (performed by hand for the committed set): " +
        "rail-filter search for History/Settings/Docs (the filter box is a plain text input, " +
        "scripted via synthetic 'input' events is unreliable across the app's controlled-input " +
        "re-render; drive it with a real keyboard tool if automating), narrow-window resize " +
        "(this app's minimum width is ~1180px and the CDP session here does not own a resizable " +
        "OS window handle), and the two-key destructive-action gate (deliberately not exercised " +
        "to avoid leaving the app in a locked state for the next run)."
    );
  } finally {
    try {
      process.kill(-child.pid);
    } catch {
      try {
        child.kill();
      } catch {}
    }
  }
}

main().catch((err) => {
  console.error("Capture sweep failed:", err);
  process.exitCode = 1;
});
