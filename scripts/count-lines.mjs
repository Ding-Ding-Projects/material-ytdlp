#!/usr/bin/env node
// Committed line counter for yt-dlp Studio.
//
// Prints a markdown table breaking the project down by area, with total and
// non-blank line counts, a grand total, and git-blame-based agent-vs-human
// attribution over SURVIVING lines only (churn from `git log` is not
// authorship: a line written and later deleted belongs to nobody).
//
// Usage: node scripts/count-lines.mjs
//
// Excluded from every count: vendor/ (the yt-dlp submodule plus fetched
// binaries such as ffmpeg/ffprobe/yt-dlp.exe), node_modules, dist/out/build
// output, and .git itself. These are not the project's own code.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EXCLUDE_DIR_NAMES = new Set([
  "vendor",
  "node_modules",
  "dist",
  "out",
  "build",
  ".git",
  ".vite",
  "release",
]);

// Areas are matched by path prefix, in order; first match wins.
const AREAS = [
  { name: "App main process", prefix: "app/src/main/" },
  { name: "App preload", prefix: "app/src/preload/" },
  { name: "App renderer", prefix: "app/src/renderer/" },
  { name: "App (other)", prefix: "app/" },
  { name: "Scripts", prefix: "scripts/" },
  { name: "Docs", prefix: "docs/" },
  { name: "Design references", prefix: "design/" },
  { name: "Workflows", prefix: ".github/" },
];

const CODE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".json", ".css", ".scss", ".html",
  ".bat", ".ps1", ".sh",
  ".md", ".yml", ".yaml",
]);

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 * 256 });
}

function isExcluded(relPath) {
  const parts = relPath.split("/");
  return parts.some((p) => EXCLUDE_DIR_NAMES.has(p));
}

function areaFor(relPath) {
  for (const area of AREAS) {
    if (relPath.startsWith(area.prefix)) return area.name;
  }
  return "Other";
}

function listTrackedFiles() {
  const out = git(["ls-files", "-z"]);
  return out.split(String.fromCharCode(0)).filter(Boolean);
}

