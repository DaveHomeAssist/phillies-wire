/* ============================================================
   PHILLIES WIRE — SEASON AT A GLANCE (client)
   Derives a whole-season summary from the canonical schedule
   artifact (data/phillies-2026.json) entirely on the client.
   Mirrors the dashboard hydration pattern: fetch a JSON
   contract, build the DOM defensively (no innerHTML on data),
   and honour theme / reduced-data prefs.
   ============================================================ */

import { applyPrefsToDocument, readPrefs } from "../../shared/phillies-prefs.mjs";
import { formatEtDateLabel } from "../../shared/phillies-schedule.mjs";

const SCHEDULE_URL = "../../data/phillies-2026.json";

const slot = (name) => document.querySelector(`[data-slot="${name}"]`);

// Carry the user's theme/accent over from the rest of the dashboard, and
// respect reduced-data the same way the Command Center does.
const prefs = readPrefs();
applyPrefsToDocument(prefs);
if (prefs.reducedData || navigator.connection?.saveData) {
  document.documentElement.dataset.saveData = "true";
}

boot();

async function boot() {
  try {
    const payload = await loadSchedule();
    render(payload);
  } catch (error) {
    setState(`Could not load the season schedule (${error.message}). View the raw data at phillies-2026.json.`, "error");
  }
}

async function loadSchedule() {
  const res = await fetch(SCHEDULE_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data || typeof data !== "object" || !Array.isArray(data.games)) {
    throw new Error("malformed schedule");
  }
  return data;
}

// ── Derivation ──────────────────────────────────────────────
function isFinal(game) {
  const result = game?.result;
  const score = game?.score;
  return (result === "W" || result === "L")
    && score
    && Number.isFinite(score.phillies)
    && Number.isFinite(score.opponent);
}

function chronological(games) {
  return [...games].sort((a, b) => {
    const da = a.official_date || "";
    const db = b.official_date || "";
    if (da !== db) return da < db ? -1 : 1;
    return (a.game_pk || 0) - (b.game_pk || 0);
  });
}

function splitRecord(games, predicate) {
  let wins = 0, losses = 0;
  for (const g of games) {
    if (!predicate(g)) continue;
    if (g.result === "W") wins += 1; else losses += 1;
  }
  return { wins, losses };
}

function longestRun(games, kind) {
  let best = 0, run = 0;
  for (const g of games) {
    if (g.result === kind) { run += 1; best = Math.max(best, run); }
    else run = 0;
  }
  return best;
}

function currentStreak(chron) {
  let kind = "", count = 0;
  for (let i = chron.length - 1; i >= 0; i -= 1) {
    const r = chron[i].result;
    if (kind === "") { kind = r; count = 1; continue; }
    if (r === kind) count += 1; else break;
  }
  return { kind, count };
}

function deriveSeason(payload) {
  const games = Array.isArray(payload.games) ? payload.games : [];
  const finals = chronological(games.filter(isFinal));

  const wins = finals.filter((g) => g.result === "W").length;
  const losses = finals.length - wins;

  // Authoritative record from the latest final's league_record when present
  // (handles any ties / suspended games the naive count would miss).
  const latest = finals[finals.length - 1];
  const official = latest?.phillies?.league_record;
  const recWins = Number.isFinite(official?.wins) ? official.wins : wins;
  const recLosses = Number.isFinite(official?.losses) ? official.losses : losses;
  const recDecisions = recWins + recLosses;
  const winPct = recDecisions ? recWins / recDecisions : 0;

  let runsFor = 0, runsAgainst = 0;
  for (const g of finals) {
    runsFor += g.score.phillies;
    runsAgainst += g.score.opponent;
  }

  const last10 = finals.slice(-10);
  const streak = currentStreak(finals);

  const splits = {
    home: splitRecord(finals, (g) => g.home_game === true),
    away: splitRecord(finals, (g) => g.home_game === false),
    division: splitRecord(finals, (g) => Array.isArray(g.tags) && g.tags.includes("division")),
    day: splitRecord(finals, (g) => g.day_night === "day"),
    night: splitRecord(finals, (g) => g.day_night === "night"),
    oneRun: splitRecord(finals, (g) => Math.abs(g.score.phillies - g.score.opponent) === 1),
    last10: splitRecord(last10, () => true),
  };

  // Per-month W-L
  const monthMap = new Map();
  for (const g of finals) {
    const key = (g.official_date || "").slice(0, 7);
    if (!key) continue;
    if (!monthMap.has(key)) monthMap.set(key, { wins: 0, losses: 0 });
    const bucket = monthMap.get(key);
    if (g.result === "W") bucket.wins += 1; else bucket.losses += 1;
  }
  const months = [...monthMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, rec]) => ({ key, ...rec }));

  const totalGames = Number.isFinite(payload?.summary?.total_games) ? payload.summary.total_games : games.length;
  // The first playable game after the last completed one. Deriving from the
  // last final (rather than wall-clock or the canonical "current" pointer)
  // keeps "Up Next" sane even when a postponed game sits at the frontier.
  const lastPlayed = latest?.official_date || "";
  const next = chronological(games).find((g) =>
    (g.official_date || "") > lastPlayed && g.status?.detailed !== "Postponed",
  ) || null;

  return {
    season: payload.season || 2026,
    generatedAt: payload.generated_at || "",
    played: finals.length,
    totalGames,
    record: { wins: recWins, losses: recLosses, winPct },
    runsFor,
    runsAgainst,
    runDiff: runsFor - runsAgainst,
    streak,
    longestWin: longestRun(finals, "W"),
    longestLoss: longestRun(finals, "L"),
    last10: last10.map((g) => g.result),
    splits,
    months,
    next,
  };
}

