export const CANONICAL_SCHEDULE_SCHEMA_VERSION = "1.0.0";
export const CANONICAL_SCHEDULE_SEASON = 2026;
export const CANONICAL_SCHEDULE_PATH = "data/phillies-2026.json";
export const LEGACY_QUEST_SOURCE_KEY = "phillies2026";
export const PHILLIES_TEAM_ID = 143;

const TEAM_ABBR_BY_ID = {
  108: "LAA",
  109: "ARI",
  110: "BAL",
  111: "BOS",
  112: "CHC",
  113: "CIN",
  114: "CLE",
  115: "COL",
  116: "DET",
  117: "HOU",
  118: "KC",
  119: "LAD",
  120: "WSH",
  121: "NYM",
  133: "OAK",
  134: "PIT",
  135: "SD",
  136: "SEA",
  137: "SF",
  138: "STL",
  139: "TB",
  140: "TEX",
  141: "TOR",
  142: "MIN",
  143: "PHI",
  144: "ATL",
  145: "CWS",
  146: "MIA",
  147: "NYY",
  158: "MIL",
};

const TEAM_NAME_FALLBACKS = {
  "athletics": "ATH",
  "angels": "LAA",
  "diamondbacks": "ARI",
  "orioles": "BAL",
  "red sox": "BOS",
  "cubs": "CHC",
  "reds": "CIN",
  "guardians": "CLE",
  "rockies": "COL",
  "tigers": "DET",
  "astros": "HOU",
  "royals": "KC",
  "dodgers": "LAD",
  "nationals": "WSH",
  "mets": "NYM",
  "pirates": "PIT",
  "padres": "SD",
  "mariners": "SEA",
  "giants": "SF",
  "cardinals": "STL",
  "rays": "TB",
  "rangers": "TEX",
  "blue jays": "TOR",
  "twins": "MIN",
  "phillies": "PHI",
  "braves": "ATL",
  "white sox": "CWS",
  "marlins": "MIA",
  "yankees": "NYY",
  "brewers": "MIL",
};

const NL_EAST = new Set([120, 121, 143, 144, 146]);
const NATIONAL_LEAGUE = new Set([108, 109, 112, 113, 115, 119, 120, 121, 133, 134, 135, 136, 137, 138, 143, 144, 146, 158]);
const RIVAL_TEAM_IDS = new Set([119, 121, 144, 147]);
const ACTIVE_STATE_CODES = new Set(["P", "S", "PW", "M", "N", "I", "IR", "DR", "CR", "TR"]);

export function getTeamAbbr(team = {}) {
  const numericId = Number(team.id);
  if (TEAM_ABBR_BY_ID[numericId]) {
    return TEAM_ABBR_BY_ID[numericId];
  }
  const name = String(team.name || team.teamName || "").trim();
  if (!name) {
    return "TBD";
  }
  const lower = name.toLowerCase();
  for (const [needle, abbr] of Object.entries(TEAM_NAME_FALLBACKS)) {
    if (lower.includes(needle)) {
      return abbr;
    }
  }
  return lower
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase() || "TBD";
}

export function formatEtDateLabel(value) {
  if (!value) return "—";
  try {
    const iso = value.includes("T") ? value : `${value}T12:00:00Z`;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return value;
  }
}

export function formatEtTimeLabel(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatMonthLabel(monthKey) {
  if (!monthKey) return "Undated";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "long",
      year: "numeric",
    }).format(new Date(`${monthKey}-15T12:00:00Z`));
  } catch {
    return monthKey;
  }
}

export function buildLegacyMatchKey(input = {}) {
  const date = input.official_date || input.date || "";
  const abbr = input.opponent_abbr || input.opp_abbr || input.opponent?.abbr || "";
  const side = input.home_game ? "H" : "A";
  return `${date}:${abbr}:${side}`;
}

export function buildAttendanceKey(game = {}) {
  const key = game.game_pk != null ? String(game.game_pk) : buildLegacyMatchKey(game);
  return `pw-game:${key}`;
}

export function getMonthKey(game = {}) {
  return String(game.official_date || "").slice(0, 7);
}

export function sortGamesByDate(left, right) {
  const leftDate = Date.parse(left?.game_date || left?.official_date || 0);
  const rightDate = Date.parse(right?.game_date || right?.official_date || 0);
  if (leftDate !== rightDate) {
    return leftDate - rightDate;
  }
  return Number(left?.game_pk || 0) - Number(right?.game_pk || 0);
}

export function groupGamesByMonth(games = []) {
  const groups = new Map();
  for (const game of [...games].sort(sortGamesByDate)) {
    const monthKey = getMonthKey(game);
    if (!groups.has(monthKey)) {
      groups.set(monthKey, {
        month_key: monthKey,
        label: formatMonthLabel(monthKey),
        games: [],
      });
    }
    groups.get(monthKey).games.push(game);
  }
  return [...groups.values()];
}

