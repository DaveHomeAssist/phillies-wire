// RELIABILITY: live-refresh source checks must not false-fail the verify gate
//
// Root cause of the "wire didn't fire" failures (2026-06-28): every pipeline
// run — daily AND the game-window live refresh — calls
// `factcheck.mjs --export-accuracy`, which runs the live-API source checks. On a
// live refresh the crawl deliberately PRESERVES the morning's editorial snapshot
// (recap, standings). Once the prior game goes Final overnight, the live MLB API
// moves ahead of that frozen snapshot, so the recap/standings reconciliation
// recorded a `findings.errors` entry. buildAccuracyReport maps errors ->
// verdict "inaccurate", and verify.mjs hard-fails when inaccurate !== 0, which
// gates the Pages deploy and (in daily mode) email delivery.
//
// Fix: run.mjs passes `--live-refresh` to the accuracy export on live runs, and
// factcheck routes those live-API disagreements to the non-blocking `unverified`
// bucket instead of `errors`. The strict daily gate is unchanged.

import { readFileSync } from "node:fs";
import { buildAccuracyReport, reconcileRecap } from "../../factcheck.mjs";
import { test, run, assert } from "./_harness.mjs";

const factcheckSource = readFileSync(new URL("../../factcheck.mjs", import.meta.url), "utf8");
const runSource = readFileSync(new URL("../../run.mjs", import.meta.url), "utf8");

// A recap whose final score disagrees with the box score. PHI are home; the
// box score says PHI 2, NYM 7, but the recap copy reads "PHI 5, NYM 3" (it
// describes a different, most-recent-final game than factcheck's "yesterday").
function disagreeingFixture() {
  const data = { recap: { final_score: "PHI 5, NYM 3" } };
  const boxscore = {
    teams: {
      home: { team: { id: 143 }, pitchers: [], players: {} },
      away: { team: { id: 121 }, pitchers: [], players: {} },
    },
  };
  const game = { teams: { home: { score: 2 }, away: { score: 7 } } };
  return { data, boxscore, game };
}

function emptyFindings() {
  return { accurate: [], errors: [], stale: [], unverified: [], pipeline: [] };
}

test("daily (default bucket): a recap score disagreement is a blocking error", () => {
  const { data, boxscore, game } = disagreeingFixture();
  const findings = emptyFindings();
  reconcileRecap({ data, boxscore, game, findings });
  assert.equal(findings.errors.length, 1, "disagreement should be recorded as an error");
  assert.equal(findings.errors[0].id, "recap-final-score");
  assert.equal(findings.unverified.length, 0);

  const report = buildAccuracyReport({
    data: { meta: { date: "2026-06-28", publication: "Phillies Wire" } },
    findings,
    generatedAt: new Date("2026-06-28T13:00:00Z"),
  });
  assert.equal(report.summary.inaccurate, 1, "daily run must still gate on a real disagreement");
});

test("live refresh (unverified bucket): the same disagreement is non-blocking", () => {
  const { data, boxscore, game } = disagreeingFixture();
  const findings = emptyFindings();
  reconcileRecap({ data, boxscore, game, findings, bucket: findings.unverified });
  assert.equal(findings.errors.length, 0, "live-refresh drift must not be an error");
  assert.equal(findings.unverified.length, 1, "live-refresh drift is recorded as unverifiable");
  assert.equal(findings.unverified[0].id, "recap-final-score");

  const report = buildAccuracyReport({
    data: { meta: { date: "2026-06-28", publication: "Phillies Wire" } },
    findings,
    generatedAt: new Date("2026-06-28T20:00:00Z"),
  });
  assert.equal(report.summary.inaccurate, 0, "live refresh must not trip the verify inaccurate gate");
  assert.ok(report.summary.unverifiable >= 1, "the drift still surfaces on the scorecard as unverifiable");
});

// --- Wiring pins ---

test("PIN: run.mjs passes --live-refresh to the accuracy export only on live runs", () => {
  assert.ok(
    /IS_LIVE_REFRESH \? \["--live-refresh"\] : \[\]/.test(runSource),
    "expected run.mjs to append --live-refresh to the accuracy-export args when IS_LIVE_REFRESH",
  );
});

test("PIN: factcheck detects --live-refresh and threads it into the recap check only", () => {
  assert.ok(
    /process\.argv\.includes\("--live-refresh"\)/.test(factcheckSource),
    "expected factcheck.mjs to detect the --live-refresh flag",
  );
  assert.ok(
    /const recapBucket = liveRefresh \? findings\.unverified : findings\.errors/.test(factcheckSource),
    "expected the recap reconciliation to use the live-refresh-aware bucket",
  );
  assert.ok(
    /reconcileRecap\(\{ data, boxscore, game, findings, bucket: recapBucket \}\)/.test(factcheckSource),
    "expected the recap reconciliation to receive the recap bucket",
  );
});

// Codex P2: standings are live-fetched each refresh (NOT a frozen snapshot), so
// a standings-vs-API disagreement must keep blocking in every mode — otherwise a
// degraded crawl could publish stale NL East records past the verify gate.
test("PIN: standings record disagreements stay blocking errors in all modes", () => {
  const standingsBlock = factcheckSource.slice(
    factcheckSource.indexOf("// B. Standings reconciliation"),
    factcheckSource.indexOf("// C."),
  );
  assert.ok(standingsBlock.length > 0, "sanity: located the standings reconciliation block");
  assert.ok(
    /findings\.errors\.push\(\{\s*\/\/[^\n]*\n\s*id: `standings-record-/.test(standingsBlock)
      || /\/\/ Always blocking[\s\S]*?findings\.errors\.push\(\{\s*\n\s*id: `standings-record-/.test(standingsBlock),
    "standings-record disagreement must push to findings.errors (blocking), not the live-refresh bucket",
  );
  assert.ok(
    !/recapBucket\.push\(\{\s*\n\s*id: `standings-record-/.test(standingsBlock),
    "standings disagreement must not route through the recap (downgrade) bucket",
  );
});

await run();
