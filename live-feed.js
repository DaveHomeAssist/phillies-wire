const PREVIEW_POLL_MS = 60 * 1000;
const LIVE_POLL_MS = 15 * 1000;
const LIVE_PAGE_RELOAD_MS = 5 * 60 * 1000;
const GAME_WINDOW_MS = 6 * 60 * 60 * 1000;
const HERO_MODES = ["pregame", "live", "final", "off_day"];
const SEPARATOR = " \u00b7 ";

export function buildGameSnapshot(input) {
  const source = input || {};
  const linescore = source.linescore || {};
  const feed = source.feed || {};
  const home = linescore.teams && linescore.teams.home ? linescore.teams.home : {};
  const away = linescore.teams && linescore.teams.away ? linescore.teams.away : {};
  const inning = Number(linescore.currentInning || 0);
  const outs = typeof linescore.outs === "number" ? linescore.outs : 0;
  const half = linescore.isTopInning ? "Top" : "Bot";
  const detailedState =
    feed.gameData && feed.gameData.status && feed.gameData.status.detailedState
      ? feed.gameData.status.detailedState
      : "";
  const isFinal = /final|game over|completed/i.test(detailedState);
  const isLive = !isFinal && inning > 0;
  const lineText =
    getTeamAbbreviation(away, "AWAY") +
    " " +
    getTeamRuns(away) +
    ", " +
    getTeamAbbreviation(home, "HOME") +
    " " +
    getTeamRuns(home);
  const detailText = isFinal ? "Final" : inning === 0 ? "Pregame" : half + " " + inning + SEPARATOR + formatOuts(outs);
  const mode = isFinal ? "final" : isLive ? "live" : "pregame";
  const heroLabel = isFinal ? "Final" : isLive ? "Live" : "Pregame";
  const venue = source.venue || "";

  return {
    mode,
    isFinal,
    isLive,
    lineText,
    detailText,
    heroLabel,
    heroHeadline: lineText,
    heroDek: detailText,
    heroSummary: isFinal ? buildFinalSummary(venue) : isLive ? buildLiveSummary(venue) : "",
    previewText: lineText + SEPARATOR + detailText,
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
  let reloadTimer = null;

  if (activeDoc.body && activeDoc.body.dataset && activeDoc.body.dataset.pageMode === "live") {
    reloadTimer = scheduleReload(activeWin, reloadTimer);
  }

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
    Promise.all([
      fetchJson(activeFetch, "https://statsapi.mlb.com/api/v1/game/" + gamePk + "/linescore"),
      fetchJson(activeFetch, "https://statsapi.mlb.com/api/v1.1/game/" + gamePk + "/feed/live?fields=gameData,status,detailedState"),
    ])
      .then(function(results) {
        const snapshot = buildGameSnapshot({
          linescore: results[0],
          feed: results[1],
          venue,
        });

        syncLiveShell(activeDoc, snapshot);
        if (snapshot.isLive) {
          reloadTimer = scheduleReload(activeWin, reloadTimer);
        }
        scheduleNextPoll(getNextPollDelay(snapshot));
      })
      .catch(function() {
        scheduleNextPoll(PREVIEW_POLL_MS);
      });
  }

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

function getTeamAbbreviation(team, fallback) {
  return team && team.abbreviation ? team.abbreviation : fallback;
}

function getTeamRuns(team) {
  return team && typeof team.runs === "number" ? team.runs : 0;
}

function formatOuts(outs) {
  return String(outs) + " out" + (outs === 1 ? "" : "s");
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

function scheduleReload(win, currentTimer) {
  if (currentTimer) {
    return currentTimer;
  }

  return win.setTimeout(function() {
    if (win.location && typeof win.location.reload === "function") {
      win.location.reload();
    }
  }, LIVE_PAGE_RELOAD_MS);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  initLiveFeed(document, window, typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
}
