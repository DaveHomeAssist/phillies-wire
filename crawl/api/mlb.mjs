import https from "node:https";

import {
  FETCH_TIMEOUT_MS,
  MLB_API_BASE,
  TEAM_ID,
} from "../../config.mjs";
import { normalizeGamesBack } from "../format.mjs";

export {
  createFetchSoft,
  fetchDailyMlbData,
  fetchGameDetail,
  fetchJson,
  fetchPitcherStats,
  fetchStandings,
};

function createFetchSoft() {
  return (label, url) =>
    fetchJson(url).catch((error) => {
      console.warn(`[crawl] ${label} fetch failed: ${error.message}`);
      return null;
    });
}

async function fetchDailyMlbData({ today, yesterday, endDate, teamId = TEAM_ID, fetchSoft = createFetchSoft() }) {
  const [scheduleResponse, nextScheduleResponse, rosterResponse, transactionResponse, injuryResponse] = await Promise.all([
    fetchSoft(
      "schedule",
      `${MLB_API_BASE}/schedule?sportId=1&teamId=${teamId}&date=${today}&hydrate=linescore,probablePitcher,seriesStatus,team,broadcasts(all),game(content(summary,media(epg)))`,
    ),
    fetchSoft(
      "next-schedule",
      `${MLB_API_BASE}/schedule?sportId=1&teamId=${teamId}&startDate=${today}&endDate=${endDate}&hydrate=linescore,probablePitcher,seriesStatus,team,broadcasts(all)`,
    ),
    fetchSoft("roster", `${MLB_API_BASE}/teams/${teamId}/roster?rosterType=active`),
    fetchSoft("transactions", `${MLB_API_BASE}/transactions?teamId=${teamId}&startDate=${yesterday}&endDate=${today}`),
    fetchSoft("injuries", `${MLB_API_BASE}/teams/${teamId}/injuries`),
  ]);

  return {
    scheduleResponse,
    nextScheduleResponse,
    rosterResponse,
    transactionResponse,
    injuryResponse,
  };
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

async function fetchStandings() {
  const season = new Date().getFullYear();
  const response = await fetchJson(
    `${MLB_API_BASE}/standings?leagueId=104&season=${season}&standingsTypes=regularSeason`,
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
        gb: normalizeGamesBack(team.gamesBack),
        streak: team.streak?.streakCode ?? "",
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
