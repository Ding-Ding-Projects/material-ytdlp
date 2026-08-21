#!/usr/bin/env node
// Picks one dim sum dish as the code name for a release, and downloads its
// photo so the release can attach a real image.
//
// Every dish is used at most once per project. A repeated code name makes two
// different builds indistinguishable in conversation, which is the one job a
// code name has. The record of what has already been used lives in
// docs/dim-sum-used.json, committed, so the mapping is auditable.
//
// Photos are never generated here and never copied into this repository. They
// come from the public catalog at Ding-Ding-Projects/dim-sum-photos, which owns
// image generation and publication. A dish whose photo has not been published
// there yet is simply unavailable, and this script says so rather than
// inventing a substitute.
//
// This is decoration with a purpose, not a gate: if nothing can be resolved,
// the script exits 0 and prints nothing usable, so a release still ships.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USED_FILE = path.join(REPO_ROOT, "docs", "dim-sum-used.json");
const CATALOG_URL =
  "https://raw.githubusercontent.com/Ding-Ding-Projects/dim-sum-photos/main/catalog/index.json";
const PHOTO_REPO = "Ding-Ding-Projects/dim-sum-photos";

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
}

function readUsed() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USED_FILE, "utf8"));
    return Array.isArray(parsed.used) ? parsed.used : [];
  } catch {
    return [];
  }
}

async function main() {
  const outDir = process.argv[2] || REPO_ROOT;

  const catalogResponse = await fetch(CATALOG_URL);
  if (!catalogResponse.ok) {
    console.error(`Dim sum catalog unavailable (HTTP ${catalogResponse.status}). Skipping code name.`);
    return;
  }
  const catalog = await catalogResponse.json();
  const dishes = Array.isArray(catalog.dishes) ? catalog.dishes : [];

  // Which dish photos have actually been published. A catalog record without a
  // published asset is not usable, however complete the record looks.
  const releases = JSON.parse(gh(["release", "list", "-R", PHOTO_REPO, "--limit", "200", "--json", "tagName"]));
  const available = new Map(); // dish id -> { tag, assetName }
  for (const release of releases) {
    let assets;
    try {
      assets = JSON.parse(
        gh(["release", "view", release.tagName, "-R", PHOTO_REPO, "--json", "assets"])
      ).assets;
    } catch {
      continue;
    }
    for (const asset of assets) {
      const match = /^(hk-dish-\d+)-.*\.png$/.exec(asset.name);
      if (match && !available.has(match[1])) {
        available.set(match[1], { tag: release.tagName, assetName: asset.name });
      }
    }
  }

  const used = new Set(readUsed());
  const dish = dishes.find((d) => available.has(d.id) && !used.has(d.id));

  if (!dish) {
    console.error(
      `No unused dish with a published photo (catalog ${dishes.length} dishes, ` +
        `${available.size} with photos, ${used.size} already used). Shipping without a code name.`
    );
    return;
  }

  const { tag, assetName } = available.get(dish.id);
  const destination = path.join(outDir, assetName);
  gh(["release", "download", tag, "-R", PHOTO_REPO, "--pattern", assetName, "--dir", outDir, "--clobber"]);

  if (!fs.existsSync(destination) || fs.statSync(destination).size === 0) {
    console.error(`Downloaded ${assetName} is missing or empty. Shipping without a code name.`);
    return;
  }

  const result = {
    id: dish.id,
    nameEn: dish.name.en,
    nameZhHant: dish.name.zhHant,
    assetName,
    assetPath: destination,
    sourceTag: tag,
    sourceRepo: PHOTO_REPO,
    bytes: fs.statSync(destination).size,
  };

  // Machine-readable on stdout so a workflow can consume it.
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  // Never fail a release over decoration.
  console.error(`Dim sum code name could not be resolved: ${error.message}`);
});
