/* ============================================
   PHILLIES WIRE — INNINGS TIMELINE (client)
   Reads ../../archive.json for edition pointer,
   then ../../issues/<date>/data.json for linescore + plays.
   Persists filter state in localStorage (philliesWire_prefs).
   ============================================ */

import { applyPrefsToDocument, readPrefs, writePrefs } from "../../shared/phillies-prefs.mjs";
import { findCurrentOrNextGame } from "../../shared/phillies-schedule.mjs";

const ARCHIVE_URL = "../../archive.json";
const SCHEDULE_URL = "../../data/phillies-2026.json";

let prefs = readPrefs();
applyPrefsToDocument(prefs);

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
  const srList = slot("plays-sr");
  const count = slot("plays-count");
  if (!host) return;
  const plays = issueData?.sections?.game_status?.content?.plays;

  if (!Array.isArray(plays) || !plays.length) {
    renderPlaysEmpty(host, srList);
    if (count) count.textContent = "0 plays";
    return;
  }

  const filtered = prefs.inningsFilter === "scoring"
    ? plays.filter(p => p.is_scoring === true || p.event_type === "home_run")
    : plays;

  renderTimeline(host, filtered, plays);
  renderScreenReaderPlays(srList, filtered);

  if (count) count.textContent = `${filtered.length} of ${plays.length} plays`;
}

function renderPlaysEmpty(host, srList) {
  clearTimelineFocusHandlers(host);
  host.onmouseover = null;
  host.onmousemove = null;
  host.onmouseout = null;
  host.onclick = null;
  host.onfocusin = null;
  host.onfocusout = null;
  const p = document.createElement("p");
  p.className = "plays-empty";
  p.append("Per-play feed isn't yet populated by the crawler. The inning timeline will appear here once ");
  const code = document.createElement("code");
  code.textContent = "sections.game_status.content.plays";
  p.append(code, " lands in the data.json contract.");
  host.replaceChildren(p);
  if (srList) srList.replaceChildren();
}

const SVG_NS = "http://www.w3.org/2000/svg";
const TIMELINE = {
  inningWidth: 74,
  headerHeight: 42,
  lanePaddingY: 24,
  markerGap: 28,
  minLaneHeight: 132,
  totalsHeight: 34,
};

function renderTimeline(host, plays, allPlays) {
  const teams = orderedTimelineTeams(allPlays);
  const maxInning = Math.max(1, ...allPlays.map((p) => Number(p.inning)).filter(Number.isFinite));
  const maxPa = Math.max(1, ...teams.flatMap((team) =>
    Array.from({ length: maxInning }, (_, index) =>
      plays.filter((p) => p.team === team && Number(p.inning) === index + 1).length,
    ),
  ));
  const laneHeight = Math.max(TIMELINE.minLaneHeight, TIMELINE.lanePaddingY * 2 + (maxPa - 1) * TIMELINE.markerGap + 28);
  const width = maxInning * TIMELINE.inningWidth;
  const laneTop = TIMELINE.headerHeight;
  const totalsTop = laneTop + laneHeight * teams.length;
  const height = totalsTop + TIMELINE.totalsHeight;
  const totals = calculateInningRuns(allPlays, teams, maxInning);

  const wrap = document.createElement("div");
  wrap.className = "timeline-wrap";

  const gutter = document.createElement("div");
  gutter.className = "timeline-gutter";
  gutter.appendChild(divWithClass("timeline-gutter-head"));
  for (const team of teams) {
    const lane = divWithClass(`timeline-team-lane${team === "PHI" ? " is-phi" : ""}`);
    lane.style.height = `${laneHeight}px`;
    const abbr = divWithClass("timeline-team-abbr");
    abbr.textContent = team;
    const total = divWithClass("timeline-team-total");
    total.textContent = String(totals.teamTotals.get(team) ?? 0);
    lane.append(abbr, total);
    gutter.appendChild(lane);
  }
  const runLabel = divWithClass("timeline-run-label");
  runLabel.textContent = "R";
  gutter.appendChild(runLabel);

  const scroll = document.createElement("div");
  scroll.className = "timeline-scroll";

  const svg = createSvg("svg", {
    class: "timeline-svg",
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `Inning-by-inning timeline with ${plays.length} displayed plate appearances.`,
  });
  drawTimelineGrid(svg, { width, height, maxInning, teams, laneHeight, laneTop, totalsTop });
  drawTimelineMarkers(svg, { plays, teams, laneHeight, laneTop });
  drawTimelineTotals(svg, { teams, totals, maxInning, totalsTop });

  scroll.appendChild(svg);
  wrap.append(gutter, scroll);

  const tooltip = document.createElement("div");
  tooltip.className = "timeline-tooltip";
  tooltip.hidden = true;
  host.replaceChildren(wrap, tooltip);
  wireTimelineTooltip(host, tooltip);
}

