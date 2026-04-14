import { existsSync, readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import { buildPregamePreviewContent, buildRecapPullQuote } from "./pregame-preview.js";

const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";
const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=39.906&longitude=-75.166&current=temperature_2m,wind_speed_10m,wind_gusts_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph";
const TEAM_ID = 143;
const TODAY = getIsoDate();
const YESTERDAY = getRelativeIsoDate(-1);
const OUTPUT_FILE = "./phillies-wire-data.json";
const ERROR_LOG = "./crawl-error.log";

main().catch((error) => fail(error));

async function main() {
  const fixture = JSON.parse(readFileSync("./phillies-wire-schema.json", "utf8"));
  const overrides = loadOverrides(TODAY);
  const [scheduleResponse, nextScheduleResponse, rosterResponse, transactionResponse, weatherResponse] =
    await Promise.all([
      fetchJson(`${MLB_API_BASE}/schedule?sportId=1&teamId=${TEAM_ID}&date=${TODAY}&hydrate=linescore,probablePitcher,seriesStatus,team,game(content(summary,media(epg)))`),
      fetchJson(
        `${MLB_API_BASE}/schedule?sportId=1&teamId=${TEAM_ID}&startDate=${TODAY}&endDate=${getRelativeIsoDate(4)}&hydrate=linescore,probablePitcher,seriesStatus,team`,
      ),
      fetchJson(`${MLB_API_BASE}/teams/${TEAM_ID}/roster?rosterType=active`),
      fetchJson(`${MLB_API_BASE}/transactions?teamId=${TEAM_ID}&startDate=${YESTERDAY}&endDate=${TODAY}`),
      fetchJson(WEATHER_URL),
    ]);

  const nextGames = collectUpcomingGames(nextScheduleResponse, TEAM_ID);
  const game = scheduleResponse?.dates?.[0]?.games?.[0];

  if (!game) {
    const offDay = buildOffDayPayload(fixture, nextGames, overrides);
    validateCrawlPayload(offDay);
    writePayload(offDay);
    console.log(`No game scheduled for ${TODAY}. Off-day payload written.`);
    return;
  }

  const boxscore = await fetchJson(`${MLB_API_BASE}/game/${game.gamePk}/boxscore`).catch(() => null);

  const data = await buildLivePayload({
    fixture,
    overrides,
    game,
    boxscore,
    nextGames,
    rosterResponse,
    transactionResponse,
    weatherResponse,
  });

  validateCrawlPayload(data);
  writePayload(data);
  console.log("phillies-wire-data.json written");
}

async function buildLivePayload(context) {
  const {
    fixture,
    overrides,
    game,
    boxscore,
    nextGames,
    rosterResponse,
    transactionResponse,
    weatherResponse,
  } = context;

  const data = cloneJson(fixture);
  const homeTeam = game.teams.home.team;
  const awayTeam = game.teams.away.team;
  const philliesAreHome = homeTeam.id === TEAM_ID;
  const philliesSide = philliesAreHome ? game.teams.home : game.teams.away;
  const opponentSide = philliesAreHome ? game.teams.away : game.teams.home;
  const weather = weatherResponse?.current ?? {};

  data.meta.schema_version = fixture.meta.schema_version ?? "1.2.0";
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
    enrich_label: "Awaiting editorial pass",
    generated_at_et: formatGeneratedAtEt(data.meta.generated_at),
    source_notes: buildSourceNotes(transactionResponse, fixture, overrides),
  };

  data.sections.game_status.preview = `${homeTeam.abbreviation} vs ${awayTeam.abbreviation} · ${formatGameTime(game.gameDate)} · ${game.venue.name}`;
  data.sections.game_status.content = {
    ...data.sections.game_status.content,
    matchup: `${homeTeam.teamName} vs ${awayTeam.teamName} - Game ${game.seriesGameNumber ?? 1}`,
    first_pitch: formatGameTime(game.gameDate),
    venue: `${game.venue.name}, ${homeTeam.locationName}`,
    starters: {
      home: {
        name: philliesSide.probablePitcher?.fullName ?? fixture.sections.game_status.content.starters.home.name,
        hand: fixture.sections.game_status.content.starters.home.hand,
      },
      away: {
        name: opponentSide.probablePitcher?.fullName ?? fixture.sections.game_status.content.starters.away.name,
        hand: fixture.sections.game_status.content.starters.away.hand,
      },
    },
    series: {
      ...data.sections.game_status.content.series,
      home_wins: game.seriesStatus?.wins ?? fixture.sections.game_status.content.series.home_wins,
      away_wins: game.seriesStatus?.losses ?? fixture.sections.game_status.content.series.away_wins,
      label: game.seriesStatus?.result ?? fixture.sections.game_status.content.series.label,
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
  };

  data.sections.lineup = buildLineupSection({
    fixture,
    boxscore,
    philliesAreHome,
    homeTeam,
    awayTeam,
    starters: data.sections.game_status.content.starters,
    firstPitch: data.sections.game_status.content.first_pitch,
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
    data.sections.recap.preview = buildRecapPreview(game, boxscore, fixture.sections.recap.preview);
    data.sections.recap.title = `${formatWeekday(game.gameDate)} Recap`;
    data.sections.recap.content.result = {
      home_score: game.teams.home.score,
      away_score: game.teams.away.score,
      winner: game.teams.home.score > game.teams.away.score ? homeTeam.abbreviation : awayTeam.abbreviation,
      summary_line: buildRecapSummaryLine(game, TEAM_ID),
    };
    data.sections.recap.content.key_performers = extractKeyPerformers(boxscore, fixture.sections.recap.content.key_performers);
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

  data.meta.game_pk = game.gamePk;
  data.meta.first_pitch_iso = game.gameDate;

  data.sections.roster.content.rotation = rotation;
  data.sections.roster.content.highlights = buildRosterHighlights(rosterResponse, transactionResponse, fixture.sections.roster.content.highlights);
  data.sections.injury_report.content.il_entries = mergeInjuryEntriesFromTransactions(
    fixture.sections.injury_report.content.il_entries,
    transactionResponse,
  );
  data.sections.standings = {
    title: "NL East Standings",
    preview: buildStandingsPreview(standings),
    content: { teams: standings },
  };
  data.sections.preview.content.up_next = buildUpNext(nextGames, fixture.sections.preview.content.up_next);

  if (nextGames.length > 1) {
    const nextGame = nextGames[1];
    data.next_game = {
      ...data.next_game,
      label: "Tomorrow",
      matchup: `${nextGame.homePitcher} vs ${nextGame.awayPitcher} · ${nextGame.matchup}`,
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
      matchup: `${nextGame.homePitcher} vs ${nextGame.awayPitcher} · ${nextGame.matchup}`,
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

function buildLineupSection(context) {
  const { fixture, boxscore, philliesAreHome, homeTeam, awayTeam, starters, firstPitch } = context;
  const fixtureLineup = fixture.sections.lineup;
  const homeAbbr = homeTeam.abbreviation;
  const awayAbbr = awayTeam.abbreviation;

  const homeBox = boxscore?.teams?.home ?? null;
  const awayBox = boxscore?.teams?.away ?? null;

  const homeOrder = extractBattingOrder(homeBox);
  const awayOrder = extractBattingOrder(awayBox);

  const announced = homeOrder.length === 9 && awayOrder.length === 9;

  const fallbackHomeOrder = philliesAreHome
    ? fixtureLineup.content.batting_order.home
    : fixtureLineup.content.batting_order.away;
  const fallbackAwayOrder = philliesAreHome
    ? fixtureLineup.content.batting_order.away
    : fixtureLineup.content.batting_order.home;

  const homeStarter = {
    team: homeAbbr,
    name: philliesAreHome ? starters.home.name : starters.away.name,
    hand: philliesAreHome ? starters.home.hand : starters.away.hand,
  };
  const awayStarter = {
    team: awayAbbr,
    name: philliesAreHome ? starters.away.name : starters.home.name,
    hand: philliesAreHome ? starters.away.hand : starters.home.hand,
  };

  const statusNote = announced
    ? `Official batting orders confirmed for today's ${homeAbbr} vs ${awayAbbr} game.`
    : "Official lineups typically post roughly two hours before first pitch. Holding baseline order until MLB confirms.";

  const preview = announced
    ? `${homeAbbr} order set · ${homeStarter.name} vs ${awayStarter.name}`
    : `Lineups pending · ${homeStarter.name} vs ${awayStarter.name}`;

  return {
    preview,
    content: {
      status_note: statusNote,
      announced,
      first_pitch: firstPitch,
      starters: {
        home: homeStarter,
        away: awayStarter,
      },
      batting_order: {
        home: homeOrder.length === 9 ? homeOrder : fallbackHomeOrder,
        away: awayOrder.length === 9 ? awayOrder : fallbackAwayOrder,
      },
    },
  };
}

function extractBattingOrder(teamBox) {
  if (!teamBox?.players) {
    return [];
  }

  const entries = Object.values(teamBox.players)
    .filter((player) => typeof player?.battingOrder === "string" && player.battingOrder.endsWith("00"))
    .map((player) => ({
      slot: Number(player.battingOrder) / 100,
      name: player.person?.fullName ?? "TBD",
      position: player.position?.abbreviation ?? "",
      bats: player.person?.batSide?.code ?? player.batSide?.code ?? "R",
    }))
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

  data.meta.schema_version = fixture.meta.schema_version ?? "1.2.0";
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
    return {
      mode,
      label: "Final",
      headline: data.sections.recap.content.result.summary_line,
      dek: data.sections.recap.preview,
      summary: data.sections.recap.content.pull_quote,
      cards: [
        { label: "Winning Pitcher", value: data.sections.recap.content.key_performers[0]?.name ?? "TBD" },
        { label: "Series", value: data.sections.game_status.content.series.label },
        { label: data.next_game.label, value: `${data.next_game.date} · ${data.next_game.time}` },
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
    const pitcher = linescore.defense?.pitcher?.fullName ?? data.sections.game_status.content.starters.home.name;
    const seriesContext = buildSeriesContext(data.sections.game_status.content.series.label);

    return {
      mode,
      label: "Live",
      headline: `${philliesSide.team.abbreviation} ${philliesSide.score ?? 0}, ${opponentSide.team.abbreviation} ${opponentSide.score ?? 0}`,
      dek: `${inning} · ${outs}`,
      summary: `${batter} is up against ${pitcher}.${seriesContext ? ` ${seriesContext}` : ""}`,
      cards: [
        { label: "Matchup", value: data.sections.game_status.content.matchup },
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

  return {
    mode: "pregame",
    label: "Pregame",
    headline: data.sections.game_status.content.matchup,
    dek: `${data.sections.game_status.content.starters.home.name} vs ${data.sections.game_status.content.starters.away.name}`,
    summary: data.sections.preview.preview,
    cards: [
      { label: "First Pitch", value: data.sections.game_status.content.first_pitch },
      { label: "Venue", value: data.sections.game_status.content.venue },
      { label: "Watch", value: buildBroadcastLine(data.sections.game_status.content.broadcast) },
    ],
    bullets: [
      `${data.sections.game_status.content.weather.temp_f}° · ${data.sections.game_status.content.weather.condition} · ${data.sections.game_status.content.weather.wind}`,
      data.sections.game_status.content.giveaway,
      data.sections.game_status.content.transit,
    ],
    next_label: data.next_game.label,
    next_value: `${data.next_game.matchup} · ${data.next_game.date} · ${data.next_game.time}`,
  };
}

function buildTicker(data, transactionResponse, weather) {
  const items = [
    { text: `PHI ${data.record.wins}-${data.record.losses}`, highlight: true },
    {
      text: `${data.sections.game_status.content.matchup} · ${data.sections.game_status.content.first_pitch}`,
      highlight: false,
    },
    {
      text: `${data.sections.game_status.content.starters.home.name} vs ${data.sections.game_status.content.starters.away.name}`,
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
    return fallback;
  }

  const pitcherIds = nextGames
    .slice(0, 5)
    .map((game) => game.homePitcherId)
    .filter(Boolean);

  const statsMap = await fetchPitcherStats(pitcherIds);

  return nextGames.slice(0, 5).map((game, index) => {
    const stats = statsMap.get(game.homePitcherId) ?? {};
    return {
      date: game.shortDate,
      pitcher: game.homePitcher,
      opponent: game.opponentAbbr,
      hand: fallback[index]?.hand ?? "R",
      era: stats.era ?? "",
      record: stats.wins != null ? `${stats.wins}-${stats.losses}` : "",
    };
  });
}

async function fetchPitcherStats(pitcherIds) {
  const statsMap = new Map();
  if (!pitcherIds.length) {
    return statsMap;
  }

  const results = await Promise.all(
    pitcherIds.map((id) =>
      fetchJson(`${MLB_API_BASE}/people/${id}/stats?stats=season&group=pitching&season=${new Date().getFullYear()}`)
        .catch(() => null),
    ),
  );

  for (let i = 0; i < pitcherIds.length; i++) {
    const splits = results[i]?.stats?.[0]?.splits?.[0]?.stat;
    if (splits) {
      statsMap.set(pitcherIds[i], {
        era: splits.era ?? "",
        wins: splits.wins ?? 0,
        losses: splits.losses ?? 0,
      });
    }
  }

  return statsMap;
}

async function fetchStandings() {
  const year = new Date().getFullYear();
  const response = await fetchJson(
    `${MLB_API_BASE}/standings?leagueId=104&season=${year}&standingsTypes=regularSeason`,
  ).catch(() => null);

  if (!response?.records) {
    return [];
  }

  for (const division of response.records) {
    if (division.division?.id === 204) {
      return division.teamRecords.map((team) => ({
        name: team.team.name,
        abbr: team.team.abbreviation ?? team.team.name.split(" ").pop(),
        wins: team.wins,
        losses: team.losses,
        pct: team.winningPercentage,
        gb: team.gamesBack === "-" ? "—" : team.gamesBack,
        streak: team.streak?.streakCode ?? "",
        is_phi: team.team.id === TEAM_ID,
      }));
    }
  }

  return [];
}

function buildStandingsPreview(teams) {
  const phi = teams.find((t) => t.is_phi);
  if (!phi) {
    return "NL East standings unavailable";
  }

  return `PHI ${phi.wins}-${phi.losses} · ${phi.gb === "\u2014" ? "1st" : `${phi.gb} GB`} · ${phi.streak}`;
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

function mergeInjuryEntriesFromTransactions(fallbackEntries, transactionResponse) {
  const descriptions = new Map(
    (transactionResponse?.transactions ?? []).map((transaction) => [transaction.person?.fullName, transaction.description]),
  );

  return fallbackEntries.map((entry) => {
    const description = descriptions.get(entry.name);
    if (!description) {
      return entry;
    }

    if (/rehab assignment/i.test(description)) {
      return {
        ...entry,
        status_note: shortTransactionNote(description),
      };
    }

    return entry;
  });
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
  const players = Object.values(boxscore?.teams?.home?.players ?? {}).concat(Object.values(boxscore?.teams?.away?.players ?? {}));
  const performers = players
    .filter((player) => player?.stats?.batting || player?.stats?.pitching)
    .map((player) => {
      const batting = player.stats.batting ?? {};
      const pitching = player.stats.pitching ?? {};
      const battingParts = [];
      const pitchingParts = [];

      if (batting.atBats) battingParts.push(`${batting.hits ?? 0}-for-${batting.atBats}`);
      if (batting.homeRuns) battingParts.push(`${batting.homeRuns} HR`);
      if (batting.rbi) battingParts.push(`${batting.rbi} RBI`);
      if (pitching.inningsPitched) pitchingParts.push(`${pitching.inningsPitched} IP`);
      if (pitching.hits) pitchingParts.push(`${pitching.hits} H`);
      if (pitching.runs) pitchingParts.push(`${pitching.runs} R`);
      if (pitching.strikeOuts) pitchingParts.push(`${pitching.strikeOuts} K`);

      return {
        name: player.person.fullName,
        position: player.position?.abbreviation ?? "P",
        line: battingParts.concat(pitchingParts).join(", "),
        note: player.seasonStats?.pitching?.era ? `ERA ${player.seasonStats.pitching.era}` : "Live boxscore performer",
      };
    })
    .filter((player) => player.line)
    .slice(0, 5);

  return performers.length ? performers : fallback;
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

  if (data.meta.date !== TODAY) {
    throw new Error(`meta.date ${data.meta.date} does not match today's date ${TODAY}.`);
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

function buildWindSummary(weather) {
  const speed = Math.round(weather.wind_speed_10m ?? 0);
  const gusts = Math.round(weather.wind_gusts_10m ?? 0);
  return gusts ? `${speed} mph · gusts ${gusts}` : `${speed} mph`;
}

function buildBroadcastLine(broadcast) {
  return [broadcast.tv, broadcast.stream, broadcast.radio].filter(Boolean).join(" · ");
}

function buildSeriesContext(seriesLabel) {
  if (!seriesLabel) {
    return "";
  }

  return `Series: ${seriesLabel}.`;
}

function deriveMode(game) {
  const state = game?.status?.abstractGameState;
  if (state === "Final") {
    return "final";
  }

  if (state === "Live") {
    return "live";
  }

  return "pregame";
}

function deriveModeLabel(game) {
  const mode = deriveMode(game);
  if (mode === "final") {
    return "Final";
  }

  if (mode === "live") {
    return "Live";
  }

  return "Pregame";
}

function weatherCodeToText(code) {
  const map = new Map([
    [0, "Clear"],
    [1, "Mostly sunny"],
    [2, "Partly cloudy"],
    [3, "Overcast"],
    [45, "Fog"],
    [48, "Freezing fog"],
    [51, "Light drizzle"],
    [53, "Drizzle"],
    [55, "Heavy drizzle"],
    [61, "Light rain"],
    [63, "Rain"],
    [65, "Heavy rain"],
    [71, "Light snow"],
    [73, "Snow"],
    [75, "Heavy snow"],
    [80, "Rain showers"],
    [81, "Heavy showers"],
    [95, "Thunderstorms"],
  ]);
  return map.get(code);
}

function extractBroadcast(game, mediaType) {
  const epg = game?.broadcasts ?? game?.content?.media?.epg ?? [];
  for (const item of epg) {
    for (const content of item.items ?? []) {
      if ((content.mediaType ?? "").toUpperCase() === mediaType && content.title) {
        return content.title;
      }
    }
  }

  return null;
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https
      .get(url, { timeout: 30000 }, (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Request failed (${response.statusCode}) for ${url}`));
            return;
          }

          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("timeout", () => {
        req.destroy(new Error(`Request timed out after 30s: ${url}`));
      })
      .on("error", reject);
  });
}

function isFinalGame(game) {
  return ["Final", "Game Over"].includes(game?.status?.detailedState);
}

function getIsoDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getRelativeIsoDate(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return getIsoDate(date);
}

function formatGameTime(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function formatShortDate(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(isoString));
}

function formatMonthDay(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  }).format(new Date(isoString));
}

function formatWeekday(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(new Date(isoString));
}

function formatGeneratedAtEt(isoString) {
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString))} ET`;
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

function loadOverrides(date) {
  const path = `./overrides/${date}.json`;
  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(readFileSync(path, "utf8"));
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

function deepMerge(target, source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return source == null ? target : source;
  }

  const output = target && typeof target === "object" && !Array.isArray(target) ? target : {};
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = output[key];

    if (Array.isArray(sourceValue)) {
      output[key] = cloneJson(sourceValue);
      continue;
    }

    if (sourceValue && typeof sourceValue === "object") {
      output[key] = deepMerge(targetValue, sourceValue);
      continue;
    }

    output[key] = sourceValue;
  }

  return output;
}

function fail(error) {
  const message = `[${new Date().toISOString()}] ${error.stack ?? error.message}\n`;
  writeFileSync(ERROR_LOG, message, "utf8");
  console.error(error.message);
  process.exit(1);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function dedupeStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
