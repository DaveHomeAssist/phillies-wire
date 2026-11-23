#!/usr/bin/env node
// Assemble a GitHub Pages `site/` artifact from the already-published
// repo tree, without running crawl, render, enrich, or email.
// Used by .github/workflows/deploy-pages-static.yml while the data
// publish workflow is paused. Keep asset lists in sync with render.mjs.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SITE_DIR = join(ROOT, "site");
const SITE_TMP_DIR = join(ROOT, "site.tmp");
const SITE_BACKUP_DIR = join(ROOT, "site.bak");

// Mirrors STATIC_ASSET_FILES / STATIC_ASSET_DIRS in render.mjs, plus the
// already-generated homepage, issues, archive, and SEO files.
const ROOT_FILES = [
  "index.html",
  "archive.json",
  "status.json",
  "latest.json",
  "robots.txt",
  "sitemap.xml",
  "feed.xml",
  "manifest.webmanifest",
  "favicon.svg",
  "og-default.svg",
  "CNAME",
  "fonts.css",
  "tokens.css",
  "phillies-wire.css",
  "pw-enhance.css",
  "site.css",
  "live-feed.js",
];

const ROOT_DIRS = [
  "fonts",
  "dashboard",
  "embed",
  "schedule",
  "shared",
  "calendar",
  "data",
  "hot-stove",
  "issues",
  "archive",
];

function copyDirectory(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir)) {
    if (entry === ".DS_Store") continue;
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    const stats = statSync(sourcePath);
    if (stats.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }
    copyFileSync(sourcePath, targetPath);
  }
}

function replaceSiteArtifact() {
  rmSync(SITE_BACKUP_DIR, { recursive: true, force: true });
  const hadPreviousSite = existsSync(SITE_DIR);
  if (hadPreviousSite) {
    renameSync(SITE_DIR, SITE_BACKUP_DIR);
  }
  try {
    renameSync(SITE_TMP_DIR, SITE_DIR);
  } catch (error) {
    if (hadPreviousSite && existsSync(SITE_BACKUP_DIR) && !existsSync(SITE_DIR)) {
      renameSync(SITE_BACKUP_DIR, SITE_DIR);
    }
    throw error;
  } finally {
    rmSync(SITE_BACKUP_DIR, { recursive: true, force: true });
  }
}

function main() {
  const indexPath = join(ROOT, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error("Missing index.html; cannot assemble a site artifact.");
  }
  if (!existsSync(join(ROOT, "hot-stove", "index.html"))) {
    throw new Error("Missing hot-stove/index.html; cannot assemble a site artifact.");
  }

  rmSync(SITE_TMP_DIR, { recursive: true, force: true });
  mkdirSync(SITE_TMP_DIR, { recursive: true });

  for (const file of ROOT_FILES) {
    const source = join(ROOT, file);
    if (existsSync(source)) {
      copyFileSync(source, join(SITE_TMP_DIR, file));
    }
  }
  for (const dir of ROOT_DIRS) {
    const source = join(ROOT, dir);
    if (existsSync(source)) {
      copyDirectory(source, join(SITE_TMP_DIR, dir));
    }
  }

  replaceSiteArtifact();
  const splash = join(SITE_DIR, "hot-stove", "index.html");
  const audio = join(SITE_DIR, "hot-stove", "hot-stove-audio.mp3");
  if (!existsSync(splash) || !existsSync(audio)) {
    throw new Error("Assembled site is missing /hot-stove/ assets.");
  }
  console.log("Assembled static site artifact at ./site (no pipeline run).");
}

main();
