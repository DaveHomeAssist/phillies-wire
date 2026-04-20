/* ============================================
   PHILLIES WIRE — INNINGS TIMELINE (client)
   Reads ../../archive.json for edition pointer,
   then ../../issues/<date>/data.json for linescore + plays.
   Persists filter state in localStorage (philliesWire_prefs).
   ============================================ */

const ARCHIVE_URL = "../../archive.json";

const LS_PREFS = "philliesWire_prefs";
const Prefs = {
  read(fallback) {
    try {
      const raw = localStorage.getItem(LS_PREFS);
      return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    } catch { return fallback; }
  },
  write(value) {
    try { localStorage.setItem(LS_PREFS, JSON.stringify(value)); } catch {}
  },
};

let prefs = Prefs.read({ inningsFilter: "all" });

const el  = (sel, scope = document) => scope.querySelector(sel);
const els = (sel, scope = document) => [...scope.querySelectorAll(sel)];
const slot = (name, scope = document) => el(`[data-slot="${name}"]`, scope);
const setText = (name, text) => { const n = slot(name); if (n) n.textContent = text ?? "—"; };

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const TEAM_NAMES = {
  ATL: "Braves", NYM: "Mets", WSH: "Nationals", MIA: "Marlins",
  CHC: "Cubs", STL: "Cardinals", CIN: "Reds", PIT: "Pirates", MIL: "Brewers",
  LAD: "Dodgers", SF: "Giants", SD: "Padres", COL: "Rockies", ARI: "Diamondbacks",
  NYY: "Yankees", BOS: "Red Sox", TOR: "Blue Jays", BAL: "Orioles", TB: "Rays",
  CLE: "Guardians", CWS: "White Sox", DET: "Tigers", KC: "Royals", MIN: "Twins",
  HOU: "Astros", SEA: "Mariners", TEX: "Rangers", OAK: "Athletics", LAA: "Angels",
};

function parseScoreFromHeadline(headline) {
  if (!headline) return null;
  const m = headline.match(/PHI\s+(\d+)\s*,\s*([A-Z]{2,4})\s+(\d+)/i);
  return m ? { phi: +m[1], opp: +m[3], oppAbbr: m[2].toUpperCase() } : null;
}

function renderMatchup(latestEntry, issueData) {
  const head = issueData?.hero?.headline || latestEntry?.headline || "Loading…";
  const dek  = issueData?.hero?.dek || latestEntry?.dek || latestEntry?.summary || "";
  setText("matchup-head", head);
  setText("matchup-detail", dek);

  const modeSlot = slot("matchup-mode");
  if (modeSlot) {
    const modeLabel = issueData?.hero?.label || latestEntry?.mode_label || latestEntry?.mode || "—";
    modeSlot.textContent = modeLabel;
    modeSlot.setAttribute("data-mode", latestEntry?.mode || issueData?.hero?.mode || "");
  }

  setText("edition", latestEntry?.edition != null ? `Vol. ${latestEntry.volume} Ed. ${latestEntry.edition}` : "—");
}

function renderLinescore(latestEntry, issueData) {
  const awayRow = slot("line-away");
  const homeRow = slot("line-home");
  if (!awayRow || !homeRow) return;

  const score = parseScoreFromHeadline(latestEntry?.headline);
  const oppAbbr = score?.oppAbbr || "OPP";
  const awayName = el('[data-slot="line-away-abbr"]');
  const homeName = el('[data-slot="line-home-abbr"]');
  if (awayName) awayName.textContent = oppAbbr;
  if (homeName) homeName.textContent = "PHI";

  const linescore = issueData?.sections?.game_status?.content?.linescore || null;

  // Try to use a structured `linescore.innings` if present; otherwise fall back
  // to R/H/E totals from the final headline only.
  const homeCells = awayRow.querySelectorAll("td");   // 9 inning cells + R/H/E
  const homeRowCells = homeRow.querySelectorAll("td");

  function writeInning(row, idx, value) {
    const cell = row.querySelectorAll("td")[idx];
    if (!cell) return;
    cell.textContent = value ?? "—";
    cell.classList.remove("has-run", "high-run");
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) cell.classList.add("has-run");
    if (Number.isFinite(n) && n >= 4) cell.classList.add("high-run");
  }

  function writeTotals(row, r, h, e) {
    const cells = row.querySelectorAll("td");
    const totals = [r, h, e];
    for (let i = 0; i < 3; i++) {
      const cell = cells[9 + i];
      if (cell) cell.textContent = totals[i] ?? "—";
    }
  }

  // Clear any prior "current-inning" highlight on reload.
  els(".current-inning").forEach(n => n.classList.remove("current-inning"));

  // Path 1: full linescore with inning arrays.
  if (linescore?.innings && Array.isArray(linescore.innings)) {
    linescore.innings.slice(0, 9).forEach((inn, i) => {
      writeInning(awayRow, i, inn?.away?.runs ?? inn?.away ?? "—");
      writeInning(homeRow, i, inn?.home?.runs ?? inn?.home ?? "—");
    });
    writeTotals(awayRow, linescore.teams?.away?.runs, linescore.teams?.away?.hits, linescore.teams?.away?.errors);
    writeTotals(homeRow, linescore.teams?.home?.runs, linescore.teams?.home?.hits, linescore.teams?.home?.errors);
    if (Number.isFinite(linescore.currentInning)) {
      const idx = Math.min(linescore.currentInning - 1, 8);
      (linescore.isTopInning ? awayRow : homeRow).querySelectorAll("td")[idx]?.classList.add("current-inning");
    }
    setText("linescore-note", `Sourced from sections.game_status.content.linescore`);
    return;
  }

  // Path 2: totals only (from parsed headline of a final).
  if (score) {
    // Spread unknown per-inning runs as "—" and fill R from the final score.
    for (let i = 0; i < 9; i++) {
      writeInning(awayRow, i, "—");
      writeInning(homeRow, i, "—");
    }
    writeTotals(awayRow, score.opp, "—", "—");
    writeTotals(homeRow, score.phi, "—", "—");
    setText("linescore-note", "Totals parsed from headline. Per-inning runs require linescore in data.json (v1.5 target).");
    return;
  }

  // Path 3: no score yet (pregame / off-day).
  for (let i = 0; i < 9; i++) {
    writeInning(awayRow, i, "—");
    writeInning(homeRow, i, "—");
  }
  writeTotals(awayRow, "—", "—", "—");
  writeTotals(homeRow, "—", "—", "—");
  setText("linescore-note", "No linescore yet — game hasn't started (or today is an off day).");
}

