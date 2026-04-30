import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildPregamePreviewContent, buildRecapPullQuote } from "./pregame-preview.js";
import {
  createFetchSoft,
  fetchDailyMlbData,
  fetchGameDetail,
  fetchPitcherStats,
  fetchRecentFinals,
  fetchStandings,
} from "./crawl/api/mlb.mjs";
import { fetchWeatherData } from "./crawl/api/weather.mjs";
import {
  buildBroadcastLine,
  buildFreshnessLabel,
  buildSeriesContext,
  buildWindSummary,
  deriveMode,
  deriveModeLabel,
  formatGameTime,
  formatGeneratedAtEt,
  formatMonthDay,
  formatShortDate,
  formatWeekday,
  getIsoDate,
  getRelativeIsoDate,
  isFinalGame,
  weatherCodeToText,
} from "./crawl/format.mjs";
import {
  TEAM_ID,
  SCHEMA_VERSION,
} from "./config.mjs";
const TODAY = getIsoDate();
const YESTERDAY = getRelativeIsoDate(-1);
const TRANSACTION_START_DATE = `${TODAY.slice(0, 4)}-03-01`;
const OUTPUT_FILE = "./phillies-wire-data.json";
const ERROR_LOG = "./crawl-error.log";
const PITCHER_OVERRIDES_PATH = "./overrides/pitchers.json";

// Static handedness overrides applied when the MLB Stats API probable-pitcher
// payload omits pitchHand.code. Without this, resolvePitcher would silently
// default to "R", which produced the Matthew Boyd = RHP bug on 2026-04-22.
let PITCHER_HANDEDNESS = null;
function loadPitcherOverrides() {
  if (PITCHER_HANDEDNESS) return PITCHER_HANDEDNESS;
  try {
    if (!existsSync(PITCHER_OVERRIDES_PATH)) {
      PITCHER_HANDEDNESS = new Map();
      return PITCHER_HANDEDNESS;
    }
    const raw = JSON.parse(readFileSync(PITCHER_OVERRIDES_PATH, "utf8"));
    const map = new Map();
    for (const [name, hand] of Object.entries(raw?.handedness ?? {})) {
      if (typeof name === "string" && (hand === "L" || hand === "R" || hand === "S")) {
        map.set(name.toLowerCase().trim(), hand);
      }
    }
    PITCHER_HANDEDNESS = map;
  } catch {
    PITCHER_HANDEDNESS = new Map();
  }
  return PITCHER_HANDEDNESS;
}

export function lookupPitcherHand(fullName) {
  if (!fullName || typeof fullName !== "string") return null;
  const map = loadPitcherOverrides();
  return map.get(fullName.toLowerCase().trim()) ?? null;
}

// Live-refresh mode: the game-window cron re-crawls every 15 min to update
// scores, inning, and hero card values. It must NOT overwrite the morning's
// Claude-enriched editorial copy (pull quotes, preview narrative, ticker
// items) — enrich.mjs does not run on live refreshes, so a fresh overwrite
// here would replace good copy with the structured fallback and never
// regenerate it. When ISSUE_MODE=live, we merge live MLB updates back into
// the previous payload instead of starting from fixture.
const IS_LIVE_REFRESH = (process.env.ISSUE_MODE || "").toLowerCase() === "live";
const EDITORIAL_FIELDS_TO_PRESERVE = [
  ["meta", "status", "enrich_state"],
  ["meta", "status", "enrich_label"],
  ["ticker"],
  ["sections", "preview", "content", "narrative"],
  ["sections", "preview", "content", "pull_quote"],
  ["sections", "recap", "content", "pull_quote"],
  ["sections", "game_status", "content", "giveaway"],
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => fail(error));
}

export {
  resolvePitcher,
  resolveSeriesLabel,
  buildPitchHandIndex,
  extractDecisions,
  extractBroadcast,
  extractBattingOrder,
  buildLineupSection,
  mergeInjuryEntries,
  normalizeLiveInjuries,
  applyStandingRecord,
  buildTbdBattingOrder,
  extractKeyPerformers,
  pickActiveGame,
  clampOverride,
};

async function main() {
  const fixture = JSON.parse(readFileSync("./phillies-wire-schema.json", "utf8"));
  const overrides = loadOverrides(TODAY);
  const fetchSoft = createFetchSoft();
  const [{ scheduleResponse, nextScheduleResponse, rosterResponse, transactionResponse, injuryResponse }, weatherResponse, lastFinal] =
    await Promise.all([
      fetchDailyMlbData({
        today: TODAY,
        yesterday: YESTERDAY,
        transactionStartDate: TRANSACTION_START_DATE,
        endDate: getRelativeIsoDate(4),
        teamId: TEAM_ID,
        fetchSoft,
      }),
      fetchWeatherData(fetchSoft),
      fetchRecentFinals({ teamId: TEAM_ID, today: TODAY, fetchSoft }),
    ]);

  const nextGames = collectUpcomingGames(nextScheduleResponse, TEAM_ID);
  const game = pickActiveGame(scheduleResponse?.dates?.[0]?.games ?? []);

  if (!game) {
    const offDay = buildOffDayPayload(fixture, nextGames, overrides);
    if (lastFinal) offDay.meta.last_final = lastFinal;
    validateCrawlPayload(offDay);
    writePayload(offDay);
    console.log(`No game scheduled for ${TODAY}. Off-day payload written.`);
    return;
  }

  // Fetch boxscore (for batting order, stats) AND feed/live (for full
  // person records including batSide). The boxscore's person object is
  // thinned to {id, fullName, link} — batSide lives in feed/live only.
  const { boxscore, gameFeed } = await fetchGameDetail(game.gamePk);

  const data = await buildLivePayload({
    fixture,
    overrides,
    game,
    boxscore,
    gameFeed,
    nextGames,
    rosterResponse,
    transactionResponse,
    injuryResponse,
    weatherResponse,
  });
  if (lastFinal) data.meta.last_final = lastFinal;

  const finalData = IS_LIVE_REFRESH ? preserveEditorialFromPrevious(data) : data;
  validateCrawlPayload(finalData);
  writePayload(finalData);
  console.log(
    IS_LIVE_REFRESH
      ? "phillies-wire-data.json refreshed (editorial preserved)"
      : "phillies-wire-data.json written",
  );
}

function preserveEditorialFromPrevious(freshData) {
  if (!existsSync(OUTPUT_FILE)) return freshData;
  let previous;
  try {
    previous = JSON.parse(readFileSync(OUTPUT_FILE, "utf8"));
  } catch {
    return freshData;
  }
  // Only preserve editorial if the previous payload is from the same ET day.
  // If date rolled over (midnight ET), treat as a fresh crawl.
  if (!previous?.meta?.date || previous.meta.date !== freshData.meta.date) {
    return freshData;
  }
  for (const path of EDITORIAL_FIELDS_TO_PRESERVE) {
    const previousValue = getPath(previous, path);
    if (previousValue !== undefined && previousValue !== null && previousValue !== "") {
      setPath(freshData, path, previousValue);
    }
  }
  return freshData;
}

function getPath(obj, path) {
  return path.reduce((cur, key) => (cur == null ? cur : cur[key]), obj);
}

function setPath(obj, path, value) {
  const last = path[path.length - 1];
  const parent = path.slice(0, -1).reduce((cur, key) => {
    if (cur[key] == null || typeof cur[key] !== "object") cur[key] = {};
    return cur[key];
  }, obj);
  parent[last] = value;
}

