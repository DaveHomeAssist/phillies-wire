// RELIABILITY: the accuracy scorecard must only call a claim "accurate" when a
// check actually compared it, and the recap source check must read the data
// model crawl.mjs really publishes.
//
// Two audit findings (2026-09-10, "build toward the whole"):
//
// 1. reconcileRecap only read `recap.final_score` / `recap.starter_line`,
//    fields no stage of the pipeline ever writes. crawl.mjs publishes the most
//    recent final as `meta.last_final` (date, game_pk, phi_runs, opp_runs) and,
//    on a final edition, `sections.recap.content.result` (home_score,
//    away_score, summary_line). So the documented "previous day final vs MLB
//    box score" check never compared anything in production.
//
// 2. buildAccuracyReport defaulted every published claim to verdict
//    "accurate", so the scorecard reported "27 of 28 claims verified" when the
//    only claims a source check had touched were the five standings rows. The
//    report now carries a `coverage` map and marks a claim accurate only when
//    the group it belongs to was compared on that run.

import { readFileSync } from "node:fs";
import {
  buildAccuracyReport,
  emptyCoverage,
  pickRecapGame,
  reconcileRecap,
  resolveRecapTarget,
} from "../../factcheck.mjs";
import { test, run, assert } from "./_harness.mjs";

const factcheckSource = readFileSync(new URL("../../factcheck.mjs", import.meta.url), "utf8");

function emptyFindings() {
  return { accurate: [], errors: [], stale: [], unverified: [], pipeline: [] };
}

// Shapes copied from a real crawl payload (2026-09-10 pregame edition).
function crawlPayload(overrides = {}) {
  return {
    meta: {
      date: "2026-09-10",
      volume: 1,
      edition: 163,
      publication: "Phillies Wire",
      status: { generated_at_et: "Sep 10, 2026, 1:48 AM ET" },
      last_final: {
        date: "2026-09-09",
        game_pk: 823416,
        phi_runs: 11,
        opp_runs: 7,
        opp_abbr: "HOU",
        outcome: "W",
        venue_is_home: true,
      },
      ...overrides.meta,
    },
    record: { wins: 82, losses: 64, streak: "W1", division_rank: 2, division: "NL East" },
    hero: { headline: "Astros @ Phillies · Game 3 of 3" },
    sections: {
      game_status: {
        content: {
          matchup: "Astros @ Phillies · Game 3 of 3",
          first_pitch: "1:05 PM",
          venue: "Citizens Bank Park, Philadelphia",
          starters: { home: { name: "Zack Wheeler", hand: "R" }, away: { name: "Cristian Javier", hand: "R" } },
          broadcast: { tv: "NBC 10", stream: "MLB.TV", radio: "94 WIP" },
          weather: { temp_f: 73, condition: "Clear", wind: "9 mph" },
        },
      },
      standings: {
        content: {
          teams: [
            { name: "Braves", abbr: "ATL", team: "ATL", wins: 85, losses: 61, gb: "—", streak: "L3", is_phi: false },
            { name: "Phillies", abbr: "PHI", team: "PHI", wins: 82, losses: 64, gb: "3.0", streak: "W1", is_phi: true },
          ],
        },
      },
      recap: {
        show: false,
        content: {
          result: { home_score: null, away_score: null, winner: "", summary_line: "" },
          decisions: { winner: null, loser: null, save: null },
          date: "",
          key_performers: [],
          pull_quote: "",
        },
        ...overrides.recap,
      },
      lineup: { content: { mode_label: "Pending", status_note: "Lineups pending.", show_orders: false } },
      injury_report: { content: { il_entries: [{ name: "Brad Keller", position: "RHP", injury: "Right elbow UCL tear", il_type: "60-day" }] } },
      preview: { content: { up_next: [{ date: "Fri, Sep 11", matchup: "TBD vs Chris Sale", time: "7:15 PM", broadcast: "NBCSP" }] } },
    },
    next_game: { date: "Fri, Sep 11", matchup: "Chris Sale · PHI @ ATL", time: "7:15 PM", broadcast: "NBCSP" },
  };
}

