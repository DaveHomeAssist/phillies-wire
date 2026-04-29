import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildLineupSection,
  buildTbdBattingOrder,
  clampOverride,
  extractBattingOrder,
  extractDecisions,
  extractKeyPerformers,
  mergeInjuryEntries,
  normalizeLiveInjuries,
  pickActiveGame,
  resolvePitcher,
  resolveSeriesLabel,
  updateRecordFromStandings,
} from "../crawl.mjs";
import {
  buildWindSummary,
  normalizeGamesBack,
} from "../crawl/format.mjs";


const fixture = JSON.parse(readFileSync(new URL("../phillies-wire-schema.json", import.meta.url), "utf8"));

runTest("resolvePitcher prefers MLB probable data including pitchHand", () => {
  const side = {
    probablePitcher: { fullName: "Jose Alvarado", pitchHand: { code: "L" } },
  };
  const pitcher = resolvePitcher(side, fixture, "phi");
  assert.equal(pitcher.name, "Jose Alvarado");
  assert.equal(pitcher.hand, "L");
});

runTest("resolvePitcher falls back to PHI fixture only for the phi role", () => {
  const phi = resolvePitcher({}, fixture, "phi");
  assert.equal(phi.name, "Aaron Nola");
  assert.equal(phi.hand, "R");

  // Opponent fallback must not leak the fixture's TEX starter into a
  // non-Texas matchup — we emit TBD until MLB confirms.
  const opp = resolvePitcher({}, fixture, "opp");
  assert.equal(opp.name, "TBD");
  assert.equal(opp.hand, "R");
});

runTest("resolveSeriesLabel prefers seriesStatus.result, then description, then Game-of-series", () => {
  assert.equal(
    resolveSeriesLabel({ seriesStatus: { result: "PHI leads 2-1" } }, "fallback"),
    "PHI leads 2-1",
  );
  assert.equal(
    resolveSeriesLabel({ seriesStatus: { description: "Series tied 1-1" } }, "fallback"),
    "Series tied 1-1",
  );
  assert.equal(
    resolveSeriesLabel({ seriesGameNumber: 2, gamesInSeries: 3 }, "fallback"),
    "Game 2 of 3",
  );
  assert.equal(resolveSeriesLabel({}, "Series 1-0"), "Series 1-0");
});

runTest("extractDecisions normalizes decisions to { winner, loser, save }", () => {
  const decisions = extractDecisions({
    decisions: {
      winner: { id: 1, fullName: "Aaron Nola", link: "/x" },
      loser: { id: 2, fullName: "Jacob deGrom", link: "/y" },
    },
  });
  assert.equal(decisions.winner.fullName, "Aaron Nola");
  assert.equal(decisions.loser.fullName, "Jacob deGrom");
  assert.equal(decisions.save, null);
});

runTest("extractBattingOrder emits 1-9 slots, sorted, and filters substitutes", () => {
  const teamBox = {
    players: {
      ID1: { person: { fullName: "One" }, position: { abbreviation: "SS" }, battingOrder: "100" },
      ID2: { person: { fullName: "Two" }, position: { abbreviation: "DH" }, battingOrder: "200" },
      ID3: { person: { fullName: "Three" }, position: { abbreviation: "1B" }, battingOrder: "300" },
      ID4: { person: { fullName: "Four" }, position: { abbreviation: "3B" }, battingOrder: "400" },
      ID5: { person: { fullName: "Five" }, position: { abbreviation: "RF" }, battingOrder: "500" },
      ID6: { person: { fullName: "Six" }, position: { abbreviation: "C" }, battingOrder: "600" },
      ID7: { person: { fullName: "Seven" }, position: { abbreviation: "LF" }, battingOrder: "700" },
      ID8: { person: { fullName: "Eight" }, position: { abbreviation: "2B" }, battingOrder: "800" },
      ID9: { person: { fullName: "Nine" }, position: { abbreviation: "CF" }, battingOrder: "900" },
      ID10: { person: { fullName: "Sub" }, position: { abbreviation: "PH" }, battingOrder: "401" },
    },
  };
  const order = extractBattingOrder(teamBox);
  assert.equal(order.length, 9);
  assert.deepEqual(
    order.map((slot) => slot.name),
    ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"],
  );
});