async function buildLivePayload(context) {
  const {
    fixture,
    overrides,
    game,
    boxscore,
    gameFeed,
    nextGames,
    rosterResponse,
    transactionResponse,
    injuryResponse,
    weatherResponse,
  } = context;

  // Build a player-id -> batSide.code map once. Used by extractBattingOrder
  // because the boxscore endpoint thins person to {id, fullName, link} and
  // does NOT carry batSide. feed/live is the canonical source.
  const handednessByPlayerId = buildHandednessIndex(gameFeed);
  const pitchHandByPlayerId = buildPitchHandIndex(gameFeed);

  const data = cloneJson(fixture);
  const homeTeam = game.teams.home.team;
  const awayTeam = game.teams.away.team;
  const philliesAreHome = homeTeam.id === TEAM_ID;
  const philliesSide = philliesAreHome ? game.teams.home : game.teams.away;
  const opponentSide = philliesAreHome ? game.teams.away : game.teams.home;
  const weather = weatherResponse?.current ?? {};

  data.meta.schema_version = fixture.meta.schema_version ?? SCHEMA_VERSION;
  data.meta.date = TODAY;
  data.meta.generated_at = new Date().toISOString();
  data.meta.off_day = false;
  data.meta.show_sections = true;
  data.record = {
    ...data.record,
    wins: philliesSide.leagueRecord?.wins ?? data.record.wins,
    losses: philliesSide.leagueRecord?.losses ?? data.record.losses,
  };

  data.meta.status = {
    ...fixture.meta.status,
    mode: deriveMode(game),
    mode_label: deriveModeLabel(game),
    crawl_state: "ok",
    enrich_state: "pending",
    // Public-safe label. Internal "awaiting editorial pass" wording was
    // being shown to readers; "Draft edition" tells a subscriber the
    // same thing without exposing workflow state.
    enrich_label: "Draft edition",
    generated_at_et: formatGeneratedAtEt(data.meta.generated_at),
    source_notes: buildSourceNotes(transactionResponse, fixture, overrides),
  };

  data.sections.game_status.preview = buildGameStatusPreview(data.meta.status.mode);
  data.sections.recap.show = false;
  data.sections.recap.chip_label = "";
  data.sections.recap.chip_tone = "";

  const philliesPitcher = resolvePitcher(philliesSide, fixture, "phi", pitchHandByPlayerId);
  const opponentPitcher = resolvePitcher(opponentSide, fixture, "opp", pitchHandByPlayerId);
  const homePitcher = philliesAreHome ? philliesPitcher : opponentPitcher;
  const awayPitcher = philliesAreHome ? opponentPitcher : philliesPitcher;

  data.sections.game_status.content = {
    ...data.sections.game_status.content,
    matchup: buildMatchupTitle(game, awayTeam, homeTeam),
    first_pitch: formatGameTime(game.gameDate),
    venue: `${game.venue.name}, ${homeTeam.locationName}`,
    starters: {
      home: homePitcher,
      away: awayPitcher,
      phi: philliesPitcher,
      opp: opponentPitcher,
    },
    series: {
      ...data.sections.game_status.content.series,
      label: resolveSeriesLabel(game, fixture.sections.game_status.content.series.label),
    },
    broadcast: {
      ...data.sections.game_status.content.broadcast,
      tv: extractBroadcast(game, "TV") ?? fixture.sections.game_status.content.broadcast.tv,
      stream: fixture.sections.game_status.content.broadcast.stream,
      radio: extractBroadcast(game, "RADIO") ?? fixture.sections.game_status.content.broadcast.radio,
    },
    weather: {
      temp_f: Math.round(weather.temperature_2m ?? fixture.sections.game_status.content.weather.temp_f),
      condition: weatherCodeToText(weather.weather_code) ?? fixture.sections.game_status.content.weather.condition,
      wind: buildWindSummary(weather),
      gusts_mph: Math.round(weather.wind_gusts_10m ?? fixture.sections.game_status.content.weather.gusts_mph),
    },
    giveaway: fixture.sections.game_status.content.giveaway,
    transit: fixture.sections.game_status.content.transit,
    // Transit block is Citizens Bank Park / SEPTA specific. Only show it
    // for home games. Away games hide the transit row entirely.
    venue_is_home: philliesAreHome,
  };

  data.sections.lineup = buildLineupSection({
    fixture,
    boxscore,
    handednessByPlayerId,
    philliesAreHome,
    homeTeam,
    awayTeam,
    starters: data.sections.game_status.content.starters,
    firstPitch: data.sections.game_status.content.first_pitch,
    opponentAbbr: opponentSide.team.abbreviation,
  });

  const pregamePreview = buildPregamePreviewContent({
    matchup: data.sections.game_status.content.matchup,
    firstPitch: data.sections.game_status.content.first_pitch,
    venue: data.sections.game_status.content.venue,
    seriesLabel: data.sections.game_status.content.series.label,
    starters: data.sections.game_status.content.starters,
  });
  data.sections.preview.preview = pregamePreview.preview;
  data.sections.preview.content.narrative = pregamePreview.content.narrative;
  data.sections.preview.content.pull_quote = pregamePreview.content.pull_quote;

  if (isFinalGame(game)) {
    data.sections.recap.show = true;
    data.sections.recap.preview = buildRecapPreview(game, boxscore, fixture.sections.recap.preview);
    data.sections.recap.title = `${formatWeekday(game.gameDate)} Recap`;
    data.sections.recap.content.date = data.meta.date;
    data.sections.recap.content.result = {
      home_score: game.teams.home.score,
      away_score: game.teams.away.score,
      winner: game.teams.home.score > game.teams.away.score ? homeTeam.abbreviation : awayTeam.abbreviation,
      summary_line: buildRecapSummaryLine(game, TEAM_ID),
    };
    data.sections.recap.content.key_performers = extractKeyPerformers(boxscore, fixture.sections.recap.content.key_performers);
    data.sections.recap.content.decisions = extractDecisions(boxscore);
    data.sections.recap.content.pull_quote = buildRecapPullQuote({
      summaryLine: data.sections.recap.content.result.summary_line,
      venue: data.sections.game_status.content.venue,
      seriesLabel: data.sections.game_status.content.series.label,
    });
  }

  const [rotation, standings] = await Promise.all([
    buildRotation(nextGames, fixture.sections.roster.content.rotation),
    fetchStandings(),
  ]);
  data.record = applyStandingRecord(data.record, standings);

  data.meta.game_pk = game.gamePk;
  data.meta.first_pitch_iso = game.gameDate;

  const fallbackGeneratedAt = fixture.meta.generated_at ?? data.meta.generated_at;
  data.sections.roster.content.rotation = rotation;
  data.sections.roster.content.as_of_label = buildFreshnessLabel("As of", data.meta.generated_at);
  data.sections.roster.content.highlights = buildRosterHighlights(rosterResponse, transactionResponse, fixture.sections.roster.content.highlights);
  if (data.sections.recap.show) {
    data.sections.recap.chip_label = "Final";
    data.sections.recap.chip_tone = "final";
  }
  data.sections.roster.chip_label = rosterResponse?.roster ? "Confirmed" : "Fallback";
  data.sections.roster.chip_tone = rosterResponse?.roster ? "confirmed" : "fallback";
  data.sections.injury_report.content.il_entries = mergeInjuryEntries(
    fixture.sections.injury_report.content.il_entries,
    injuryResponse,
    transactionResponse,
    data.meta.generated_at,
    fallbackGeneratedAt,
  );
  data.sections.injury_report.content.footer_note = buildInjuryFooterNote(
    data.sections.injury_report.content.il_entries,
    Boolean(transactionResponse?.transactions?.length),
  );
  const hasLiveInjuryFeed = Array.isArray(injuryResponse?.injuries)
    || Array.isArray(injuryResponse?.roster)
    || hasTransactionInjuryData(transactionResponse);
  data.sections.injury_report.chip_label = hasLiveInjuryFeed ? "Live" : "Fallback";
  data.sections.injury_report.chip_tone = hasLiveInjuryFeed ? "live" : "fallback";
  data.sections.farm_system.chip_label = "Editorial";
  data.sections.farm_system.chip_tone = "editorial";
  data.sections.farm_system.content.last_confirmed_label = buildFreshnessLabel(
    "Last confirmed",
    data.sections.farm_system.content.last_confirmed ?? fallbackGeneratedAt,
  );
  data.sections.standings = {
    title: "NL East Standings",
    preview: buildStandingsPreview(standings),
    content: { teams: standings },
  };
  data.sections.preview.content.up_next = buildUpNext(nextGames, fixture.sections.preview.content.up_next);

  if (nextGames.length > 1) {
    const nextGame = nextGames[1];
    // Same-day doubleheader: nextGames[1] shares its ISO date with the active
    // game. Don't call it "Tomorrow"; readers will be confused, especially
    // when the date label says "today's date".
    const nextIsoDate = String(nextGame.gameDate ?? "").slice(0, 10);
    const sameDayDoubleheader = nextIsoDate === TODAY;
    data.next_game = {
      ...data.next_game,
      label: sameDayDoubleheader ? "Game 2 Today" : "Tomorrow",
      matchup: buildNextGameMatchup(nextGame),
      date: nextGame.dateLabel,
      time: nextGame.timeLabel,
      broadcast: nextGame.broadcast ?? fixture.next_game.broadcast,
      venue: nextGame.venue,
    };
  } else if (nextGames.length) {
    const nextGame = nextGames[0];
    data.next_game = {
      ...data.next_game,
      label: "Next Game",
      matchup: buildNextGameMatchup(nextGame),
      date: nextGame.dateLabel,
      time: nextGame.timeLabel,
      broadcast: nextGame.broadcast ?? fixture.next_game.broadcast,
      venue: nextGame.venue,
    };
  }

  data.ticker = buildTicker(data, transactionResponse, weather);

  const overrideHero = overrides?.hero ? cloneJson(overrides.hero) : null;
  applyOverrides(data, stripHeroOverride(overrides));
  data.hero = buildHero(data, game);
  if (overrideHero) {
    data.hero = deepMerge(data.hero, overrideHero);
  }

  return data;
}

