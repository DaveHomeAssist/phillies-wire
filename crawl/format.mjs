export {
  buildBroadcastLine,
  buildFreshnessLabel,
  buildSeriesContext,
  buildWindSummary,
  deriveMode,
  deriveModeLabel,
  formatGameTime,
  formatGeneratedAtEt,
  formatMonthDay,
  formatShortDate,
  formatWeekday,
  getIsoDate,
  getRelativeIsoDate,
  isFinalGame,
  normalizeGamesBack,
  weatherCodeToText,
};

function normalizeGamesBack(value) {
  if (value == null) {
    return "\u2014";
  }
  const trimmed = String(value).trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "\u2013" || trimmed === "\u2014" || trimmed === "0.0") {
    return "\u2014";
  }
  return trimmed;
}

function buildWindSummary(weather) {
  const rawSpeed = weather?.wind_speed_10m;
  if (rawSpeed == null) {
    return "Calm";
  }
  const speed = Math.round(rawSpeed);
  const gusts = Math.round(weather.wind_gusts_10m ?? 0);
  if (!speed && !gusts) {
    return "Calm";
  }
  return gusts ? `${speed} mph · gusts ${gusts}` : `${speed} mph`;
}

function buildBroadcastLine(broadcast) {
  return [broadcast.tv, broadcast.stream, broadcast.radio].filter(Boolean).join(" · ");
}

function buildSeriesContext(seriesLabel) {
  if (!seriesLabel) {
    return "";
  }
  return `Series: ${seriesLabel}.`;
}

function deriveMode(game) {
  const state = game?.status?.abstractGameState;
  if (state === "Final") {
    return "final";
  }
  if (state === "Live") {
    return "live";
  }
  return "pregame";
}

function deriveModeLabel(game) {
  const mode = deriveMode(game);
  if (mode === "final") {
    return "Final";
  }
  if (mode === "live") {
    return "Live";
  }
  return "Pregame";
}

function weatherCodeToText(code) {
  const map = new Map([
    [0, "Clear"],
    [1, "Mostly sunny"],
    [2, "Partly cloudy"],
    [3, "Overcast"],
    [45, "Fog"],
    [48, "Freezing fog"],
    [51, "Light drizzle"],
    [53, "Drizzle"],
    [55, "Heavy drizzle"],
    [61, "Light rain"],
    [63, "Rain"],
    [65, "Heavy rain"],
    [71, "Light snow"],
    [73, "Snow"],
    [75, "Heavy snow"],
    [80, "Rain showers"],
    [81, "Heavy showers"],
    [95, "Thunderstorms"],
  ]);
  return map.get(code);
}

function isFinalGame(game) {
  return ["Final", "Game Over"].includes(game?.status?.detailedState);
}

function getIsoDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getRelativeIsoDate(offsetDays) {
  const todayEt = getIsoDate(new Date());
  const [year, month, day] = todayEt.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() + offsetDays);
  return getIsoDate(anchor);
}

function formatGameTime(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function formatShortDate(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(isoString));
}

function formatMonthDay(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  }).format(new Date(isoString));
}

function formatWeekday(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(new Date(isoString));
}

function formatGeneratedAtEt(isoString) {
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString))} ET`;
}

function buildFreshnessLabel(prefix, isoString) {
  if (!prefix || !isoString) {
    return "";
  }
  return `${prefix} ${formatGeneratedAtEt(isoString)}`;
}