function renderScreenReaderPlays(srList, plays) {
  if (!srList) return;
  srList.replaceChildren();
  for (const play of plays) {
    const li = document.createElement("li");
    li.textContent = `${play.team}, ${play.half === "top" ? "top" : "bottom"} ${play.inning}: ${play.actor}, ${eventLabel(play.event_type)} — ${play.detail}${play.score_after ? ` (${play.score_after})` : ""}`;
    srList.appendChild(li);
  }
}

function orderedTimelineTeams(plays) {
  const teams = Array.from(new Set(plays.map((p) => p.team).filter(Boolean)));
  const phillies = teams.includes("PHI") ? ["PHI"] : [];
  const others = teams.filter((team) => team !== "PHI").sort();
  return [...phillies, ...others].slice(0, 2);
}

function drawTimelineGrid(svg, { width, height, maxInning, teams, laneHeight, laneTop, totalsTop }) {
  for (let inning = 0; inning <= maxInning; inning++) {
    const x = inning * TIMELINE.inningWidth;
    svg.appendChild(createSvg("line", { x1: x, y1: laneTop, x2: x, y2: totalsTop, class: "timeline-grid-line" }));
  }
  teams.forEach((team, index) => {
    const y = laneTop + index * laneHeight;
    if (team === "PHI") {
      svg.appendChild(createSvg("rect", { x: 0, y, width, height: laneHeight, class: "timeline-phi-band" }));
    }
    svg.appendChild(createSvg("line", { x1: 0, y1: y, x2: width, y2: y, class: "timeline-lane-line" }));
  });
  svg.appendChild(createSvg("line", { x1: 0, y1: totalsTop, x2: width, y2: totalsTop, class: "timeline-total-line" }));
  for (let inning = 1; inning <= maxInning; inning++) {
    const text = createSvg("text", {
      x: inningCenter(inning),
      y: 27,
      class: "timeline-inning-label",
      "text-anchor": "middle",
    });
    text.textContent = String(inning);
    svg.appendChild(text);
  }
}

function drawTimelineMarkers(svg, { plays, teams, laneHeight, laneTop }) {
  const inningTeamCounts = new Map();
  for (const play of plays) {
    const teamIndex = Math.max(0, teams.indexOf(play.team));
    const key = `${play.team}:${play.inning}`;
    const index = inningTeamCounts.get(key) ?? 0;
    inningTeamCounts.set(key, index + 1);
    const x = inningCenter(play.inning);
    const y = laneTop + teamIndex * laneHeight + TIMELINE.lanePaddingY + index * TIMELINE.markerGap;
    const marker = createSvg("a", {
      class: `timeline-marker marker-${play.event_type}`,
      href: "#innings-timeline",
      tabindex: "0",
      focusable: "true",
      role: "img",
      "aria-label": `${play.team}, ${play.half} ${play.inning}: ${play.actor}. ${play.detail}`,
      "data-actor": play.actor,
      "data-detail": play.detail,
      "data-score": play.score_after || "",
    });
    drawMarkerGlyph(marker, play.event_type, x, y, play.team === "PHI");
    svg.appendChild(marker);
  }
}

function drawTimelineTotals(svg, { teams, totals, maxInning, totalsTop }) {
  teams.forEach((team, teamIndex) => {
    for (let inning = 1; inning <= maxInning; inning++) {
      const runs = totals.byTeamInning.get(`${team}:${inning}`) ?? 0;
      const text = createSvg("text", {
        x: inningCenter(inning),
        y: totalsTop + 14 + teamIndex * 16,
        class: runs > 0 ? "timeline-run has-run" : "timeline-run",
        "text-anchor": "middle",
      });
      text.textContent = String(runs);
      svg.appendChild(text);
    }
  });
}