function buildMatchupTitle(game, awayTeam, homeTeam) {
  const seriesGame = game?.seriesGameNumber ?? 1;
  const gamesInSeries = game?.gamesInSeries ?? game?.seriesStatus?.totalGames;
  const seriesPart = gamesInSeries
    ? `Game ${seriesGame} of ${gamesInSeries}`
    : `Game ${seriesGame}`;
  return `${awayTeam.teamName} @ ${homeTeam.teamName} · ${seriesPart}`;
}

function buildNextGameMatchup(nextGame) {
  const phi = nextGame?.homePitcher;
  const opp = nextGame?.awayPitcher;
  const teams = nextGame?.matchup ?? "";
  const haveBothPitchers = phi && phi !== "TBD" && opp && opp !== "TBD";
  if (haveBothPitchers) {
    return `${phi} vs ${opp} · ${teams}`.trim();
  }
  if (phi && phi !== "TBD") return `${phi} · ${teams}`.trim();
  if (opp && opp !== "TBD") return `${opp} · ${teams}`.trim();
  return teams || "TBD";
}

function buildDoubleheaderBullet(game) {
  const indicator = game?.doubleHeader;
  if (indicator !== "S" && indicator !== "Y") return null;
  const dhNumber = game?.gameNumber;
  if (!dhNumber) return null;
  const dhLabel = dhNumber === 1 ? "Game 1 of 2" : `Game ${dhNumber} of 2`;
  return `Doubleheader · ${dhLabel}`;
}

function pickActiveGame(games) {
  if (!games.length) {
    return null;
  }

  // Doubleheader handling: prefer the game that is currently in
  // progress; otherwise return the next unfinished game by startTime;
  // otherwise the last final game of the day.
  const byStart = [...games].sort((left, right) =>
    String(left.gameDate ?? "").localeCompare(String(right.gameDate ?? "")),
  );

  const live = byStart.find((game) => game?.status?.abstractGameState === "Live");
  if (live) return live;

  const upcoming = byStart.find((game) => game?.status?.abstractGameState === "Preview");
  if (upcoming) return upcoming;

  const finals = byStart.filter((game) => game?.status?.abstractGameState === "Final");
  if (finals.length) return finals[finals.length - 1];

  return byStart[0];
}

function resolvePitcher(side, fixture, role, pitchHandByPlayerId = null) {
  const probable = side?.probablePitcher;
  if (probable?.fullName) {
    const id = probable.id ?? probable.personId;
    const feedHand = pitchHandByPlayerId && id != null ? pitchHandByPlayerId.get(Number(id)) : null;
    return {
      name: probable.fullName,
      hand: probable.pitchHand?.code ?? feedHand ?? lookupPitcherHand(probable.fullName) ?? "R",
    };
  }

  // Only the Phillies fallback is reliable — the fixture's opponent
  // starter is Rangers-specific and would leak into, say, a Nationals
  // preview. Leave the opponent as TBD instead of lying to the reader.
  if (role === "phi") {
    const fallback = fixture.sections.game_status.content.starters?.phi
      ?? fixture.sections.game_status.content.starters?.home
      ?? { name: "TBD", hand: "R" };
    return { name: fallback.name ?? "TBD", hand: fallback.hand ?? "R" };
  }

  return { name: "TBD", hand: "R" };
}

function resolveSeriesLabel(game, fallbackLabel) {
  const seriesStatus = game?.seriesStatus;
  if (seriesStatus?.result && typeof seriesStatus.result === "string" && seriesStatus.result.trim()) {
    return seriesStatus.result.trim();
  }

  if (seriesStatus?.description && typeof seriesStatus.description === "string") {
    return seriesStatus.description;
  }

  const gameNumber = game?.seriesGameNumber;
  const gamesInSeries = game?.gamesInSeries ?? seriesStatus?.gamesInSeries;
  if (gameNumber && gamesInSeries) {
    return `Game ${gameNumber} of ${gamesInSeries}`;
  }

  return fallbackLabel;
}

function extractDecisions(boxscore) {
  const decisions = boxscore?.decisions ?? {};
  const normalize = (entry) => {
    if (!entry) return null;
    return {
      id: entry.id ?? null,
      fullName: entry.fullName ?? entry.name ?? "TBD",
      link: entry.link ?? null,
    };
  };

  return {
    winner: normalize(decisions.winner),
    loser: normalize(decisions.loser),
    save: normalize(decisions.save),
  };
}