// ── Render ──────────────────────────────────────────────────
function render(payload) {
  const s = deriveSeason(payload);

  setText("crumbs", `${s.season} regular season · ${s.played} of ${s.totalGames} games played`);
  setText("foot-generated", s.generatedAt ? `Updated ${formatTimestamp(s.generatedAt)} ET` : "—");

  // Record chip in the topbar
  const chip = slot("record-chip");
  if (chip) {
    chip.textContent = `${s.record.wins}–${s.record.losses}`;
    chip.dataset.tone = s.record.wins >= s.record.losses ? "good" : "bad";
    chip.hidden = false;
  }

  renderKpis(s);
  renderSplits(s.splits);
  renderForm(s.last10, s.streak);
  renderRuns(s);
  renderMonths(s.months);
  renderNext(s.next);

  const state = slot("state");
  if (state) state.hidden = true;
  const report = slot("report");
  if (report) report.hidden = false;
}

function renderKpis(s) {
  const host = slot("kpis");
  if (!host) return;
  host.replaceChildren();

  const pctLabel = `.${String(Math.round(s.record.winPct * 1000)).padStart(3, "0")}`;
  const diffLabel = `${s.runDiff > 0 ? "+" : ""}${s.runDiff}`;
  const streakLabel = s.streak.kind ? `${s.streak.kind}${s.streak.count}` : "—";
  const remaining = Math.max(0, s.totalGames - s.played);

  const cells = [
    { label: "Record", value: `${s.record.wins}–${s.record.losses}`, tone: s.record.wins >= s.record.losses ? "good" : "bad" },
    { label: "Win %", value: pctLabel, tone: "" },
    { label: "Run Diff", value: diffLabel, tone: s.runDiff > 0 ? "good" : s.runDiff < 0 ? "bad" : "" },
    { label: "Streak", value: streakLabel, tone: s.streak.kind === "W" ? "good" : s.streak.kind === "L" ? "bad" : "" },
    { label: "Games Played", value: `${s.played}`, sub: `${remaining} to play`, tone: "" },
    { label: "Last 10", value: `${s.splits.last10.wins}–${s.splits.last10.losses}`, tone: "" },
  ];

  for (const cell of cells) {
    const tile = el("div", "kpi-tile");
    if (cell.tone) tile.dataset.tone = cell.tone;
    tile.setAttribute("role", "listitem");
    tile.append(
      el("span", "kpi-value", cell.value),
      el("span", "kpi-label", cell.label),
    );
    if (cell.sub) tile.append(el("span", "kpi-sub", cell.sub));
    host.append(tile);
  }
}

