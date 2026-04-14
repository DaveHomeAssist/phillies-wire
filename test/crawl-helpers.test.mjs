import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildLineupSection,
  buildTbdBattingOrder,
  buildWindSummary,
  clampOverride,
  extractBattingOrder,
  extractDecisions,
  extractKeyPerformers,
  mergeInjuryEntries,
  normalizeGamesBack,
  normalizeLiveInjuries,
  resolvePitcher,
  resolveSeriesLabel,
} from "../crawl.mjs";


const fixture = JSON.parse(readFileSync(new URL("../phillies-wire-schema.json", import.meta.url), "utf8"));

runTest("resolvePitcher prefers MLB probable data including pitchHand", () => {
  const side = {
    probablePitcher: { fullName: "Jose Alvarado", pitchHand: { code: "L" } },
  };
  const pitcher = resolvePitcher(side, fixture, "phi");
  assert.equal(pitcher.name, "Jose Alvarado");
  assert.equal(pitcher.hand, "L");
});

runTest("resolvePitcher falls back to fixture when MLB data is missing", () => {
  const pitcher = resolvePitcher({}, fixture, "opp");
  assert.equal(pitcher.name, "Jacob deGrom");
  assert.equal(pitcher.hand, "R");
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
  assert.equal(section.content.batting_order.phi[0].name, "Trea Turner");
  // Opponent fallback for a non-TEX game is a TBD placeholder.
  assert.match(section.content.batting_order.opp[0].name, /WSH hitter/);
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
  const merged = mergeInjuryEntries(baseline, injuryResponse, { transactions: [] });
  const byName = Object.fromEntries(merged.map((entry) => [entry.name, entry]));
  assert.equal(byName["Zack Wheeler"].injury, "Thoracic outlet recovery");
  assert.equal(byName["Zack Wheeler"].source, "live");
  assert.ok(byName["Ranger Suarez"], "New live-only IL entry should be appended");
  assert.equal(byName["Ranger Suarez"].source, "live");
});

runTest("normalizeLiveInjuries is resilient to missing optional fields", () => {
  assert.deepEqual(normalizeLiveInjuries(null), []);
  assert.deepEqual(normalizeLiveInjuries({ injuries: [{}] }), []);
});

runTest("buildTbdBattingOrder returns nine labelled placeholder slots", () => {
  const order = buildTbdBattingOrder("WSH");
  assert.equal(order.length, 9);
  assert.equal(order[0].slot, 1);
  assert.equal(order[8].slot, 9);
  assert.match(order[0].name, /WSH hitter 1/);
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

function runTest(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (error) {
    console.error("FAIL", name);
    throw error;
  }
}