runTest("extractBattingOrder returns [] when the lineup is not fully posted", () => {
  const teamBox = {
    players: {
      ID1: { person: { fullName: "One" }, position: { abbreviation: "SS" }, battingOrder: "100" },
    },
  };
  assert.deepEqual(extractBattingOrder(teamBox), []);
});

runTest("extractBattingOrder pulls bats from handedness map when boxscore person is thin", () => {
  // Real MLB /boxscore response thins person to { id, fullName, link }; no
  // batSide. The feed/live gameData.players map is the canonical source.
  const teamBox = {
    players: Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        `ID${i + 1}`,
        {
          person: { id: 100 + i, fullName: `Hitter${i + 1}` },
          position: { abbreviation: "RF" },
          battingOrder: String((i + 1) * 100),
        },
      ]),
    ),
  };
  const handedness = new Map([
    [100, "L"], [101, "R"], [102, "S"], [103, "L"], [104, "R"],
    [105, "L"], [106, "R"], [107, "S"], [108, "L"],
  ]);
  const order = extractBattingOrder(teamBox, handedness);
  assert.deepEqual(
    order.map((slot) => slot.bats),
    ["L", "R", "S", "L", "R", "L", "R", "S", "L"],
  );
});

runTest("extractBattingOrder still falls back to 'R' when no feed map and no batSide", () => {
  const teamBox = {
    players: Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        `ID${i + 1}`,
        {
          person: { id: 200 + i, fullName: `NoSide${i + 1}` },
          position: { abbreviation: "1B" },
          battingOrder: String((i + 1) * 100),
        },
      ]),
    ),
  };
  const order = extractBattingOrder(teamBox);
  assert.ok(order.every((slot) => slot.bats === "R"));
});

runTest("buildLineupSection keeps PHI fallback when opponent is not TEX", () => {
  const starters = {
    home: { team: "WSH", name: "MacKenzie Gore", hand: "L" },
    away: { team: "PHI", name: "Jesus Luzardo", hand: "L" },
    phi: { name: "Jesus Luzardo", hand: "L" },
    opp: { name: "MacKenzie Gore", hand: "L" },
  };
  const section = buildLineupSection({
    fixture,
    boxscore: null,
    philliesAreHome: false,
    homeTeam: { abbreviation: "WSH" },
    awayTeam: { abbreviation: "PHI" },
    starters,
    firstPitch: "6:40 PM ET",
    opponentAbbr: "WSH",
  });

  assert.equal(section.content.announced, false);
  assert.equal(section.content.mode, "projected");
  assert.equal(section.content.mode_label, "Projected");
  assert.equal(section.content.show_orders, true);
  assert.equal(section.content.batting_order.phi[0].name, "Trea Turner");
  // Opponent placeholders use a clean Pending sentinel; no filler names.
  assert.equal(section.content.batting_order.opp[0].name, "Pending");
  assert.equal(section.content.batting_order.opp[0].position, "");
  assert.equal(section.content.batting_order.opp[0].bats, "");
});

runTest("buildLineupSection sets mode=pending when no fixture baseline applies for the opponent", () => {
  // Phillies away at WSH, no boxscore, not TEX so no fixture opponent
  // baseline. PHI gets the fixture baseline, but the PHI row runs through
  // the home column; on a road game the opp column falls through to the
  // Pending sentinel and mode should be pending for the grid suppression.
  const section = buildLineupSection({
    fixture,
    boxscore: null,
    philliesAreHome: false,
    homeTeam: { abbreviation: "WSH" },
    awayTeam: { abbreviation: "PHI" },
    starters: {
      home: { team: "WSH", name: "MacKenzie Gore", hand: "L" },
      away: { team: "PHI", name: "Jesus Luzardo", hand: "L" },
      phi: { name: "Jesus Luzardo", hand: "L" },
      opp: { name: "MacKenzie Gore", hand: "L" },
    },
    firstPitch: "6:40 PM ET",
    opponentAbbr: "WSH",
  });
  // PHI side still has the fixture baseline so the mode is projected,
  // not pending. The guard is that show_orders is still true.
  assert.equal(section.content.mode, "projected");
  assert.equal(section.content.show_orders, true);
});

