// RELIABILITY: factcheck recap box-score URL (audit P0-FC-1)
//
// factcheck.mjs builds the previous-day box-score URL as `${MLB_API}.1/game/...`
// where MLB_API already ends in '/v1'. That yields /api/v1.1/game/<pk>/boxscore
// — an invalid endpoint (v1.1 serves feed/live, not boxscore). The fetch 404s,
// is swallowed by `.catch(() => null)`, and reconcileRecap never runs, so a
// wrong recap score can publish unchecked. This is the single highest-value
// correctness gap: the gate that exists to catch a wrong final score is off.

import { readFileSync } from "node:fs";
import {
  fetchJSON,
  pickStandingsLeader,
  pickStatus,
  shouldEmailReport,
} from "../../factcheck.mjs";
import { test, run, assert } from "./_harness.mjs";

const source = readFileSync(new URL("../../factcheck.mjs", import.meta.url), "utf8");

// Self-evident endpoint-shape check (mirrors how MLB Stats API is namespaced).
test("the MLB boxscore endpoint lives under /api/v1, not /api/v1.1", () => {
  const base = "https://statsapi.mlb.com/api/v1";
  const buggy = `${base}.1/game/777/boxscore`;
  const correct = `${base}/game/777/boxscore`;
  assert.ok(buggy.includes("/api/v1.1/"), "sanity: the .1 form is the broken v1.1 path");
  assert.ok(correct.includes("/api/v1/game/"), "sanity: the correct form is v1");
});

test("P1-FC-2: factcheck fetches time out instead of hanging indefinitely", async () => {
  await assert.rejects(
    () => fetchJSON("https://example.invalid/slow", {
      timeoutMs: 5,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    }),
    /timed out/,
  );
});

test("P1-FC-2: boxscore fetch failures are recorded as unverified instead of swallowed", () => {
  assert.ok(source.includes("recap-boxscore-api-unreachable"));
  assert.ok(source.includes("Could not reach MLB Stats API boxscore for recap reconciliation"));
});

test("P1-FC-3: unverified source gaps affect status and alerting", () => {
  const findings = { accurate: [], errors: [], stale: [], pipeline: [], unverified: [{ id: "api", title: "API unreachable" }] };
  assert.equal(pickStatus(findings), "Unverified");
  assert.equal(shouldEmailReport(findings), true);
});

test("P2-FC-4: standings leader is chosen by record, not fragile GB text", () => {
  const leader = pickStandingsLeader([
    { abbr: "ATL", wins: 10, losses: 7, gb: "\u2014" },
    { abbr: "PHI", wins: 12, losses: 6, gb: "0.0" },
    { abbr: "NYM", wins: 11, losses: 8, gb: "1.5" },
  ]);
  assert.equal(leader.abbr, "PHI");
});

// --- Pin (open P0) ---

test("PIN P0: factcheck must not build the box-score URL as ${MLB_API}.1/game", () => {
  assert.ok(
    !/\$\{MLB_API\}\.1\/game\//.test(source),
    "found `${MLB_API}.1/game/` — boxscore fetch targets the invalid v1.1 path and is silently swallowed",
  );
});

test("PIN P0: factcheck fetches the box score from a valid v1 endpoint", () => {
  assert.ok(
    /\$\{MLB_API\}\/game\/\$\{gamePk\}\/boxscore/.test(source),
    "expected a `${MLB_API}/game/${gamePk}/boxscore` fetch (v1)",
  );
});

await run();
