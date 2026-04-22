export const PREFS_KEY = "philliesWire_prefs";
export const SIGNALS_KEY = "philliesWire_sessionSignals";
export const SCHEDULE_STATE_KEY = "philliesWire_scheduleState";
export const SCHEDULE_IMPORT_KEY = "philliesWire_scheduleImport_v1";
export const ISSUE_THEME_KEY = "pw-theme";
export const LOCAL_BUNDLE_SCHEMA_VERSION = "1.0.0";

export const defaultPrefs = Object.freeze({
  theme: "dark",
  lastVisit: null,
  streakAlertThreshold: 3,
  reducedData: false,
  inningsFilter: "all",
});

export const defaultSignals = Object.freeze({
  visitCount: 0,
  mostViewedPanel: null,
  lastMode: null,
});

export const defaultScheduleState = Object.freeze({
  version: 1,
  view: {
    filter: "all",
    search: "",
  },
  attendance: {},
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...clone(fallback), ...JSON.parse(raw) } : clone(fallback);
  } catch {
    return clone(fallback);
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function normalizeTheme(value) {
  return value === "light" ? "light" : "dark";
}

export function readStoredIssueTheme() {
  try {
    return normalizeTheme(localStorage.getItem(ISSUE_THEME_KEY));
  } catch {
    return "dark";
  }
}

export function writeStoredIssueTheme(value) {
  try {
    localStorage.setItem(ISSUE_THEME_KEY, normalizeTheme(value));
  } catch {}
}

export function readPrefs() {
  const prefs = readJson(PREFS_KEY, defaultPrefs);
  prefs.theme = normalizeTheme(prefs.theme || readStoredIssueTheme());
  return prefs;
}

export function writePrefs(value = {}) {
  const next = { ...clone(defaultPrefs), ...value };
  next.theme = normalizeTheme(next.theme);
  writeStoredIssueTheme(next.theme);
  writeJson(PREFS_KEY, next);
  return next;
}

export function readSignals() {
  return readJson(SIGNALS_KEY, defaultSignals);
}

export function writeSignals(value = {}) {
  const next = { ...clone(defaultSignals), ...value };
  writeJson(SIGNALS_KEY, next);
  return next;
}

export function readScheduleState() {
  const state = readJson(SCHEDULE_STATE_KEY, defaultScheduleState);
  state.view = { ...clone(defaultScheduleState.view), ...(state.view || {}) };
  state.attendance = state.attendance && typeof state.attendance === "object" ? state.attendance : {};
  return state;
}

export function writeScheduleState(value = {}) {
  const next = {
    ...clone(defaultScheduleState),
    ...value,
    view: { ...clone(defaultScheduleState.view), ...(value.view || {}) },
    attendance: value.attendance && typeof value.attendance === "object" ? value.attendance : {},
  };
  writeJson(SCHEDULE_STATE_KEY, next);
  return next;
}

export function readScheduleImportMarker() {
  try {
    return localStorage.getItem(SCHEDULE_IMPORT_KEY);
  } catch {
    return null;
  }
}

export function buildLocalBundle() {
  return {
    schema_version: LOCAL_BUNDLE_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    issue_theme: readStoredIssueTheme(),
    prefs: readPrefs(),
    signals: readSignals(),
    schedule_state: readScheduleState(),
    schedule_imported_at: readScheduleImportMarker(),
  };
}

export function importLocalBundle(payload = {}) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Local bundle must be an object.");
  }
  if (payload.schema_version !== LOCAL_BUNDLE_SCHEMA_VERSION) {
    throw new Error(`Unsupported local bundle schema: ${payload.schema_version || "unknown"}`);
  }
  const prefs = writePrefs(payload.prefs || {});
  const signals = writeSignals(payload.signals || {});
  const scheduleState = writeScheduleState(payload.schedule_state || {});
  if (payload.issue_theme) {
    writeStoredIssueTheme(payload.issue_theme);
  }
  return { prefs, signals, scheduleState };
}

export function clearLocalBundle() {
  try {
    localStorage.removeItem(PREFS_KEY);
    localStorage.removeItem(SIGNALS_KEY);
    localStorage.removeItem(SCHEDULE_STATE_KEY);
    localStorage.removeItem(SCHEDULE_IMPORT_KEY);
    localStorage.removeItem(ISSUE_THEME_KEY);
  } catch {}
}

export function summarizeAttendance(state = readScheduleState()) {
  const entries = Object.values(state.attendance || {});
  return {
    total: entries.length,
    attended: entries.filter((entry) => entry.status === "attended").length,
    planned: entries.filter((entry) => entry.status === "planned").length,
    skipped: entries.filter((entry) => entry.status === "skipped").length,
  };
}
