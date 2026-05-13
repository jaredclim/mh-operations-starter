/**
 * Address geocoding via Nominatim (OpenStreetMap). Free, no API key,
 * but rate-limited to 1 request/second per their usage policy. We
 * geocode each unique address ONCE and cache the result in the Lead
 * Tracker's Settings tab so we don't hammer Nominatim on every page
 * load.
 *
 * Cache structure: Settings!B15 holds JSON
 *   { "<normalized address>": { lat: number, lon: number } }
 *
 * Policy: https://operations.osmfoundation.org/policies/nominatim/
 */

import { getServiceAccountAuth, SHEET_ID } from "./sheets";
import { google } from "googleapis";

export interface GeoCoord {
  lat: number;
  lon: number;
}

const CACHE_RANGE = "Settings!B15";

function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function fetchGeocodeCache(): Promise<Record<string, GeoCoord>> {
  try {
    const auth = getServiceAccountAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: CACHE_RANGE,
    });
    const raw = data.values?.[0]?.[0] ?? "";
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

async function writeGeocodeCache(cache: Record<string, GeoCoord>): Promise<void> {
  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: CACHE_RANGE,
    valueInputOption: "RAW",
    requestBody: { values: [[JSON.stringify(cache)]] },
  });
}

// Service-area bounding box (Richmond + Delta + Tsawwassen + Vancouver
// southwest quadrant + Surrey-west). Any geocode result outside this
// box is treated as a Nominatim mis-match and rejected — prevents pins
// from appearing in Toronto / US / random other "5th Ave" addresses.
//
// Box corners (approximate):
//   NW:  49.30°N, -123.30°W
//   SE:  48.95°N, -122.70°W
const SERVICE_AREA = {
  minLat: 48.95,
  maxLat: 49.30,
  minLon: -123.30,
  maxLon: -122.70,
} as const;

export function isInServiceArea(c: GeoCoord): boolean {
  return (
    c.lat >= SERVICE_AREA.minLat &&
    c.lat <= SERVICE_AREA.maxLat &&
    c.lon >= SERVICE_AREA.minLon &&
    c.lon <= SERVICE_AREA.maxLon
  );
}

// Heuristic to ensure short addresses (no city/province) get qualified
// before being sent to Nominatim. "5365 6 Ave" matches many cities;
// "5365 6 Ave, Delta, BC, Canada" matches one.
function enhanceAddressForGeocoding(addr: string): string {
  const trimmed = addr.trim();
  const lower = trimmed.toLowerCase();
  // Already has a recognizable city/province hint? Leave it alone
  const hasCity = /\b(richmond|delta|tsawwassen|vancouver|surrey|burnaby|new west)\b/i.test(trimmed);
  const hasProvince = /\b(bc|british columbia)\b/i.test(trimmed);
  const hasCountry = /\b(canada|usa|us)\b/i.test(trimmed);
  if (hasCity && hasProvince) return trimmed; // best case — no need to append
  if (hasCity && !hasProvince) return `${trimmed}, BC, Canada`;
  if (!hasCity && hasProvince) return `${trimmed}, Canada`;
  // No city, no province — guess the most-common service area.
  // Heuristic: street number ranges in the 1000-2000s tend to be Delta
  // (Tsawwassen / Beach Grove); 3000-12000 tend to be Richmond. This
  // is rough but works for CC's territory. If wrong, viewbox check
  // will catch it and we'll log for review.
  const numMatch = trimmed.match(/^(\d+)/);
  const num = numMatch ? parseInt(numMatch[1], 10) : null;
  const guessCity = num && num >= 1000 && num <= 2999 ? "Delta" : "Richmond";
  void lower; void hasCountry;
  return `${trimmed}, ${guessCity}, BC, Canada`;
}

async function geocodeOne(rawAddress: string): Promise<GeoCoord | null> {
  const address = enhanceAddressForGeocoding(rawAddress);
  // Nominatim asks for: User-Agent identifying the app, and ≤1 req/sec
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "3"); // ask for 3, filter to in-service-area
  url.searchParams.set("countrycodes", "ca");
  // Viewbox (left, top, right, bottom) + bounded=1 constrains results
  // to the service-area box so wildly-wrong cross-country matches never
  // come back at all. Combined with the post-fetch service-area check
  // for belt-and-suspenders.
  url.searchParams.set(
    "viewbox",
    `${SERVICE_AREA.minLon},${SERVICE_AREA.maxLat},${SERVICE_AREA.maxLon},${SERVICE_AREA.minLat}`
  );
  url.searchParams.set("bounded", "1");
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "CC Production Dashboard (jared.lim@colourcraftpainting.com)" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    // Pick the FIRST result whose coords land inside the service area.
    for (const item of arr) {
      if (!item.lat || !item.lon) continue;
      const coord = { lat: parseFloat(item.lat), lon: parseFloat(item.lon) };
      if (isInServiceArea(coord)) return coord;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve geocodes for an array of addresses. Returns the same shape:
 * `Record<normalizedAddress, GeoCoord>`. Uses cached values when
 * present; geocodes uncached addresses sequentially with a 1.1s delay
 * to respect Nominatim rate limits. Writes the new cache back to the
 * sheet at the end.
 */
export async function resolveGeocodes(addresses: string[]): Promise<Record<string, GeoCoord>> {
  const cache = await fetchGeocodeCache();
  let changed = false;

  // Sanity sweep — purge any previously-cached coords that lie outside
  // the service area. Those came from pre-bounded geocodes that wandered
  // to Toronto/US/etc. After purging, the address falls back into the
  // "uncached" set below and re-geocodes with the bounded query.
  for (const [key, coord] of Object.entries(cache)) {
    if (!isInServiceArea(coord)) {
      delete cache[key];
      changed = true;
    }
  }

  const uncached = addresses
    .filter((a) => a.trim())
    .map(normalizeAddress)
    .filter((a, i, arr) => arr.indexOf(a) === i) // unique
    .filter((a) => !cache[a]);

  for (const a of uncached) {
    const coord = await geocodeOne(a);
    if (coord) {
      cache[a] = coord;
      changed = true;
    }
    // Rate limit: ≤1 req/s per Nominatim policy
    await new Promise((r) => setTimeout(r, 1100));
  }
  if (changed) {
    try {
      await writeGeocodeCache(cache);
    } catch (err) {
      console.warn("geocode cache write failed", err);
    }
  }
  return cache;
}

export function lookupGeocode(cache: Record<string, GeoCoord>, address: string): GeoCoord | null {
  return cache[normalizeAddress(address)] ?? null;
}
