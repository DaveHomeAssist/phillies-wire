/* ============================================
   PHILLIES WIRE — COMMAND CENTER (client)
   Reads archive.json from the repo root.
   Hydrates hero, activity feed, record, next, key events.
   ============================================ */

const ARCHIVE_URL = "../archive.json";

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
  // Until the crawler exposes per-issue highlights, surface a digest of the last 5 finals.
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
    const result = score ? (score.phi > score.opp ? "W" : "L") : "·";
    li.innerHTML = `
      <div class="key-date">${fmtDateShort(e.date)}</div>
      <div class="key-text"><strong>${result}</strong> &middot; ${escapeHtml(e.headline || "")} &middot; ${escapeHtml(e.dek || "")}</div>
    `;
    host.appendChild(li);
  }
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