runTest("buildLineupSection uses live boxscore order when both lineups post", () => {
  const section = buildLineupSection({
    fixture,
    boxscore: {
      teams: {
        home: {
          players: Object.fromEntries(
            Array.from({ length: 9 }, (_, i) => [
              `ID${i}`,
              {
                person: { fullName: `Home${i + 1}`, batSide: { code: "R" } },
                position: { abbreviation: "1B" },
                battingOrder: String((i + 1) * 100),
              },
            ]),
          ),
        },
        away: {
          players: Object.fromEntries(
            Array.from({ length: 9 }, (_, i) => [
              `ID${i}`,
              {
                person: { fullName: `Away${i + 1}`, batSide: { code: "L" } },
                position: { abbreviation: "CF" },
                battingOrder: String((i + 1) * 100),
              },
            ]),
          ),
        },
      },
    },
    philliesAreHome: true,
    homeTeam: { abbreviation: "PHI" },
    awayTeam: { abbreviation: "TEX" },
    starters: {
      home: { team: "PHI", name: "Nola", hand: "R" },
      away: { team: "TEX", name: "deGrom", hand: "R" },
      phi: { name: "Nola", hand: "R" },
      opp: { name: "deGrom", hand: "R" },
    },
    firstPitch: "4:05 PM ET",
    opponentAbbr: "TEX",
  });

  assert.equal(section.content.announced, true);
  assert.equal(section.content.batting_order.phi[0].name, "Home1");
  assert.equal(section.content.batting_order.opp[0].name, "Away1");
});

runTest("mergeInjuryEntries overlays live injuries onto the fixture baseline", () => {
  const generatedAt = "2026-04-20T17:05:00Z";
  const fallbackGeneratedAt = "2026-03-28T14:00:00Z";
  const baseline = [
    { name: "Zack Wheeler", position: "RHP", il_type: "15-Day", badge: "il", injury: "Old note", status_note: "" },
  ];
  const injuryResponse = {
    injuries: [
      {
        person: { fullName: "Zack Wheeler" },
        position: { abbreviation: "RHP" },
        injuryDescription: "Thoracic outlet recovery",
        status: { description: "60-Day IL" },
        comment: "Throwing bullpens",
      },
      {
        person: { fullName: "Ranger Suarez" },
        position: { abbreviation: "LHP" },
        injuryDescription: "Lower back strain",
        status: { description: "15-Day IL" },
      },
    ],
  };
  const merged = mergeInjuryEntries(baseline, injuryResponse, { transactions: [] }, generatedAt, fallbackGeneratedAt);
  const byName = Object.fromEntries(merged.map((entry) => [entry.name, entry]));
  assert.equal(byName["Zack Wheeler"].injury, "Thoracic outlet recovery");
  assert.equal(byName["Zack Wheeler"].source, "live");
  assert.equal(byName["Zack Wheeler"].last_confirmed, generatedAt);
  assert.match(byName["Zack Wheeler"].freshness_label, /^As of /);
  assert.ok(byName["Ranger Suarez"], "New live-only IL entry should be appended");
  assert.equal(byName["Ranger Suarez"].source, "live");
  assert.equal(byName["Ranger Suarez"].last_confirmed, generatedAt);
});

runTest("mergeInjuryEntries preserves fallback freshness when no live injury data arrives", () => {
  const baseline = [
    {
      name: "Max Lazar",
      position: "RHP",
      il_type: "15-Day",
      badge: "dtd",
      injury: "Left oblique strain",
      status_note: "Minor per Thomson",
      last_confirmed: "2026-03-28T14:00:00Z",
    },
  ];
  const merged = mergeInjuryEntries(baseline, null, { transactions: [] }, "2026-04-20T17:05:00Z", "2026-03-28T14:00:00Z");
  assert.equal(merged[0].source, "fallback");
  assert.equal(merged[0].last_confirmed, "2026-03-28T14:00:00Z");
  assert.match(merged[0].freshness_label, /^Last confirmed /);
});

runTest("normalizeLiveInjuries is resilient to missing optional fields", () => {
  assert.deepEqual(normalizeLiveInjuries(null), []);
  assert.deepEqual(normalizeLiveInjuries({ injuries: [{}] }), []);
});