export function findGameByPk(games = [], gamePk) {
  return games.find((game) => String(game.game_pk) === String(gamePk)) || null;
}

export function findGameByLegacyMatch(games = [], input = {}) {
  const matchKey = buildLegacyMatchKey(input);
  return games.find((game) => game.legacy_match_key === matchKey) || null;
}

export function findCurrentOrNextGame(games = [], now = new Date()) {
  const sorted = [...games].sort(sortGamesByDate);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const currentGame = sorted.find((game) => isActiveGame(game));
  if (currentGame) {
    const nextGame = sorted.find((game) => Date.parse(game.game_date) > Date.parse(currentGame.game_date));
    return {
      current_game: currentGame,
      next_game: nextGame || null,
      latest_completed_game: findLatestCompletedGame(sorted),
    };
  }
  const nextGame = sorted.find((game) => Date.parse(game.game_date) >= nowMs && !isCompletedGame(game));
  return {
    current_game: null,
    next_game: nextGame || null,
    latest_completed_game: findLatestCompletedGame(sorted),
  };
}

export function isCompletedGame(game = {}) {
  const abstractState = String(game.status?.abstract || game.status?.abstract_state || "").toLowerCase();
  return abstractState === "final";
}

export function isActiveGame(game = {}) {
  const statusCode = String(game.status?.code || "").toUpperCase();
  const abstractState = String(game.status?.abstract || "").toLowerCase();
  return ACTIVE_STATE_CODES.has(statusCode) || abstractState === "live" || abstractState === "preview";
}

export function findLatestCompletedGame(games = []) {
  const finals = [...games].filter(isCompletedGame).sort(sortGamesByDate);
  return finals[finals.length - 1] || null;
}

export function buildCanonicalSchedulePayload(rawGames = [], meta = {}) {
  const games = rawGames
    .filter((game) => String(game.gameType || "").toUpperCase() === "R")
    .map((game, index) => buildCanonicalGame(game, { season: meta.season, sequence: index + 1 }))
    .sort(sortGamesByDate);

  const pointer = findCurrentOrNextGame(games, meta.now || new Date());
  const summary = {
    total_games: games.length,
    home_games: games.filter((game) => game.home_game).length,
    away_games: games.filter((game) => !game.home_game).length,
    completed_games: games.filter(isCompletedGame).length,
    current_game_pk: pointer.current_game?.game_pk ?? null,
    next_game_pk: pointer.next_game?.game_pk ?? null,
    latest_completed_game_pk: pointer.latest_completed_game?.game_pk ?? null,
  };

  return {
    schema_version: CANONICAL_SCHEDULE_SCHEMA_VERSION,
    publication: meta.publication || "Phillies Wire",
    season: Number(meta.season || CANONICAL_SCHEDULE_SEASON),
    generated_at: meta.generated_at || new Date().toISOString(),
    source: {
      provider: meta.provider || "MLB Stats API",
      fetched_at: meta.fetched_at || meta.generated_at || new Date().toISOString(),
      query: meta.query || {},
    },
    summary,
    games,
  };
}

