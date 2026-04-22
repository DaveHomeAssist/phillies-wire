import {
  buildLocalBundle,
  clearLocalBundle,
  importLocalBundle,
  readPrefs,
  readScheduleImportMarker,
  readScheduleState,
  readSignals,
  summarizeAttendance,
  writePrefs,
} from "../../shared/phillies-prefs.mjs";

const form = {
  theme: document.getElementById("pref-theme"),
  reducedData: document.getElementById("pref-reduced-data"),
  streakThreshold: document.getElementById("pref-streak-threshold"),
  inningsFilter: document.getElementById("pref-innings-filter"),
  exportButton: document.getElementById("pref-export"),
  importButton: document.getElementById("pref-import"),
  resetButton: document.getElementById("pref-reset"),
  importFile: document.getElementById("pref-import-file"),
};

let prefs = readPrefs();
let signals = readSignals();
let scheduleState = readScheduleState();

function slot(name) {
  return document.querySelector(`[data-slot="${name}"]`);
}

function setText(name, value) {
  const node = slot(name);
  if (node) node.textContent = value;
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function renderForm() {
  form.theme.value = prefs.theme || "dark";
  form.reducedData.checked = prefs.reducedData === true;
  form.streakThreshold.value = String(prefs.streakAlertThreshold || 3);
  form.inningsFilter.value = prefs.inningsFilter || "all";
  setText("streak-threshold-value", `L${prefs.streakAlertThreshold || 3}`);
}

function renderSummary() {
  const attendance = summarizeAttendance(scheduleState);
  setText("visit-count", String(signals.visitCount || 0));
  setText("last-mode", signals.lastMode || "—");
  setText("last-visit", formatDate(prefs.lastVisit));
  setText("attended-count", String(attendance.attended));
  setText("planned-count", String(attendance.planned));
  setText("skipped-count", String(attendance.skipped));
  setText("imported-at", readScheduleImportMarker() ? formatDate(readScheduleImportMarker()) : "No");
}

function setStatus(message, tone = "quiet") {
  const node = slot("status-copy");
  if (!node) return;
  node.textContent = message;
  node.dataset.tone = tone;
}

function persistPrefs(patch) {
  prefs = writePrefs({ ...prefs, ...patch });
  renderForm();
  renderSummary();
}

function downloadBundle() {
  const payload = buildLocalBundle();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `phillies-wire-local-bundle-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Exported local bundle.", "success");
}

async function importBundle(file) {
  if (!file) return;
  const text = await file.text();
  const payload = JSON.parse(text);
  importLocalBundle(payload);
  prefs = readPrefs();
  signals = readSignals();
  scheduleState = readScheduleState();
  renderForm();
  renderSummary();
  setStatus("Imported local bundle.", "success");
}

function resetBundle() {
  if (!window.confirm("Reset local Phillies Wire preferences and schedule state on this browser?")) {
    return;
  }
  clearLocalBundle();
  prefs = readPrefs();
  signals = readSignals();
  scheduleState = readScheduleState();
  renderForm();
  renderSummary();
  setStatus("Local Phillies Wire data reset.", "success");
}

function wireForm() {
  form.theme.addEventListener("change", () => {
    persistPrefs({ theme: form.theme.value });
    setStatus("Issue theme saved.");
  });

  form.reducedData.addEventListener("change", () => {
    persistPrefs({ reducedData: form.reducedData.checked });
    setStatus("Reduced data preference saved.");
  });

  form.streakThreshold.addEventListener("input", () => {
    setText("streak-threshold-value", `L${form.streakThreshold.value}`);
  });

  form.streakThreshold.addEventListener("change", () => {
    persistPrefs({ streakAlertThreshold: Number(form.streakThreshold.value) || 3 });
    setStatus("Streak alert threshold saved.");
  });

  form.inningsFilter.addEventListener("change", () => {
    persistPrefs({ inningsFilter: form.inningsFilter.value });
    setStatus("Default innings filter saved.");
  });

  form.exportButton.addEventListener("click", downloadBundle);
  form.importButton.addEventListener("click", () => form.importFile.click());
  form.importFile.addEventListener("change", async (event) => {
    try {
      await importBundle(event.target.files?.[0]);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Import failed.", "error");
    } finally {
      form.importFile.value = "";
    }
  });
  form.resetButton.addEventListener("click", resetBundle);
}

renderForm();
renderSummary();
wireForm();
