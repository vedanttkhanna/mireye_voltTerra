import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { zipToCounty } from '../lib/zip-county.js';
import { meanPoint } from '../lib/geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');
const PAGE_LIMIT = 200; // AFDC's hard max per request
const MAX_RETRIES = 5;

// How many of a county's existing charger locations to keep as "corridor"
// sample points for the join pipeline (Days 5-7) — a proxy for where
// charging demand already concentrates, since this project doesn't have a
// state highway centerline dataset in scope. Picked by even spacing through
// the county's station list (see pickEvenlySpaced), not geographic
// clustering, which is a cheap heuristic and not a guarantee of even
// coverage — worth revisiting if a county's stations turn out to be
// lopsided (e.g. all in one corner near the county line).
const CORRIDOR_SAMPLE_SIZE = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pulls every open ("E" = available) electric charging station for a state
 * from the DOE Alternative Fuels Data Center, paginating in pages of 200
 * (the API's max). DEMO_KEY is rate-limited (~30 req/hr); a real key from
 * developer.nlr.gov/signup removes that ceiling.
 */
export async function fetchAllStations({
  state = config.pilotState,
  fuelType = 'ELEC',
  status = 'E',
  apiKey = config.nrelApiKey,
  baseUrl = config.afdcBaseUrl,
  fetchImpl = fetch,
  pageDelayMs = 250,
} = {}) {
  const stations = [];
  let offset = 0;
  let totalResults = Infinity;

  while (offset < totalResults) {
    const url = new URL('/api/alt-fuel-stations/v1.json', baseUrl);
    url.searchParams.set('fuel_type', fuelType);
    url.searchParams.set('state', state);
    url.searchParams.set('status', status);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('api_key', apiKey);

    const data = await fetchPageWithRetry(fetchImpl, url);
    totalResults = data.total_results ?? 0;
    stations.push(...data.fuel_stations);
    offset += PAGE_LIMIT;

    if (offset < totalResults) {
      await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
    }
  }

  return stations;
}

/**
 * AFDC (unlike Mireye) doesn't send Retry-After, and DEMO_KEY's rate limit
 * (~30-50 req/hr) is tight enough that a statewide sweep of ~100+ pages
 * WILL hit it. Backs off exponentially on 429/502/503/504 rather than
 * failing the whole ingest on one throttled page.
 */
async function fetchPageWithRetry(fetchImpl, url) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetchImpl(url);
    if (res.ok) return res.json();

    const retryable = [429, 502, 503, 504].includes(res.status);
    const body = await res.text().catch(() => '');
    if (!retryable || attempt === MAX_RETRIES) {
      throw new Error(`AFDC request failed: ${res.status} ${body}`);
    }
    await sleep(2 ** attempt * 2000);
  }
}

/** Picks up to `max` items from `list`, spread evenly across its index range. */
export function pickEvenlySpaced(list, max) {
  if (list.length <= max) return list;
  const picked = [];
  for (let i = 0; i < max; i++) {
    picked.push(list[Math.floor((i * list.length) / max)]);
  }
  return picked;
}

/**
 * Reduces raw AFDC station records to per-county charger counts, splitting
 * Level 2 vs DC fast, plus:
 *   - up to CORRIDOR_SAMPLE_SIZE representative station coordinates per
 *     county for the join pipeline's county sampling step, and
 *   - `demand_centroid`, the arithmetic mean lat/lng of EVERY station in
 *     the county (not just the truncated corridor sample) — a proxy for
 *     where charging demand actually concentrates geographically, used to
 *     detect when a county's Census-gazetteer centroid is a poor stand-in
 *     for that (orchestrator.js's CENTROID_DIVERGENCE_THRESHOLD_M). null
 *     for a county with zero geocoded stations.
 * Stations whose ZIP isn't in the state's crosswalk (bad ZIP, PO box,
 * data entry error) are counted separately rather than silently dropped.
 */
export function aggregateStationsByCounty(stations, { state = config.pilotState } = {}) {
  const byCounty = new Map();
  const unresolved = [];

  for (const station of stations) {
    const county = zipToCounty(station.zip, state);
    if (!county) {
      unresolved.push({ id: station.id, zip: station.zip, station_name: station.station_name });
      continue;
    }

    const key = county.county_fips;
    if (!byCounty.has(key)) {
      byCounty.set(key, {
        county_fips: key,
        county_name: county.county_name,
        station_count: 0,
        level2_ports: 0,
        dc_fast_ports: 0,
        level1_ports: 0,
        stationsWithCoords: [],
      });
    }
    const bucket = byCounty.get(key);
    bucket.station_count += 1;
    bucket.level2_ports += station.ev_level2_evse_num || 0;
    bucket.dc_fast_ports += station.ev_dc_fast_num || 0;
    bucket.level1_ports += station.ev_level1_evse_num || 0;
    if (Number.isFinite(station.latitude) && Number.isFinite(station.longitude)) {
      bucket.stationsWithCoords.push({
        id: station.id,
        station_name: station.station_name,
        lat: station.latitude,
        lng: station.longitude,
      });
    }
  }

  const counties = [...byCounty.values()]
    .map(({ stationsWithCoords, ...county }) => ({
      ...county,
      corridor_points: pickEvenlySpaced(stationsWithCoords, CORRIDOR_SAMPLE_SIZE),
      demand_centroid: meanPoint(stationsWithCoords),
    }))
    .sort((a, b) => a.county_fips.localeCompare(b.county_fips));

  return { counties, unresolved };
}

export async function ingestAfdc({ state = config.pilotState } = {}) {
  const stations = await fetchAllStations({ state });
  const { counties, unresolved } = aggregateStationsByCounty(stations, { state });

  const output = {
    state,
    fetched_at: new Date().toISOString(),
    source: 'DOE Alternative Fuels Data Center (developer.nlr.gov)',
    total_stations: stations.length,
    unresolved_count: unresolved.length,
    counties,
    unresolved,
  };

  await mkdir(CACHE_DIR, { recursive: true });
  const outPath = path.join(CACHE_DIR, `afdc-${state}.json`);
  await writeFile(outPath, JSON.stringify(output, null, 2));
  return { outPath, ...output };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { outPath, total_stations, counties, unresolved_count } = await ingestAfdc();
  console.log(
    `Wrote ${outPath}: ${total_stations} stations across ${counties.length} counties (${unresolved_count} unresolved).`
  );
}