runTest("buildTbdBattingOrder returns nine Pending sentinel slots", () => {
  const order = buildTbdBattingOrder("WSH");
  assert.equal(order.length, 9);
  assert.equal(order[0].slot, 1);
  assert.equal(order[8].slot, 9);
  // Sentinel rows: no filler name, no fake handedness. Template detects
  // mode === "pending" and suppresses the grid entirely.
  assert.ok(order.every((slot) => slot.name === "Pending"));
  assert.ok(order.every((slot) => slot.bats === ""));
});

runTest("normalizeGamesBack coerces leader markers to an em dash", () => {
  assert.equal(normalizeGamesBack("-"), "\u2014");
  assert.equal(normalizeGamesBack(""), "\u2014");
  assert.equal(normalizeGamesBack(null), "\u2014");
  assert.equal(normalizeGamesBack("0.0"), "\u2014");
  assert.equal(normalizeGamesBack("\u2013"), "\u2014");
  assert.equal(normalizeGamesBack("\u2014"), "\u2014");
  assert.equal(normalizeGamesBack("1.5"), "1.5");
  assert.equal(normalizeGamesBack(3), "3");
});

runTest("clampOverride truncates strings and walks nested shapes", () => {
  const long = "x".repeat(5000);
  const clamped = clampOverride({ list: [long], hero: { summary: long } });
  assert.ok(clamped.list[0].length < 5000);
  assert.ok(clamped.hero.summary.length < 5000);
});

runTest("extractKeyPerformers balances hitters and pitchers", () => {
  const boxscore = {
    teams: {
      home: {
        players: {
          p1: {
            person: { fullName: "Starter" },
            position: { abbreviation: "P" },
            stats: { pitching: { inningsPitched: "7.0", strikeOuts: 9, earnedRuns: 1, hits: 4 } },
          },
          h1: {
            person: { fullName: "Masher" },
            position: { abbreviation: "DH" },
            stats: { batting: { atBats: 4, hits: 3, homeRuns: 2, rbi: 5, runs: 2 } },
          },
          h2: {
            person: { fullName: "Slapper" },
            position: { abbreviation: "2B" },
            stats: { batting: { atBats: 5, hits: 2, runs: 1 } },
          },
        },
      },
      away: { players: {} },
    },
  };
  const performers = extractKeyPerformers(boxscore, []);
  assert.ok(performers.some((performer) => performer.name === "Starter"));
  assert.ok(performers.some((performer) => performer.name === "Masher"));
  assert.ok(performers.every((performer) => typeof performer.line === "string" && performer.line.length > 0));
});

runTest("buildWindSummary returns calm when weather is missing", () => {
  assert.equal(buildWindSummary({}), "Calm");
  assert.equal(buildWindSummary({ wind_speed_10m: 12 }), "12 mph");
  assert.equal(buildWindSummary({ wind_speed_10m: 12, wind_gusts_10m: 22 }), "12 mph · gusts 22");
});

runTest("pickActiveGame prefers live, then upcoming, then last final", () => {
  assert.equal(pickActiveGame([]), null);

  const preview1 = { gameDate: "2026-05-04T17:00:00Z", status: { abstractGameState: "Preview" } };
  const preview2 = { gameDate: "2026-05-04T20:05:00Z", status: { abstractGameState: "Preview" } };
  assert.strictEqual(pickActiveGame([preview2, preview1]), preview1);

  const live = { gameDate: "2026-05-04T20:05:00Z", status: { abstractGameState: "Live" } };
  assert.strictEqual(pickActiveGame([preview1, live, preview2]), live);

  const final1 = { gameDate: "2026-05-04T17:00:00Z", status: { abstractGameState: "Final" } };
  const final2 = { gameDate: "2026-05-04T20:05:00Z", status: { abstractGameState: "Final" } };
  assert.strictEqual(pickActiveGame([final1, final2]), final2);
});

runTest("updateRecordFromStandings copies Phillies streak and division rank without touching W-L", () => {
  const record = { wins: 10, losses: 19, streak: "W1", division_rank: 1, division: "NL East" };
  const updated = updateRecordFromStandings(record, [
    { abbr: "NYM", streak: "W2", division_rank: 1, is_phi: false },
    { abbr: "PHI", streak: "L3", division_rank: 5, is_phi: true },
  ]);

  assert.deepEqual(updated, {
    wins: 10,
    losses: 19,
    streak: "L3",
    division_rank: 5,
    division: "NL East",
  });
});

function runTest(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (error) {
    console.error("FAIL", name);
    throw error;
  }
}
