import assert from "node:assert/strict";

import {
  buildCanonicalGame,
  buildCanonicalSchedulePayload,
  buildLegacyMatchKey,
  findCurrentOrNextGame,
} from "../shared/phillies-schedule.mjs";

const rawGame = {
  gamePk: 823486,
  gameType: "R",
  season: "2026",
  gameDate: "2026-03-26T20:15:00Z",
  officialDate: "2026-03-26",
  status: {
    abstractGameState: "Final",
    detailedState: "Final",
    statusCode: "F",
    startTimeTBD: false,
  },
  teams: {
    away: {
      team: { id: 140, name: "Texas Rangers" },
      score: 3,
      isWinner: false,
      probablePitcher: { id: 543135, fullName: "Nathan Eovaldi" },
      leagueRecord: { wins: 0, losses: 1, pct: ".000" },
    },
    home: {
      team: { id: 143, name: "Philadelphia Phillies" },
      score: 5,
      isWinner: true,
      probablePitcher: { id: 650911, fullName: "Cristopher Sánchez" },
      leagueRecord: { wins: 1, losses: 0, pct: "1.000" },
    },
  },
  venue: { id: 2681, name: "Citizens Bank Park" },
  seriesStatus: { result: "PHI leads 1-0", description: "Regular Season", gameNumber: 1, totalGames: 3 },
  seriesGameNumber: 1,
  gamesInSeries: 3,
  doubleHeader: "N",
  dayNight: "day",
};

runTest("buildCanonicalGame normalizes Phillies home fields and score", () => {
  const game = buildCanonicalGame(rawGame);
  assert.equal(game.game_pk, 823486);
  assert.equal(game.home_game, true);
  assert.equal(game.opponent.abbr, "TEX");
  assert.equal(game.result, "W");
  assert.equal(game.phillies.probable_pitcher.name, "Cristopher Sánchez");
  assert.equal(game.opponent.probable_pitcher.name, "Nathan Eovaldi");
  assert.equal(game.legacy_match_key, "2026-03-26:TEX:H");
});

runTest("buildCanonicalSchedulePayload summarizes current and next pointers", () => {
  const previewGame = {
    ...rawGame,
    gamePk: 823487,
    officialDate: "2026-03-27",
    gameDate: "2026-03-27T20:15:00Z",
    status: {
      abstractGameState: "Preview",
      detailedState: "Scheduled",
      statusCode: "S",
      startTimeTBD: false,
    },
    teams: {
      ...rawGame.teams,
      away: { ...rawGame.teams.away, score: undefined },
      home: { ...rawGame.teams.home, score: undefined },
    },
  };
  const payload = buildCanonicalSchedulePayload([rawGame, previewGame], {
    season: 2026,
    generated_at: "2026-03-26T21:00:00Z",
    fetched_at: "2026-03-26T21:00:00Z",
    now: new Date("2026-03-26T22:00:00Z"),
  });
  assert.equal(payload.summary.total_games, 2);
  assert.equal(payload.summary.current_game_pk, 823487);
  assert.equal(payload.summary.latest_completed_game_pk, 823486);
});

runTest("findCurrentOrNextGame prefers live or preview games before future finals", () => {
  const payload = buildCanonicalSchedulePayload([
    rawGame,
    {
      ...rawGame,
      gamePk: 900001,
      officialDate: "2026-04-01",
      gameDate: "2026-04-01T23:00:00Z",
      status: {
        abstractGameState: "Preview",
        detailedState: "Scheduled",
        statusCode: "S",
        startTimeTBD: false,
      },
    },
  ], {
    now: new Date("2026-03-31T23:00:00Z"),
  });
  const pointer = findCurrentOrNextGame(payload.games, new Date("2026-03-31T23:00:00Z"));
  assert.equal(pointer.current_game.game_pk, 900001);
});

runTest("buildLegacyMatchKey keeps date opponent and side stable", () => {
  assert.equal(
    buildLegacyMatchKey({ official_date: "2026-04-18", opponent_abbr: "ATL", home_game: true }),
    "2026-04-18:ATL:H",
  );
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
