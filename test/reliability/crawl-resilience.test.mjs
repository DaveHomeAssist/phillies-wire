// RELIABILITY: crawl partial-data resilience (audit P0/P1-CRAWL)
//
// The crawl stage consumes live MLB JSON that is frequently partial: missing
// lineups, missing probable pitchers, postponed games. Exported pure helpers
// must degrade to safe sentinels instead of throwing or emitting NaN/undefined
// into the schema. Guards lock the safe behavior; pins document open gaps.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatGameTime as rawFormatGameTime } from "../../crawl/format.mjs";
import {
  extractBattingOrder,
  buildTbdBattingOrder,
  resolvePitcher,
  extractKeyPerformers,
  pickActiveGame,
  updateRecordFromStandings,
  normalizeGameContext,
  computeCrawlState,
  safeRound,
  safeFormatGameTime,
  formatScore,
  loadFixture,
  loadOverrides,
  buildHero,
  applyStandingsCrawlState,
  reconcileRecordStreakWithLastFinal,
  reconcilePayloadStreakWithLastFinal,
  extractLastFinalFromGame,
} from "../../crawl.mjs";
import { test, run, assert } from "./_harness.mjs";

const MINIMAL_FIXTURE = {
  sections: {
    game_status: { content: { starters: { phi: { name: "Aaron Nola", hand: "R" }, home: { name: "Aaron Nola", hand: "R" } } } },
    lineup: { content: { batting_order: { home: buildTbdBattingOrder("PHI"), away: buildTbdBattingOrder("OPP") } } },
  },
};

// --- Guards ---

test("extractBattingOrder tolerates null/empty boxscore without throwing", () => {
  assert.deepEqual(extractBattingOrder(null), []);
  assert.deepEqual(extractBattingOrder({}), []);
  assert.deepEqual(extractBattingOrder({ players: {} }), []);
});

test("resolvePitcher returns a safe TBD shape for an empty opponent side", () => {
  const p = resolvePitcher({}, MINIMAL_FIXTURE, "opp");
  assert.equal(p.name, "TBD");
  assert.equal(p.hand, "R");
});

test("extractKeyPerformers tolerates an empty boxscore", () => {
  const out = extractKeyPerformers({ teams: { home: { players: {} }, away: { players: {} } } }, []);
  assert.ok(Array.isArray(out));
});

test("buildTbdBattingOrder always returns nine sentinel slots", () => {
  const order = buildTbdBattingOrder("ATL");
  assert.equal(order.length, 9);
  assert.ok(order.every((s) => s.name === "Pending"));
});

test("updateRecordFromStandings never mutates W-L from standings noise", () => {
  const rec = { wins: 10, losses: 19, streak: "W1", division_rank: 1, division: "NL East" };
  const out = updateRecordFromStandings(rec, [{ abbr: "PHI", streak: "L3", division_rank: 5, is_phi: true }]);
  assert.equal(out.wins, 10);
  assert.equal(out.losses, 19);
});

test("P0-CRAWL-1: partial MLB game shapes normalize to safe Phillies/opponent defaults", () => {
  const context = normalizeGameContext({
    gameDate: "2026-06-14T23:05:00Z",
    teams: { home: { team: { id: 144, abbreviation: "ATL", teamName: "Braves" } } },
  });
  assert.equal(context.philliesAreHome, false);
  assert.equal(context.philliesSide.team.abbreviation, "PHI");
  assert.equal(context.opponentSide.team.abbreviation, "ATL");
  assert.equal(context.philliesSide.score, null);
});

test("P1-CRAWL-4: missing source responses mark crawl state degraded", () => {
  assert.equal(computeCrawlState({ scheduleResponse: {}, weatherResponse: null }), "degraded");
  assert.equal(computeCrawlState({ scheduleResponse: {}, weatherResponse: { current: {} } }), "ok");
  const status = { crawl_state: "ok", source_notes: [] };
  applyStandingsCrawlState(status, []);
  assert.equal(status.crawl_state, "degraded");
  assert.ok(status.source_notes.some((note) => /standings unavailable/i.test(note)));
});

test("record.streak is reconciled with the freshest MLB final before verify", () => {
  const out = reconcileRecordStreakWithLastFinal(
    { wins: 40, losses: 29, streak: "L1" },
    { date: "2026-06-13", phi_runs: 9, opp_abbr: "MIL", opp_runs: 8, outcome: "W" },
  );
  assert.equal(out.streak, "W1");
});

test("record and standings streaks are reconciled together before factcheck", () => {
  const payload = {
    record: { wins: 40, losses: 29, streak: "L1" },
    sections: {
      standings: {
        preview: "PHI 40-29 · 1st · L1",
        content: {
          teams: [
            { abbr: "PHI", wins: 40, losses: 29, gb: "\u2014", streak: "L1", is_phi: true },
            { abbr: "ATL", wins: 31, losses: 38, gb: "9.0", streak: "W1" },
          ],
        },
      },
    },
  };
  const out = reconcilePayloadStreakWithLastFinal(
    payload,
    { date: "2026-06-13", phi_runs: 9, opp_abbr: "MIL", opp_runs: 8, outcome: "W" },
  );
  const phi = out.sections.standings.content.teams.find((team) => team.is_phi);
  assert.equal(out.record.streak, "W1");
  assert.equal(phi.streak, "W1");
  assert.match(out.sections.standings.preview, /W1$/);
});