function buildLineupSection(context) {
  const { fixture, boxscore, handednessByPlayerId, philliesAreHome, homeTeam, awayTeam, starters, firstPitch, opponentAbbr } = context;
  const fixtureLineup = fixture.sections.lineup;
  const homeAbbr = homeTeam.abbreviation;
  const awayAbbr = awayTeam.abbreviation;

  const homeBox = boxscore?.teams?.home ?? null;
  const awayBox = boxscore?.teams?.away ?? null;

  const homeOrder = extractBattingOrder(homeBox, handednessByPlayerId);
  const awayOrder = extractBattingOrder(awayBox, handednessByPlayerId);

  const homeAnnounced = homeOrder.length === 9;
  const awayAnnounced = awayOrder.length === 9;
  const announced = homeAnnounced && awayAnnounced;

  // Phillies fallback is the only reliable baseline; opponent fallback in
  // the fixture is Rangers-specific. Only reuse the opponent fallback when
  // today's opponent actually is Texas — otherwise leave a TBD placeholder.
  const fixturePhiOrder = fixtureLineup.content.batting_order.home;
  const fixtureOppOrder = opponentAbbr === "TEX" ? fixtureLineup.content.batting_order.away : buildTbdBattingOrder(opponentAbbr);

  const phiFallbackOrder = fixturePhiOrder;
  const oppFallbackOrder = fixtureOppOrder;

  const phiOrder = homeAnnounced && philliesAreHome ? homeOrder
    : awayAnnounced && !philliesAreHome ? awayOrder
    : phiFallbackOrder;
  const oppOrder = homeAnnounced && !philliesAreHome ? homeOrder
    : awayAnnounced && philliesAreHome ? awayOrder
    : oppFallbackOrder;

  const homeStarter = {
    team: homeAbbr,
    name: starters.home?.name ?? "TBD",
    hand: starters.home?.hand ?? "R",
  };
  const awayStarter = {
    team: awayAbbr,
    name: starters.away?.name ?? "TBD",
    hand: starters.away?.hand ?? "R",
  };

  // Three-state mode drives template rendering:
  //   official  both boxscore orders posted
  //   projected PHI side is a fixture baseline, opponent is pending
  //   pending   both sides pending (road game, no baseline)
  let mode;
  if (announced) {
    mode = "official";
  } else if (phiOrder !== oppFallbackOrder && phiOrder.length === 9) {
    mode = "projected";
  } else {
    mode = "pending";
  }
  const modeLabel = mode === "official" ? "Official" : mode === "projected" ? "Projected" : "Pending";

  const statusNote = mode === "official"
    ? `Official batting orders confirmed for today's ${awayAbbr} at ${homeAbbr} game.`
    : mode === "projected"
    ? `PHI order is a projected baseline. ${opponentAbbr} lineup posts about two hours before first pitch.`
    : "Lineups post about two hours before first pitch. Holding until MLB confirms.";

  const preview = mode === "official"
    ? `${homeAbbr} order set · ${starters.phi?.name ?? "TBD"} vs ${starters.opp?.name ?? "TBD"}`
    : mode === "projected"
    ? `Projected · ${starters.phi?.name ?? "TBD"} vs ${starters.opp?.name ?? "TBD"}`
    : `Lineups pending · ${starters.phi?.name ?? "TBD"} vs ${starters.opp?.name ?? "TBD"}`;

  return {
    preview,
    content: {
      status_note: statusNote,
      announced,
      mode,
      mode_label: modeLabel,
      // Template toggle: render the 9x2 batting order grid only when we
      // have either confirmed lineups or a projected PHI baseline.
      // Pending mode suppresses the grid so readers don't see filler rows.
      show_orders: mode !== "pending",
      first_pitch: firstPitch,
      starters: {
        home: homeStarter,
        away: awayStarter,
        phi: { team: "PHI", name: starters.phi?.name ?? "TBD", hand: starters.phi?.hand ?? "R" },
        opp: { team: opponentAbbr, name: starters.opp?.name ?? "TBD", hand: starters.opp?.hand ?? "R" },
      },
      batting_order: {
        home: philliesAreHome ? phiOrder : oppOrder,
        away: philliesAreHome ? oppOrder : phiOrder,
        phi: phiOrder,
        opp: oppOrder,
      },
    },
  };
}

// Sentinel row used when a full lineup is not yet posted. The template
// detects these rows via mode === "pending" and renders a single
// "lineup pending" message instead of nine numbered filler names.
// The unused teamAbbr is preserved for callers still labelling by team.
function buildTbdBattingOrder(_teamAbbr) {
  return Array.from({ length: 9 }, (_, index) => ({
    slot: index + 1,
    name: "Pending",
    position: "",
    bats: "",
  }));
}

// Build a Map from numeric player id -> batSide.code ("L" | "R" | "S")
// using the feed/live response's gameData.players. The boxscore endpoint
// thins `person` to {id, fullName, link} and drops batSide, so this is
// the canonical source for server-side handedness.
function buildHandednessIndex(gameFeed) {
  const index = new Map();
  const players = gameFeed?.gameData?.players;
  if (!players || typeof players !== "object") return index;
  for (const record of Object.values(players)) {
    const id = Number(record?.id);
    const code = record?.batSide?.code;
    if (Number.isFinite(id) && typeof code === "string" && code.length > 0) {
      index.set(id, code);
    }
  }
  return index;
}

function buildPitchHandIndex(gameFeed) {
  const index = new Map();
  const players = gameFeed?.gameData?.players;
  if (!players || typeof players !== "object") return index;
  for (const record of Object.values(players)) {
    const id = Number(record?.id);
    const code = record?.pitchHand?.code;
    if (Number.isFinite(id) && typeof code === "string" && code.length > 0) {
      index.set(id, code);
    }
  }
  return index;
}

function extractBattingOrder(teamBox, handednessByPlayerId = null) {
  if (!teamBox?.players) {
    return [];
  }

  const entries = Object.values(teamBox.players)
    .filter((player) => typeof player?.battingOrder === "string" && player.battingOrder.endsWith("00"))
    .map((player) => {
      // Priority for bats: feed/live gameData (canonical, has batSide) >
      // any fallback the boxscore happened to carry > "R" last resort.
      // Pre-fix: boxscore's thin `person` never had batSide, so every
      // batter defaulted to "R".
      const playerId = player.person?.id ?? player.personId;
      const feedBatSide = handednessByPlayerId && playerId != null
        ? handednessByPlayerId.get(Number(playerId))
        : undefined;
      return {
        slot: Number(player.battingOrder) / 100,
        name: player.person?.fullName ?? "TBD",
        position: player.position?.abbreviation ?? "",
        bats: feedBatSide ?? player.person?.batSide?.code ?? player.batSide?.code ?? "R",
      };
    })
    .filter((entry) => entry.slot >= 1 && entry.slot <= 9)
    .sort((left, right) => left.slot - right.slot);

  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    if (seen.has(entry.slot)) {
      continue;
    }
    seen.add(entry.slot);
    deduped.push(entry);
  }

  return deduped.length === 9 ? deduped : [];
}

function buildOffDayPayload(fixture, nextGames, overrides) {
  const data = cloneJson(fixture);
  const nextGame = nextGames[0] ?? null;

  data.meta.schema_version = fixture.meta.schema_version ?? SCHEMA_VERSION;
  data.meta.date = TODAY;
  data.meta.generated_at = new Date().toISOString();
  data.meta.off_day = true;
  data.meta.show_sections = false;
  data.meta.status = {
    ...fixture.meta.status,
    mode: "off_day",
    mode_label: "Off Day",
    crawl_state: "ok",
    enrich_state: "skipped",
    enrich_label: "No game today. Archive and next-game mode published.",
    generated_at_et: formatGeneratedAtEt(data.meta.generated_at),
    source_notes: buildSourceNotes(null, fixture, overrides),
  };

  if (nextGame) {
    data.next_game = {
      ...data.next_game,
      label: "Next Game",
      matchup: `${nextGame.homePitcher} vs ${nextGame.awayPitcher} · ${nextGame.matchup}`,
      date: nextGame.dateLabel,
      time: nextGame.timeLabel,
      broadcast: nextGame.broadcast ?? fixture.next_game.broadcast,
      venue: nextGame.venue,
    };
  }

  data.hero = {
    mode: "off_day",
    label: "Off Day",
    headline: "No Phillies game today",
    dek: nextGame ? `Next up: ${data.next_game.matchup}` : "Next matchup pending",
    summary: "Use the archive to catch up or check the next scheduled game window.",
    cards: [
      { label: "Next Game", value: data.next_game.date },
      { label: "First Pitch", value: data.next_game.time },
      { label: "Watch", value: data.next_game.broadcast },
    ],
    bullets: [
      nextGame ? data.next_game.matchup : "Schedule update pending",
      nextGame ? data.next_game.venue : "Venue update pending",
      "Archive mode is active until the next issue is generated.",
    ],
    next_label: data.next_game.label,
    next_value: `${data.next_game.matchup} · ${data.next_game.date} · ${data.next_game.time}`,
  };

  data.sections.preview.content.up_next = buildUpNext(nextGames, fixture.sections.preview.content.up_next);
  applyOverrides(data, overrides);
  return data;
}

