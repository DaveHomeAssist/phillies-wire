import https from "node:https";

import {
  FETCH_TIMEOUT_MS,
  MLB_API_BASE,
  TEAM_ID,
} from "../../config.mjs";
import { normalizeGamesBack } from "../format.mjs";

const TEAM_ABBR_BY_ID = {
  120: "WSH",
  121: "NYM",
  143: "PHI",
  144: "ATL",
  146: "MIA",
};

export {
  createFetchSoft,
  deriveIlFromTransactions,
  fetchDailyMlbData,
  fetchGameDetail,
  fetchJson,
  fetchPitcherStats,
  fetchRecentFinals,
  fetchSeasonTransactions,
  fetchStandings,
};

function createFetchSoft() {
  return (label, url) =>
    fetchJson(url).catch((error) => {
      console.warn(`[crawl] ${label} fetch failed: ${error.message}`);
      return null;
    });
}

async function fetchDailyMlbData({
  today,
  yesterday,
  transactionStartDate = yesterday,
  endDate,
  teamId = TEAM_ID,
  fetchSoft = createFetchSoft(),
}) {
  const [
    scheduleResponse,
    nextScheduleResponse,
    rosterResponse,
    transactionResponse,
    injuryResponse,
    seasonTransactionsResponse,
  ] = await Promise.all([
    fetchSoft(
      "schedule",
      `${MLB_API_BASE}/schedule?sportId=1&teamId=${teamId}&date=${today}&hydrate=linescore,probablePitcher,seriesStatus,team,broadcasts(all),game(content(summary,media(epg)))`,
    ),
    fetchSoft(
      "next-schedule",
      `${MLB_API_BASE}/schedule?sportId=1&teamId=${teamId}&startDate=${today}&endDate=${endDate}&hydrate=linescore,probablePitcher,seriesStatus,team,broadcasts(all)`,
    ),
    fetchSoft("roster", `${MLB_API_BASE}/teams/${teamId}/roster?rosterType=active`),
    fetchSoft("transactions", `${MLB_API_BASE}/transactions?teamId=${teamId}&startDate=${transactionStartDate}&endDate=${today}`),
    // Preserved for when MLB re-enables the direct IL endpoint. Currently
    // 404s and is superseded by the season-transactions derivation below.
    fetchSoft("injuries", `${MLB_API_BASE}/teams/${teamId}/injuries`),
    fetchSeasonTransactions({ today, teamId, fetchSoft }),
  ]);

  return {
    scheduleResponse,
    nextScheduleResponse,
    rosterResponse,
    transactionResponse,
    injuryResponse,
    seasonTransactionsResponse,
  };
}

// 120-day window covers spring training through the current date, which is
// all that's needed to reconstruct active IL state. Kept separate from the
// yesterday-today transactionResponse so the recent-transactions ticker and
// source-notes logic stay scoped to what actually happened today.
async function fetchSeasonTransactions({ today, teamId = TEAM_ID, fetchSoft = createFetchSoft() }) {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 120);
  const startDate = start.toISOString().slice(0, 10);
  return fetchSoft(
    "season-transactions",
    `${MLB_API_BASE}/transactions?teamId=${teamId}&startDate=${startDate}&endDate=${today}`,
  );
}

// The `/teams/{id}/injuries` endpoint 404s for teamId=143 (and other teams).
// Derive current IL state from the structured transaction log instead: each
// SC (Status Change) transaction has a free-text description in a stable
// format. Walk chronologically, open a slot on "placed on the N-day injured
// list", update on "transferred from ... to the M-day injured list", and
// close on "activated/reinstated from the N-day injured list" / released
// / traded / designated for assignment. Output shape matches what
// normalizeLiveInjuries already expects, so downstream code is unchanged.
function deriveIlFromTransactions(transactionResponse) {
  const txs = [...(transactionResponse?.transactions ?? [])].sort((left, right) =>
    (left.date ?? "").localeCompare(right.date ?? ""),
  );

  const active = new Map();

  for (const tx of txs) {
    const desc = tx.description ?? "";
    const name = tx.person?.fullName;
    if (!name) continue;

    const position = extractIlPosition(desc);

    const placed = desc.match(
      /on the (\d+)-day injured list(?: retroactive to ([^\.]+))?\.?\s*(.*?)$/i,
    );
    if (/\bplaced\b/i.test(desc) && placed) {
      const [, days, retroRaw, trailing] = placed;
      active.set(name, {
        person: { fullName: name, id: tx.person?.id },
        position: { abbreviation: position },
        status: { description: `${days}-day IL` },
        injuryListType: `${days}-Day`,
        retroactiveDate: normalizeLooseDate(retroRaw),
        injuryDescription: cleanInjuryText(trailing),
        placedDate: tx.date,
      });
      continue;
    }

    const transferred = desc.match(
      /from the \d+-day injured list to the (\d+)-day injured list\.?\s*(.*?)$/i,
    );
    if (/\btransferred\b/i.test(desc) && transferred) {
      const [, newDays, trailing] = transferred;
      const existing = active.get(name) ?? {
        person: { fullName: name, id: tx.person?.id },
        position: { abbreviation: position },
      };
      existing.injuryListType = `${newDays}-Day`;
      existing.status = { description: `${newDays}-day IL` };
      if (trailing) existing.injuryDescription = cleanInjuryText(trailing);
      if (!existing.placedDate) existing.placedDate = tx.date;
      active.set(name, existing);
      continue;
    }

    if (/\b(activated|reinstated)\b.+from the \d+-day injured list/i.test(desc)) {
      active.delete(name);
      continue;
    }

    if (/\breleased\b|\btraded\b|designated for assignment/i.test(desc)) {
      active.delete(name);
    }
  }

  return { injuries: [...active.values()] };
}

