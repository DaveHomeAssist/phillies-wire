import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { FETCH_TIMEOUT_MS, MLB_API_BASE, TEAM_ID } from "./config.mjs";
import {
  CANONICAL_SCHEDULE_PATH,
  CANONICAL_SCHEDULE_SCHEMA_VERSION,
  CANONICAL_SCHEDULE_SEASON,
  buildCanonicalSchedulePayload,
  findCurrentOrNextGame,
  formatEtDateLabel,
  formatEtTimeLabel,
} from "./shared/phillies-schedule.mjs";

const DATA_DIR = "./data";
const CALENDAR_DIR = "./calendar";
const SCHEDULE_FILE = `./${CANONICAL_SCHEDULE_PATH}`;
const SCHEDULE_AUDIT_FILE = `${DATA_DIR}/phillies-2026-audit.json`;
const SCHEDULE_OVERRIDES_FILE = `${DATA_DIR}/phillies-2026-overrides.json`;
const CALENDAR_FILE = `${CALENDAR_DIR}/phillies-2026-all.ics`;

export async function ensureCanonicalScheduleArtifacts(currentIssueData = {}) {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(CALENDAR_DIR, { recursive: true });
  ensureOverrideFile();

  const generatedAt = new Date().toISOString();
  const existing = readJsonIfExists(SCHEDULE_FILE);

  let payload = null;
  let source = "mlb";
  let usedFallback = false;
  let fetchError = null;

  if (process.env.PW_SKIP_SCHEDULE_FETCH === "1") {
    source = "env-skip";
  } else {
    try {
      const raw = await fetchSeasonSchedule(CANONICAL_SCHEDULE_SEASON);
      payload = buildCanonicalSchedulePayload(raw.games, {
        season: CANONICAL_SCHEDULE_SEASON,
        generated_at: generatedAt,
        fetched_at: raw.fetchedAt,
        query: raw.query,
      });
    } catch (error) {
      source = "fallback";
      fetchError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!payload && existing?.games?.length) {
    payload = {
      ...existing,
      generated_at: generatedAt,
      source: {
        ...(existing.source || {}),
        provider: existing.source?.provider || "Cached artifact",
        fetched_at: existing.source?.fetched_at || existing.generated_at || generatedAt,
      },
    };
    usedFallback = true;
  }

  if (!payload) {
    payload = buildFallbackSchedulePayload(currentIssueData, generatedAt);
    usedFallback = true;
  }

  const overrideResult = applyOverrides(payload, loadOverrides());
  payload = overrideResult.payload;
  const pointer = findCurrentOrNextGame(payload.games, new Date());
  payload.summary = {
    ...payload.summary,
    current_game_pk: pointer.current_game?.game_pk ?? null,
    next_game_pk: pointer.next_game?.game_pk ?? null,
    latest_completed_game_pk: pointer.latest_completed_game?.game_pk ?? null,
  };

  const calendarText = buildCalendar(payload.games);
  const audit = {
    schema_version: CANONICAL_SCHEDULE_SCHEMA_VERSION,
    generated_at: generatedAt,
    source,
    used_fallback: usedFallback,
    fetch_error: fetchError,
    total_games: payload.games.length,
    overrides_applied: overrideResult.applied,
    current_game_pk: payload.summary.current_game_pk,
    next_game_pk: payload.summary.next_game_pk,
  };

  writeFileSync(SCHEDULE_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  writeFileSync(SCHEDULE_AUDIT_FILE, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  writeFileSync(CALENDAR_FILE, calendarText, "utf8");

  return {
    schedule: payload,
    audit,
    calendarText,
    schedulePath: SCHEDULE_FILE,
    calendarPath: CALENDAR_FILE,
  };
}

export async function fetchSeasonSchedule(season = CANONICAL_SCHEDULE_SEASON) {
  const query = {
    sportId: "1",
    teamId: String(TEAM_ID),
    season: String(season),
    gameType: "R",
    hydrate: "probablePitcher,seriesStatus",
  };
  const url = new URL(`${MLB_API_BASE}/schedule`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Schedule fetch timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`Schedule fetch failed with HTTP ${response.status}`);
  }
  const data = await response.json();
  const games = (data.dates || []).flatMap((day) => day.games || []);
  return {
    fetchedAt: new Date().toISOString(),
    query,
    games,
  };
}

function buildFallbackSchedulePayload(currentIssueData = {}, generatedAt) {
  const fallbackGames = [];
  const meta = currentIssueData.meta || {};
  const status = meta.status || {};
  const nextGame = currentIssueData.next_game || {};
  const currentDate = meta.date;

  if (currentDate) {
    fallbackGames.push({
      game_pk: Number(meta.game_pk || 0) || null,
      official_date: currentDate,
      game_date: meta.first_pitch_iso || `${currentDate}T23:05:00Z`,
      title: currentIssueData.sections?.game_status?.content?.matchup || currentIssueData.hero?.headline || "Phillies game",
      matchup: currentIssueData.sections?.game_status?.content?.matchup || currentIssueData.hero?.headline || "PHI",
      date_label: formatEtDateLabel(meta.first_pitch_iso || currentDate),
      time_label: formatEtTimeLabel(meta.first_pitch_iso || null),
      home_game: Boolean(currentIssueData.sections?.game_status?.content?.venue_is_home),
      phillies_side: currentIssueData.sections?.game_status?.content?.venue_is_home ? "home" : "away",
      phillies: {
        team_id: TEAM_ID,
        side: currentIssueData.sections?.game_status?.content?.venue_is_home ? "home" : "away",
        score: currentIssueData.sections?.game_status?.content?.score?.phillies ?? null,
        probable_pitcher: currentIssueData.sections?.game_status?.content?.starters?.phi ?? null,
        league_record: null,
      },
      opponent: {
        team_id: null,
        side: currentIssueData.sections?.game_status?.content?.venue_is_home ? "away" : "home",
        name: currentIssueData.sections?.game_status?.content?.matchup || "Opponent",
        abbr: extractOpponentAbbr(currentIssueData.hero?.headline),
        score: currentIssueData.sections?.game_status?.content?.score?.opponent ?? null,
        probable_pitcher: currentIssueData.sections?.game_status?.content?.starters?.opp ?? null,
        league_record: null,
      },
      teams: {
        home: {
          team_id: currentIssueData.sections?.game_status?.content?.venue_is_home ? TEAM_ID : null,
          name: currentIssueData.sections?.game_status?.content?.venue_is_home ? "Philadelphia Phillies" : "Opponent",
          abbr: currentIssueData.sections?.game_status?.content?.venue_is_home ? "PHI" : extractOpponentAbbr(currentIssueData.hero?.headline),
          score: null,
          is_winner: false,
          probable_pitcher: currentIssueData.sections?.game_status?.content?.starters?.home ?? null,
          league_record: null,
        },
        away: {
          team_id: currentIssueData.sections?.game_status?.content?.venue_is_home ? null : TEAM_ID,
          name: currentIssueData.sections?.game_status?.content?.venue_is_home ? "Opponent" : "Philadelphia Phillies",
          abbr: currentIssueData.sections?.game_status?.content?.venue_is_home ? extractOpponentAbbr(currentIssueData.hero?.headline) : "PHI",
          score: null,
          is_winner: false,
          probable_pitcher: currentIssueData.sections?.game_status?.content?.starters?.away ?? null,
          league_record: null,
        },
      },
      venue: {
        id: null,
        name: currentIssueData.sections?.game_status?.content?.venue || nextGame.venue || "TBD",
      },
      status: {
        abstract: status.mode_label || status.mode || "Preview",
        detailed: status.mode_label || status.mode || "Preview",
        code: null,
        start_time_tbd: false,
      },
      score: {
        phillies: currentIssueData.sections?.game_status?.content?.score?.phillies ?? null,
        opponent: currentIssueData.sections?.game_status?.content?.score?.opponent ?? null,
        home: null,
        away: null,
      },
      result: null,
      series: {
        game_number: null,
        total_games: null,
        label: currentIssueData.sections?.game_status?.content?.series || null,
        description: currentIssueData.sections?.game_status?.content?.series || null,
      },
      description: null,
      double_header: "N",
      day_night: null,
      legacy_match_key: `${currentDate}:${extractOpponentAbbr(currentIssueData.hero?.headline)}:${currentIssueData.sections?.game_status?.content?.venue_is_home ? "H" : "A"}`,
      attendance_key: `pw-game:${meta.game_pk || currentDate}`,
      tags: ["fallback"],
    });
  }

  if (nextGame.date || nextGame.matchup) {
    fallbackGames.push({
      game_pk: `next-${currentDate || "pending"}`,
      official_date: inferOfficialDate(nextGame.date, currentDate),
      game_date: buildNextGameIso(nextGame, currentDate),
      title: nextGame.matchup || "Next Phillies game",
      matchup: nextGame.matchup || "Next Phillies game",
      date_label: nextGame.date || "Upcoming",
      time_label: nextGame.time || "TBD",
      home_game: !String(nextGame.matchup || "").includes("PHI"),
      phillies_side: String(nextGame.matchup || "").includes("PHI") ? "away" : "home",
      phillies: { team_id: TEAM_ID, side: "away", score: null, probable_pitcher: null, league_record: null },
      opponent: {
        team_id: null,
        side: "home",
        name: nextGame.matchup || "Opponent",
        abbr: extractOpponentAbbr(nextGame.matchup),
        score: null,
        probable_pitcher: null,
        league_record: null,
      },
      teams: { home: { team_id: null, name: "Opponent", abbr: extractOpponentAbbr(nextGame.matchup), score: null, is_winner: false, probable_pitcher: null, league_record: null }, away: { team_id: TEAM_ID, name: "Philadelphia Phillies", abbr: "PHI", score: null, is_winner: false, probable_pitcher: null, league_record: null } },
      venue: { id: null, name: nextGame.venue || "TBD" },
      status: { abstract: "Preview", detailed: "Preview", code: "S", start_time_tbd: false },
      score: { phillies: null, opponent: null, home: null, away: null },
      result: null,
      series: { game_number: null, total_games: null, label: null, description: null },
      description: null,
      double_header: "N",
      day_night: null,
      legacy_match_key: `${inferOfficialDate(nextGame.date, currentDate)}:${extractOpponentAbbr(nextGame.matchup)}:A`,
      attendance_key: `pw-game:next-${inferOfficialDate(nextGame.date, currentDate)}`,
      tags: ["fallback"],
    });
  }

  return {
    schema_version: CANONICAL_SCHEDULE_SCHEMA_VERSION,
    publication: currentIssueData.meta?.publication || "Phillies Wire",
    season: CANONICAL_SCHEDULE_SEASON,
    generated_at: generatedAt,
    source: {
      provider: "Fallback issue data",
      fetched_at: generatedAt,
      query: {},
    },
    summary: {
      total_games: fallbackGames.length,
      home_games: fallbackGames.filter((game) => game.home_game).length,
      away_games: fallbackGames.filter((game) => !game.home_game).length,
      completed_games: 0,
      current_game_pk: fallbackGames[0]?.game_pk ?? null,
      next_game_pk: fallbackGames[1]?.game_pk ?? null,
      latest_completed_game_pk: null,
    },
    games: fallbackGames,
  };
}

function applyOverrides(payload, overridesFile) {
  const overrides = Array.isArray(overridesFile?.overrides) ? overridesFile.overrides : [];
  let applied = 0;
  const games = payload.games.map((game) => {
    const override = overrides.find((entry) => matchesOverride(entry, game));
    if (!override) return game;
    applied += 1;
    return {
      ...game,
      note: override.note ?? game.note ?? null,
      must_go: override.must_go ?? game.must_go ?? null,
      featured: override.featured ?? game.featured ?? false,
      tags: Array.isArray(override.tags) ? [...new Set([...(game.tags || []), ...override.tags])] : game.tags,
      legacy_plan_id: override.legacy_plan_id ?? game.legacy_plan_id ?? null,
      broadcast: override.broadcast ? { ...(game.broadcast || {}), ...override.broadcast } : game.broadcast ?? null,
    };
  });
  return {
    applied,
    payload: {
      ...payload,
      games,
    },
  };
}

function matchesOverride(override = {}, game = {}) {
  if (override.game_pk != null) {
    return String(override.game_pk) === String(game.game_pk);
  }
  if (override.official_date && override.opponent_abbr) {
    return override.official_date === game.official_date && override.opponent_abbr === game.opponent?.abbr;
  }
  return false;
}

function loadOverrides() {
  return readJsonIfExists(SCHEDULE_OVERRIDES_FILE) || {
    schema_version: "1.0.0",
    season: CANONICAL_SCHEDULE_SEASON,
    overrides: [],
  };
}

function ensureOverrideFile() {
  if (existsSync(SCHEDULE_OVERRIDES_FILE)) {
    return;
  }
  const initial = {
    schema_version: "1.0.0",
    season: CANONICAL_SCHEDULE_SEASON,
    overrides: [],
  };
  writeFileSync(SCHEDULE_OVERRIDES_FILE, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
}

function buildCalendar(games = []) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Phillies Wire//Merged Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Phillies 2026 Schedule",
    "X-WR-TIMEZONE:America/New_York",
  ];

  for (const game of games) {
    const start = buildCalendarStamp(game.game_date);
    const end = buildCalendarEndStamp(game.game_date);
    const descriptionBits = [
      game.series?.label,
      game.note,
      game.must_go,
    ].filter(Boolean);
    lines.push(
      "BEGIN:VEVENT",
      `UID:phillies-wire-${game.game_pk}@davehomeassist.github.io`,
      `DTSTAMP:${buildCalendarStamp(new Date().toISOString())}`,
      `DTSTART;TZID=America/New_York:${start}`,
      `DTEND;TZID=America/New_York:${end}`,
      `SUMMARY:${escapeCalendarText(`⚾ ${game.title}`)}`,
      `DESCRIPTION:${escapeCalendarText(descriptionBits.join("\\n"))}`,
      `LOCATION:${escapeCalendarText(game.venue?.name || "TBD")}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function buildCalendarStamp(value) {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function buildCalendarEndStamp(value) {
  const start = new Date(value);
  return buildCalendarStamp(new Date(start.getTime() + 3 * 60 * 60 * 1000));
}

function escapeCalendarText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function inferOfficialDate(dateLabel, fallbackDate) {
  if (!dateLabel) {
    return fallbackDate || `${CANONICAL_SCHEDULE_SEASON}-01-01`;
  }
  const parsed = Date.parse(`${dateLabel}, ${CANONICAL_SCHEDULE_SEASON}`);
  if (Number.isNaN(parsed)) {
    return fallbackDate || `${CANONICAL_SCHEDULE_SEASON}-01-01`;
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date(parsed));
}

function buildNextGameIso(nextGame, fallbackDate) {
  const officialDate = inferOfficialDate(nextGame.date, fallbackDate);
  const time = String(nextGame.time || "7:05 PM");
  const match = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  let hours = 19;
  let minutes = 5;
  if (match) {
    hours = Number(match[1]) % 12;
    if (match[3].toUpperCase() === "PM") {
      hours += 12;
    }
    minutes = Number(match[2]);
  }
  return new Date(`${officialDate}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00-04:00`).toISOString();
}

function extractOpponentAbbr(text) {
  const match = String(text || "").match(/\b([A-Z]{2,4})\b(?!.*\b[A-Z]{2,4}\b)/);
  return match?.[1] || "TBD";
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}