function renderSplits(splits) {
  const host = slot("splits");
  if (!host) return;
  host.replaceChildren();
  const rows = [
    { label: "Home", rec: splits.home },
    { label: "Away", rec: splits.away },
    { label: "vs NL East", rec: splits.division },
    { label: "Day games", rec: splits.day },
    { label: "Night games", rec: splits.night },
    { label: "One-run games", rec: splits.oneRun },
  ];
  for (const { label, rec } of rows) {
    const total = rec.wins + rec.losses;
    const pct = total ? Math.round((rec.wins / total) * 100) : 0;
    const row = el("div", "split-row");

    row.append(el("span", "split-label", label));

    const bar = el("div", "split-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", `${rec.wins} wins, ${rec.losses} losses`);
    const fill = el("span", "split-bar-fill");
    fill.style.width = `${pct}%`;
    if (total && rec.wins < rec.losses) fill.dataset.tone = "bad";
    bar.append(fill);
    row.append(bar);

    row.append(el("span", "split-rec", total ? `${rec.wins}–${rec.losses}` : "—"));
    host.append(row);
  }
}

function renderForm(results, streak) {
  const host = slot("form-strip");
  if (host) {
    host.replaceChildren();
    if (!results.length) {
      host.append(el("span", "form-empty", "No games played yet."));
    } else {
      results.forEach((result, i) => {
        const dot = el("span", "form-dot");
        dot.dataset.result = result;
        dot.title = `Game ${i + 1} of last ${results.length}: ${result === "W" ? "Win" : "Loss"}`;
        dot.textContent = result;
        host.append(dot);
      });
    }
  }
  setText("streak-now", streak.kind ? `${streak.kind === "W" ? "Won" : "Lost"} ${streak.count} straight` : "—");
}

function renderRuns(s) {
  const host = slot("runs");
  if (!host) return;
  host.replaceChildren();
  const perGame = (total) => (s.played ? (total / s.played).toFixed(2) : "—");
  const cells = [
    { label: "Runs Scored", value: String(s.runsFor), sub: `${perGame(s.runsFor)} / game` },
    { label: "Runs Allowed", value: String(s.runsAgainst), sub: `${perGame(s.runsAgainst)} / game` },
    { label: "Longest Win Streak", value: s.longestWin ? `W${s.longestWin}` : "—", sub: "season best" },
    { label: "Longest Skid", value: s.longestLoss ? `L${s.longestLoss}` : "—", sub: "season worst" },
  ];
  for (const cell of cells) {
    const tile = el("div", "run-tile");
    tile.append(
      el("span", "run-value", cell.value),
      el("span", "run-label", cell.label),
      el("span", "run-sub", cell.sub),
    );
    host.append(tile);
  }
}

function renderMonths(months) {
  const host = slot("months");
  if (!host) return;
  host.replaceChildren();
  if (!months.length) {
    host.append(el("p", "month-empty", "No completed games to break down yet."));
    return;
  }
  const peak = months.reduce((m, x) => Math.max(m, x.wins + x.losses), 0) || 1;
  for (const month of months) {
    const total = month.wins + month.losses;
    const row = el("div", "month-row");
    row.append(el("span", "month-name", monthLabel(month.key)));

    const track = el("div", "month-track");
    const winBar = el("span", "month-seg month-win");
    winBar.style.width = `${(month.wins / peak) * 100}%`;
    const lossBar = el("span", "month-seg month-loss");
    lossBar.style.width = `${(month.losses / peak) * 100}%`;
    track.append(winBar, lossBar);
    row.append(track);

    row.append(el("span", "month-rec", `${month.wins}–${month.losses}`));
    host.append(row);
  }
}

function renderNext(game) {
  const host = slot("next");
  if (!host) return;
  host.replaceChildren();
  if (!game) {
    host.append(el("p", "next-empty", "No upcoming game on the schedule."));
    return;
  }
  const matchup = game.home_game
    ? `PHI vs ${game.opponent?.abbr || "—"}`
    : `PHI @ ${game.opponent?.abbr || "—"}`;
  host.append(el("div", "next-matchup", matchup));
  const when = [game.date_label || formatEtDateLabel(game.game_date), game.time_label]
    .filter(Boolean)
    .join(" · ");
  if (when) host.append(el("div", "next-meta", when));
  if (game.venue?.name) host.append(el("div", "next-meta", game.venue.name));
}

// ── Helpers ─────────────────────────────────────────────────
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setText(name, value) {
  const node = slot(name);
  if (node) node.textContent = value;
}

function setState(message, tone) {
  const node = slot("state");
  if (!node) return;
  node.hidden = false;
  node.textContent = message;
  if (tone) node.dataset.tone = tone;
  const report = slot("report");
  if (report) report.hidden = true;
}

function monthLabel(key) {
  const [year, month] = String(key).split("-");
  const idx = Number(month) - 1;
  const names = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return names[idx] ? `${names[idx]} ${year}` : key;
}

function formatTimestamp(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}
