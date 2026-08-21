#!/usr/bin/env node
// Points this checkout at the committed hooks in .githooks/.
//
// Git does not install hooks when a repository is cloned — .git/hooks is local
// and never travels — so a committed hook does nothing until someone runs this
// once. The build scripts call it, so in practice it happens on the first build
// rather than being a step anybody has to remember.
//
// What the hooks do: bring vendor/yt-dlp and vendor/ffmpeg up to their upstream
// tips after every pull and checkout. Both track master. This project wants the
// newest upstream rather than a frozen pin, because yt-dlp breaks whenever a
// site changes and is fixed upstream within days; a pin that never moves is a
// downloader that quietly stops working.
//
// The cost of that choice, stated plainly: two checkouts of the same commit of
// this repository can produce different binaries. Every build therefore writes a
// stamp recording the exact submodule commit it used, so an artifact stays
// traceable even though the pin moves underneath it.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(...args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

try {
  git("config", "core.hooksPath", ".githooks");
  // Makes an ordinary `git pull` bring submodules along, so a checkout is never
  // left with an empty vendor/ directory that looks like a broken clone.
  git("config", "submodule.recurse", "true");

  console.log("Hooks enabled: core.hooksPath = .githooks");
  console.log("Submodule recursion enabled: submodule.recurse = true");
  console.log("");
  console.log("vendor/yt-dlp and vendor/ffmpeg now advance to their upstream tips");
  console.log("on pull and checkout. To update them by hand at any time:");
  console.log("");
  console.log("  git submodule update --init --remote --recursive");
  console.log("");
  console.log("To skip the automatic update for one command, set");
  console.log("MATERIAL_YTDLP_SKIP_SUBMODULE_UPDATE=1.");
} catch (error) {
  // Never fail a build over hook configuration.
  console.error(`Could not enable hooks: ${error.message}`);
  process.exitCode = 0;
}