function drawMarkerGlyph(marker, type, x, y, isPhillies) {
  const teamClass = isPhillies ? " is-phi" : " is-opp";
  switch (type) {
    case "home_run":
      marker.appendChild(createSvg("circle", { cx: x, cy: y, r: 12, class: "marker-ring" }));
      marker.appendChild(createSvg("polygon", { points: starPoints(x, y, 8), class: `marker-fill${teamClass}` }));
      return;
    case "extra_base_hit":
      marker.appendChild(createSvg("polygon", { points: `${x},${y - 8} ${x + 8},${y} ${x},${y + 8} ${x - 8},${y}`, class: `marker-fill${teamClass}` }));
      return;
    case "single":
      marker.appendChild(createSvg("circle", { cx: x, cy: y, r: 7, class: `marker-fill${teamClass}` }));
      return;
    case "walk_hbp":
      marker.appendChild(createSvg("circle", { cx: x, cy: y, r: 7, class: `marker-stroke${teamClass}` }));
      return;
    case "reached_on_error":
      marker.appendChild(createSvg("rect", { x: x - 7, y: y - 7, width: 14, height: 14, class: `marker-stroke${teamClass}` }));
      return;
    case "strikeout":
      marker.appendChild(createSvg("path", { d: `M${x - 7} ${y - 7} L${x + 7} ${y + 7} M${x + 7} ${y - 7} L${x - 7} ${y + 7}`, class: "marker-muted-stroke" }));
      return;
    case "out":
      marker.appendChild(createSvg("rect", { x: x - 8, y: y - 2, width: 16, height: 4, rx: 2, class: "marker-muted-fill" }));
      return;
    default:
      marker.appendChild(createSvg("circle", { cx: x, cy: y, r: 5, class: "marker-muted-fill" }));
  }
}

function calculateInningRuns(plays, teams, maxInning) {
  const byTeamInning = new Map();
  const teamTotals = new Map(teams.map((team) => [team, 0]));
  for (const play of plays) {
    if (!teams.includes(play.team)) continue;
    const key = `${play.team}:${play.inning}`;
    const previous = byTeamInning.get(key) ?? 0;
    const runs = Number(play.runs) || 0;
    byTeamInning.set(key, previous + runs);
    teamTotals.set(play.team, (teamTotals.get(play.team) ?? 0) + runs);
  }
  for (const team of teams) {
    for (let inning = 1; inning <= maxInning; inning++) {
      const key = `${team}:${inning}`;
      if (!byTeamInning.has(key)) byTeamInning.set(key, 0);
    }
  }
  return { byTeamInning, teamTotals };
}

function wireTimelineTooltip(host, tooltip) {
  clearTimelineFocusHandlers(host);
  host.onmouseover = (event) => {
    const marker = event.target.closest(".timeline-marker");
    if (marker) showTimelineTooltip(marker, tooltip, event.clientX, event.clientY);
  };
  host.onmousemove = (event) => {
    const marker = event.target.closest(".timeline-marker");
    if (marker && !tooltip.hidden) positionTimelineTooltip(tooltip, event.clientX, event.clientY);
  };
  host.onmouseout = (event) => {
    if (event.target.closest(".timeline-marker")) hideTimelineTooltip(tooltip);
  };
  host.onclick = (event) => {
    if (event.target.closest(".timeline-marker")) event.preventDefault();
  };
  const focusHandler = (event) => {
    const marker = event.target.closest(".timeline-marker");
    if (!marker) return;
    const bounds = marker.getBoundingClientRect();
    showTimelineTooltip(marker, tooltip, bounds.left + bounds.width / 2, bounds.top);
  };
  const blurHandler = () => hideTimelineTooltip(tooltip);
  host.addEventListener("focus", focusHandler, true);
  host.addEventListener("blur", blurHandler, true);
  host.__timelineFocusHandlers = { focusHandler, blurHandler };
}

function clearTimelineFocusHandlers(host) {
  const handlers = host.__timelineFocusHandlers;
  if (!handlers) return;
  host.removeEventListener("focus", handlers.focusHandler, true);
  host.removeEventListener("blur", handlers.blurHandler, true);
  host.__timelineFocusHandlers = null;
}

function showTimelineTooltip(marker, tooltip, x, y) {
  tooltip.replaceChildren();
  const actor = document.createElement("strong");
  actor.textContent = marker.dataset.actor || "Play";
  const detail = document.createElement("span");
  detail.textContent = marker.dataset.detail || "";
  const score = document.createElement("em");
  score.textContent = marker.dataset.score || "";
  tooltip.append(actor, detail, score);
  tooltip.hidden = false;
  positionTimelineTooltip(tooltip, x, y);
}

