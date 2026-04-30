#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const RUNS = Number(process.env.RUNS || 100);
const MODE = process.env.LOOP_MODE || "live"; // live | daily | mixed

const results = [];
let lastTail = "";

function runOnce(mode) {
  const env = { ...process.env };
  if (mode === "live") {
    env.ISSUE_MODE = "live";
  } else {
    delete env.ISSUE_MODE;
  }
  delete env.ANTHROPIC_API_KEY; // never exercise enrich in the loop
  const start = Date.now();
  const result = spawnSync(process.execPath, ["run.mjs"], {
    encoding: "utf8",
    env,
  });
  const ms = Date.now() - start;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const tail = (stdout + stderr).split("\n").slice(-12).join("\n");
  return {
    mode,
    status: result.status,
    signal: result.signal,
    ms,
    stdout,
    stderr,
    tail,
  };
}

const startedAt = Date.now();
let passes = 0;
let fails = 0;

for (let i = 1; i <= RUNS; i++) {
  const mode = MODE === "mixed" ? (i % 2 === 0 ? "live" : "daily") : MODE;
  const r = runOnce(mode);
  const ok = r.status === 0 && !r.signal;
  results.push({ i, mode: r.mode, ok, status: r.status, signal: r.signal, ms: r.ms });
  if (ok) {
    passes++;
  } else {
    fails++;
    console.error(`\n=== run ${i} (${r.mode}) FAILED — status=${r.status} signal=${r.signal} ===`);
    console.error("--- STDOUT TAIL ---");
    console.error(r.tail);
    console.error("--- STDERR ---");
    console.error(r.stderr);
    writeFileSync("./reports/loop-failure.log", JSON.stringify({ run: i, mode: r.mode, status: r.status, stdout: r.stdout, stderr: r.stderr }, null, 2));
    process.exit(1);
  }
  process.stdout.write(`run ${String(i).padStart(3, " ")} ${r.mode.padEnd(5, " ")} OK ${r.ms}ms\n`);
  lastTail = r.tail;
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\nAll ${passes}/${RUNS} runs passed in ${elapsed}s.`);
console.log(`Last run tail:\n${lastTail}`);
