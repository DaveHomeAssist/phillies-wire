// Offseason payload helpers. Pure functions (no network) so they can be unit
// tested; crawl.mjs wires them in when SEASON_PHASE=offseason.
//
// The final record is computed from the canonical season schedule
// (data/phillies-2026.json), never from the editorial fixture — the fixture's
// 0-0 placeholder is what leaked onto the live site after the season ended.

const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function isScoredFinal(game) {
  return (
    game?.status?.abstract === "Final" &&
    Number.isFinite(game?.phillies?.score) &&
    Number.isFinite(game?.opponent?.score) &&
    game.phillies.score !== game.opponent.score
  );
}

// Returns { wins, losses, pct, streak, last_game, source } or null when the
// schedule has no completed games.
export function computeFinalRecord(schedule) {
  const games = (schedule?.games ?? [])
    .filter(isScoredFinal)
    .sort((a, b) => String(a.game_date ?? a.official_date).localeCompare(String(b.game_date ?? b.official_date)));
  if (games.length === 0) return null;

  let countedWins = 0;
  let countedLosses = 0;
  for (const game of games) {
    if (game.phillies.score > game.opponent.score) countedWins += 1;
    else countedLosses += 1;
  }

  // MLB's league_record on the last final is authoritative (it includes any
  // makeup games the schedule file may be missing); fall back to the count.
  const last = games[games.length - 1];
  const official = last.phillies?.league_record;
  const useOfficial = Number.isFinite(official?.wins) && Number.isFinite(official?.losses);
  const wins = useOfficial ? official.wins : countedWins;
  const losses = useOfficial ? official.losses : countedLosses;

  const lastOutcome = last.phillies.score > last.opponent.score ? "W" : "L";
  let streakLength = 0;
  for (let i = games.length - 1; i >= 0; i -= 1) {
    const outcome = games[i].phillies.score > games[i].opponent.score ? "W" : "L";
    if (outcome !== lastOutcome) break;
    streakLength += 1;
  }

  const total = wins + losses;
  const pct = total > 0 ? (wins / total).toFixed(3).replace(/^0/, "") : ".000";
  const venueWord = last.home_game ? "vs" : "at";
  const lastDate = last.official_date ? MONTH_DAY.format(new Date(`${last.official_date}T12:00:00Z`)) : "";

  return {
    wins,
    losses,
    pct,
    streak: `${lastOutcome}${streakLength}`,
    source: useOfficial ? "schedule league_record" : "schedule count",
    last_game: {
      outcome: lastOutcome,
      label: `${lastOutcome} ${last.phillies.score}-${last.opponent.score} ${venueWord} ${last.opponent.abbr ?? last.opponent.name ?? "OPP"}`,
      date: lastDate,
      game_pk: last.game_pk ?? null,
    },
    // Same shape crawl.mjs extractLastFinalFromGame emits, so verify's streak
    // check and factcheck's recap reconciliation target the real last game.
    last_final: {
      date: last.official_date ?? String(last.game_date ?? "").slice(0, 10),
      game_pk: last.game_pk ?? null,
      phi_runs: last.phillies.score,
      opp_runs: last.opponent.score,
      opp_abbr: last.opponent.abbr ?? "OPP",
      outcome: lastOutcome,
      venue_is_home: Boolean(last.home_game),
    },
  };
}

export function buildHotStoveItems(transactionResponse, limit = 6) {
  const seen = new Set();
  const items = [];
  const transactions = [...(transactionResponse?.transactions ?? [])]
    .filter((t) => typeof t?.description === "string" && t.description.trim())
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  for (const transaction of transactions) {
    const text = transaction.description.replace(/^Philadelphia Phillies\s+/i, "").trim();
    const normalized = text.charAt(0).toUpperCase() + text.slice(1);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    items.push({ text: `Hot stove: ${normalized}`, highlight: /sign|trade|claim|acquire/i.test(text) });
    if (items.length >= limit) break;
  }
  return items;
}

// Mutates `data` (an off-day payload) into the offseason edition.
export function applyOffseasonPayload(data, { season, finalRecord, hotStoveItems = [] }) {
  const recordText = finalRecord ? `${finalRecord.wins}-${finalRecord.losses}` : "Final record pending";

  data.meta.off_day = true;
  data.meta.show_sections = false;
  data.meta.season_phase = "offseason";
  data.meta.completed_season = season;
  data.meta.status = {
    ...data.meta.status,
    mode: "offseason",
    mode_label: "Offseason",
    enrich_state: "skipped",
    enrich_label: "Offseason mode. Weekly hot-stove edition published.",
  };

  if (finalRecord) {
    data.record = {
      ...data.record,
      wins: finalRecord.wins,
      losses: finalRecord.losses,
      streak: finalRecord.streak,
    };
  }

  data.next_game = {
    ...data.next_game,
    label: "Next Season",
    matchup: `${season + 1} schedule to be announced`,
    date: "TBA",
    time: "TBA",
    venue: "TBA",
  };

  data.hero = {
    mode: "offseason",
    label: "Offseason",
    headline: `${season} season complete`,
    dek: finalRecord ? `Phillies finish ${recordText} (${finalRecord.pct})` : "Final record pending",
    summary: "The Wire is in offseason mode: weekly hot-stove updates on signings, trades, and roster moves until spring training.",
    cards: [
      { label: "Final Record", value: recordText },
      { label: "Last Game", value: finalRecord ? `${finalRecord.last_game.label} · ${finalRecord.last_game.date}` : "TBA" },
      { label: "Next Season", value: `${season + 1} schedule TBA` },
    ],
    bullets: [
      `${season} regular season: ${recordText}`,
      "Browse the archive for every issue of the season.",
      "Hot-stove moves update weekly in the ticker.",
    ],
    next_label: "Next Season",
    next_value: `${season + 1} schedule to be announced`,
  };

  data.ticker = [
    { text: `PHI ${recordText} · ${season} Final`, highlight: true },
    ...hotStoveItems,
  ];
  if (hotStoveItems.length === 0) {
    data.ticker.push({ text: "Hot stove: no new Phillies transactions this week", highlight: false });
  }
  data.ticker.push({ text: "Offseason mode · weekly updates", highlight: false });
  return data;
}
