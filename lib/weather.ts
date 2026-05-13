/**
 * Weather integration for the Production Dashboard. Uses Open-Meteo's
 * free forecast API (no API key required) to get daily precipitation,
 * temperature, and weather codes for Richmond/Delta, BC. Cached on the
 * server for 1 hour so we're not hitting the API on every request.
 *
 * Open-Meteo docs: https://open-meteo.com/en/docs
 *
 * Why Open-Meteo over OpenWeather:
 *  - No API key (no secret rotation, no rate-limit risk).
 *  - Free for non-commercial / low-volume.
 *  - Returns 16-day forecast, more than enough for 4-week timeline.
 */

// Steveston / Tsawwassen midpoint. CC's territory is south Richmond +
// south Delta — both coastal microclimates (cloudier/foggier, slightly
// cooler than inland Richmond). Open-Meteo's resolution is ~11km, so a
// single coastal point covers both areas accurately. Inland Richmond
// (49.166) was off by ~5km and biased the forecast toward warmer/drier.
// TODO: per-job address weather (geocode each job's address via
// Open-Meteo's free geocoding API) for more accuracy on bigger spread.
const LAT = 49.105;
const LON = -123.15;

export type RainSeverity = "none" | "light" | "heavy";

export interface DayWeather {
  date: string; // YYYY-MM-DD
  precipMm: number;
  tempMaxC: number;
  tempMinC: number;
  weatherCode: number;
  /** Human-friendly label e.g. "Light rain", "Sunny" */
  label: string;
  /** Emoji icon for compact display */
  icon: string;
  /** Rain severity for exterior-paint planning:
   *  - "heavy": codes 63/65/67/75/82/86/95-99 OR ≥8mm precip — definitely
   *    a problem for exterior work
   *  - "light": codes 51/53/55/61/80/81/85 OR ≥1mm — watch the forecast
   *  - "none": clear / cloudy / dry
   */
  rainSeverity: RainSeverity;
  /** Legacy alias for rainSeverity === "heavy". */
  isHeavyRain: boolean;
}

// WMO weather codes → label + icon. Source: https://open-meteo.com/en/docs#weathervariables
const CODE_MAP: Record<number, { label: string; icon: string }> = {
  0: { label: "Clear", icon: "☀️" },
  1: { label: "Mostly clear", icon: "🌤" },
  2: { label: "Partly cloudy", icon: "⛅" },
  3: { label: "Overcast", icon: "☁️" },
  45: { label: "Fog", icon: "🌫" },
  48: { label: "Fog (rime)", icon: "🌫" },
  51: { label: "Light drizzle", icon: "🌦" },
  53: { label: "Drizzle", icon: "🌦" },
  55: { label: "Heavy drizzle", icon: "🌧" },
  61: { label: "Light rain", icon: "🌦" },
  63: { label: "Rain", icon: "🌧" },
  65: { label: "Heavy rain", icon: "⛈" },
  66: { label: "Freezing rain", icon: "🌧❄" },
  67: { label: "Heavy freezing rain", icon: "🌧❄" },
  71: { label: "Light snow", icon: "🌨" },
  73: { label: "Snow", icon: "❄️" },
  75: { label: "Heavy snow", icon: "❄️" },
  77: { label: "Snow grains", icon: "❄️" },
  80: { label: "Light showers", icon: "🌦" },
  81: { label: "Showers", icon: "🌧" },
  82: { label: "Heavy showers", icon: "⛈" },
  85: { label: "Light snow showers", icon: "🌨" },
  86: { label: "Heavy snow showers", icon: "❄️" },
  95: { label: "Thunderstorm", icon: "⛈" },
  96: { label: "Thunderstorm + hail", icon: "⛈" },
  99: { label: "Heavy thunderstorm", icon: "⛈" },
};

let cache: { data: Map<string, DayWeather>; fetchedAt: number } | null = null;
const CACHE_MS = 60 * 60 * 1000; // 1 hour

export async function fetchWeatherForecast(): Promise<Map<string, DayWeather>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) {
    return cache.data;
  }
  // 16-day forecast is the max Open-Meteo provides — covers our 4-week
  // window comfortably. Past days don't return forecast (just NaN), but
  // that's fine — we don't surface weather for days that have already
  // happened anyway.
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(LAT));
  url.searchParams.set("longitude", String(LON));
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum");
  url.searchParams.set("timezone", "America/Vancouver");
  url.searchParams.set("forecast_days", "16");
  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 3600 }, // server-side cache for 1h
    });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const json = await res.json();
    const dates: string[] = json.daily?.time ?? [];
    const codes: number[] = json.daily?.weather_code ?? [];
    const tmax: number[] = json.daily?.temperature_2m_max ?? [];
    const tmin: number[] = json.daily?.temperature_2m_min ?? [];
    const precip: number[] = json.daily?.precipitation_sum ?? [];
    const map = new Map<string, DayWeather>();
    for (let i = 0; i < dates.length; i++) {
      const code = codes[i] ?? 0;
      const meta = CODE_MAP[code] || { label: "Unknown", icon: "" };
      const precipMm = precip[i] ?? 0;
      // Two-level rain severity (trades exterior paint planning):
      //   heavy = day-stopping rain — codes 63/65/67/75/82/86/95-99 OR ≥8mm
      //   light = disruptive drizzle/showers — codes 51/53/55/61/80/81/85 OR ≥1mm
      //   none = dry
      const heavyCodes = [63, 65, 67, 75, 82, 86, 95, 96, 99];
      const lightCodes = [51, 53, 55, 61, 80, 81, 85];
      const rainSeverity: RainSeverity = heavyCodes.includes(code) || precipMm >= 8
        ? "heavy"
        : lightCodes.includes(code) || precipMm >= 1
          ? "light"
          : "none";
      map.set(dates[i], {
        date: dates[i],
        precipMm,
        tempMaxC: tmax[i] ?? NaN,
        tempMinC: tmin[i] ?? NaN,
        weatherCode: code,
        label: meta.label,
        icon: meta.icon,
        rainSeverity,
        isHeavyRain: rainSeverity === "heavy",
      });
    }
    cache = { data: map, fetchedAt: Date.now() };
    return map;
  } catch (err) {
    console.warn("weather fetch failed:", err);
    // Fail open: empty map — UI degrades gracefully (no weather shown)
    return new Map();
  }
}