function renderPlays(issueData) {
  const host = slot("plays");
  const count = slot("plays-count");
  if (!host) return;
  const plays = issueData?.sections?.game_status?.content?.plays;

  if (!Array.isArray(plays) || !plays.length) {
    // Keep the existing "empty" message from HTML — crawler doesn't populate plays yet.
    if (count) count.textContent = "0 plays";
    return;
  }

  const filtered = prefs.inningsFilter === "scoring"
    ? plays.filter(p => p.event_type === "score_change" || p.event_type === "home_run")
    : plays;

  host.innerHTML = "";
  for (const p of filtered.slice(0, 30)) {
    const li = document.createElement("li");
    li.className = "play-row";
    li.setAttribute("data-event", p.event_type || "other");
    li.innerHTML = `
      <div class="play-inning">${p.half === "top" ? "▲" : "▼"} ${p.inning ?? "·"}</div>
      <div class="play-marker">${markerFor(p.event_type)}</div>
      <div>
        <div class="play-text">${escapeHtml(p.detail || p.description || "—")}</div>
        ${p.actor ? `<div class="play-actor">${escapeHtml(p.actor)}</div>` : ""}
      </div>
      <div class="play-actor">${escapeHtml(p.score_after || "")}</div>
    `;
    host.appendChild(li);
  }

  if (count) count.textContent = `${filtered.length} of ${plays.length} plays`;
}

function markerFor(type) {
  switch (type) {
    case "score_change": return '<span class="marker marker-score" aria-label="Score change"></span>';
    case "home_run":     return '<span class="marker marker-hr" aria-label="Home run"></span>';
    case "key_play":     return '<span class="marker marker-key" aria-label="Key play"></span>';
    case "strikeout":    return '<span class="marker marker-k" aria-hidden="true"></span>';
    default:             return '<span class="marker" style="background:var(--dash-ink-quiet)"></span>';
  }
}

function wireFilter() {
  // Set pressed state from persisted pref.
  els(".filter-btn").forEach(btn => {
    btn.setAttribute("aria-pressed", btn.dataset.filter === prefs.inningsFilter ? "true" : "false");
    btn.addEventListener("click", () => {
      prefs.inningsFilter = btn.dataset.filter;
      els(".filter-btn").forEach(b => b.setAttribute("aria-pressed", b.dataset.filter === prefs.inningsFilter ? "true" : "false"));
      Prefs.write(prefs);
      // Re-render plays only — linescore is filter-agnostic.
      if (window.__currentIssueData) renderPlays(window.__currentIssueData);
    });
  });
}

async function fetchIssueData(date) {
  if (!date) return null;
  try {
    const r = await fetch(`../../issues/${date}/data.json`, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function init() {
  wireFilter();
  try {
    const res = await fetch(ARCHIVE_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`archive.json HTTP ${res.status}`);
    const archive = await res.json();
    const entries = Array.isArray(archive.entries) ? archive.entries : [];
    // Prefer the most recent final (gives a real score) over today's pregame.
    const target = entries.find(e => e.mode === "final") || entries[0];
    if (!target) {
      setText("matchup-head", "No issues published yet");
      return;
    }
    const issueData = await fetchIssueData(target.date);
    window.__currentIssueData = issueData;
    renderMatchup(target, issueData);
    renderLinescore(target, issueData);
    renderPlays(issueData);
  } catch (e) {
    console.error(e);
    setText("matchup-head", "Couldn't load archive.json");
    setText("matchup-detail", e?.message || String(e));
  }
}

init();
