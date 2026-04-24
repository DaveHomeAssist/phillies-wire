import assert from "node:assert/strict";

import { buildPlaysTimeline } from "../crawl.mjs";

// Sample play shapes taken from MLB Stats API feed/live:
// https://statsapi.mlb.com/api/v1.1/game/{gamePk}/feed/live on 2026-04-24.
// Exercise the four event-type classes the frontend styles (home_run,
// score_change, strikeout, key_play) plus the neutral "other" default.
const sampleFeed = {
  liveData: {
    plays: {
      allPlays: [
        {
          about: { atBatIndex: 0, halfInning: "top", inning: 1, isComplete: true, isScoringPlay: false, captivatingIndex: 10 },
          result: {
            event: "Strikeout",
            eventType: "strikeout",
            description: "Kyle Schwarber strikes out swinging.",
            awayScore: 0,
            homeScore: 0,
            isOut: true,
          },
          matchup: { batter: { fullName: "Kyle Schwarber", id: 656941 } },
        },
        {
          about: { atBatIndex: 5, halfInning: "bottom", inning: 1, isComplete: true, isScoringPlay: true, captivatingIndex: 32 },
          result: {
            event: "Forceout",
            eventType: "force_out",
            description: "Ian Happ grounds into a force out. Nico Hoerner scores.",
            rbi: 1,
            awayScore: 0,
            homeScore: 1,
            isOut: true,
          },
          matchup: { batter: { fullName: "Ian Happ", id: 664023 } },
        },
        {
          about: { atBatIndex: 12, halfInning: "bottom", inning: 3, isComplete: true, isScoringPlay: true, captivatingIndex: 78 },
          result: {
            event: "Home Run",
            eventType: "home_run",
            description: "Michael Busch homers (1) on a fly ball to left center field.",
            rbi: 1,
            awayScore: 0,
            homeScore: 2,
            isOut: false,
          },
          matchup: { batter: { fullName: "Michael Busch", id: 683737 } },
        },
        {
          about: { atBatIndex: 20, halfInning: "top", inning: 5, isComplete: true, isScoringPlay: false, captivatingIndex: 88 },
          result: {
            event: "Field Out",
            eventType: "field_out",
            description: "Bryce Harper flies out to center fielder Pete Crow-Armstrong (diving catch).",
            awayScore: 0,
            homeScore: 2,
            isOut: true,
          },
          matchup: { batter: { fullName: "Bryce Harper", id: 547180 } },
        },
        {
          about: { atBatIndex: 22, halfInning: "bottom", inning: 5, isComplete: true, isScoringPlay: false, captivatingIndex: 5 },
          result: {
            event: "Single",
            eventType: "single",
            description: "Nico Hoerner singles on a line drive to right field.",
            awayScore: 0,
            homeScore: 2,
            isOut: false,
          },
          matchup: { batter: { fullName: "Nico Hoerner", id: 663538 } },
        },
        {
          // Drop this one — invalid half
          about: { atBatIndex: 25, halfInning: "middle", inning: 6 },
          result: { event: "End of half" },
          matchup: {},
        },
      ],
    },
  },
};

const homeContext = { gameFeed: sampleFeed, philliesAreHome: false, philliesAbbr: "PHI", opponentAbbr: "CHC" };

runTest("buildPlaysTimeline returns one entry per allPlays row with valid half+inning", () => {
  const plays = buildPlaysTimeline(homeContext);
  // 6 sample plays, 1 dropped for invalid half
  assert.equal(plays.length, 5);
  assert.equal(plays[0].inning, 1);
  assert.equal(plays[0].half, "top");
  assert.equal(plays[0].actor, "Kyle Schwarber");
});

runTest("buildPlaysTimeline maps MLB eventType to the frontend enum", () => {
  const plays = buildPlaysTimeline(homeContext);
  // index 0 = strikeout → "strikeout"
  assert.equal(plays[0].event_type, "strikeout");
  // index 1 = force_out, scoring → "score_change"
  assert.equal(plays[1].event_type, "score_change");
  // index 2 = home_run → "home_run" (takes precedence over scoring flag)
  assert.equal(plays[2].event_type, "home_run");
  // index 3 = field_out, captivatingIndex 88 → "key_play"
  assert.equal(plays[3].event_type, "key_play");
  // index 4 = single, not scoring, low captivatingIndex → "other"
  assert.equal(plays[4].event_type, "other");
});

runTest("buildPlaysTimeline writes score_after only on scoring plays, Phillies-relative", () => {
  const plays = buildPlaysTimeline(homeContext);
  // Phillies are away in this sample (CHC home) — phiAbbr=PHI scores=awayScore, opp=CHC=homeScore
  assert.equal(plays[0].score_after, "");
  assert.equal(plays[1].score_after, "PHI 0–1 CHC");
  assert.equal(plays[2].score_after, "PHI 0–2 CHC");
  assert.equal(plays[3].score_after, "");
  assert.equal(plays[4].score_after, "");
});

runTest("buildPlaysTimeline inverts score_after correctly when Phillies are home", () => {
  const plays = buildPlaysTimeline({ ...homeContext, philliesAreHome: true });
  // Now homeScore = Phillies score. Same input but reversed orientation.
  assert.equal(plays[1].score_after, "PHI 1–0 CHC");
  assert.equal(plays[2].score_after, "PHI 2–0 CHC");
});

runTest("buildPlaysTimeline carries detail + actor + captivating_index + event_label verbatim", () => {
  const plays = buildPlaysTimeline(homeContext);
  assert.equal(plays[2].detail, "Michael Busch homers (1) on a fly ball to left center field.");
  assert.equal(plays[2].actor, "Michael Busch");
  assert.equal(plays[2].event_label, "Home Run");
  assert.equal(plays[2].captivating_index, 78);
  assert.equal(plays[0].at_bat_index, 0);
});

runTest("buildPlaysTimeline returns [] for missing or malformed input", () => {
  assert.deepEqual(buildPlaysTimeline({ gameFeed: null }), []);
  assert.deepEqual(buildPlaysTimeline({ gameFeed: {} }), []);
  assert.deepEqual(buildPlaysTimeline({ gameFeed: { liveData: {} } }), []);
  assert.deepEqual(buildPlaysTimeline({ gameFeed: { liveData: { plays: {} } } }), []);
  assert.deepEqual(buildPlaysTimeline({ gameFeed: { liveData: { plays: { allPlays: [] } } } }), []);
});

runTest("buildPlaysTimeline drops plays with non-top/bottom half or non-finite inning", () => {
  const plays = buildPlaysTimeline({
    gameFeed: {
      liveData: {
        plays: {
          allPlays: [
            { about: { halfInning: "top", inning: 1 }, result: {}, matchup: {} },
            { about: { halfInning: "middle", inning: 1 }, result: {}, matchup: {} },
            { about: { halfInning: "bottom", inning: "not-a-number" }, result: {}, matchup: {} },
            { about: { halfInning: "top", inning: NaN }, result: {}, matchup: {} },
          ],
        },
      },
    },
    philliesAreHome: true,
    philliesAbbr: "PHI",
    opponentAbbr: "ATL",
  });
  assert.equal(plays.length, 1);
  assert.equal(plays[0].inning, 1);
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
