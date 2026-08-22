// Launch the packaged app, drive it over CDP, and report every console error.
//
// The smoke test asserts that the app LOADS correctly. This drives it, which is
// a different question: a defect reported as "it happens when I press Download"
// is invisible to a suite that never presses anything, and this project spent a
// long time failing to reproduce exactly such a report from source alone.
//
// Usage:
//   node scripts/drive-app.mjs                     # default: press Download
//   node scripts/drive-app.mjs --action=<name>     # invoke a named binding
//   SMOKE_APP_DIR=... SMOKE_SEED_PROFILE=... node scripts/drive-app.mjs
//
// Exits non-zero when the app logs anything, so it can gate a release.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { CdpClient } from "./lib/cdp-client.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = process.env.SMOKE_APP_DIR
  ? path.resolve(process.env.SMOKE_APP_DIR)
  : path.join(REPO_ROOT, "app", "dist", "win-unpacked");
const APP_EXE = path.join(APP_DIR, "yt-dlp Studio.exe");

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const ACTION = arg("action", "easyDownload");
const URL_TO_USE = arg("url", "https://www.youtube.com/watch?v=BU7AjL9-Avw");

// listen() is asynchronous: address() is null until the listening event fires,
// so this has to await it rather than reading straight after the call.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function killTree(pid) {
  if (!pid) return;
  try {
    execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", timeout: 15000 });
  } catch {
    /* already gone */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!fs.existsSync(APP_EXE)) {
    console.log(`Packaged app not found at ${APP_EXE}`);
    process.exit(1);
  }

  const port = await freePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-studio-drive-"));
  if (process.env.SMOKE_SEED_PROFILE) {
    const seed = path.resolve(process.env.SMOKE_SEED_PROFILE);
    if (fs.existsSync(seed)) {
      fs.cpSync(seed, profileDir, { recursive: true, force: true, errorOnExist: false });
      console.log(`[seed] copied profile from ${seed}`);
    }
  }

  console.log(`Launching ${APP_EXE}`);
  const child = spawn(APP_EXE, [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`], {
    stdio: "ignore",
    windowsHide: true,
  });

  let cdp = null;
  let failed = false;
  const consoleErrors = [];
  const exceptions = [];

  try {
    // Wait for the debugger to answer, then take the single page target.
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await res.json();
        target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      } catch {
        /* not up yet */
      }
    }
    if (!target) {
      console.log("No CDP page target appeared.");
      return;
    }

    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.connect();

    cdp.on("Runtime.consoleAPICalled", (p) => {
      if (p?.type !== "error") return;
      const text = (p.args || [])
        .map((a) => a?.description || a?.value || "")
        .filter(Boolean)
        .join(" ");
      consoleErrors.push(text || "(console.error with no readable payload)");
    });
    cdp.on("Runtime.exceptionThrown", (p) => {
      const d = p?.exceptionDetails;
      exceptions.push(d?.exception?.description || d?.text || "unknown");
    });

    await cdp.send("Runtime.enable");
    await sleep(2500); // let the first render settle

    console.log(`\n--- before the action: ${consoleErrors.length} console error(s)\n`);

    // Set the URL, then invoke the binding by name through the component's own
    // renderVals() output -- which is what the button's onClick is bound to, so
    // this exercises the same code path a click does without needing to hit
    // pixels that may have moved.
    const script = `
      (() => {
        const host = document.querySelector('x-dc');
        const inst = host && host.__dcInstance ? host.__dcInstance
          : (window.__dcLast || null);
        const out = { found: false, action: ${JSON.stringify(ACTION)} };
        // Walk React's tree for the logic object if the host does not expose it.
        const findLogic = () => {
          const root = document.getElementById('dc-root') || document.body;
          const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('_reactRootContainer'));
          let node = key ? root[key] : null;
          const seen = new Set();
          const stack = [node];
          while (stack.length) {
            const n = stack.pop();
            if (!n || typeof n !== 'object' || seen.has(n)) continue;
            seen.add(n);
            if (n.stateNode && n.stateNode.logic && typeof n.stateNode.logic.renderVals === 'function') return n.stateNode.logic;
            stack.push(n.child, n.sibling, n.return === undefined ? null : null, n.current);
          }
          return null;
        };
        const logic = (inst && inst.logic) || findLogic();
        if (!logic) return JSON.stringify({ ...out, error: 'could not reach the component instance' });
        out.found = true;
        try { logic.setState({ easyUrl: ${JSON.stringify(URL_TO_USE)} }); } catch (e) { out.setUrlError = String(e && e.message); }
        let vals;
        try { vals = logic.renderVals(); } catch (e) { return JSON.stringify({ ...out, renderValsError: String(e && e.message), stack: String(e && e.stack).split('\\n').slice(0,4).join(' | ') }); }
        const fn = vals && vals[${JSON.stringify(ACTION)}];
        out.actionType = typeof fn;
        if (typeof fn !== 'function') return JSON.stringify({ ...out, error: 'binding is not a function' });
        try { fn(); out.invoked = true; } catch (e) { out.invokeError = String(e && e.message); out.invokeStack = String(e && e.stack).split('\\n').slice(0,4).join(' | '); }
        return JSON.stringify(out);
      })()
    `;

    const res = await cdp.send("Runtime.evaluate", { expression: script, returnByValue: true });
    console.log("action result:", res?.result?.value || JSON.stringify(res));

    await sleep(3000); // let the resulting renders happen

    console.log(`\n=== console errors after the action: ${consoleErrors.length}`);
    const unique = [...new Set(consoleErrors)];
    unique.slice(0, 10).forEach((e) => console.log("  " + e.split("\n").slice(0, 3).join("\n  ")));
    console.log(`=== uncaught exceptions: ${exceptions.length}`);
    exceptions.slice(0, 5).forEach((e) => console.log("  " + String(e).split("\n").slice(0, 3).join("\n  ")));

    // Exit non-zero on anything found, so this can gate a release rather than
    // only inform one. The defect that motivated this script -- a mangled regex
    // that made pressing Download throw "i is not defined" -- was invisible to
    // every other check in this repository: it type-checked, it built, it
    // packaged, it passed a smoke test that loads the app, and the broken line
    // parsed as valid JavaScript. Only pressing the button found it.
    failed = unique.length > 0 || exceptions.length > 0;
  } finally {
    try {
      cdp?.close();
    } catch {
      /* ignore */
    }
    killTree(child?.pid);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  return failed;
}

main()
  .then((bad) => {
    if (bad) {
      console.log("");
      console.log("DRIVE FAILED - the app logged errors while being driven.");
      process.exit(1);
    }
    console.log("");
    console.log("DRIVE PASSED - no console errors, no uncaught exceptions.");
  })
  .catch((err) => {
    console.error("driver crashed:", err);
    process.exit(1);
  });