function buildHero(data, game) {
  const mode = data.meta.status.mode;
  const linescore = game.linescore ?? {};
  const philliesAreHome = game.teams.home.team.id === TEAM_ID;
  const philliesSide = philliesAreHome ? game.teams.home : game.teams.away;
  const opponentSide = philliesAreHome ? game.teams.away : game.teams.home;

  if (mode === "final") {
    const decisions = data.sections.recap.content.decisions ?? {};
    const winnerName = decisions.winner?.fullName ?? "TBD";
    const saveName = decisions.save?.fullName;
    const winCard = saveName
      ? { label: "WP / SV", value: `${winnerName} / ${saveName}` }
      : { label: "Winning Pitcher", value: winnerName };

    return {
      mode,
      label: "Final",
      headline: data.sections.recap.content.result.summary_line,
      dek: data.sections.recap.preview,
      summary: data.sections.recap.content.pull_quote,
      cards: [
        winCard,
        { label: "Venue", value: data.sections.game_status.content.venue },
        { label: "Series", value: data.sections.game_status.content.series.label },
      ],
      bullets: data.sections.recap.content.key_performers.slice(0, 3).map((performer) => `${performer.name}: ${performer.line}`),
      next_label: data.next_game.label,
      next_value: `${data.next_game.matchup} · ${data.next_game.date} · ${data.next_game.time}`,
    };
  }

  if (mode === "live") {
    const inning = linescore.currentInningOrdinal ? `${linescore.inningState} ${linescore.currentInningOrdinal}` : game.status?.detailedState;
    const outs = typeof linescore.outs === "number" ? `${linescore.outs} out${linescore.outs === 1 ? "" : "s"}` : "In progress";
    const batter = linescore.offense?.batter?.fullName ?? "Current batter pending";
    const defaultPitcher = linescore.isTopInning
      ? data.sections.game_status.content.starters.home.name
      : data.sections.game_status.content.starters.away.name;
    const pitcher = linescore.defense?.pitcher?.fullName ?? defaultPitcher;
    const seriesContext = buildSeriesContext(data.sections.game_status.content.series.label);

    return {
      mode,
      label: "Live",
      headline: `${philliesSide.team.abbreviation} ${philliesSide.score ?? 0}, ${opponentSide.team.abbreviation} ${opponentSide.score ?? 0}`,
      dek: `${inning} · ${outs}`,
      summary: `${batter} is up against ${pitcher}.${seriesContext ? ` ${seriesContext}` : ""}`,
      cards: [
        { label: "Venue", value: data.sections.game_status.content.venue },
        { label: "Broadcast", value: buildBroadcastLine(data.sections.game_status.content.broadcast) },
        { label: "Weather", value: `${data.sections.game_status.content.weather.temp_f}° · ${data.sections.game_status.content.weather.condition}` },
      ],
      bullets: [
        `${batter} at the plate`,
        `${pitcher} on the mound`,
        `${data.sections.game_status.content.venue}`,
      ],
      next_label: data.next_game.label,
      next_value: `${data.next_game.matchup} · ${data.next_game.date} · ${data.next_game.time}`,
    };
  }

  const starters = data.sections.game_status.content.starters;
  const dhBullet = buildDoubleheaderBullet(game);
  return {
    mode: "pregame",
    label: "Pregame",
    headline: data.sections.game_status.content.matchup,
    dek: `${starters.phi.name} vs ${starters.opp.name}`,
    summary: data.sections.preview.preview,
    cards: [
      { label: "First Pitch", value: data.sections.game_status.content.first_pitch },
      { label: "Venue", value: data.sections.game_status.content.venue },
      { label: "Watch", value: buildBroadcastLine(data.sections.game_status.content.broadcast) },
    ],
    bullets: [
      `${data.sections.game_status.content.weather.temp_f}° · ${data.sections.game_status.content.weather.condition} · ${data.sections.game_status.content.weather.wind}`,
      data.sections.game_status.content.series.label,
      dhBullet,
    ].filter((line) => typeof line === "string" && line.trim().length > 0),
    next_label: data.next_game.label,
    next_value: `${data.next_game.matchup} · ${data.next_game.date} · ${data.next_game.time}`,
  };
}

function buildGameStatusPreview(mode) {
  if (mode === "live") {
    return "Live tracker, starters, and park notes";
  }
  if (mode === "final") {
    return "Final line, starters, and park notes";
  }
  return "Starters, live tracker, and park notes";
}

function buildTicker(data, transactionResponse, weather) {
  const items = [
    { text: `PHI ${data.record.wins}-${data.record.losses}`, highlight: true },
    {
      text: `${data.sections.game_status.content.matchup} · ${data.sections.game_status.content.first_pitch}`,
      highlight: false,
    },
    {
      text: `${data.sections.game_status.content.starters.phi.name} vs ${data.sections.game_status.content.starters.opp.name}`,
      highlight: true,
    },
    {
      text: `${data.sections.game_status.content.broadcast.tv} · ${data.sections.game_status.content.broadcast.radio}`,
      highlight: false,
    },
    {
      text: `${Math.round(weather.temperature_2m ?? data.sections.game_status.content.weather.temp_f)}° · ${data.sections.game_status.content.weather.condition} · gusts ${Math.round(weather.wind_gusts_10m ?? data.sections.game_status.content.weather.gusts_mph)} mph`,
      highlight: false,
    },
  ];

  for (const transaction of transactionResponse?.transactions ?? []) {
    items.push({
      text: transaction.description.replace(/^Philadelphia Phillies\s+/i, ""),
      highlight: /rehab|assigned/i.test(transaction.description),
    });
  }

  for (const item of loadDailyProphet()) {
    items.push(item);
  }

  return items.slice(0, 9);
}

function buildSourceNotes(transactionResponse, fixture, overrides) {
  const notes = [];

  for (const note of fixture?.meta?.status?.source_notes ?? []) {
    notes.push(note);
  }

  if (transactionResponse?.transactions?.some((transaction) => /rehab assignment/i.test(transaction.description))) {
    notes.push("Rehab assignment notes are refreshed from the MLB transactions feed.");
  }

  if (overrides) {
    notes.push(`Editorial overrides applied from overrides/${TODAY}.json.`);
  }

  if (existsSync("./daily-prophet.json")) {
    notes.push("Daily Prophet notes injected into ticker.");
  }

  return dedupeStrings(notes);
}

