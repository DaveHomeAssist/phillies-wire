import {
  LEGACY_QUEST_SOURCE_KEY,
  buildLegacyMatchKey,
  findCurrentOrNextGame,
  formatEtDateLabel,
  groupGamesByMonth,
  isCompletedGame,
} from "../shared/phillies-schedule.mjs";

const SCHEDULE_URL = "../data/phillies-2026.json";
const STATE_KEY = "philliesWire_scheduleState";
const LEGACY_IMPORT_KEY = "philliesWire_scheduleImport_v1";

const LEGACY_PLAN_GAMES = [
  { legacy_id: 17, official_date: "2026-03-31", opponent_abbr: "WSH", home_game: true },
  { legacy_id: 1, official_date: "2026-04-15", opponent_abbr: "CHC", home_game: true },
  { legacy_id: 2, official_date: "2026-04-18", opponent_abbr: "ATL", home_game: true },
  { legacy_id: 3, official_date: "2026-04-29", opponent_abbr: "SF", home_game: true },
  { legacy_id: 4, official_date: "2026-05-08", opponent_abbr: "COL", home_game: true },
  { legacy_id: 5, official_date: "2026-05-18", opponent_abbr: "CIN", home_game: true },
  { legacy_id: 6, official_date: "2026-05-23", opponent_abbr: "CLE", home_game: true },
  { legacy_id: 7, official_date: "2026-06-04", opponent_abbr: "SD", home_game: true },
  { legacy_id: 8, official_date: "2026-06-15", opponent_abbr: "MIA", home_game: true },
  { legacy_id: 9, official_date: "2026-06-20", opponent_abbr: "NYM", home_game: true },
  { legacy_id: 10, official_date: "2026-07-01", opponent_abbr: "PIT", home_game: true },
  { legacy_id: 11, official_date: "2026-07-20", opponent_abbr: "LAD", home_game: true },
  { legacy_id: 12, official_date: "2026-07-24", opponent_abbr: "NYY", home_game: true },
  { legacy_id: 13, official_date: "2026-08-06", opponent_abbr: "WSH", home_game: true },
  { legacy_id: 14, official_date: "2026-08-22", opponent_abbr: "STL", home_game: true },
  { legacy_id: 15, official_date: "2026-09-07", opponent_abbr: "ATL", home_game: true },
  { legacy_id: 16, official_date: "2026-09-25", opponent_abbr: "TB", home_game: true },
];

const defaultState = {
  version: 1,
  view: {
    filter: "all",
    search: "",
  },
  attendance: {},
};

let schedulePayload = null;
let state = readState();

const monthsHost = document.getElementById("schedule-months");
const migrationBanner = document.getElementById("migration-banner");
const migrationCopy = document.getElementById("migration-copy");
const spotlight = document.getElementById("schedule-spotlight");
const searchInput = document.getElementById("schedule-search");
const importFileInput = document.getElementById("import-file");

function readState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? { ...defaultState, ...JSON.parse(raw) } : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function persistState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {}
}

function getAttendanceEntry(gamePk) {
  return state.attendance?.[String(gamePk)] || { status: null, note: "" };
}

function setAttendanceEntry(gamePk, patch) {
  const key = String(gamePk);
  const next = { ...getAttendanceEntry(gamePk), ...patch };
  if (!next.status && !next.note) {
    delete state.attendance[key];
  } else {
    state.attendance[key] = next;
  }
  persistState();
}

function applyFilterButtons() {
  document.querySelectorAll(".filter-btn").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.filter === state.view.filter ? "true" : "false");
  });
}

function updateStats(games) {
  const attendanceEntries = Object.values(state.attendance);
  const attended = attendanceEntries.filter((entry) => entry.status === "attended").length;
  const planned = attendanceEntries.filter((entry) => entry.status === "planned").length;
  const total = games.length;
  setSlot("total-games", total);
  setSlot("attended-games", attended);
  setSlot("planned-games", planned);
  setSlot("remaining-games", Math.max(total - attended, 0));
}

function setSlot(name, value) {
  const node = document.querySelector(`[data-slot="${name}"]`);
  if (node) node.textContent = value;
}