export function buildCanonicalGame(rawGame = {}) {
  const home = rawGame.teams?.home?.team || {};
  const away = rawGame.teams?.away?.team || {};
  const homeAbbr = getTeamAbbr(home);
  const awayAbbr = getTeamAbbr(away);
  const philliesAreHome = Number(home.id) === PHILLIES_TEAM_ID;
  const philliesSide = philliesAreHome ? "home" : "away";
  const opponentSide = philliesAreHome ? "away" : "home";
  const philliesEntry = rawGame.teams?.[philliesSide] || {};
  const opponentEntry = rawGame.teams?.[opponentSide] || {};
  const opponentTeam = opponentEntry.team || {};
  const opponentAbbr = getTeamAbbr(opponentTeam);
  const score = buildScore(rawGame, philliesSide, opponentSide);
  const status = {
    abstract: rawGame.status?.abstractGameState || null,
    detailed: rawGame.status?.detailedState || null,
    code: rawGame.status?.statusCode || null,
    start_time_tbd: Boolean(rawGame.status?.startTimeTBD),
  };
  const game = {
    game_pk: rawGame.gamePk ?? null,
    official_date: rawGame.officialDate || null,
    game_date: rawGame.gameDate || null,
    title: philliesAreHome
      ? `${opponentTeam.name || opponentAbbr} at Phillies`
      : `Phillies at ${opponentTeam.name || opponentAbbr}`,
    matchup: `${awayAbbr} at ${homeAbbr}`,
    date_label: formatEtDateLabel(rawGame.gameDate || rawGame.officialDate),
    time_label: formatEtTimeLabel(rawGame.gameDate),
    home_game: philliesAreHome,
    phillies_side: philliesSide,
    phillies: {
      team_id: PHILLIES_TEAM_ID,
      side: philliesSide,
      score: score.phillies,
      probable_pitcher: normalizePitcher(philliesEntry.probablePitcher),
      league_record: philliesEntry.leagueRecord || null,
    },
    opponent: {
      team_id: opponentTeam.id ?? null,
      side: opponentSide,
      name: opponentTeam.name || opponentAbbr,
      abbr: opponentAbbr,
      score: score.opponent,
      probable_pitcher: normalizePitcher(opponentEntry.probablePitcher),
      league_record: opponentEntry.leagueRecord || null,
    },
    teams: {
      home: normalizeTeamEntry(rawGame.teams?.home, homeAbbr),
      away: normalizeTeamEntry(rawGame.teams?.away, awayAbbr),
    },
    venue: {
      id: rawGame.venue?.id ?? null,
      name: rawGame.venue?.name ?? null,
    },
    status,
    score,
    result: resolveResult(status.abstract, score),
    series: {
      game_number: rawGame.seriesGameNumber ?? rawGame.seriesStatus?.gameNumber ?? null,
      total_games: rawGame.gamesInSeries ?? rawGame.seriesStatus?.totalGames ?? null,
      label: rawGame.seriesStatus?.result || rawGame.seriesStatus?.description || rawGame.seriesDescription || null,
      description: rawGame.seriesDescription || rawGame.seriesStatus?.description || null,
    },
    description: rawGame.description || null,
    double_header: rawGame.doubleHeader || "N",
    day_night: rawGame.dayNight || null,
    legacy_match_key: buildLegacyMatchKey({
      official_date: rawGame.officialDate,
      opponent_abbr: opponentAbbr,
      home_game: philliesAreHome,
    }),
    attendance_key: buildAttendanceKey({ game_pk: rawGame.gamePk }),
    tags: deriveGameTags({
      officialDate: rawGame.officialDate,
      gameDate: rawGame.gameDate,
      homeGame: philliesAreHome,
      opponentTeamId: opponentTeam.id,
      opponentAbbr,
      dayNight: rawGame.dayNight,
    }),
  };
  return game;
}

export function deriveGameTags(input = {}) {
  const tags = new Set();
  const gameDate = input.gameDate || input.officialDate;
  if (gameDate) {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    }).format(new Date(gameDate));
    if (weekday === "Sat" || weekday === "Sun") {
      tags.add("weekend");
    }
    if (weekday === "Mon" || weekday === "Tue" || weekday === "Wed" || weekday === "Thu" || weekday === "Fri") {
      tags.add("weekday");
    }
  }
  if (input.homeGame) {
    tags.add("home");
  } else {
    tags.add("road");
  }
  if (RIVAL_TEAM_IDS.has(Number(input.opponentTeamId))) {
    tags.add("rivalry");
  }
  if (NL_EAST.has(Number(input.opponentTeamId))) {
    tags.add("division");
  } else if (!NATIONAL_LEAGUE.has(Number(input.opponentTeamId))) {
    tags.add("interleague");
  }
  if (String(input.dayNight || "").toLowerCase() === "day") {
    tags.add("day");
  }
  return [...tags];
}

function normalizeTeamEntry(entry = {}, abbr = "TBD") {
  return {
    team_id: entry.team?.id ?? null,
    name: entry.team?.name ?? abbr,
    abbr,
    score: entry.score ?? null,
    is_winner: Boolean(entry.isWinner),
    probable_pitcher: normalizePitcher(entry.probablePitcher),
    league_record: entry.leagueRecord || null,
  };
}

function buildScore(rawGame = {}, philliesSide, opponentSide) {
  const philliesRuns = rawGame.teams?.[philliesSide]?.score;
  const opponentRuns = rawGame.teams?.[opponentSide]?.score;
  return {
    phillies: Number.isFinite(philliesRuns) ? philliesRuns : null,
    opponent: Number.isFinite(opponentRuns) ? opponentRuns : null,
    home: Number.isFinite(rawGame.teams?.home?.score) ? rawGame.teams.home.score : null,
    away: Number.isFinite(rawGame.teams?.away?.score) ? rawGame.teams.away.score : null,
  };
}

function resolveResult(abstractState, score = {}) {
  if (String(abstractState || "").toLowerCase() !== "final") {
    return null;
  }
  if (!Number.isFinite(score.phillies) || !Number.isFinite(score.opponent)) {
    return null;
  }
  if (score.phillies === score.opponent) {
    return "T";
  }
  return score.phillies > score.opponent ? "W" : "L";
}

function normalizePitcher(pitcher) {
  if (!pitcher) return null;
  return {
    id: pitcher.id ?? null,
    name: pitcher.fullName || pitcher.name || null,
  };
}