function extractIlPosition(desc) {
  const match = desc.match(
    /\b(?:placed|transferred|activated|reinstated)\s+((?:RHP|LHP|P|C|1B|2B|3B|SS|LF|CF|RF|OF|DH|IF|INF|UT))\s+/,
  );
  return match ? match[1] : "";
}

function normalizeLooseDate(input) {
  if (!input) return null;
  const cleaned = input.replace(/\s+/g, " ").trim();
  const dt = new Date(cleaned);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function cleanInjuryText(input) {
  if (!input) return "";
  return input.replace(/\s+/g, " ").replace(/\.$/, "").trim();
}

async function fetchGameDetail(gamePk) {
  // feed/live payload: we rely on gameData.players[].batSide.code for
  // batting handedness. A prior fields=gameData,players filter silently
  // stripped every nested key from the player records (server returned
  // 52 empty objects), which collapsed every batter to the "R" default.
  // Fetching the full payload is the reliable shape.
  const [boxscore, gameFeed] = await Promise.all([
    fetchJson(`${MLB_API_BASE}/game/${gamePk}/boxscore`).catch(() => null),
    fetchJson(
      `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,
    ).catch(() => null),
  ]);

  return { boxscore, gameFeed };
}

async function fetchPitcherStats(pitcherIds) {
  const statsMap = new Map();
  if (!pitcherIds.length) {
    return statsMap;
  }

  const season = new Date().getFullYear();
  const results = await Promise.all(
    pitcherIds.map((id) =>
      fetchJson(`${MLB_API_BASE}/people/${id}/stats?stats=season&group=pitching&season=${season}`)
        .catch(() => null),
    ),
  );

  for (let index = 0; index < pitcherIds.length; index++) {
    const splits = results[index]?.stats?.[0]?.splits?.[0]?.stat;
    if (splits) {
      statsMap.set(pitcherIds[index], {
        era: splits.era ?? "",
        wins: splits.wins ?? 0,
        losses: splits.losses ?? 0,
      });
    }
  }

  return statsMap;
}

// Fetch the most recent COMPLETED final game for the team in the lookback
// window. Excludes postponed/cancelled/suspended entries, which the API still
// stamps abstractGameState="Final" with codedGameState="D" and no scores.
// Returns null if no completed final exists in the window.
async function fetchRecentFinals({
  teamId = TEAM_ID,
  today,
  lookbackDays = 10,
  fetchSoft = createFetchSoft(),
} = {}) {
  if (!today) return null;
  const start = offsetIsoDate(today, -lookbackDays);
  const end = offsetIsoDate(today, -1);
  const response = await fetchSoft(
    "recent-finals",
    `${MLB_API_BASE}/schedule?sportId=1&teamId=${teamId}&startDate=${start}&endDate=${end}&hydrate=team,linescore`,
  );
  if (!response?.dates) return null;

  const finals = [];
  for (const day of response.dates) {
    for (const game of day?.games ?? []) {
      const status = game?.status ?? {};
      if (status.abstractGameState !== "Final") continue;
      // codedGameState "D" is Postponed/Cancelled/Suspended without final
      // score. detailedState may be "Postponed", "Cancelled", "Suspended".
      if (status.codedGameState === "D") continue;
      const home = game?.teams?.home;
      const away = game?.teams?.away;
      const homeScore = home?.score;
      const awayScore = away?.score;
      if (typeof homeScore !== "number" || typeof awayScore !== "number") continue;
      const phiIsHome = home?.team?.id === teamId;
      const phiSide = phiIsHome ? home : away;
      const oppSide = phiIsHome ? away : home;
      const phiRuns = phiSide?.score;
      const oppRuns = oppSide?.score;
      const oppAbbr =
        oppSide?.team?.abbreviation
          ?? TEAM_ABBR_BY_ID[oppSide?.team?.id]
          ?? oppSide?.team?.teamCode?.toUpperCase()
          ?? "OPP";
      finals.push({
        date: day.date,
        game_pk: game.gamePk,
        phi_runs: phiRuns,
        opp_runs: oppRuns,
        opp_abbr: oppAbbr,
        outcome: phiRuns > oppRuns ? "W" : "L",
        venue_is_home: phiIsHome,
      });
    }
  }
  if (!finals.length) return null;
  // Newest first
  finals.sort((a, b) => b.date.localeCompare(a.date));
  return finals[0];
}

function offsetIsoDate(iso, deltaDays) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

async function fetchStandings() {
  const season = new Date().getFullYear();
  const response = await fetchJson(
    `${MLB_API_BASE}/standings?leagueId=104&season=${season}&standingsTypes=regularSeason`,
  ).catch((error) => {
    console.warn(`[crawl] standings fetch failed: ${error.message}`);
    return null;
  });

  if (!response?.records) {
    return [];
  }

  for (const division of response.records) {
    if (division.division?.id === 204) {
      return division.teamRecords.map((team) => ({
        name: team.team.name,
        abbr: team.team.abbreviation ?? TEAM_ABBR_BY_ID[team.team.id] ?? team.team.name.split(" ").pop(),
        wins: team.wins,
        losses: team.losses,
        pct: team.winningPercentage,
        gb: normalizeGamesBack(team.gamesBack),
        streak: team.streak?.streakCode ?? "",
        division_rank: Number.parseInt(team.divisionRank, 10),
        is_phi: team.team.id === TEAM_ID,
      }));
    }
  }

  return [];
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https
      .get(url, { timeout: FETCH_TIMEOUT_MS }, (response) => {
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
        req.destroy(new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms: ${url}`));
      })
      .on("error", reject);
  });
}
