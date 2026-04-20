/* ============================================
   PHILLIES WIRE — COMMAND CENTER (client)
   Reads archive.json from the repo root.
   Hydrates hero, activity feed, record, next, key events.
   Anticipates user intent via localStorage + save-data detection.
   ============================================ */

const ARCHIVE_URL = "../archive.json";

// ── Preferences & session signals (zero-backend, zero tracking) ──
const LS_PREFS = "philliesWire_prefs";
const LS_SIGNALS = "philliesWire_sessionSignals";

const Prefs = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    } catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

const defaultPrefs = {
  theme: "dark",
  lastVisit: null,
  streakAlertThreshold: 3,
  reducedData: false,
};
const defaultSignals = {
  visitCount: 0,
  mostViewedPanel: null,
  lastMode: null,
};

let prefs = Prefs.read(LS_PREFS, defaultPrefs);
let signals = Prefs.read(LS_SIGNALS, defaultSignals);

// Save-data detection — honour slow connections / user intent
const saveDataActive =
  prefs.reducedData === true ||
  (navigator.connection && (
    navigator.connection.saveData === true ||
    ["slow-2g", "2g"].includes(navigator.connection.effectiveType)
  ));
if (saveDataActive) document.documentElement.dataset.saveData = "true";

// First-visit + return-visit signals
signals.visitCount = (signals.visitCount || 0) + 1;
document.documentElement.dataset.visitKind =
  signals.visitCount === 1 ? "first" : "return";

// Persist on unload, not on every tick
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persist();
});
window.addEventListener("beforeunload", persist);

function persist() {
  prefs.lastVisit = new Date().toISOString();
  Prefs.write(LS_PREFS, prefs);
  Prefs.write(LS_SIGNALS, signals);
}

const el = (sel, scope = document) => scope.querySelector(sel);
const els = (sel, scope = document) => [...scope.querySelectorAll(sel)];

const slot = (name, scope = document) => el(`[data-slot="${name}"]`, scope);
const setText = (name, text, scope = document) => {
  const node = slot(name, scope);
  if (node) node.textContent = text;
};

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}

function fmtDateShort(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch { return iso; }
}

function parseScore(headline) {
  // "PHI 2, ATL 4." or "PHI 0, ATL 9."
  if (!headline) return null;
  const m = headline.match(/PHI\s+(\d+)\s*,\s*([A-Z]{2,4})\s+(\d+)/i);
  if (!m) return null;
  return { phi: parseInt(m[1], 10), oppAbbr: m[2].toUpperCase(), opp: parseInt(m[3], 10) };
}

const TEAM_NAMES = {
  ATL: "Braves", NYM: "Mets", WSH: "Nationals", MIA: "Marlins",
  CHC: "Cubs", STL: "Cardinals", CIN: "Reds", PIT: "Pirates", MIL: "Brewers",
  LAD: "Dodgers", SF: "Giants", SD: "Padres", COL: "Rockies", ARI: "Diamondbacks",
  NYY: "Yankees", BOS: "Red Sox", TOR: "Blue Jays", BAL: "Orioles", TB: "Rays",
  CLE: "Guardians", CWS: "White Sox", DET: "Tigers", KC: "Royals", MIN: "Twins",
  HOU: "Astros", SEA: "Mariners", TEX: "Rangers", OAK: "Athletics", LAA: "Angels",
};

function teamName(abbr) {
  return TEAM_NAMES[abbr] || abbr || "Opponent";
}

function renderHero(latest) {
  const heroCard = document.querySelector('[data-card="hero"]');
  const status = el(".card-status", heroCard);
  status.textContent = (latest.mode_label || latest.mode || "—");
  status.setAttribute("data-mode", latest.mode || "");

  // Time-aware emphasis — pregame and live get visual weight on hero.
  const stage = heroCard.closest(".stage") || document.body;
  stage.dataset.mode = latest.mode || "unknown";
  heroCard.dataset.emphasis = (latest.mode === "pregame" || latest.mode === "live") ? "true" : "false";
  signals.lastMode = latest.mode;

  const score = parseScore(latest.headline);
  if (score) {
    setText("phi-runs", String(score.phi));
    setText("opp-runs", String(score.opp));
    setText("opp-abbr", score.oppAbbr);
    setText("opp-name", teamName(score.oppAbbr));
    const initial = el('[data-slot="opp-initial"]');
    if (initial) initial.textContent = score.oppAbbr[0];
  } else {
    setText("phi-runs", "—");
    setText("opp-runs", "—");
    setText("opp-abbr", "—");
    setText("opp-name", latest.mode === "pregame" ? "TBD" : "—");
    const initial = el('[data-slot="opp-initial"]');
    if (initial) initial.textContent = "?";
  }

  setText("headline", latest.headline || "Latest edition");
  setText("dek", latest.dek || latest.summary || "");
  setText("updated", fmtDate(latest.generated_at || latest.updated_at));
  setText("edition", latest.edition != null ? `Vol. ${latest.volume} Ed. ${latest.edition}` : "—");
}

function renderNextGame(entries) {
  // Look for the most recent pregame entry to populate next-game-ish info.
  const pregame = entries.find(e => e.mode === "pregame");
  const host = slot("next");
  if (!host) return;
  if (!pregame) return;
  host.innerHTML = `
    <p class="next-matchup">${pregame.headline || "Upcoming"}</p>
    <p class="next-meta">${pregame.dek || ""}</p>
    <p class="next-meta">${fmtDateShort(pregame.date)}</p>
  `;
}

