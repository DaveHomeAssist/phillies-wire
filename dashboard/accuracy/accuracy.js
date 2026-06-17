/* ============================================================
   PHILLIES WIRE — ACCURACY (client)
   Hydrates the fact-check scorecard from accuracy.json.
   Mirrors the dashboard hydration pattern: fetch a JSON
   contract, build the DOM defensively (no innerHTML on data),
   and honour theme / reduced-data prefs.
   ============================================================ */

import { applyPrefsToDocument, readPrefs } from "../../shared/phillies-prefs.mjs";

const VERDICTS = new Set(["accurate", "inaccurate", "unverifiable"]);
const RELEVANCY = new Set(["current", "outdated", "misleading"]);

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
    const report = await loadReport();
    render(report);
  } catch (error) {
    setState(`Could not load the fact-check report (${error.message}). View the raw data at accuracy.json.`, "error");
  }
}

async function loadReport() {
  const res = await fetch("./accuracy.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data || typeof data !== "object" || !data.summary || !Array.isArray(data.sections)) {
    throw new Error("malformed report");
  }
  return data;
}

function render(report) {
  const summary = report.summary || {};
  const editionLabel = report.edition_label || "";
  const editionDate = report.edition_date || "";
  const checkedAt = formatTimestamp(report.generated_at);

  // Topbar + crumbs + footer
  const crumbs = [editionLabel, editionDate].filter(Boolean).join(" · ") || "Fact-check of today's edition";
  setText("crumbs", checkedAt ? `${crumbs} · checked ${checkedAt} ET` : crumbs);
  setText("foot-edition", editionDate || "—");

  // Summary
  setText("summary-edition", editionDate || "—");
  setText("summary-headline", summary.headline || "Fact-check complete.");
  renderStats(summary);
  renderRelevancy(summary.relevancy || {});
  setText("method", report.method || "");

  // Grade chip — share of verifiable claims confirmed accurate.
  renderGrade(summary);

  // Highlights
  renderHighlights(report.highlights || []);

  // Sections
  renderSections(report.sections || []);

  // Sources
  renderSources(report.sources || []);

  // Legend
  renderLegend(report.verdict_legend || {}, report.relevancy_legend || {});

  // Reveal
  const state = slot("state");
  if (state) state.hidden = true;
  const node = slot("report");
  if (node) node.hidden = false;
}

function renderStats(summary) {
  const host = slot("summary-stats");
  if (!host) return;
  host.replaceChildren();
  const cells = [
    { label: "Claims checked", value: summary.total_claims, tone: "" },
    { label: "Accurate", value: summary.accurate, tone: "good" },
    { label: "Inaccurate", value: summary.inaccurate, tone: "bad" },
    { label: "Unverifiable", value: summary.unverifiable, tone: "warn" },
  ];
  for (const cell of cells) {
    const tile = el("div", "acc-stat");
    if (cell.tone) tile.dataset.tone = cell.tone;
    tile.setAttribute("role", "listitem");
    tile.append(
      el("span", "acc-stat-value", numberOrDash(cell.value)),
      el("span", "acc-stat-label", cell.label),
    );
    host.append(tile);
  }
}

function renderRelevancy(rel) {
  const host = slot("summary-relevancy");
  if (!host) return;
  host.replaceChildren();
  const order = [
    ["Current", rel.current],
    ["Outdated", rel.outdated],
    ["Misleading", rel.misleading],
  ];
  for (const [label, value] of order) {
    if (value == null) continue;
    const pill = el("span", "acc-rel-pill");
    const strong = el("b", "", numberOrDash(value));
    pill.append(strong, document.createTextNode(` ${label}`));
    host.append(pill);
  }
}

function renderGrade(summary) {
  const node = slot("grade");
  if (!node) return;
  const accurate = Number(summary.accurate) || 0;
  const inaccurate = Number(summary.inaccurate) || 0;
  const verifiable = accurate + inaccurate;
  if (!verifiable) return;
  const pct = Math.round((accurate / verifiable) * 100);
  node.textContent = `${pct}% verified`;
  node.dataset.tone = inaccurate > 0 ? "bad" : "good";
  node.title = `${accurate} of ${verifiable} verifiable claims confirmed accurate`;
  node.hidden = false;
}

