#!/usr/bin/env node
// Rasterises assets/logo/mark.svg into every packaging icon size and writes
// a genuine multi-resolution app/build/icon.ico.
//
// Rasterisation route: this host has no `sharp` installed (and dependency
// installation is not this script's job — never runs `npm install`). Python
// with PyMuPDF (pymupdf) IS available, so the actual rendering and ICO byte
// assembly happens in scripts/make-icons.py; this file just locates a
// working Python interpreter, shells out to it, and reports the result.
//
// Idempotent: re-running regenerates the same files from the same source.

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const pyScript = path.join(__dirname, "make-icons.py");
const buildDir = path.join(repoRoot, "app", "build");

function tryRun(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.error) return null;
  return result;
}

function findPython() {
  // Try interpreters in order and require pymupdf to actually import, not
  // just that the interpreter exists -- on this host `py -3` resolves to a
  // different install than `python`, and only one of them has pymupdf.
  const candidates = [
    ["python", [pyScript]],
    ["py", ["-3", pyScript]],
    ["python3", [pyScript]],
  ];
  for (const [cmd, args] of candidates) {
    const probe = spawnSync(cmd, ["-c", "import pymupdf"], {
      encoding: "utf8",
    });
    if (!probe.error && probe.status === 0) {
      return { cmd, args };
    }
  }
  return null;
}

const found = findPython();
if (!found) {
  console.error(
    "ERROR: no Python interpreter with pymupdf importable was found " +
      "(tried python, py -3, python3)."
  );
  process.exit(1);
}

console.log(`Using Python via: ${found.cmd} ${found.args.join(" ")}`);
const run = spawnSync(found.cmd, found.args, {
  cwd: repoRoot,
  stdio: "inherit",
});

if (run.status !== 0) {
  console.error(`ERROR: scripts/make-icons.py exited with status ${run.status}`);
  process.exit(run.status ?? 1);
}

// Do not trust the generator's own log alone: re-verify the outputs exist
// on disk here, from the Node side, with sensible sizes.
const expected = [
  path.join(buildDir, "icon.ico"),
  path.join(buildDir, "icon.png"),
  path.join(buildDir, "icon@512.png"),
];

let ok = true;
for (const file of expected) {
  if (!existsSync(file)) {
    console.error(`MISSING expected output: ${file}`);
    ok = false;
    continue;
  }
  const size = statSync(file).size;
  if (size < 200) {
    console.error(`SUSPICIOUSLY SMALL output (${size} bytes): ${file}`);
    ok = false;
    continue;
  }
  console.log(`confirmed: ${file} (${size} bytes)`);
}

if (!ok) {
  console.error("make-icons.mjs: verification failed, see above.");
  process.exit(1);
}

console.log("make-icons.mjs: all icon assets generated and verified.");