function renderSpotlight(pointer) {
  const lead = pointer.current_game || pointer.next_game || pointer.latest_completed_game;
  if (!lead) {
    spotlight.hidden = true;
    spotlight.innerHTML = "";
    return;
  }
  const modeLabel = pointer.current_game
    ? "Current game"
    : pointer.next_game
      ? "Next game"
      : "Latest final";
  const links = [
    `<a class="spotlight-link" href="../issues/${lead.official_date}/">Issue for ${lead.official_date}</a>`,
    `<a class="spotlight-link" href="../dashboard/">Command center</a>`,
    `<a class="spotlight-link" href="../dashboard/innings/">Innings view</a>`,
  ];
  spotlight.hidden = false;
  spotlight.innerHTML = `
    <div>
      <div class="spotlight-kicker">${modeLabel}</div>
      <div class="spotlight-title">${escapeHtml(lead.title)}</div>
      <p class="spotlight-copy">${escapeHtml(lead.date_label)} · ${escapeHtml(lead.time_label)} · ${escapeHtml(lead.venue?.name || "TBD")} · ${escapeHtml(lead.series?.label || lead.status?.detailed || "Scheduled")}</p>
    </div>
    <div class="spotlight-links">${links.join("")}</div>
  `;
}

function renderMigrationBanner(result) {
  if (!result || !result.importedCount) {
    migrationBanner.hidden = true;
    return;
  }
  migrationBanner.hidden = false;
  migrationCopy.textContent = `${result.importedCount} game entr${result.importedCount === 1 ? "y" : "ies"} moved from the old Quest key. Notes were preserved where a match was found.`;
}

function getFilteredGames(games) {
  const filter = state.view.filter || "all";
  const query = String(state.view.search || "").trim().toLowerCase();
  const today = new Date();
  return games.filter((game) => {
    const entry = getAttendanceEntry(game.game_pk);
    let visible = true;
    if (filter === "upcoming") {
      visible = !isCompletedGame(game) && Date.parse(game.game_date) >= today.getTime() - 6 * 60 * 60 * 1000;
    } else if (filter === "attended") {
      visible = entry.status === "attended";
    } else if (filter === "planned") {
      visible = entry.status === "planned";
    } else if (filter === "home") {
      visible = Boolean(game.home_game);
    } else if (filter === "road") {
      visible = !game.home_game;
    } else if (filter === "rivalry") {
      visible = (game.tags || []).includes("rivalry");
    }
    if (!visible) return false;
    if (!query) return true;
    const searchText = [
      game.title,
      game.matchup,
      game.opponent?.name,
      game.opponent?.abbr,
      game.date_label,
      game.time_label,
      game.venue?.name,
      ...(game.tags || []),
      entry.note,
    ].filter(Boolean).join(" ").toLowerCase();
    return searchText.includes(query);
  });
}

function renderMonths(games) {
  const filteredGames = getFilteredGames(games);
  updateStats(games);
  if (!filteredGames.length) {
    monthsHost.innerHTML = '<p class="schedule-empty">No games match this view.</p>';
    return;
  }
  const groups = groupGamesByMonth(filteredGames);
  monthsHost.innerHTML = groups.map(renderMonthGroup).join("");
}

function renderMonthGroup(group) {
  return `
    <section class="schedule-month-group" data-month="${escapeHtml(group.month_key)}">
      <header class="schedule-month-head">
        <div>
          <div class="month-eyebrow">Month view</div>
          <div class="month-title">${escapeHtml(group.label)}</div>
        </div>
        <div class="month-count">${group.games.length} game${group.games.length === 1 ? "" : "s"}</div>
      </header>
      <div class="schedule-card-grid">
        ${group.games.map(renderGameCard).join("")}
      </div>
    </section>
  `;
}