async function buildRotation(nextGames, fallback) {
  if (!nextGames.length) {
    return (fallback ?? []).map((entry) => ({ ...entry, source: "fallback" }));
  }

  const pitcherIds = nextGames
    .slice(0, 5)
    .map((game) => game.homePitcherId)
    .filter(Boolean);

  const statsMap = await fetchPitcherStats(pitcherIds);

  return nextGames.slice(0, 5).map((game, index) => {
    const stats = statsMap.get(game.homePitcherId) ?? {};
    const hasLiveProbable = Boolean(game.homePitcherId) && game.homePitcher && game.homePitcher !== "TBD";
    return {
      date: game.shortDate,
      pitcher: game.homePitcher,
      opponent: game.opponentAbbr,
      hand: fallback[index]?.hand ?? "R",
      era: stats.era ?? "",
      record: stats.wins != null ? `${stats.wins}-${stats.losses}` : "",
      source: hasLiveProbable ? "live" : "fallback",
    };
  });
}

function buildStandingsPreview(teams) {
  const phi = teams.find((t) => t.is_phi);
  if (!phi) {
    return "NL East standings unavailable";
  }

  return `PHI ${phi.wins}-${phi.losses} · ${phi.gb === "\u2014" ? "1st" : `${phi.gb} GB`} · ${phi.streak}`;
}

function applyStandingRecord(record = {}, standings = []) {
  const phi = standings.find((team) => team.is_phi);
  if (!phi) {
    return record;
  }

  return {
    ...record,
    wins: phi.wins ?? record.wins,
    losses: phi.losses ?? record.losses,
    streak: phi.streak ?? record.streak,
    division_rank: phi.division_rank ?? record.division_rank,
    games_back: phi.gb ?? record.games_back,
  };
}

function buildUpNext(nextGames, fallback) {
  if (nextGames.length < 2) {
    return fallback;
  }

  return nextGames.slice(1, 4).map((game) => ({
    date: game.dateLabel,
    matchup: `${game.homePitcher} vs ${game.awayPitcher}`,
    time: game.timeLabel,
    broadcast: game.broadcast ?? "TBD",
  }));
}

