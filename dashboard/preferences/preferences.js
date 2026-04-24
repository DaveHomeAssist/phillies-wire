/* ============================================================
   PHILLIES WIRE — PREFERENCES (client)
   Tabbed local-settings surface. Writes to the shared prefs
   keys in localStorage via shared/phillies-prefs.mjs.
   ============================================================ */

import {
  applyPrefsToDocument,
  buildLocalBundle,
  clearLocalBundle,
  defaultPrefs,
  importLocalBundle,
  readPrefs,
  readScheduleImportMarker,
  readScheduleState,
  readSignals,
  summarizeAttendance,
  writePrefs,
} from "../../shared/phillies-prefs.mjs";

const byId  = (id)  => document.getElementById(id);
const slot  = (name) => document.querySelector(`[data-slot="${name}"]`);
const slots = (name) => [...document.querySelectorAll(`[data-slot="${name}"]`)];

let prefs = readPrefs();
let signals = readSignals();
let scheduleState = readScheduleState();

applyPrefsToDocument(prefs);

// ── Tabs ────────────────────────────────────────────────────
const tabs = [...document.querySelectorAll(".prefs-tab")];
const panels = [...document.querySelectorAll(".pref-section[data-panel]")];

function showTab(id) {
  tabs.forEach((t) => {
    const active = t.dataset.tab === id;
    t.classList.toggle("is-active", active);
    t.setAttribute("aria-selected", active ? "true" : "false");
  });
  panels.forEach((p) => {
    p.hidden = p.dataset.panel !== id;
  });
}

tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

// ── Text inputs ─────────────────────────────────────────────
function wireText(id, key) {
  const node = byId(id);
  if (!node) return;
  node.value = prefs[key] || "";
  node.addEventListener("change", () => {
    persist({ [key]: node.value.trim() });
    setStatus(`${labelFor(key)} saved.`, "success");
  });
}

// ── Segmented controls ──────────────────────────────────────
function wireSeg(prefKey) {
  const btns = [...document.querySelectorAll(`.pref-seg-btn[data-pref="${prefKey}"]`)];
  if (!btns.length) return;
  const paint = () => {
    btns.forEach((b) => b.classList.toggle("is-active", b.dataset.value === String(prefs[prefKey])));
  };
  paint();
  btns.forEach((b) =>
    b.addEventListener("click", () => {
      persist({ [prefKey]: b.dataset.value });
      paint();
      setStatus(`${labelFor(prefKey)} set to ${b.textContent.trim()}.`, "success");
    }),
  );
}

// ── Accent swatches ─────────────────────────────────────────
function wireSwatches() {
  const btns = [...document.querySelectorAll(".pref-swatch")];
  const paint = () => {
    btns.forEach((b) => b.classList.toggle("is-active", b.dataset.value.toLowerCase() === String(prefs.accent || "").toLowerCase()));
  };
  paint();
  btns.forEach((b) =>
    b.addEventListener("click", () => {
      persist({ accent: b.dataset.value });
      paint();
      setStatus(`Accent updated.`, "success");
    }),
  );
}

// ── Toggle (aria-switch button) ─────────────────────────────
function wireToggle(id, key) {
  const node = byId(id);
  if (!node) return;
  const paint = () => node.setAttribute("aria-checked", prefs[key] ? "true" : "false");
  paint();
  node.addEventListener("click", () => {
    persist({ [key]: !prefs[key] });
    paint();
    setStatus(`${labelFor(key)} ${prefs[key] ? "on" : "off"}.`, "success");
  });
}

// ── Streak threshold range ──────────────────────────────────
function wireStreak() {
  const range = byId("pref-streak-threshold");
  const val   = slot("streak-threshold-value");
  if (!range) return;
  range.value = String(prefs.streakAlertThreshold || 3);
  if (val) val.textContent = `L${prefs.streakAlertThreshold || 3}`;
  range.addEventListener("input", () => {
    if (val) val.textContent = `L${range.value}`;
  });
  range.addEventListener("change", () => {
    persist({ streakAlertThreshold: Number(range.value) || 3 });
    setStatus(`Streak alert threshold saved.`, "success");
  });
}

// ── Innings default filter ──────────────────────────────────
function wireSelect(id, key) {
  const node = byId(id);
  if (!node) return;
  node.value = prefs[key] || "";
  node.addEventListener("change", () => {
    persist({ [key]: node.value });
    setStatus(`${labelFor(key)} saved.`, "success");
  });
}

// ── Local data ──────────────────────────────────────────────
function renderSummary() {
  const a = summarizeAttendance(scheduleState);
  setText("visit-count",    String(signals.visitCount || 0));
  setText("last-mode",      signals.lastMode || "—");
  setText("last-visit",     formatDate(prefs.lastVisit));
  setText("attended-count", String(a.attended));
  setText("planned-count",  String(a.planned));
  setText("skipped-count",  String(a.skipped));
  setText("imported-at",    readScheduleImportMarker() ? formatDate(readScheduleImportMarker()) : "No");
}

