import { readFileSync, writeFileSync } from "node:fs";
import https from "node:https";

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
  const [scheduleResponse, nextScheduleResponse, rosterResponse, transactionResponse, weatherResponse] =
    await Promise.all([
      fetchJson(`${MLB_API_BASE}/schedule?sportId=1&teamId=${TEAM_ID}&date=${TODAY}&hydrate=linescore,probablePitcher,seriesStatus,team,game(content(summary,media(epg)))`),
      fetchJson(
        `${MLB_API_BASE}/schedule?sportId=1&teamId=${TEAM_ID}&startDate=${TODAY}&endDate=${getRelativeIsoDate(4)}&hydrate=probablePitcher,seriesStatus,team`,
      ),
      fetchJson(`${MLB_API_BASE}/teams/${TEAM_ID}/roster?rosterType=active`),
      fetchJson(`${MLB_API_BASE}/transactions?teamId=${TEAM_ID}&startDate=${YESTERDAY}&endDate=${TODAY}`),
      fetchJson(WEATHER_URL),
    ]);

  const game = scheduleResponse?.dates?.[0]?.games?.[0];
  if (!game) {
    console.log(`No Phillies game scheduled for ${TODAY}. Nothing to do.`);
    process.exit(0);
  }

  const nextGames = collectUpcomingGames(nextScheduleResponse, TEAM_ID);
  const boxscore = isFinalGame(game)
    ? await fetchJson(`${MLB_API_BASE}/game/${game.gamePk}/boxscore`)
    : null;

  const data = cloneJson(fixture);

  data.meta.date = TODAY;
  data.meta.generated_at = new Date().toISOString();
  data.meta.schema_version = fixture.meta.schema_version ?? "1.1.0";
  data.record = {
    ...data.record,
    wins: game.teams?.home?.team?.id === TEAM_ID ? (game.teams.home.leagueRecord?.wins ?? 0) : (game.teams.away.leagueRecord?.wins ?? 0),
    losses: game.teams?.home?.team?.id === TEAM_ID ? (game.teams.home.leagueRecord?.losses ?? 0) : (game.teams.away.leagueRecord?.losses ?? 0),
  };

  const homeTeam = game.teams.home.team;
  const awayTeam = game.teams.away.team;
  const philliesSide = homeTeam.id === TEAM_ID ? game.teams.home : game.teams.away;
  const opponentSide = homeTeam.id === TEAM_ID ? game.teams.away : game.teams.home;
  const weather = weatherResponse?.current ?? {};
  const fallbackNotes = buildSourceNotes(transactionResponse, fixture);
  const starters = {
    home: {
      name: philliesSide.probablePitcher?.fullName ?? fixture.sections.game_status.content.starters.home.name,
      hand: fixture.sections.game_status.content.starters.home.hand,
    },
    away: {
      name: opponentSide.probablePitcher?.fullName ?? fixture.sections.game_status.content.starters.away.name,
      hand: fixture.sections.game_status.content.starters.away.hand,
    },
  };

  data.meta.status = {
    ...fixture.meta.status,
    mode: deriveMode(game),
    mode_label: deriveModeLabel(game),
    crawl_state: "ok",
    enrich_state: "pending",
    enrich_label: "Awaiting editorial pass",
    generated_at_et: formatGeneratedAtEt(data.meta.generated_at),
    source_notes: fallbackNotes,
  };

  data.sections.game_status.preview = `${homeTeam.abbreviation} vs ${awayTeam.abbreviation} · ${formatGameTime(game.gameDate)} · ${game.venue.name}`;
  data.sections.game_status.content = {
    ...data.sections.game_status.content,
    matchup: `${homeTeam.teamName} vs ${awayTeam.teamName} - Game ${game.seriesGameNumber ?? 1}`,
    first_pitch: formatGameTime(game.gameDate),
    venue: `${game.venue.name}, ${homeTeam.locationName}`,
    starters,
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
  }

  data.sections.roster.content.rotation = buildRotation(nextGames, fixture.sections.roster.content.rotation);
  data.sections.roster.content.highlights = buildRosterHighlights(rosterResponse, transactionResponse, fixture.sections.roster.content.highlights);
  data.sections.injury_report.content.il_entries = mergeInjuryEntriesFromTransactions(
    fixture.sections.injury_report.content.il_entries,
    transactionResponse,
  );
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
  }

  data.ticker = buildTicker(data, transactionResponse, weather);

  validateCrawlPayload(data);
  writeFileSync(OUTPUT_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log("phillies-wire-data.json written");
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

  return items.slice(0, 9);
}

function buildSourceNotes(transactionResponse, fixture) {
  const notes = [];

  for (const note of fixture?.meta?.status?.source_notes ?? []) {
    notes.push(note);
  }

  if (transactionResponse?.transactions?.some((transaction) => /rehab assignment/i.test(transaction.description))) {
    notes.push("Rehab assignment notes are refreshed from the MLB transactions feed.");
  }

  return dedupeStrings(notes);
}

function buildRotation(nextGames, fallback) {
  if (!nextGames.length) {
    return fallback;
  }

  return nextGames.slice(0, 5).map((game, index) => ({
    date: game.shortDate,
    pitcher: game.homePitcher,
    opponent: game.opponentAbbr,
    hand: fallback[index]?.hand ?? "R",
  }));
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
    "recap",
    "roster",
    "injury_report",
    "farm_system",
    "preview",
  ];

  if (!data.meta || !data.record || !data.ticker || !data.sections) {
    throw new Error("Missing one of the required top-level keys: meta, record, ticker, sections.");
  }

  if (!data.meta.status || !Array.isArray(data.meta.status.source_notes)) {
    throw new Error("Missing meta.status or source notes.");
  }

  for (const sectionKey of requiredSections) {
    if (!data.sections[sectionKey]) {
      throw new Error(`Missing section: ${sectionKey}`);
    }
  }

  if (!data.sections.game_status.content.starters.home.name || !data.sections.game_status.content.starters.away.name) {
    throw new Error("Both starters must be non-null.");
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