// MLB schedule + boxscore shapes for the 2026-09-09 final: PHI (home) 11, HOU 7.
function mlbFinal({ phiRuns = 11, oppRuns = 7 } = {}) {
  const game = {
    gamePk: 823416,
    officialDate: "2026-09-09",
    status: { abstractGameState: "Final", detailedState: "Final" },
    teams: { home: { score: phiRuns, team: { id: 143 } }, away: { score: oppRuns, team: { id: 117 } } },
  };
  const boxscore = {
    teams: {
      home: { team: { id: 143 }, pitchers: [], players: {} },
      away: { team: { id: 117 }, pitchers: [], players: {} },
    },
  };
  return { game, boxscore };
}

// --- Recap source check reads the real data model ---

test("PIN: reconcileRecap compares meta.last_final with the MLB schedule game", () => {
  const { game, boxscore } = mlbFinal();
  const findings = emptyFindings();
  const compared = reconcileRecap({ data: crawlPayload(), boxscore, game, findings });
  assert.equal(compared, true, "a payload with meta.last_final must be compared");
  assert.equal(findings.errors.length, 0);
});

test("PIN: a last_final that disagrees with MLB is a blocking error in daily mode", () => {
  const { game, boxscore } = mlbFinal({ phiRuns: 11, oppRuns: 9 });
  const findings = emptyFindings();
  reconcileRecap({ data: crawlPayload(), boxscore, game, findings });
  assert.equal(findings.errors.length, 1);
  assert.equal(findings.errors[0].id, "recap-last-final-score");
  assert.match(findings.errors[0].detail, /PHI 11, HOU 7/);
});

test("PIN: a visible recap result block is compared in schedule orientation", () => {
  const { game, boxscore } = mlbFinal();
  const data = crawlPayload({
    meta: { last_final: null },
    recap: {
      show: true,
      content: {
        result: { home_score: 11, away_score: 6, winner: "PHI", summary_line: "PHI 11, HOU 6." },
        date: "2026-09-09",
      },
    },
  });
  const findings = emptyFindings();
  const compared = reconcileRecap({ data, boxscore, game, findings });
  assert.equal(compared, true);
  assert.equal(findings.errors.length, 1);
  assert.equal(findings.errors[0].id, "recap-final-score");
});

test("PIN: a pregame payload with no final claim is not reported as compared", () => {
  const { game, boxscore } = mlbFinal();
  const data = crawlPayload({ meta: { last_final: null } });
  const findings = emptyFindings();
  const compared = reconcileRecap({ data, boxscore, game, findings });
  assert.equal(compared, false, "nothing to compare must not count as coverage");
  assert.equal(findings.errors.length, 0);
});

test("PIN: last_final for a different game than the schedule entry is skipped, not compared", () => {
  const { game, boxscore } = mlbFinal();
  const data = crawlPayload({ meta: { last_final: { date: "2026-09-08", game_pk: 823415, phi_runs: 2, opp_runs: 3, opp_abbr: "HOU", outcome: "L" } } });
  const findings = emptyFindings();
  const compared = reconcileRecap({ data, boxscore, game, findings });
  assert.equal(compared, false);
  assert.equal(findings.errors.length, 0);
});

test("resolveRecapTarget prefers meta.last_final, then a shown recap, then calendar yesterday", () => {
  assert.deepEqual(resolveRecapTarget(crawlPayload(), "2026-09-10"), { date: "2026-09-09", gamePk: 823416, source: "last_final" });
  const recapOnly = crawlPayload({ meta: { last_final: null, game_pk: 900 }, recap: { show: true, content: { date: "2026-09-10", result: {} } } });
  assert.deepEqual(resolveRecapTarget(recapOnly, "2026-09-10"), { date: "2026-09-10", gamePk: 900, source: "recap" });
  assert.deepEqual(resolveRecapTarget({ meta: {} }, "2026-09-10"), { date: "2026-09-09", gamePk: null, source: "calendar" });
});

