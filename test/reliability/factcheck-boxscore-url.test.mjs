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
  buildAccuracyReport,
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

test("P2-FC-5: accuracy export uses run time and current edition metadata", () => {
  const report = buildAccuracyReport({
    generatedAt: new Date("2026-06-17T11:05:20Z"),
    findings: { accurate: [], errors: [], stale: [], pipeline: [], unverified: [] },
    data: {
      meta: {
        date: "2026-06-17",
        volume: 1,
        edition: 78,
        publication: "Phillies Wire",
        generated_at: "2026-06-17T04:48:25.189Z",
        status: { generated_at_et: "Jun 17, 2026, 12:48 AM ET" },
      },
      hero: { headline: "Marlins @ Phillies \u00b7 Game 3 of 3" },
      record: { wins: 40, losses: 33, streak: "W2", division_rank: 2, division: "NL East" },
      sections: {
        game_status: {
          content: {
            matchup: "Marlins @ Phillies \u00b7 Game 3 of 3",
            first_pitch: "1:05 PM",
            venue: "Citizens Bank Park",
            starters: {
              home: { name: "Andrew Painter", hand: "R" },
              away: { name: "Sandy Alcantara", hand: "R" },
            },
            broadcast: { tv: "NBC 10", radio: "94 WIP" },
            weather: { temp_f: 64, condition: "Overcast", wind: "5 mph" },
          },
        },
        standings: { content: { teams: [{ abbr: "PHI", wins: 40, losses: 33, gb: "7.0", streak: "W2", is_phi: true }] } },
        lineup: { content: { mode_label: "Pending", status_note: "Lineups pending.", show_orders: false } },
        injury_report: { content: { il_entries: [{ name: "Kyle Backhus", position: "LHP", injury: "Left elbow inflammation", il_type: "15-day" }] } },
        preview: { content: { up_next: [{ date: "Thu, Jun 18", matchup: "PHI vs NYM", time: "6:40 PM", broadcast: "NBCSP" }] } },
      },
      next_game: { date: "Thu, Jun 18", matchup: "PHI vs NYM", time: "6:40 PM", broadcast: "NBCSP" },
    },
  });

  assert.equal(report.schema_version, "accuracy-1.0.0");
  assert.equal(report.edition_date, "2026-06-17");
  assert.equal(report.edition_label, "Vol. 1 \u00b7 No. 78");
  assert.equal(report.generated_at, "2026-06-17T11:05:20.000Z");
  assert.notEqual(report.generated_at, "2026-06-17T04:48:25.189Z");
  assert.equal(report.summary.inaccurate, 0);
  assert.equal(report.summary.relevancy.outdated, 0);
  assert.equal(report.summary.total_claims, report.sections.flatMap((section) => section.items).length);
});

test("P2-FC-5: accuracy export reflects factcheck findings in summary counts", () => {
  const report = buildAccuracyReport({
    generatedAt: "2026-06-17T11:05:20Z",
    data: { meta: { date: "2026-06-17", publication: "Phillies Wire" } },
    findings: {
      accurate: [],
      errors: [{ id: "bad-record", title: "Record disagrees with MLB API", detail: "Wire 1-0, API 0-1." }],
      stale: [{ id: "stale", title: "Edition date stale", detail: "Yesterday's copy." }],
      pipeline: [],
      unverified: [{ id: "api", title: "Transactions API unreachable", detail: "timeout" }],
    },
  });

  assert.equal(report.summary.inaccurate, 1);
  assert.equal(report.summary.unverifiable, 1);
  assert.equal(report.summary.relevancy.outdated, 1);
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