function buildRosterHighlights(rosterResponse, transactionResponse, fallback) {
  const rosterNames = new Set((rosterResponse?.roster ?? []).map((entry) => entry.person.fullName));
  const highlights = fallback.filter((entry) => rosterNames.has(entry.name));
  const transactions = transactionResponse?.transactions ?? [];

  for (const transaction of transactions) {
    if (/minor league contract/i.test(transaction.description)) {
      highlights.push({
        name: transaction.person.fullName,
        position: inferPositionFromDescription(transaction.description),
        status: "milb",
        note: shortTransactionNote(transaction.description),
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const item of highlights) {
    if (seen.has(item.name)) {
      continue;
    }
    seen.add(item.name);
    deduped.push(item);
  }

  return deduped.slice(0, 5);
}

function mergeInjuryEntries(fallbackEntries, injuryResponse, transactionResponse, generatedAtIso = null, fallbackGeneratedAtIso = null) {
  const transactions = transactionResponse?.transactions ?? [];
  const transactionState = buildTransactionInjuryState(transactions);
  const transactionDescriptions = new Map(
    transactions.map((transaction) => [transaction.person?.fullName, transaction.description]),
  );

  const liveInjuries = normalizeLiveInjuries(injuryResponse);
  const byName = new Map();

  if (transactionState.hasData) {
    for (const injury of transactionState.activeInjuries.values()) {
      const fallback = fallbackEntries.find((entry) => entry.name === injury.name) ?? {};
      byName.set(injury.name, {
        ...fallback,
        ...injury,
        injury: injury.injury || fallback.injury || "",
        source: "live",
        last_confirmed: generatedAtIso ?? fallback.last_confirmed ?? fallbackGeneratedAtIso ?? null,
      });
    }
  } else {
    // Seed with fixture baseline so we retain editorial-quality context notes
    // for known long-term IL entries.
    for (const entry of fallbackEntries) {
      byName.set(entry.name, {
        ...entry,
        source: entry.source ?? "fallback",
        last_confirmed: entry.last_confirmed ?? fallbackGeneratedAtIso ?? null,
      });
    }
  }

  // Overlay live MLB data. New entries are appended; known entries get
  // fresher injury + status text pulled from the feed.
  for (const injury of liveInjuries) {
    const existing = byName.get(injury.name);
    if (existing) {
      byName.set(injury.name, {
        ...existing,
        injury: injury.injury ?? existing.injury,
        status_note: injury.status_note ?? existing.status_note,
        il_type: injury.il_type ?? existing.il_type,
        badge: injury.badge ?? existing.badge,
        position: injury.position ?? existing.position,
        retroactive_to: injury.retroactive_to ?? existing.retroactive_to,
        first_eligible: injury.first_eligible ?? existing.first_eligible,
        source: "live",
        last_confirmed: generatedAtIso ?? existing.last_confirmed ?? fallbackGeneratedAtIso ?? null,
      });
      continue;
    }

    byName.set(injury.name, {
      ...injury,
      source: "live",
      last_confirmed: generatedAtIso ?? fallbackGeneratedAtIso ?? null,
    });
  }

  // Overlay rehab assignment notes from the transactions feed, which update
  // faster than the injuries feed for in-progress rehab outings.
  for (const [name, description] of transactionDescriptions.entries()) {
    if (!name || !description) {
      continue;
    }
    if (!/rehab assignment/i.test(description)) {
      continue;
    }
    const existing = byName.get(name);
    if (existing) {
      byName.set(name, {
        ...existing,
        status_note: shortTransactionNote(description),
        badge: existing.badge ?? "rehab",
        source: "live",
        last_confirmed: generatedAtIso ?? existing.last_confirmed ?? fallbackGeneratedAtIso ?? null,
      });
    }
  }

  return Array.from(byName.values()).map((entry) => annotateFreshness(entry, fallbackGeneratedAtIso));
}

function hasTransactionInjuryData(transactionResponse) {
  return (transactionResponse?.transactions ?? []).some((transaction) =>
    /injured list|disabled list|10-day|15-day|60-day|activated/i.test(transaction.description ?? ""),
  );
}

function buildTransactionInjuryState(transactions = []) {
  const activeInjuries = new Map();
  let hasData = false;

  const sorted = [...transactions].sort((left, right) =>
    String(left.effectiveDate ?? left.date ?? "").localeCompare(String(right.effectiveDate ?? right.date ?? "")),
  );

  for (const transaction of sorted) {
    const description = transaction.description ?? "";
    const name = transaction.person?.fullName;
    if (!name || !description) {
      continue;
    }

    if (/activated .* from the .*injured list/i.test(description)) {
      hasData = true;
      activeInjuries.delete(name);
      continue;
    }

    if (/placed .* on the .*injured list/i.test(description) || /transferred .* injured list .* injured list/i.test(description)) {
      hasData = true;
      activeInjuries.set(name, buildInjuryEntryFromTransaction(transaction));
    }
  }

  return { hasData, activeInjuries };
}

function buildInjuryEntryFromTransaction(transaction) {
  const description = transaction.description ?? "";
  const ilType = extractIlType(description);
  return {
    name: transaction.person?.fullName,
    position: extractPositionFromDescription(description),
    il_type: ilType,
    badge: "il",
    injury: extractInjuryDescription(description),
    status_note: shortTransactionNote(description),
    retroactive_to: extractRetroactiveDate(description, transaction.effectiveDate ?? transaction.date),
    first_eligible: null,
  };
}

function extractIlType(description) {
  const matches = [...String(description).matchAll(/(\d+)[- ]?day injured list/gi)];
  const value = matches[matches.length - 1]?.[1];
  return value ? `${value}-Day` : "IL";
}

function extractPositionFromDescription(description) {
  const match = String(description).match(/Philadelphia Phillies\s+(?:placed|transferred)\s+([A-Z0-9]{1,3})\s+/i);
  return match?.[1]?.toUpperCase() ?? inferPositionFromDescription(description);
}

function extractInjuryDescription(description) {
  const sentences = String(description)
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  return sentences[sentences.length - 1] ?? "";
}

function extractRetroactiveDate(description, fallbackDate) {
  const match = String(description).match(/retroactive to ([A-Za-z]+ \d{1,2}, \d{4})/i);
  if (!match) {
    return fallbackDate ?? null;
  }
  const parsed = Date.parse(`${match[1]} 12:00:00 GMT`);
  if (Number.isNaN(parsed)) {
    return fallbackDate ?? null;
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function buildInjuryFooterNote(entries, transactionFeedAvailable) {
  if (!transactionFeedAvailable) {
    return "Injury status is using the fixture baseline because transaction data was unavailable.";
  }
  if (!entries.length) {
    return "No active Phillies injured list entries found in the MLB transactions feed.";
  }
  return "Injury status is rebuilt from the MLB transactions feed when the injuries endpoint is unavailable.";
}

function normalizeLiveInjuries(injuryResponse) {
  const entries = injuryResponse?.injuries ?? injuryResponse?.roster ?? [];
  return entries
    .map((entry) => {
      const name = entry?.person?.fullName ?? entry?.playerName ?? entry?.name;
      if (!name) {
        return null;
      }

      const ilType = entry?.status?.description?.match(/\d+[- ]?day/i)?.[0]
        ?? entry?.injuryListType
        ?? entry?.ilType
        ?? entry?.status?.code
        ?? "15-Day";

      return {
        name,
        position: entry?.position?.abbreviation ?? entry?.positionAbbreviation ?? "",
        il_type: ilType.replace(/\s+/g, "-"),
        badge: /day/i.test(String(ilType)) ? "il" : "dtd",
        injury: entry?.injuryDescription ?? entry?.comment ?? entry?.note ?? "",
        status_note: entry?.statusNote ?? entry?.description ?? "",
        retroactive_to: entry?.retroActiveDate ?? entry?.retroactiveDate ?? null,
        first_eligible: entry?.dateEligibleToReturn ?? entry?.firstEligibleDate ?? null,
      };
    })
    .filter(Boolean);
}

function collectUpcomingGames(scheduleResponse, teamId) {
  const games = [];

  for (const date of scheduleResponse?.dates ?? []) {
    for (const game of date.games ?? []) {
      const homeTeam = game.teams.home.team;
      const awayTeam = game.teams.away.team;
      const philliesAreHome = homeTeam.id === teamId;
      const philliesSide = philliesAreHome ? game.teams.home : game.teams.away;
      const opponentSide = philliesAreHome ? game.teams.away : game.teams.home;

      games.push({
        gameDate: game.gameDate,
        dateLabel: formatShortDate(game.gameDate),
        shortDate: formatMonthDay(game.gameDate),
        timeLabel: formatGameTime(game.gameDate),
        matchup: `${homeTeam.abbreviation} vs ${awayTeam.abbreviation}`,
        opponentAbbr: opponentSide.team.abbreviation,
        homePitcher: philliesSide.probablePitcher?.fullName ?? "TBD",
        homePitcherId: philliesSide.probablePitcher?.id ?? null,
        awayPitcher: opponentSide.probablePitcher?.fullName ?? "TBD",
        broadcast: extractBroadcast(game, "TV"),
        venue: game.venue?.name ?? "TBD",
      });
    }
  }

  return games.sort((left, right) => left.gameDate.localeCompare(right.gameDate));
}

function extractKeyPerformers(boxscore, fallback) {
  const players = Object.values(boxscore?.teams?.home?.players ?? {})
    .concat(Object.values(boxscore?.teams?.away?.players ?? {}));

  const performers = players
    .map((player) => buildPerformerLine(player))
    .filter(Boolean);

  // Prefer the best two hitters and two pitchers so the recap card
  // shows a balanced view instead of five batters or five arms.
  const hitters = performers
    .filter((performer) => performer.role === "hitter")
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  const pitchers = performers
    .filter((performer) => performer.role === "pitcher")
    .sort((left, right) => right.score - left.score)
    .slice(0, 2);

  const chosen = pitchers.concat(hitters).slice(0, 5);
  if (!chosen.length) {
    return fallback;
  }

  return chosen.map(({ score: _score, role: _role, ...performer }) => performer);
}

function buildPerformerLine(player) {
  if (!player?.person?.fullName) {
    return null;
  }

  const batting = player.stats?.batting ?? {};
  const pitching = player.stats?.pitching ?? {};
  const position = player.position?.abbreviation ?? "";
  const isPitcher = Boolean(pitching.inningsPitched) || position === "P";

  if (isPitcher) {
    if (!pitching.inningsPitched) {
      return null;
    }
    const parts = [`${pitching.inningsPitched} IP`];
    if (pitching.hits != null) parts.push(`${pitching.hits} H`);
    if (pitching.earnedRuns != null) parts.push(`${pitching.earnedRuns} ER`);
    if (pitching.strikeOuts != null) parts.push(`${pitching.strikeOuts} K`);
    return {
      role: "pitcher",
      score: (Number(pitching.strikeOuts) || 0) + (Number(pitching.inningsPitched) || 0) * 2 - (Number(pitching.earnedRuns) || 0),
      name: player.person.fullName,
      position: position || "P",
      line: parts.join(", "),
      note: player.seasonStats?.pitching?.era ? `ERA ${player.seasonStats.pitching.era}` : "Live boxscore performer",
    };
  }

  if (!batting.atBats && !batting.homeRuns && !batting.rbi) {
    return null;
  }

  const parts = [];
  if (batting.atBats) parts.push(`${batting.hits ?? 0}-for-${batting.atBats}`);
  if (batting.homeRuns) parts.push(`${batting.homeRuns} HR`);
  if (batting.rbi) parts.push(`${batting.rbi} RBI`);
  if (batting.runs) parts.push(`${batting.runs} R`);
  if (batting.stolenBases) parts.push(`${batting.stolenBases} SB`);

  return {
    role: "hitter",
    score: (Number(batting.hits) || 0) * 2 + (Number(batting.homeRuns) || 0) * 5 + (Number(batting.rbi) || 0),
    name: player.person.fullName,
    position: position || "DH",
    line: parts.join(", "),
    note: player.seasonStats?.batting?.avg ? `AVG ${player.seasonStats.batting.avg}` : "Live boxscore performer",
  };
}

function buildRecapPreview(game, boxscore, fallback) {
  if (!isFinalGame(game)) {
    return fallback;
  }

  const winner = game.teams.home.score > game.teams.away.score ? game.teams.home.team.abbreviation : game.teams.away.team.abbreviation;
  const loser = winner === game.teams.home.team.abbreviation ? game.teams.away.team.abbreviation : game.teams.home.team.abbreviation;
  const winningScore = Math.max(game.teams.home.score, game.teams.away.score);
  const losingScore = Math.min(game.teams.home.score, game.teams.away.score);
  const firstPerformer = extractKeyPerformers(boxscore, [])[0];
  return firstPerformer
    ? `${winner} ${winningScore}, ${loser} ${losingScore} · ${firstPerformer.name} · ${firstPerformer.line}`
    : `${winner} ${winningScore}, ${loser} ${losingScore}`;
}

function buildRecapSummaryLine(game, teamId) {
  const philliesAreHome = game.teams.home.team.id === teamId;
  const philliesSide = philliesAreHome ? game.teams.home : game.teams.away;
  const opponentSide = philliesAreHome ? game.teams.away : game.teams.home;
  return `${philliesSide.team.abbreviation} ${philliesSide.score}, ${opponentSide.team.abbreviation} ${opponentSide.score}.`;
}

function validateCrawlPayload(data) {
  const requiredSections = [
    "game_status",
    "lineup",
    "recap",
    "roster",
    "injury_report",
    "farm_system",
    "preview",
  ];

  if (!data.meta || !data.record || !data.ticker || !data.sections || !data.hero) {
    throw new Error("Missing one of the required top-level keys: meta, record, hero, ticker, sections.");
  }

  if (!data.meta.status || !Array.isArray(data.meta.status.source_notes)) {
    throw new Error("Missing meta.status or source notes.");
  }

  if (!Array.isArray(data.hero.cards) || !Array.isArray(data.hero.bullets)) {
    throw new Error("Hero cards and bullets must be arrays.");
  }

  if (!data.hero.headline || !data.hero.label) {
    throw new Error("Hero headline and label are required.");
  }

  for (const sectionKey of requiredSections) {
    if (!data.sections[sectionKey]) {
      throw new Error(`Missing section: ${sectionKey}`);
    }
  }

  if (!data.meta.off_day && (!data.sections.game_status.content.starters.home.name || !data.sections.game_status.content.starters.away.name)) {
    throw new Error("Both starters must be non-null.");
  }

  if (!data.meta.off_day) {
    const lineupContent = data.sections.lineup?.content;
    if (!lineupContent?.starters?.home?.name || !lineupContent?.starters?.away?.name) {
      throw new Error("Lineup starters must be non-null.");
    }

    const homeOrder = lineupContent.batting_order?.home;
    const awayOrder = lineupContent.batting_order?.away;
    if (!Array.isArray(homeOrder) || homeOrder.length !== 9 || !Array.isArray(awayOrder) || awayOrder.length !== 9) {
      throw new Error("Lineup batting_order must contain nine entries for each side.");
    }
  }

  if (!Array.isArray(data.sections.injury_report.content.il_entries)) {
    throw new Error("sections.injury_report.content.il_entries must be an array.");
  }

  // Recompute today at validation time to avoid races when the crawl
  // spans midnight ET during a game-window cron run.
  const currentIsoDate = getIsoDate();
  if (data.meta.date !== TODAY && data.meta.date !== currentIsoDate) {
    throw new Error(`meta.date ${data.meta.date} does not match today's date ${currentIsoDate}.`);
  }
}

function inferPositionFromDescription(description) {
  const match = description.match(/\b(C|IF|INF|OF|SS|2B|3B|LF|CF|RF|LHP|RHP|P)\b/i);
  return match?.[1]?.toUpperCase() ?? "OF";
}

function shortTransactionNote(description) {
  return description
    .replace(/^Philadelphia Phillies\s+/i, "")
    .replace(/\s+to a minor league contract\.?$/i, "")
    .replace(/\.$/, "");
}

function extractBroadcast(game, mediaType) {
  const epg = game?.broadcasts ?? game?.content?.media?.epg ?? [];
  const candidates = [];

  for (const item of epg) {
    const itemType = normalizeBroadcastType(item.mediaType ?? item.type);
    const itemTitle = item.title ?? item.name;
    if (itemType === mediaType && itemTitle) {
      candidates.push({ title: itemTitle, homeAway: item.homeAway ?? null });
    }
    for (const content of item.items ?? []) {
      const contentType = normalizeBroadcastType(content.mediaType ?? content.type);
      const contentTitle = content.title ?? content.name;
      if (contentType === mediaType && contentTitle) {
        candidates.push({ title: contentTitle, homeAway: content.homeAway ?? item.homeAway ?? null });
      }
    }
  }

  return candidates.find((candidate) => candidate.homeAway === "home")?.title
    ?? candidates[0]?.title
    ?? null;
}

function normalizeBroadcastType(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "TV") return "TV";
  if (normalized === "RADIO" || normalized === "AM" || normalized === "FM") return "RADIO";
  return normalized;
}

function annotateFreshness(entry, fallbackGeneratedAtIso = null) {
  const source = entry.source === "live" ? "live" : "fallback";
  const lastConfirmed = entry.last_confirmed ?? fallbackGeneratedAtIso ?? null;
  const prefix = source === "live" ? "As of" : "Last confirmed";
  return {
    ...entry,
    source,
    last_confirmed: lastConfirmed,
    freshness_label: buildFreshnessLabel(prefix, lastConfirmed),
  };
}

function writePayload(data) {
  writeFileSync(OUTPUT_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function loadDailyProphet() {
  const path = "./daily-prophet.json";
  if (!existsSync(path)) {
    return [];
  }

  try {
    const items = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .filter((item) => item && typeof item.text === "string")
      .map((item) => ({ text: item.text, highlight: item.highlight ?? false }));
  } catch {
    return [];
  }
}

// Overrides are editorial copy, so the per-string cap needs to fit a
// short paragraph. 2000 characters covers the longest legitimate
// narrative block we've shipped and still clamps runaway payloads.
const OVERRIDE_MAX_FIELD_LENGTH = 2000;

const OVERRIDE_MAX_FILE_BYTES = 50_000;

function loadOverrides(date) {
  const path = `./overrides/${date}.json`;
  if (!existsSync(path)) {
    return null;
  }

  // Check file size BEFORE reading. A 50 MB crafted override would
  // exhaust heap during readFileSync before the existing post-read
  // length check could fire. statSync is O(1) and doesn't touch data.
  const { size } = statSync(path);
  if (size > OVERRIDE_MAX_FILE_BYTES) {
    throw new Error(`Override file ${path} is suspiciously large (${size} bytes). Aborting.`);
  }

  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  return clampOverride(parsed);
}

function clampOverride(value) {
  if (typeof value === "string") {
    return value.length > OVERRIDE_MAX_FIELD_LENGTH
      ? `${value.slice(0, OVERRIDE_MAX_FIELD_LENGTH - 1)}\u2026`
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => clampOverride(item));
  }
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = clampOverride(item);
    }
    return output;
  }
  return value;
}

function stripHeroOverride(overrides) {
  if (!overrides) {
    return null;
  }

  const clone = cloneJson(overrides);
  delete clone.hero;
  return clone;
}

function applyOverrides(target, overrides) {
  if (!overrides) {
    return target;
  }

  return deepMerge(target, overrides);
}

const DELETE_SENTINEL = "__delete__";

function deepMerge(target, source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return source == null ? target : source;
  }

  const output = target && typeof target === "object" && !Array.isArray(target) ? target : {};
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];

    // Sentinel string "__delete__" removes the key entirely from the
    // merged output — use for retracting fixture fields via overrides.
    if (sourceValue === DELETE_SENTINEL) {
      delete output[key];
      continue;
    }

    if (Array.isArray(sourceValue)) {
      output[key] = cloneJson(sourceValue);
      continue;
    }

    if (sourceValue && typeof sourceValue === "object") {
      output[key] = deepMerge(output[key], sourceValue);
      continue;
    }

    output[key] = sourceValue;
  }

  return output;
}

function fail(error) {
  // Append rather than overwrite so a second failure keeps the first's
  // evidence available to the diagnostics artifact.
  const message = `[${new Date().toISOString()}] ${error.stack ?? error.message}\n`;
  appendFileSync(ERROR_LOG, message, "utf8");
  console.error(error.message);
  process.exit(1);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function dedupeStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