function renderGameCard(game) {
  const entry = getAttendanceEntry(game.game_pk);
  const statuses = [];
  if (entry.status) {
    statuses.push(`<span class="schedule-pill" data-tone="${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span>`);
  }
  statuses.push(`<span class="schedule-pill">${escapeHtml(game.status?.detailed || "Scheduled")}</span>`);
  if (game.result) {
    statuses.push(`<span class="schedule-pill" data-tone="${game.result === "W" ? "attended" : "skipped"}">${escapeHtml(game.result)}</span>`);
  }

  const tags = (game.tags || []).map((tag) => `<span class="schedule-pill">${escapeHtml(tag)}</span>`).join("");
  const noteValue = entry.note || "";
  return `
    <article class="schedule-card" data-game-pk="${escapeHtml(String(game.game_pk))}">
      <div>
        <div class="schedule-card-title">${escapeHtml(game.title)}</div>
        <div class="schedule-card-meta">${escapeHtml(game.date_label)} · ${escapeHtml(game.time_label)} · ${escapeHtml(game.venue?.name || "TBD")}</div>
        <div class="schedule-card-statuses">${statuses.join("")}</div>
        <div class="schedule-card-tags">${tags}</div>
        <div class="schedule-card-links">
          <a class="schedule-inline-link" href="../issues/${game.official_date}/">Issue</a>
          <a class="schedule-inline-link" href="../dashboard/">Dashboard</a>
          <a class="schedule-inline-link" href="../dashboard/innings/">Innings</a>
        </div>
        <div class="schedule-note">
          <label for="note-${escapeHtml(String(game.game_pk))}">Notes</label>
          <textarea id="note-${escapeHtml(String(game.game_pk))}" data-note-for="${escapeHtml(String(game.game_pk))}" placeholder="Seats, transit, who went, or what to watch">${escapeHtml(noteValue)}</textarea>
        </div>
      </div>
      <div class="schedule-card-side">
        <div class="schedule-detail-block">
          <span class="schedule-detail-label">Series</span>
          <span class="schedule-detail-value">${escapeHtml(game.series?.label || "Season game")}</span>
        </div>
        <div class="schedule-detail-block">
          <span class="schedule-detail-label">Probables</span>
          <span class="schedule-detail-value">${escapeHtml(formatProbables(game))}</span>
        </div>
        <div class="schedule-detail-block">
          <span class="schedule-detail-label">Result</span>
          <span class="schedule-detail-value">${escapeHtml(formatResult(game))}</span>
        </div>
        <div class="schedule-card-actions">
          <button class="schedule-action-btn ${entry.status === "planned" ? "is-active" : ""}" data-action="set-status" data-status="planned" data-game-pk="${escapeHtml(String(game.game_pk))}">Plan</button>
          <button class="schedule-action-btn ${entry.status === "attended" ? "is-active" : ""}" data-action="set-status" data-status="attended" data-game-pk="${escapeHtml(String(game.game_pk))}">Attended</button>
          <button class="schedule-action-btn ${entry.status === "skipped" ? "is-active" : ""}" data-action="set-status" data-status="skipped" data-game-pk="${escapeHtml(String(game.game_pk))}">Skip</button>
          <button class="schedule-action-btn" data-action="clear-status" data-game-pk="${escapeHtml(String(game.game_pk))}">Clear</button>
        </div>
      </div>
    </article>
  `;
}

function formatProbables(game) {
  const phi = game.phillies?.probable_pitcher?.name;
  const opp = game.opponent?.probable_pitcher?.name;
  if (phi && opp) return `${phi} vs ${opp}`;
  if (phi) return phi;
  if (opp) return opp;
  return "TBD";
}

