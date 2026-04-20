import { WEATHER_URL } from "../../config.mjs";

export { fetchWeatherData };

async function fetchWeatherData(fetchSoft, weatherUrl = WEATHER_URL) {
  return fetchSoft("weather", weatherUrl);
}