function renderTabMeta() {
  setText("tab-meta-name",   prefs.displayName || "Set your display name");
  setText("tab-meta-handle", prefs.handle ? prefs.handle : "no handle set");
}

function downloadBundle() {
  const payload = buildLocalBundle();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `phillies-wire-local-bundle-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus("Exported local bundle.", "success");
}

async function importBundle(file) {
  if (!file) return;
  const text = await file.text();
  importLocalBundle(JSON.parse(text));
  prefs = readPrefs();
  signals = readSignals();
  scheduleState = readScheduleState();
  applyPrefsToDocument(prefs);
  renderAll();
  setStatus("Imported local bundle.", "success");
}

function resetLocal() {
  if (!window.confirm("Reset local Phillies Wire preferences and schedule state on this browser?")) return;
  clearLocalBundle();
  prefs = readPrefs();
  signals = readSignals();
  scheduleState = readScheduleState();
  applyPrefsToDocument(prefs);
  renderAll();
  setStatus("Local Phillies Wire data reset.", "success");
}

// "Reset all" in the topbar = same as Reset local for this surface.
byId("pref-reset")?.addEventListener("click", resetLocal);
byId("pref-reset-local")?.addEventListener("click", resetLocal);

byId("pref-export")?.addEventListener("click", downloadBundle);
byId("pref-import")?.addEventListener("click", () => byId("pref-import-file")?.click());
byId("pref-import-file")?.addEventListener("change", async (e) => {
  try {
    await importBundle(e.target.files?.[0]);
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Import failed.", "error");
  } finally {
    e.target.value = "";
  }
});

// ── Helpers ─────────────────────────────────────────────────
function persist(patch) {
  prefs = writePrefs({ ...prefs, ...patch });
  applyPrefsToDocument(prefs);
  renderTabMeta();
}

function setText(name, value) {
  slots(name).forEach((n) => {
    if (n) n.textContent = value;
  });
}

function setStatus(message, tone = "quiet") {
  const node = slot("status-copy");
  if (!node) return;
  node.textContent = message;
  node.dataset.tone = tone;
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function labelFor(key) {
  const labels = {
    displayName: "Display name",
    handle: "Handle",
    theme: "Theme",
    density: "Density",
    feedStyle: "Feed style",
    accent: "Accent",
    inningsFilter: "Default innings filter",
    reducedData: "Reduced data mode",
  };
  return labels[key] || key;
}

function renderAll() {
  // Text inputs don't auto-update post-import; set their values by hand.
  const nameInput = byId("pref-display-name");
  if (nameInput) nameInput.value = prefs.displayName || "";
  const handleInput = byId("pref-handle");
  if (handleInput) handleInput.value = prefs.handle || "";
  const filter = byId("pref-innings-filter");
  if (filter) filter.value = prefs.inningsFilter || "all";
  const range = byId("pref-streak-threshold");
  if (range) range.value = String(prefs.streakAlertThreshold || 3);
  const rangeVal = slot("streak-threshold-value");
  if (rangeVal) rangeVal.textContent = `L${prefs.streakAlertThreshold || 3}`;
  const reduced = byId("pref-reduced-data");
  if (reduced) reduced.setAttribute("aria-checked", prefs.reducedData ? "true" : "false");
  // Repaint seg/swatch active states by re-running their wire fns' paint step.
  [..."theme density feedStyle".split(" ")].forEach(wireSegRefresh);
  wireSwatchRefresh();
  renderSummary();
  renderTabMeta();
}

function wireSegRefresh(prefKey) {
  [...document.querySelectorAll(`.pref-seg-btn[data-pref="${prefKey}"]`)].forEach((b) => {
    b.classList.toggle("is-active", b.dataset.value === String(prefs[prefKey]));
  });
}
function wireSwatchRefresh() {
  [...document.querySelectorAll(".pref-swatch")].forEach((b) => {
    b.classList.toggle("is-active", b.dataset.value.toLowerCase() === String(prefs.accent || "").toLowerCase());
  });
}

// ── Boot ────────────────────────────────────────────────────
wireText("pref-display-name", "displayName");
wireText("pref-handle", "handle");
wireSeg("theme");
wireSeg("density");
wireSeg("feedStyle");
wireSwatches();
wireSelect("pref-innings-filter", "inningsFilter");
wireStreak();
wireToggle("pref-reduced-data", "reducedData");
renderSummary();
renderTabMeta();
showTab("profile");

// Export defaults for devtools spot-checks.
window.__PW_DEFAULT_PREFS__ = defaultPrefs;