test("same-day active final supersedes the previous recent-final fallback", () => {
  const activeFinal = extractLastFinalFromGame({
    gamePk: 777,
    officialDate: "2026-06-14",
    status: { abstractGameState: "Final", detailedState: "Final" },
    teams: {
      home: { team: { id: 158, abbreviation: "MIL", teamName: "Brewers" }, score: 4 },
      away: { team: { id: 143, abbreviation: "PHI", teamName: "Phillies" }, score: 0 },
    },
  });
  assert.equal(activeFinal.outcome, "L");
  assert.equal(activeFinal.date, "2026-06-14");
  assert.equal(activeFinal.phi_runs, 0);
  assert.equal(activeFinal.opp_runs, 4);

  const payload = {
    record: { wins: 38, losses: 33, streak: "W1" },
    sections: {
      standings: {
        preview: "PHI 38-33 · 2.0 GB · W1",
        content: {
          teams: [{ abbr: "PHI", wins: 38, losses: 33, gb: "2.0", streak: "W1", is_phi: true }],
        },
      },
    },
  };
  const out = reconcilePayloadStreakWithLastFinal(payload, activeFinal);
  assert.equal(out.record.streak, "L1");
  assert.equal(out.sections.standings.content.teams[0].streak, "L1");
  assert.match(out.sections.standings.preview, /L1$/);
});

test("P1-CRAWL-4: weather numerics use finite fallbacks instead of NaN", () => {
  assert.equal(safeRound(undefined, "bad", 72), 72);
  assert.equal(safeRound("72.6", 70, 0), 73);
});

test("P2-CRAWL-5: invalid times and missing live scores render safe sentinels", () => {
  assert.equal(rawFormatGameTime(undefined), "TBD");
  assert.equal(rawFormatGameTime("not-a-date"), "TBD");
  assert.equal(safeFormatGameTime(undefined), "TBD");
  assert.equal(safeFormatGameTime("not-a-date"), "TBD");
  assert.equal(formatScore(undefined), "\u2014");

  const hero = buildHero({
    meta: { status: { mode: "live" } },
    sections: {
      game_status: {
        content: {
          starters: { home: { name: "TBD" }, away: { name: "TBD" } },
          series: { label: "Series tied" },
          venue: "Citizens Bank Park",
          broadcast: { tv: "NBCSP", radio: "94 WIP" },
          weather: { temp_f: 72, condition: "Clear" },
        },
      },
    },
    next_game: { label: "Next", matchup: "PHI vs ATL", date: "Tomorrow", time: "7:05 PM" },
  }, {
    status: { abstractGameState: "Live", detailedState: "In Progress" },
    teams: {
      home: { team: { id: 143, abbreviation: "PHI", teamName: "Phillies" } },
      away: { team: { id: 144, abbreviation: "ATL", teamName: "Braves" } },
    },
    linescore: {},
  });
  assert.equal(hero.headline, "PHI \u2014, ATL \u2014");
});

test("P0-CRAWL-2: malformed overrides degrade to no overrides", () => {
  const work = mkdtempSync(join(tmpdir(), "pw-crawl-overrides-"));
  const previousCwd = process.cwd();
  try {
    mkdirSync(join(work, "overrides"), { recursive: true });
    writeFileSync(join(work, "overrides", "2099-01-01.json"), "{ nope", "utf8");
    process.chdir(work);
    assert.equal(loadOverrides("2099-01-01"), null);
  } finally {
    process.chdir(previousCwd);
    rmSync(work, { recursive: true, force: true });
  }
});

test("P0-CRAWL-2: missing schema can fall back to the previous payload fixture", () => {
  const work = mkdtempSync(join(tmpdir(), "pw-crawl-fixture-"));
  const previousCwd = process.cwd();
  try {
    const fallback = { meta: { publication: "Phillies Wire" }, sections: {}, record: {}, ticker: [], hero: {} };
    writeFileSync(join(work, "phillies-wire-data.json"), JSON.stringify(fallback), "utf8");
    process.chdir(work);
    assert.deepEqual(loadFixture(), fallback);
  } finally {
    process.chdir(previousCwd);
    rmSync(work, { recursive: true, force: true });
  }
});

// --- Pins (open audit findings) ---

test("PIN P1: a postponed game must not be selected as a completed final", () => {
  // MLB stamps abstractGameState=Final on postponed games while detailedState
  // says 'Postponed'. pickActiveGame keys only off abstractGameState, so it
  // returns a postponed game as the day's final — downstream then renders a
  // 'final' hero with no result. A postponed-only day should yield no final.
  const postponed = {
    gameDate: "2026-05-04T23:05:00Z",
    status: { abstractGameState: "Final", detailedState: "Postponed", codedGameState: "D" },
  };
  const picked = pickActiveGame([postponed]);
  const treatedAsFinal = picked && picked.status.abstractGameState === "Final" && /postponed/i.test(picked.status.detailedState || "");
  assert.ok(!treatedAsFinal, "postponed game was selected as a final");
});

await run();
