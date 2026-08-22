// Answer one question: when a download runs, does the MAIN process actually
// deliver progress events to the renderer?
//
// The app's own subscription is set up at mount, so watching its state cannot
// distinguish "main never sent anything" from "the renderer received events and
// failed to apply them". This installs a SECOND, independent subscriber through
// the same bridge and counts what arrives, which separates the two.

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
const URL_TO_USE =
  process.argv.find((a) => a.startsWith("--url="))?.slice(6) ||
  "https://www.youtube.com/watch?v=aqz-KE-bpKQ";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    /* gone */
  }
}

const FIND_LOGIC = `
  (() => {
    const root = document.getElementById('dc-root') || document.body;
    const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('_reactRootContainer'));
    const seen = new Set();
    const stack = [key ? root[key] : null];
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== 'object' || seen.has(n)) continue;
      seen.add(n);
      if (n.stateNode && n.stateNode.logic && typeof n.stateNode.logic.renderVals === 'function') return n.stateNode.logic;
      stack.push(n.child, n.sibling, n.current);
    }
    return null;
  })()
`;

async function main() {
  const port = await freePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-progress-"));
  const child = spawn(APP_EXE, [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`], {
    stdio: "ignore",
    windowsHide: true,
  });

  let cdp = null;
  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(500);
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      } catch {
        /* not up */
      }
    }
    if (!target) throw new Error("no CDP page target");

    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Runtime.enable");
    await sleep(2500);

    const evaluate = async (expr) => {
      const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true });
      if (r?.exceptionDetails) return { error: r.exceptionDetails.text || "eval threw" };
      return r?.result?.value;
    };

    // An independent subscriber, so this counts what MAIN sends regardless of
    // what the app's own handler does with it.
    console.log(
      "install independent listeners:",
      await evaluate(`
        (() => {
          const b = window.ytdlpStudio;
          if (!b || !b.jobs) return 'no bridge';
          window.__prog = []; window.__logs = 0; window.__states = [];
          b.jobs.onProgress(e => window.__prog.push(e && e.progress ? e.progress.pct : '(no progress field)'));
          b.jobs.onLog(() => window.__logs++);
          b.jobs.onState(e => window.__states.push(e && e.state));
          return 'installed';
        })()
      `),
    );

    console.log("start download:", await evaluate(`
      (() => {
        const logic = ${FIND_LOGIC};
        if (!logic) return 'no logic';
        logic.setState({ easyUrl: ${JSON.stringify(URL_TO_USE)} });
        const v = logic.renderVals();
        if (typeof v.easyDownload !== 'function') return 'no easyDownload';
        v.easyDownload();
        return 'started';
      })()
    `));

    for (let i = 0; i < 20; i++) {
      await sleep(2000);
      const snap = await evaluate(`
        JSON.stringify({
          progressEvents: (window.__prog || []).length,
          firstFew: (window.__prog || []).slice(0, 4),
          lastFew: (window.__prog || []).slice(-3),
          logEvents: window.__logs || 0,
          states: window.__states || [],
        })
      `);
      console.log(`  +${(i + 1) * 2}s  ${snap}`);
      const parsed = JSON.parse(snap || "{}");
      if ((parsed.states || []).some((s) => s === "done" || s === "error")) break;
    }
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
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});
