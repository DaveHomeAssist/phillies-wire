#!/usr/bin/env node
// Lightweight lint: run `node --check` against every .mjs/.js file to
// catch syntax errors before tests or render execute. Not a replacement
// for eslint — adopt eslint when the project needs richer rules.
import { readdirSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "site", ".claude"]);
const EXTENSIONS = new Set([".mjs", ".js"]);

const files = [];
collect(ROOT);

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed += 1;
    console.error(`Lint error: ${file}`);
    const stderr = (result.stderr ?? "").trim();
    if (stderr) {
      console.error(`  ${stderr.split("\n")[0]}`);
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} file${failed === 1 ? "" : "s"} failed syntax check.`);
  process.exit(1);
}

console.log(`Lint OK: ${files.length} file${files.length === 1 ? "" : "s"} parsed.`);

function collect(dir) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      collect(full);
      continue;
    }
    if (EXTENSIONS.has(extname(full))) {
      files.push(full);
    }
  }
}