function renderHighlights(highlights) {
  const card = slot("highlights-card");
  const host = slot("highlights");
  if (!card || !host) return;
  if (!highlights.length) {
    card.hidden = true;
    return;
  }
  host.replaceChildren();
  for (const item of highlights) {
    const row = el("div", "acc-highlight");
    if (item.tone === "warn") row.dataset.tone = "warn";
    const mark = el("span", "acc-highlight-mark");
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = item.tone === "warn" ? "?" : "✓";
    const body = el("div", "acc-highlight-body");
    body.append(el("div", "acc-highlight-title", item.title || ""));
    if (item.detail) body.append(el("div", "acc-highlight-detail", item.detail));
    row.append(mark, body);
    host.append(row);
  }
  card.hidden = false;
}

function renderSections(sections) {
  const host = slot("sections");
  if (!host) return;
  host.replaceChildren();
  for (const section of sections) {
    const items = Array.isArray(section.items) ? section.items : [];
    const card = el("article", "acc-card acc-section");

    const head = el("div", "acc-section-title");
    head.append(
      el("span", "acc-section-name", section.title || "Section"),
      el("span", "acc-section-tally", tally(items)),
    );

    const list = el("div", "acc-items");
    for (const item of items) list.append(renderItem(item));

    card.append(head, list);
    host.append(card);
  }
}

function renderItem(item) {
  const verdict = VERDICTS.has(item.verdict) ? item.verdict : "unverifiable";
  const rel = RELEVANCY.has(item.relevancy) ? item.relevancy : "current";

  const row = el("div", "acc-item");
  row.dataset.verdict = verdict;

  const rail = el("span", "acc-item-rail");
  rail.setAttribute("aria-hidden", "true");

  const body = el("div", "acc-item-body");
  body.append(el("div", "acc-item-claim", item.claim || ""));

  const badges = el("div", "acc-item-badges");
  const vBadge = el("span", "acc-badge", verdict);
  vBadge.dataset.verdict = verdict;
  const rBadge = el("span", "acc-badge", rel);
  rBadge.dataset.rel = rel;
  badges.append(vBadge, rBadge);
  body.append(badges);

  if (item.note) body.append(el("p", "acc-item-note", item.note));

  row.append(rail, body);
  return row;
}

function renderSources(sources) {
  const card = slot("sources-card");
  const host = slot("sources");
  if (!card || !host) return;
  if (!sources.length) {
    card.hidden = true;
    return;
  }
  setText("sources-count", String(sources.length));
  host.replaceChildren();
  for (const source of sources) {
    const li = el("li", "acc-source-item");
    const safe = safeUrl(source.url);
    if (safe) {
      const a = el("a", "", source.label || safe);
      a.href = safe;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.append(a, withHost(safe));
    } else {
      li.append(el("span", "", source.label || ""));
    }
    host.append(li);
  }
  card.hidden = false;
}

function renderLegend(verdictLegend, relevancyLegend) {
  const host = slot("legend");
  if (!host) return;
  host.replaceChildren();
  const verdicts = ["accurate", "inaccurate", "unverifiable"];
  for (const key of verdicts) {
    if (!verdictLegend[key]) continue;
    host.append(legendItem(key, key, verdictLegend[key]));
  }
  for (const key of ["current", "outdated", "misleading"]) {
    if (!relevancyLegend[key]) continue;
    host.append(legendItem(null, key, relevancyLegend[key]));
  }
}

function legendItem(verdictTone, term, definition) {
  const row = el("div", "acc-legend-item");
  const swatch = el("span", "acc-legend-swatch");
  if (verdictTone) swatch.dataset.verdict = verdictTone;
  swatch.setAttribute("aria-hidden", "true");
  const text = el("div", "acc-legend-text");
  text.append(el("div", "acc-legend-term", capitalize(term)), el("div", "acc-legend-def", definition));
  row.append(swatch, text);
  return row;
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

function tally(items) {
  const counts = { accurate: 0, inaccurate: 0, unverifiable: 0 };
  for (const item of items) {
    const v = VERDICTS.has(item.verdict) ? item.verdict : "unverifiable";
    counts[v] += 1;
  }
  const parts = [];
  if (counts.accurate) parts.push(`${counts.accurate} ✓`);
  if (counts.inaccurate) parts.push(`${counts.inaccurate} ✗`);
  if (counts.unverifiable) parts.push(`${counts.unverifiable} ?`);
  return parts.join("  ");
}

function numberOrDash(value) {
  return value == null || value === "" ? "—" : String(value);
}

function capitalize(text) {
  const s = String(text || "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function safeUrl(url) {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function withHost(url) {
  const span = el("span", "acc-source-host");
  try {
    span.textContent = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    span.textContent = "";
  }
  return span;
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