test("pickRecapGame matches by gamePk, accepts a lone final, and refuses an ambiguous doubleheader", () => {
  const g1 = { gamePk: 1, status: { abstractGameState: "Final" } };
  const g2 = { gamePk: 2, status: { abstractGameState: "Final" } };
  assert.equal(pickRecapGame([g1, g2], { gamePk: 2 }), g2);
  assert.equal(pickRecapGame([g1], { gamePk: null }), g1);
  assert.equal(pickRecapGame([g1, g2], { gamePk: null }), null);
  assert.equal(pickRecapGame([], { gamePk: 5 }), null);
});

// --- Scorecard verdicts follow coverage ---

function verdictsBySection(report) {
  const out = {};
  for (const section of report.sections) {
    out[section.id] = section.items.map((item) => item.verdict);
  }
  return out;
}

test("PIN: with no source coverage, published claims are unverifiable, not accurate", () => {
  const report = buildAccuracyReport({ data: crawlPayload(), findings: emptyFindings(), coverage: emptyCoverage() });
  const verdicts = verdictsBySection(report);
  for (const id of ["game", "record", "standings", "recap", "lineup", "injuries", "schedule"]) {
    assert.ok(verdicts[id], `section ${id} present`);
    assert.ok(verdicts[id].every((v) => v === "unverifiable"), `${id} claims must be unverifiable without a source check: ${verdicts[id]}`);
  }
  // The masthead date is covered by the deterministic edition-date check.
  assert.ok(verdicts.masthead.every((v) => v === "accurate"));
  assert.equal(report.summary.inaccurate, 0);
  assert.deepEqual(report.coverage, emptyCoverage());
  const uncovered = report.sections.find((s) => s.id === "game").items[0];
  assert.match(uncovered.note, /No source check covers this claim/);
});

test("PIN: covered groups become accurate while uncovered groups stay unverifiable", () => {
  const report = buildAccuracyReport({
    data: crawlPayload(),
    findings: emptyFindings(),
    coverage: { standings: true, record: true, recap: true, injuries: false },
  });
  const verdicts = verdictsBySection(report);
  assert.ok(verdicts.standings.every((v) => v === "accurate"), "standings rows compared with the API");
  assert.equal(verdicts.record[0], "accurate", "record W-L reconciled through the PHI standings row");
  assert.equal(verdicts.record[1], "unverifiable", "division rank is never compared with the API");
  assert.equal(verdicts.record[2], "unverifiable", "streak is never compared with the API");
  assert.ok(verdicts.recap.every((v) => v === "accurate"), "last final compared with the schedule");
  for (const id of ["game", "lineup", "injuries", "schedule"]) {
    assert.ok(verdicts[id].every((v) => v === "unverifiable"), `${id} has no source check`);
  }
  assert.ok(report.summary.accurate < report.summary.total_claims);
});

test("PIN: a row that a source check contradicted is not also marked accurate", () => {
  const findings = emptyFindings();
  findings.errors.push({ id: "standings-record-PHI", title: "PHI record disagrees with MLB API", detail: "Wire 82-64, API 83-64." });
  const report = buildAccuracyReport({ data: crawlPayload(), findings, coverage: { ...emptyCoverage(), standings: true, record: true } });
  const standings = report.sections.find((s) => s.id === "standings").items;
  assert.equal(standings.find((i) => i.claim.startsWith("ATL")).verdict, "accurate");
  assert.equal(standings.find((i) => i.claim.startsWith("PHI")).verdict, "unverifiable");
  assert.equal(report.summary.inaccurate, 1, "the error itself is still the one inaccurate row");
});

test("PIN: claim() no longer defaults to an accurate verdict", () => {
  assert.ok(
    !/function claim\(text, \{ verdict = "accurate"/.test(factcheckSource),
    "claim() must not default every published value to accurate",
  );
  assert.ok(/verdict \?\? \(covered \? "accurate" : "unverifiable"\)/.test(factcheckSource));
});

test("PIN: runSourceChecks resolves the recap target from the payload, not only calendar yesterday", () => {
  assert.ok(/const target = resolveRecapTarget\(data\)/.test(factcheckSource));
  assert.ok(/pickRecapGame\(sched\?\.dates\?\.\[0\]\?\.games \?\? \[\], target\)/.test(factcheckSource));
});

await run();