function headExists() {
  try {
    git(["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function countLines(absPath) {
  const buf = readFileSync(absPath);
  if (buf.includes(0)) return null; // real NUL byte: treat as binary, skip
  const text = buf.toString("utf8");
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.length === 0 ? [] : normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "" && normalized.endsWith("\n")) {
    lines.pop();
  }
  const total = lines.length;
  const nonBlank = lines.filter((l) => l.trim().length > 0).length;
  return { total, nonBlank };
}

// --- Attribution: per-file `git blame --line-porcelain`, summed over
// surviving lines only. A commit counts as agent-written when its author
// name/email is an automation identity, or its commit message carries a
// Co-Authored-By trailer naming an agent.
const AGENT_AUTHOR_PATTERNS = [/claude/i, /anthropic/i, /^codex$/i, /copilot/i];
const AGENT_TRAILER_PATTERN = /^Co-Authored-By:.*\b(claude|anthropic|codex)\b/im;

const commitAgentCache = new Map();

function commitIsAgent(sha) {
  if (commitAgentCache.has(sha)) return commitAgentCache.get(sha);
  let isAgent = false;
  try {
    const raw = git(["show", "-s", "--format=%an%n%ae%n%B", sha]);
    const lines = raw.split("\n");
    const authorName = lines[0] || "";
    const authorEmail = lines[1] || "";
    const body = lines.slice(2).join("\n");
    isAgent =
      AGENT_AUTHOR_PATTERNS.some((re) => re.test(authorName) || re.test(authorEmail)) ||
      AGENT_TRAILER_PATTERN.test(body);
  } catch {
    isAgent = false;
  }
  commitAgentCache.set(sha, isAgent);
  return isAgent;
}

function blameAttribution(relPath, hasHead) {
  if (!hasHead) return { agent: 0, human: 0 };
  let raw;
  try {
    raw = git(["blame", "--line-porcelain", "HEAD", "--", relPath]);
  } catch {
    return { agent: 0, human: 0 }; // e.g. file has no history yet
  }
  const lines = raw.split("\n");
  let agent = 0;
  let human = 0;
  let currentSha = null;
  for (const line of lines) {
    // A porcelain line starting a new blame entry: "<sha> <origLine> <finalLine> [<numLines>]"
    if (/^[0-9a-f]{40} \d+ \d+/.test(line)) {
      currentSha = line.slice(0, 40);
    } else if (line.startsWith("\t")) {
      if (currentSha) {
        if (commitIsAgent(currentSha)) agent += 1;
        else human += 1;
      }
    }
  }
  return { agent, human };
}

function main() {
  const hasHead = headExists();
  const files = listTrackedFiles().filter((f) => !isExcluded(f));

  const areaTotals = new Map(); // area -> { total, nonBlank }
  const excludedNote = [...EXCLUDE_DIR_NAMES].join(", ");

  let grandTotal = 0;
  let grandNonBlank = 0;
  let grandAgent = 0;
  let grandHuman = 0;
  let countedFiles = 0;

  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) continue;

    const abs = path.join(REPO_ROOT, rel);
    let counted;
    try {
      counted = countLines(abs);
    } catch {
      continue; // file listed by git but not present on disk (e.g. deleted, unstaged)
    }
    if (!counted) continue;

    countedFiles += 1;
    const area = areaFor(rel);
    const prev = areaTotals.get(area) || { total: 0, nonBlank: 0 };
    prev.total += counted.total;
    prev.nonBlank += counted.nonBlank;
    areaTotals.set(area, prev);

    grandTotal += counted.total;
    grandNonBlank += counted.nonBlank;

    const attrib = blameAttribution(rel, hasHead);
    grandAgent += attrib.agent;
    grandHuman += attrib.human;
  }

  const attribTotal = grandAgent + grandHuman;

  const rows = [...areaTotals.entries()].sort((a, b) => b[1].total - a[1].total);

  const lines = [];
  lines.push("# yt-dlp Studio - line count");
  lines.push("");
  lines.push(
    hasHead
      ? `Counted at commit \`${git(["rev-parse", "HEAD"]).trim()}\` over ${countedFiles} tracked source files.`
      : `Counted over ${countedFiles} tracked (staged/working-tree) source files. No commits exist yet, so git-blame attribution is not available and is reported as zero.`
  );
  lines.push("");
  lines.push(`Excluded (not the project's own code): ${excludedNote}.`);
  lines.push("");
  lines.push("| Area | Total lines | Non-blank lines |");
  lines.push("| --- | ---: | ---: |");
  for (const [name, counts] of rows) {
    lines.push(`| ${name} | ${counts.total} | ${counts.nonBlank} |`);
  }
  lines.push(`| **Grand total (project code)** | **${grandTotal}** | **${grandNonBlank}** |`);
  lines.push("");
  lines.push("## Agent vs. human attribution (surviving lines, via `git blame`)");
  lines.push("");
  lines.push(
    "A commit counts as agent-written when its author name/email matches a known automation " +
      "identity, or its message carries a `Co-Authored-By` trailer naming an agent. Counted per " +
      "surviving line, never by summing added lines from the log - churn is not authorship."
  );
  lines.push("");
  lines.push("| | Lines | Share |");
  lines.push("| --- | ---: | ---: |");
  lines.push(`| Agent-written | ${grandAgent} | ${attribTotal ? ((grandAgent / attribTotal) * 100).toFixed(1) : "0.0"}% |`);
  lines.push(`| Human-written | ${grandHuman} | ${attribTotal ? ((grandHuman / attribTotal) * 100).toFixed(1) : "0.0"}% |`);
  lines.push(`| **Total attributed** | **${attribTotal}** | 100.0% |`);
  lines.push("");

  if (hasHead && attribTotal !== grandTotal) {
    lines.push(
      `> **Note:** attributed total (${attribTotal}) differs from counted total (${grandTotal}). ` +
        "This should not happen; if it does, the counter has a bug and must be fixed before " +
        "this figure is published."
    );
    lines.push("");
  }

  const output = lines.join("\n");
  process.stdout.write(output + "\n");

  if (hasHead && attribTotal !== grandTotal) {
    process.exitCode = 1;
  }
}

main();