function formatResult(game) {
  if (game.result && game.score?.phillies != null && game.score?.opponent != null) {
    return `${game.result} · PHI ${game.score.phillies}, ${game.opponent?.abbr || "OPP"} ${game.score.opponent}`;
  }
  return game.status?.detailed || "Scheduled";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function exportState() {
  const payload = {
    exported_at: new Date().toISOString(),
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "phillies-wire-schedule-state.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importState(text) {
  const parsed = JSON.parse(text);
  if (!parsed?.state?.attendance) {
    throw new Error("Missing attendance map");
  }
  state = {
    ...structuredClone(defaultState),
    ...parsed.state,
  };
  persistState();
}

function maybeImportLegacyState(games) {
  if (localStorage.getItem(LEGACY_IMPORT_KEY)) {
    return null;
  }
  let legacy = null;
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_QUEST_SOURCE_KEY) || "null");
  } catch {
    legacy = null;
  }
  if (!legacy || (!legacy.attended && !legacy.notes)) {
    return null;
  }
  const mapping = new Map(
    LEGACY_PLAN_GAMES.map((entry) => [
      String(entry.legacy_id),
      buildLegacyMatchKey(entry),
    ]),
  );
  const gamesByLegacyKey = new Map(games.map((game) => [game.legacy_match_key, game]));
  let importedCount = 0;

  for (const [legacyId, attended] of Object.entries(legacy.attended || {})) {
    const matchKey = mapping.get(legacyId);
    const game = matchKey ? gamesByLegacyKey.get(matchKey) : null;
    if (!game || !attended) continue;
    const existing = getAttendanceEntry(game.game_pk);
    state.attendance[String(game.game_pk)] = {
      ...existing,
      status: existing.status || "attended",
      note: existing.note || "",
      imported_from: LEGACY_QUEST_SOURCE_KEY,
    };
    importedCount += 1;
  }

  for (const [legacyId, note] of Object.entries(legacy.notes || {})) {
    const matchKey = mapping.get(legacyId);
    const game = matchKey ? gamesByLegacyKey.get(matchKey) : null;
    if (!game || !String(note || "").trim()) continue;
    const existing = getAttendanceEntry(game.game_pk);
    state.attendance[String(game.game_pk)] = {
      ...existing,
      status: existing.status || "planned",
      note: String(note),
      imported_from: LEGACY_QUEST_SOURCE_KEY,
    };
    if (!existing.status) {
      importedCount += 1;
    }
  }

  persistState();
  localStorage.setItem(LEGACY_IMPORT_KEY, new Date().toISOString());
  return { importedCount };
}

function wireEvents() {
  searchInput.value = state.view.search || "";
  searchInput.addEventListener("input", (event) => {
    state.view.search = event.target.value;
    persistState();
    renderMonths(schedulePayload.games);
  });

  document.querySelectorAll(".filter-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.view.filter = button.dataset.filter;
      persistState();
      applyFilterButtons();
      renderMonths(schedulePayload.games);
    });
  });

  monthsHost.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const gamePk = button.dataset.gamePk;
    if (!gamePk) return;
    if (button.dataset.action === "clear-status") {
      const existing = getAttendanceEntry(gamePk);
      setAttendanceEntry(gamePk, { status: null, note: existing.note || "" });
    } else if (button.dataset.action === "set-status") {
      const existing = getAttendanceEntry(gamePk);
      setAttendanceEntry(gamePk, { ...existing, status: button.dataset.status });
    }
    renderMonths(schedulePayload.games);
  });

  monthsHost.addEventListener("input", (event) => {
    const textarea = event.target.closest("[data-note-for]");
    if (!textarea) return;
    const gamePk = textarea.dataset.noteFor;
    const existing = getAttendanceEntry(gamePk);
    setAttendanceEntry(gamePk, { ...existing, note: textarea.value });
  });

  document.getElementById("export-state").addEventListener("click", exportState);
  document.getElementById("import-state").addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      importState(await file.text());
      renderMonths(schedulePayload.games);
    } catch (error) {
      console.error(error);
      alert(`Import failed: ${error.message}`);
    } finally {
      importFileInput.value = "";
    }
  });
}

async function init() {
  wireEvents();
  applyFilterButtons();
  try {
    const response = await fetch(SCHEDULE_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Schedule fetch failed with HTTP ${response.status}`);
    }
    schedulePayload = await response.json();
    const importResult = maybeImportLegacyState(schedulePayload.games);
    renderMigrationBanner(importResult);
    renderSpotlight(findCurrentOrNextGame(schedulePayload.games, new Date()));
    renderMonths(schedulePayload.games);
  } catch (error) {
    console.error(error);
    monthsHost.innerHTML = `<p class="schedule-empty">Could not load the canonical schedule data. ${escapeHtml(error.message || String(error))}</p>`;
  }
}

init();