function positionTimelineTooltip(tooltip, x, y) {
  const bounds = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.min(x + 14, window.innerWidth - bounds.width - 8)}px`;
  tooltip.style.top = `${Math.max(8, y - bounds.height - 12)}px`;
}

function hideTimelineTooltip(tooltip) {
  tooltip.hidden = true;
}

function createSvg(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function divWithClass(className) {
  const node = document.createElement("div");
  node.className = className;
  return node;
}

function inningCenter(inning) {
  return (Number(inning) - 0.5) * TIMELINE.inningWidth;
}

function starPoints(cx, cy, radius) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    points.push(`${(cx + Math.cos(angle) * r).toFixed(1)},${(cy + Math.sin(angle) * r).toFixed(1)}`);
  }
  return points.join(" ");
}

function eventLabel(type) {
  switch (type) {
    case "home_run": return "Home run";
    case "extra_base_hit": return "Extra-base hit";
    case "single": return "Single";
    case "walk_hbp": return "Walk / HBP";
    case "reached_on_error": return "Reached on error";
    case "strikeout": return "Strikeout";
    case "out": return "Out";
    default: return "Other";
  }
}

/**
 * At-bat card. Expected data contract (when populated by enrich.mjs):
 *   gs.situation = {
 *     batter: { name: "Bryce Harper", meta: "1B · L · 4-1 .312/.421/.598" },
 *     pitches: ["B","S","S","B","F","X"],         // ordered from first pitch
 *     count:   { balls: 1, strikes: 2, outs: 1 },
 *     bases:   { first: true, second: false, third: true },
 *     status:  "Now"                               // pill label
 *   }
 * Hidden entirely when not present (pregame/final/off_day).
 */
function renderAtBat(latestEntry, issueData) {
  const card = slot("atbat-card");
  if (!card) return;
  const mode = latestEntry?.mode || issueData?.hero?.mode;
  const situation = issueData?.sections?.game_status?.content?.situation;
  if (mode !== "live" || !situation) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  setText("atbat-pill", situation.status || "Now");
  setText("batter-name", situation.batter?.name || "—");
  setText("batter-meta", situation.batter?.meta || "");

  // Pitch sequence — up to the current at-bat. Kinds: B(all)/S(trike)/F(oul)/X(contact).
  const seq = slot("pitch-seq");
  if (seq) {
    const pitches = Array.isArray(situation.pitches) ? situation.pitches : [];
    if (!pitches.length) {
      seq.innerHTML = '<span class="pitch-seq-empty">No pitches yet this at-bat.</span>';
    } else {
      seq.innerHTML = pitches
        .map((p) => `<span class="pitch" data-kind="${escapeHtml(p)}" role="listitem">${escapeHtml(p)}</span>`)
        .join("");
    }
  }

  // Bases — light up occupied bags on the diamond.
  const diamond = slot("diamond");
  if (diamond) {
    const bases = situation.bases || {};
    diamond.querySelectorAll(".base").forEach((node) => {
      const key = node.getAttribute("data-base");
      node.setAttribute("data-on", bases[key] ? "true" : "false");
    });
  }

  // Count — fill dots. Balls ≤ 3, Strikes ≤ 2, Outs ≤ 3.
  const count = situation.count || {};
  paintDots("count-balls",   3, count.balls   || 0, "ball");
  paintDots("count-strikes", 2, count.strikes || 0, "strike");
  paintDots("count-outs",    3, count.outs    || 0, "out");
}

function paintDots(slotName, total, on, kind) {
  const host = slot(slotName);
  if (!host) return;
  host.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("div");
    dot.className = "count-dot";
    dot.setAttribute("data-kind", kind);
    dot.setAttribute("data-on", i < on ? "true" : "false");
    host.appendChild(dot);
  }
}

function wireFilter() {
  // Set pressed state from persisted pref.
  els(".filter-btn").forEach(btn => {
    btn.setAttribute("aria-pressed", btn.dataset.filter === prefs.inningsFilter ? "true" : "false");
    btn.addEventListener("click", () => {
      prefs.inningsFilter = btn.dataset.filter;
      els(".filter-btn").forEach(b => b.setAttribute("aria-pressed", b.dataset.filter === prefs.inningsFilter ? "true" : "false"));
      prefs = writePrefs(prefs);
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

async function fetchSchedule() {
  try {
    const response = await fetch(SCHEDULE_URL, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function init() {
  wireFilter();
  try {
    const [res, schedulePayload] = await Promise.all([
      fetch(ARCHIVE_URL, { cache: "no-store" }),
      fetchSchedule(),
    ]);
    if (!res.ok) throw new Error(`archive.json HTTP ${res.status}`);
    const archive = await res.json();
    const entries = Array.isArray(archive.entries) ? archive.entries : [];
    const pointer = schedulePayload?.games ? findCurrentOrNextGame(schedulePayload.games, new Date()) : null;
    const scheduleGame = pointer?.current_game || pointer?.latest_completed_game || pointer?.next_game || null;
    const target = (scheduleGame && entries.find((entry) => entry.date === scheduleGame.official_date))
      || entries.find((entry) => entry.mode === "final")
      || entries[0];
    if (!target) {
      setText("matchup-head", "No issues published yet");
      return;
    }
    const issueData = await fetchIssueData(target.date);
    window.__currentIssueData = issueData;
    renderMatchup(target, issueData);
    renderLinescore(target, issueData);
    renderAtBat(target, issueData);
    renderPlays(issueData);
  } catch (e) {
    console.error(e);
    setText("matchup-head", "Couldn't load archive.json");
    setText("matchup-detail", e?.message || String(e));
  }
}

init();
