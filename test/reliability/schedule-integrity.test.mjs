import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCalendar,
  buildNextGameIso,
  ensureCanonicalScheduleArtifacts,
  refreshScheduleSummary,
} from "../../canonical-schedule.mjs";
import { buildCanonicalSchedulePayload } from "../../shared/phillies-schedule.mjs";
import { test, run, assert } from "./_harness.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EDT_FIRST_PITCH_ISO = "2026-06-14T23:05:00.000Z";
const EST_FIRST_PITCH_ISO = "2026-11-02T00:05:00.000Z";

function rawScheduleGame(gamePk, officialDate, gameDate) {
  return {
    gamePk,
    gameType: "R",
    season: "2026",
    officialDate,
    gameDate,
    status: {
      abstractGameState: "Preview",
      detailedState: "Scheduled",
      statusCode: "S",
      startTimeTBD: false,
    },
    teams: {
      away: { team: { id: 144, name: "Atlanta Braves" } },
      home: { team: { id: 143, name: "Philadelphia Phillies" } },
    },
    venue: { id: 2681, name: "Citizens Bank Park" },
  };
}

test("P1-SCHED-1: duplicate game_pk rows do not inflate schedule summary", () => {
  const payload = buildCanonicalSchedulePayload([
    rawScheduleGame(1, "2026-06-14", "2026-06-14T23:05:00Z"),
    rawScheduleGame(1, "2026-06-14", "2026-06-14T23:05:00Z"),
    rawScheduleGame(2, "2026-06-15", "2026-06-15T23:05:00Z"),
  ], {
    now: new Date("2026-06-14T12:00:00Z"),
  });

  assert.equal(payload.games.length, 2);
  assert.equal(payload.summary.total_games, 2);
});

test("P1-SCHED-2: schedule summary is recomputed from games", () => {
  const payload = buildCanonicalSchedulePayload([
    rawScheduleGame(1, "2026-06-14", "2026-06-14T23:05:00Z"),
    rawScheduleGame(2, "2026-06-15", "2026-06-15T23:05:00Z"),
  ], {
    now: new Date("2026-06-14T12:00:00Z"),
  });
  const stale = {
    ...payload,
    summary: { ...payload.summary, total_games: 999, home_games: 999 },
  };
  const refreshed = refreshScheduleSummary(stale, new Date("2026-06-14T12:00:00Z"));

  assert.equal(refreshed.summary.total_games, 2);
  assert.equal(refreshed.summary.home_games, 2);
});

test("P2-SCHED-3: fallback next-game ISO keeps June EDT date", () => {
  assert.equal(
    buildNextGameIso({ date: "Jun 14", time: "7:05 PM" }, "2026-06-14"),
    EDT_FIRST_PITCH_ISO,
  );
});

test("P2-SCHED-3: fallback next-game ISO keeps November EST offset", () => {
  assert.equal(
    buildNextGameIso({ date: "Nov 1", time: "7:05 PM" }, "2026-11-01"),
    EST_FIRST_PITCH_ISO,
  );
});

test("P2-SCHED-3: fallback next-game ISO is stable when host TZ is UTC", () => {
  const script = `
    import { buildNextGameIso } from "./canonical-schedule.mjs";
    console.log(buildNextGameIso({ date: "Jun 14", time: "7:05 PM" }, "2026-06-14"));
  `;
  const proc = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC" },
  });

  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
  assert.equal(proc.stdout.trim(), EDT_FIRST_PITCH_ISO);
});

test("P2-SCHED-3: calendar DTSTART keeps ET wall-clock for fallback game", () => {
  const calendar = buildCalendar([
    {
      game_pk: "next-2026-06-14",
      game_date: EDT_FIRST_PITCH_ISO,
      title: "PHI vs MIA",
      venue: { name: "Citizens Bank Park" },
    },
  ]);

  assert.match(calendar, /DTSTART;TZID=America\/New_York:20260614T190500/);
});

test("P2-SCHED-3: current-game fallback uses ET-aware default first pitch", async () => {
  const work = mkdtempSync(join(tmpdir(), "pw-schedule-fallback-"));
  const previousCwd = process.cwd();
  const previousSkip = process.env.PW_SKIP_SCHEDULE_FETCH;

  try {
    process.chdir(work);
    process.env.PW_SKIP_SCHEDULE_FETCH = "1";
    const { schedule, calendarText } = await ensureCanonicalScheduleArtifacts({
      meta: { date: "2026-11-01", publication: "Phillies Wire", status: { mode: "pregame" } },
      hero: { headline: "PHI vs ATL" },
      sections: {
        game_status: {
          content: {
            matchup: "Phillies vs Braves",
            first_pitch: "7:05 PM",
            venue: "Citizens Bank Park",
            venue_is_home: true,
            starters: {},
            score: {},
          },
        },
      },
      next_game: {},
    });

    assert.equal(schedule.games[0].game_date, EST_FIRST_PITCH_ISO);
    assert.equal(schedule.games[0].time_label, "7:05 PM");
    assert.match(calendarText, /DTSTART;TZID=America\/New_York:20261101T190500/);
  } finally {
    if (previousSkip == null) {
      delete process.env.PW_SKIP_SCHEDULE_FETCH;
    } else {
      process.env.PW_SKIP_SCHEDULE_FETCH = previousSkip;
    }
    process.chdir(previousCwd);
    rmSync(work, { recursive: true, force: true });
  }
});

await run();