function computeRecord(entries) {
  // Walk finals in date order, count W/L from scores, and streak.
  const finals = entries
    .filter(e => e.mode === "final" && typeof e.headline === "string")
    .map(e => ({ ...e, _score: parseScore(e.headline) }))
    .filter(e => e._score);
  // archive.json is newest-first. Reverse for chronological.
  const chron = [...finals].reverse();
  let wins = 0, losses = 0;
  for (const g of chron) { g._score.phi > g._score.opp ? wins++ : losses++; }
  // Streak from most recent backwards.
  let streak = 0, streakKind = "";
  for (const g of finals) {
    const won = g._score.phi > g._score.opp;
    if (streakKind === "") { streakKind = won ? "W" : "L"; streak = 1; continue; }
    if ((streakKind === "W") === won) streak++;
    else break;
  }
  return { wins, losses, streak, streakKind, finalsCount: finals.length };
}

function renderRecord(entries) {
  const rec = computeRecord(entries);
  setText("wins", String(rec.wins));
  setText("losses", String(rec.losses));
  setText("streak", rec.streakKind ? `${rec.streakKind}${rec.streak}` : "—");
  const status = el('[data-card="record"] .card-status');
  if (status) status.textContent = `${rec.finalsCount} finals`;

  // L3+ streak alert — one-time pulse on mount
  const recordCard = el('[data-card="record"]');
  if (recordCard) {
    const isLosingStreak = rec.streakKind === "L" && rec.streak >= 3;
    recordCard.dataset.streakAlert = isLosingStreak ? "true" : "false";
  }

  // Streak strip — last 10 finals, newest → oldest (left → right).
  const strip = slot("streak-strip");
  if (strip) {
    strip.innerHTML = "";
    const finals = entries
      .filter(e => e.mode === "final" && typeof e.headline === "string")
      .map(e => ({ ...e, _score: parseScore(e.headline) }))
      .filter(e => e._score)
      .slice(0, 10);
    for (const g of finals) {
      const won = g._score.phi > g._score.opp;
      const dot = document.createElement("div");
      dot.className = "streak-dot";
      dot.setAttribute("data-result", won ? "W" : "L");
      dot.setAttribute("title", `${fmtDateShort(g.date)}: PHI ${g._score.phi} – ${g._score.oppAbbr} ${g._score.opp}`);
      strip.appendChild(dot);
    }
  }
}

function renderActivity(entries) {
  const host = slot("activity");
  if (!host) return;
  host.innerHTML = "";
  for (const e of entries.slice(0, 10)) {
    const li = document.createElement("li");
    li.className = "activity-row";
    li.innerHTML = `
      <div class="activity-date">${fmtDateShort(e.date)}</div>
      <div class="activity-main">
        <div class="activity-headline">${escapeHtml(e.headline || "Untitled")}</div>
        <div class="activity-dek">${escapeHtml(e.dek || e.summary || "")}</div>
      </div>
      <span class="activity-mode" data-mode="${e.mode || ""}">${e.mode_label || e.mode || ""}</span>
    `;
    host.appendChild(li);
  }
  if (!entries.length) {
    host.innerHTML = '<li class="activity-empty">No entries yet.</li>';
  }
}

function renderKeyEvents(entries) {
  // Until per-issue highlight data is exposed, surface a digest of the last 5 finals
  // with W/L colour so mixed stretches read at a glance.
  const host = slot("key");
  if (!host) return;
  const finals = entries.filter(e => e.mode === "final").slice(0, 5);
  if (!finals.length) {
    host.innerHTML = '<li class="key-empty">No final-mode entries yet this season.</li>';
    return;
  }
  host.innerHTML = "";
  for (const e of finals) {
    const li = document.createElement("li");
    li.className = "key-row";
    const score = parseScore(e.headline);
    const won = score && score.phi > score.opp;
    const result = score ? (won ? "W" : "L") : "·";
    const cls = score ? (won ? "key-win" : "key-loss") : "";
    li.innerHTML = `
      <div class="key-date">${fmtDateShort(e.date)}</div>
      <div class="key-text"><span class="key-badge ${cls}">${result}</span> ${escapeHtml(e.headline || "")} <span class="key-dek">${escapeHtml(e.dek || "")}</span></div>
    `;
    host.appendChild(li);
  }

  // Update the key-status pill with the W/L breakdown so it's obvious when
  // a stretch is lopsided — prevents "filter defaulting to losses" confusion.
  const wins   = finals.filter(e => { const s = parseScore(e.headline); return s && s.phi > s.opp; }).length;
  const losses = finals.length - wins;
  const statusPill = el('[data-slot="key-status"]');
  if (statusPill) statusPill.textContent = `${wins}W · ${losses}L (last ${finals.length})`;
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderEmptyState(error) {
  setText("headline", "Couldn't load archive.json");
  setText("dek", error && error.message ? error.message : String(error));
  setText("updated", "—");
}

async function init() {
  try {
    const res = await fetch(ARCHIVE_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`archive.json HTTP ${res.status}`);
    const archive = await res.json();
    const entries = Array.isArray(archive.entries) ? archive.entries : [];
    if (!entries.length) {
      renderEmptyState(new Error("archive.json has no entries"));
      return;
    }
    renderHero(entries[0]);
    renderNextGame(entries);
    renderRecord(entries);
    renderActivity(entries);
    renderKeyEvents(entries);
  } catch (e) {
    console.error(e);
    renderEmptyState(e);
  }
}

init();
