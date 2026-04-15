// Phillies Wire — single source of truth for hardcoded constants
// Import from here instead of inlining new string literals.

export const TEAM_ID = 143;

export const VENUE = {
  name: "Citizens Bank Park",
  lat: 39.906,
  lon: -75.166,
};

export const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";

export const WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${VENUE.lat}&longitude=${VENUE.lon}&current=temperature_2m,wind_speed_10m,wind_gusts_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph`;

export const SCHEMA_VERSION = "1.2.0";

export const CLAUDE_MODEL = process.env.ENRICH_MODEL?.trim() || "claude-sonnet-4-5";

export const CLAUDE_MAX_TOKENS = Number(process.env.ENRICH_MAX_TOKENS || 4000);

// HTTP fetch timeout for live data sources (MLB / Open-Meteo).
// Kept tight so a stalled endpoint cannot block the cron cycle.
export const FETCH_TIMEOUT_MS = 10_000;
