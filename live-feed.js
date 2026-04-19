const PREVIEW_POLL_MS = 60 * 1000;
const LIVE_POLL_MS = 15 * 1000;
const GAME_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 4;
const HERO_MODES = ["pregame", "live", "final", "off_day"];
const SEPARATOR = " \u00b7 ";

// Shape guards for the two MLB Stats API responses we consume.
// Return false for anything that doesn't look like the expected
// structure so the caller can hold the previous snapshot instead
// of rendering garbage text into the live shell.
export function isValidLinescore(value) {
  if (!value || typeof value !== "object") return false;
  if (value.teams && typeof value.teams !== "object") return false;
  return true;
}

export function isValidFeed(value) {
  if (!value || typeof value !== "object") return false;
  if (value.gameData && typeof value.gameData !== "object") return false;
  return true;
}

export function buildGameSnapshot(input) {
  const source = input || {};
  const linescore = source.linescore || {};
  const feed = source.feed || {};
  const gameDataTeams = feed.gameData && feed.gameData.teams ? feed.gameData.teams : {};
  const home = linescore.teams && linescore.teams.home ? linescore.teams.home : {};
  const away = linescore.teams && linescore.teams.away ? linescore.teams.away : {};
  const homeMeta = gameDataTeams.home || {};
  const awayMeta = gameDataTeams.away || {};
  const inning = Number(linescore.currentInning || 0);
  const outs = typeof linescore.outs === "number" ? linescore.outs : 0;
  const half = linescore.isTopInning ? "Top" : "Bot";
  const detailedState =
    feed.gameData && feed.gameData.status && feed.gameData.status.detailedState
      ? feed.gameData.status.detailedState
      : "";
  const isFinal = /final|game over|completed/i.test(detailedState);
  const isPaused = /delayed|suspended|postponed/i.test(detailedState);
  const isLive = !isFinal && !isPaused && inning > 0;
  const lineText =
    getTeamAbbreviation(away, awayMeta, "AWAY") +
    " " +
    getTeamRuns(away) +
    ", " +
    getTeamAbbreviation(home, homeMeta, "HOME") +
    " " +
    getTeamRuns(home);
  const heroLineText =
    getTeamDisplayName(awayMeta, getTeamAbbreviation(away, awayMeta, "Away")) +
    " " +
    getTeamRuns(away) +
    ", " +
    getTeamDisplayName(homeMeta, getTeamAbbreviation(home, homeMeta, "Home")) +
    " " +
    getTeamRuns(home);
  const detailText = isFinal
    ? "Final"
    : isPaused
    ? pickPausedLabel(detailedState)
    : inning === 0
    ? "Pregame"
    : half + " " + inning + SEPARATOR + formatOuts(outs);
  const mode = isFinal ? "final" : isLive ? "live" : "pregame";
  const heroLabel = isFinal
    ? "Final"
    : isPaused
    ? pickPausedLabel(detailedState)
    : isLive
    ? "Live"
    : "Pregame";
  const venue = source.venue || "";

  return {
    mode,
    isFinal,
    isLive,
    lineText,
    detailText,
    heroLabel,
    heroHeadline: heroLineText,
    heroDek: detailText,
    heroSummary: isFinal ? buildFinalSummary(venue) : isLive ? buildLiveSummary(venue) : "",
    previewText: heroLineText + SEPARATOR + detailText,
    statusText: "Updated live" + SEPARATOR + detailText,
  };
}

export function syncLiveShell(doc, snapshot) {
  if (!doc || !snapshot) {
    return;
  }

  setText(doc, "pw-live-line", snapshot.lineText);
  setText(doc, "pw-live-detail", snapshot.detailText);
  addClass(doc, "pw-live-score", "pw-live-score--active");

  if (!snapshot.isLive && !snapshot.isFinal) {
    return;
  }

  setText(doc, "pw-status-mode-chip", snapshot.heroLabel);
  setText(doc, "pw-status-text", snapshot.statusText);
  setText(doc, "pw-hero-label", snapshot.heroLabel);
  setText(doc, "pw-hero-headline", snapshot.heroHeadline);
  setText(doc, "pw-hero-dek", snapshot.heroDek);
  setText(doc, "pw-hero-summary", snapshot.heroSummary);
  setText(doc, "pw-game-status-preview", snapshot.previewText);

  const heroSection = doc.getElementById("pw-hero-section");
  if (heroSection) {
    updateHeroMode(heroSection, snapshot.mode);
  }

  if (doc.body && doc.body.dataset) {
    doc.body.dataset.pageMode = snapshot.mode;
  }
}

export function getNextPollDelay(snapshot) {
  if (!snapshot || snapshot.isFinal) {
    return null;
  }

  return snapshot.isLive ? LIVE_POLL_MS : PREVIEW_POLL_MS;
}

export function shouldPoll(firstPitchIso, nowMs) {
  if (!firstPitchIso) {
    return false;
  }

  const pitchTime = new Date(firstPitchIso).getTime();
  if (!Number.isFinite(pitchTime)) {
    return false;
  }

  const now = typeof nowMs === "number" ? nowMs : Date.now();
  return now <= pitchTime + GAME_WINDOW_MS;
}

