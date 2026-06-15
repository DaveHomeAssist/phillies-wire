// Unified test runner for Phillies Wire.
//
// Replaces the brittle `node a.test.mjs && node b.test.mjs && ...` chain in
// package.json. The chain aborts on the first failure, so a single early
// breakage hides every downstream result. This runner executes EVERY test
// file in its own child process, captures pass/fail + duration, and prints a
// summary table at the end. Exit code is non-zero if any test failed, so it
// still gates CI.
//
// Usage:
//   node scripts/test-runner.mjs                  # runs test/*.test.mjs (default suite)
//   node scripts/test-runner.mjs test/reliability # runs a specific dir
//   node scripts/test-runner.mjs test test/reliability  # multiple dirs
//
// A directory argument runs every *.test.mjs directly inside it (non-recursive)
// so the default suite and the reliability suite stay cleanly separated.

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const targetDirs = args.length ? args : ["test"];

function collectTests(dir) {
  const abs = join(repoRoot, dir);
  let entries;
  try {
    entries = readdirSync(abs);
  } catch {
    console.error(`Test directory not found: ${dir}`);
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => join(abs, name))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

const files = targetDirs.flatMap(collectTests);
if (!files.length) {
  console.error("No test files found.");
  process.exit(1);
}

const results = [];
let longestName = 0;

for (const file of files) {
  const rel = relative(repoRoot, file);
  longestName = Math.max(longestName, rel.length);
  const start = Date.now();
  const proc = spawnSync(process.execPath, [file], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  const durationMs = Date.now() - start;
  const passed = proc.status === 0;
  results.push({
    rel,
    passed,
    durationMs,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    status: proc.status,
  });
}

const passCount = results.filter((r) => r.passed).length;
const failCount = results.length - passCount;

console.log("\n" + "=".repeat(longestName + 18));
console.log("PHILLIES WIRE TEST HARNESS");
console.log("=".repeat(longestName + 18));
for (const r of results) {
  const icon = r.passed ? "PASS" : "FAIL";
  console.log(`${icon}  ${r.rel.padEnd(longestName)}  ${String(r.durationMs).padStart(5)}ms`);
}
console.log("-".repeat(longestName + 18));
console.log(`${results.length} files  ${passCount} passed  ${failCount} failed`);
console.log("=".repeat(longestName + 18) + "\n");

if (failCount) {
  console.log("Failure detail:\n");
  for (const r of results.filter((x) => !x.passed)) {
    console.log(`----- ${r.rel} (exit ${r.status}) -----`);
    const body = (r.stdout + r.stderr).trim().split("\n").slice(-25).join("\n");
    console.log(body || "(no output)");
    console.log("");
  }
}

process.exit(failCount ? 1 : 0);