export function initLiveFeed(doc, win, fetchImpl) {
  const activeDoc = doc || (typeof document !== "undefined" ? document : null);
  const activeWin = win || (typeof window !== "undefined" ? window : null);
  const activeFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!activeDoc || !activeWin || !activeFetch) {
    return;
  }

  const container = activeDoc.getElementById("pw-live-score");
  if (!container) {
    return;
  }

  const gamePk = container.getAttribute("data-game-pk");
  const firstPitch = container.getAttribute("data-first-pitch");
  const venue = container.getAttribute("data-venue") || "";
  if (!gamePk || !shouldPoll(firstPitch)) {
    return;
  }

  let pollTimer = null;
  let consecutiveFailures = 0;

  function clearPollTimer() {
    if (pollTimer) {
      activeWin.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function scheduleNextPoll(delay) {
    clearPollTimer();
    if (delay == null) {
      return;
    }
    pollTimer = activeWin.setTimeout(poll, delay);
  }

  function poll() {
    if (activeDoc.visibilityState === "hidden") {
      // Back off while the tab is hidden; the polling resumes via the
      // visibilitychange listener below.
      return;
    }

    Promise.all([
      fetchJson(activeFetch, "https://statsapi.mlb.com/api/v1/game/" + gamePk + "/linescore"),
      fetchJson(activeFetch, "https://statsapi.mlb.com/api/v1.1/game/" + gamePk + "/feed/live?fields=gameData,status,detailedState,teams,home,away,abbreviation,teamName,clubName,name"),
    ])
      .then(function (results) {
        if (!isValidLinescore(results[0]) || !isValidFeed(results[1])) {
          // Hold the last good snapshot rather than rendering garbage.
          // Treat like a transient failure for backoff purposes.
          consecutiveFailures += 1;
          scheduleNextPoll(PREVIEW_POLL_MS);
          return;
        }
        consecutiveFailures = 0;
        const snapshot = buildGameSnapshot({
          linescore: results[0],
          feed: results[1],
          venue,
        });

        syncLiveShell(activeDoc, snapshot);
        scheduleNextPoll(getNextPollDelay(snapshot));
      })
      .catch(function () {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          // Give the API a minute to recover instead of hammering it.
          scheduleNextPoll(PREVIEW_POLL_MS * 4);
          return;
        }
        scheduleNextPoll(PREVIEW_POLL_MS);
      });
  }

  activeDoc.addEventListener("visibilitychange", function () {
    if (activeDoc.visibilityState === "visible") {
      // Reset the failure counter on re-entry so a tab that was hidden
      // for an hour doesn't resume "one failure away from backoff".
      consecutiveFailures = 0;
      poll();
    } else {
      clearPollTimer();
    }
  });

  poll();
}

export function fetchJson(fetchImpl, url) {
  return fetchImpl(url, { cache: "no-store" }).then(function(response) {
    if (!response || response.ok === false) {
      const status = response && typeof response.status !== "undefined" ? response.status : "unknown";
      throw new Error("Live feed request failed with status " + status + ".");
    }
    return response.json();
  });
}

function getTeamAbbreviation(team, metadata, fallback) {
  if (team && team.abbreviation) {
    return team.abbreviation;
  }

  if (metadata && metadata.abbreviation) {
    return metadata.abbreviation;
  }

  return fallback;
}

function getTeamDisplayName(metadata, fallback) {
  if (metadata && metadata.teamName) {
    return metadata.teamName;
  }

  if (metadata && metadata.clubName) {
    return metadata.clubName;
  }

  if (metadata && metadata.name) {
    return metadata.name;
  }

  return fallback;
}

function getTeamRuns(team) {
  return team && typeof team.runs === "number" ? team.runs : 0;
}

function formatOuts(outs) {
  return String(outs) + " out" + (outs === 1 ? "" : "s");
}

function pickPausedLabel(detailedState) {
  if (!detailedState) return "Paused";
  if (/postponed/i.test(detailedState)) return "Postponed";
  if (/suspended/i.test(detailedState)) return "Suspended";
  if (/delayed/i.test(detailedState)) return "Delayed";
  return detailedState;
}

function buildLiveSummary(venue) {
  return venue ? "Live from " + venue + "." : "Game in progress.";
}

function buildFinalSummary(venue) {
  return venue ? "Final from " + venue + "." : "Game over.";
}

function setText(doc, id, value) {
  const element = doc.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function addClass(doc, id, className) {
  const element = doc.getElementById(id);
  if (element && element.classList) {
    element.classList.add(className);
  }
}

function updateHeroMode(element, mode) {
  if (element.classList) {
    for (const knownMode of HERO_MODES) {
      element.classList.remove("pw-hero--" + knownMode);
    }
    element.classList.add("pw-hero--" + mode);
  }

  if (element.dataset) {
    element.dataset.liveMode = mode;
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  initLiveFeed(document, window, typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
}
