// Live facility sweep. Runs the whole county analysis for a state ON DEMAND,
// against Mireye, with nothing read from a precomputed cache.
//
// Why this exists separately from orchestrator.js: that pipeline is California-
// only, because its demand signal is CA DMV EV registrations and no equivalent
// county-level registration feed exists for the other 49 states. This uses a
// demand signal that IS available everywhere -- Census county population per
// public charging port -- so the same funding decision can be made for any
// state the moment someone picks it.
//
// Every county costs one Mireye /v1/fetch/batch slot of LIVE_SWEEP_FIELDS
// (23 credits), so a state's sweep price is simply 23 x its county count.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mireye } from './mireye.js';
import { computeGridFeasibilityScore, bucketCounty, flagUnderservedCounties } from './scoring.js';
import { fetchAllStations } from './afdc.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NATIONAL_DIR = path.join(__dirname, '../data/national');

export const STATE_FIPS = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10',
  FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20',
  KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28',
  MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36',
  NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45',
  SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56',
};

// The live sweep pulls a deliberately wider field set than the CA pipeline's
// 23 grid fields. Grid proximity alone answers "can it connect"; these also
// answer "what would it cost to run" and "can you actually build here", which
// is the combination the funding decision really turns on. All 1 credit each.
export const LIVE_SWEEP_FIELDS = [
  // --- grid interconnection (can it connect at all) ---
  'nearest_substation_distance_m',
  'nearest_substation_max_voltage_kv',
  'nearest_substation_status',
  'nearest_osm_substation_distance_m',
  'nearest_osm_substation_max_voltage_kv',
  'electric_utility_service_territory',
  'iso_rto',
  'transmission_redundancy_flag',
  'nearest_transmission_line_distance_m',
  'nearest_transmission_line_voltage_kv',
  'max_transmission_line_voltage_kv_within_radius',
  'transmission_lines_within_radius_count',
  'substations_within_radius_count',
  'nearest_power_plant_distance_m',
  'nearest_power_plant_capacity_mw',
  'nearest_power_plant_technology',
  'nearest_proposed_generator_distance_m',
  'nearest_proposed_generator_capacity_mw',
  // --- operating economics (what it costs to run) ---
  'avg_retail_electricity_price_industrial_usd_per_kwh',
  'grid_price_usd_per_mwh',
  'estimated_annual_power_cost_usd_per_mw',
  // --- buildability (can you physically put it there) ---
  'slope_degrees',
  'elevation',
  'land_use_class',
  'nearest_road_distance_m',
  'nearest_road_class',
  // --- demand density at the sampled point ---
  'housing_units_within_1km',
  'tract_population',
  // --- siting risk ---
  'fire_hazard_severity_zone_class',
  'fema_flood_zone',
  'intersects_protected_area',
];

let centroidCache = null;
let crosswalkCache = null;

function normalizedCountyName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\b(county|parish|borough|census area|municipality|city and borough|city)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function nationalCentroids() {
  if (!centroidCache) {
    centroidCache = JSON.parse(readFileSync(path.join(NATIONAL_DIR, 'county-centroids-national.json'), 'utf8'));
  }
  return centroidCache;
}

function nationalCrosswalk() {
  if (!crosswalkCache) {
    crosswalkCache = JSON.parse(readFileSync(path.join(NATIONAL_DIR, 'zip-county-national.json'), 'utf8'));
  }
  return crosswalkCache;
}

/** Every county in a state, with its population-weighted center. */
export function countiesForState(state) {
  const fips = STATE_FIPS[state];
  if (!fips) throw new Error(`Unknown state code "${state}"`);
  return Object.values(nationalCentroids())
    .filter((c) => c.state_fips === fips)
    .sort((a, b) => a.county_fips.localeCompare(b.county_fips));
}

/** Charging ports per county, from a live AFDC pull for that state. */
export async function chargersByCounty(state) {
  const stations = await fetchAllStations({ state });
  const crosswalk = nationalCrosswalk();
  const countyByName = new Map(
    countiesForState(state).map((county) => [normalizedCountyName(county.county_name), county.county_fips])
  );
  const byCounty = new Map();
  const coverage = { county_field: 0, zip_crosswalk: 0, unresolved: 0 };

  for (const s of stations) {
    // AFDC's own county field is the primary live join. ZIP is only a
    // fallback because ZIPs can cross county lines and PO-box ZIPs are common.
    const countyFromStation = countyByName.get(normalizedCountyName(s.county));
    const zip = String(s.zip ?? '').trim().slice(0, 5);
    const countyFromZip = crosswalk[zip]?.county_fips;
    const countyFips = countyFromStation ?? countyFromZip;
    if (!countyFips) {
      coverage.unresolved += 1;
      continue;
    }
    if (countyFromStation) coverage.county_field += 1;
    else coverage.zip_crosswalk += 1;

    const cur = byCounty.get(countyFips) ?? { station_count: 0, level2_ports: 0, dc_fast_ports: 0 };
    cur.station_count += 1;
    cur.level2_ports += Number(s.ev_level2_evse_num || 0);
    cur.dc_fast_ports += Number(s.ev_dc_fast_num || 0);
    byCounty.set(countyFips, cur);
  }
  return { byCounty, total_stations: stations.length, coverage };
}

/** Fetch county population directly from the Census ACS API for this run. */
export async function fetchLiveCountyPopulation(state, { fetchImpl = fetch } = {}) {
  if (!config.censusApiKey) return null;
  const url = new URL(config.censusAcsBaseUrl);
  url.searchParams.set('get', 'NAME,B01003_001E');
  url.searchParams.set('for', 'county:*');
  url.searchParams.set('in', `state:${STATE_FIPS[state]}`);
  url.searchParams.set('key', config.censusApiKey);

  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Census ACS request failed: ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('Census ACS response has an invalid county schema');
  const [header, ...values] = rows;
  const populationIndex = header.indexOf('B01003_001E');
  const countyIndex = header.indexOf('county');
  if (populationIndex < 0 || countyIndex < 0) throw new Error('Census ACS response omitted population or county fields');

  return new Map(values.map((row) => [`${STATE_FIPS[state]}${row[countyIndex]}`, Number(row[populationIndex])]));
}

export function quoteSweep(state) {
  const counties = countiesForState(state);
  return {
    state,
    counties: counties.length,
    fields_per_county: LIVE_SWEEP_FIELDS.length,
    estimated_credits: counties.length * LIVE_SWEEP_FIELDS.length,
  };
}

/**
 * Runs the full sweep live. `onProgress` is called as each Mireye batch lands
 * so the UI can show real progress rather than a spinner over a 60-second wait.
 */
export async function runLiveSweep({ state, onProgress = () => {} } = {}) {
  const started = Date.now();
  const counties = countiesForState(state);

  onProgress({ phase: 'chargers', message: `Pulling charging stations for ${state}` });
  const [{ byCounty: chargers, total_stations, coverage: chargerCoverage }, livePopulation] = await Promise.all([
    chargersByCounty(state),
    fetchLiveCountyPopulation(state),
  ]);

  // Preflight against Mireye's own pricing before spending anything.
  onProgress({ phase: 'quote', message: 'Pricing the sweep with Mireye' });
  const perLocation = await mireye.fetchQuote({ fields: LIVE_SWEEP_FIELDS, locations: 1 });
  const estimated = (perLocation.credits_total ?? LIVE_SWEEP_FIELDS.length) * counties.length;

  onProgress({
    phase: 'fetching',
    message: `Fetching live grid data at ${counties.length} county centers`,
    total: counties.length,
    done: 0,
    estimated_credits: estimated,
  });

  // Fetch independent Mireye batches concurrently. This reduces wall-clock
  // time without changing the number of API calls or credits used.
  // Smaller than Mireye's 25-location maximum, with a generous timeout: 31
  // fields across a full batch is a lot of server-side work and a 25-location
  // request was observed timing out at the client's 30 s default mid-sweep.
  const BATCH = 12;
  const BATCH_TIMEOUT_MS = 120_000;
  const batches = Array.from({ length: Math.ceil(counties.length / BATCH) }, (_, index) => ({
    index,
    counties: counties.slice(index * BATCH, (index + 1) * BATCH),
  }));
  const batchResults = new Array(batches.length);
  let nextBatch = 0;
  let completedCounties = 0;
  const workerCount = Math.min(config.liveSweepConcurrency, batches.length);

  async function fetchWorker() {
    while (nextBatch < batches.length) {
      const batch = batches[nextBatch++];
      const { results } = await mireye.fetchBatch(
        {
          locations: batch.counties.map((c) => ({ lat: c.lat, lng: c.lng })),
          fields: LIVE_SWEEP_FIELDS,
        },
        {
          timeoutMs: BATCH_TIMEOUT_MS,
          // A retry of this exact batch cannot accidentally bill twice.
          idempotencyKey: `live-sweep-${state}-${started}-${batch.index}`,
        }
      );
      batchResults[batch.index] = results;
      completedCounties += batch.counties.length;
      onProgress({
        phase: 'fetching',
        total: counties.length,
        done: completedCounties,
        message: `Fetched ${completedCounties} of ${counties.length} counties`,
      });
    }
  }

  await Promise.all(Array.from({ length: workerCount }, fetchWorker));
  const gridResults = batchResults.flat();

  onProgress({ phase: 'scoring', message: 'Scoring and bucketing' });

  const withRatio = counties.map((c, i) => {
    const ch = chargers.get(c.county_fips) ?? { station_count: 0, level2_ports: 0, dc_fast_ports: 0 };
    const ports = ch.level2_ports + ch.dc_fast_ports;
    return {
      county_fips: c.county_fips,
      county_name: c.county_name,
      population: livePopulation?.get(c.county_fips) ?? c.population,
      lat: c.lat,
      lng: c.lng,
      chargers: ch,
      charger_count: ports,
      // People per public port. The universal stand-in for the CA-only
      // EV-registrations-per-port ratio; a county with no ports at all is
      // maximally underserved rather than undefined.
      ratio: ports > 0 ? (livePopulation?.get(c.county_fips) ?? c.population) / ports : (livePopulation?.get(c.county_fips) ?? c.population) > 0 ? Infinity : null,
      grid_fields: gridResults[i]?.fields ?? null,
    };
  });

  const readField = (fields, name) => {
    const f = fields?.[name];
    return f?.status === 'ok' ? f.value : null;
  };

  const finite = withRatio.filter((c) => Number.isFinite(c.ratio));
  const { median } = flagUnderservedCounties(finite);
  const threshold = median != null ? median * config.underservedThresholdMultiplier : null;

  const scored = withRatio.map((c) => {
    const underserved = threshold != null && c.ratio != null && c.ratio >= threshold;
    let grid_feasibility = null;
    let bucket = null;
    if (underserved && c.grid_fields) {
      grid_feasibility = {
        ...computeGridFeasibilityScore(c.grid_fields),
        sampled_at: { type: 'population_center', lat: c.lat, lng: c.lng },
      };
      bucket = bucketCounty(grid_feasibility);
    }
    return {
      county_fips: c.county_fips,
      county_name: c.county_name,
      population: c.population,
      charger_count: c.charger_count,
      // Surfaced from the wider Mireye pull so the drill-down can explain cost
      // and buildability, not just whether a substation is near.
      context: c.grid_fields
        ? {
            electricity_price_usd_per_kwh: readField(c.grid_fields, 'avg_retail_electricity_price_industrial_usd_per_kwh'),
            utility: readField(c.grid_fields, 'electric_utility_service_territory'),
            slope_degrees: readField(c.grid_fields, 'slope_degrees'),
            road_class: readField(c.grid_fields, 'nearest_road_class'),
            fire_hazard: readField(c.grid_fields, 'fire_hazard_severity_zone_class'),
            flood_zone: readField(c.grid_fields, 'fema_flood_zone'),
            housing_units_within_1km: readField(c.grid_fields, 'housing_units_within_1km'),
          }
        : null,
      chargers: c.chargers,
      people_per_port: Number.isFinite(c.ratio) ? Number(c.ratio.toFixed(1)) : null,
      driver_to_plug_ratio: Number.isFinite(c.ratio) ? Number(c.ratio.toFixed(1)) : null,
      no_public_charging: c.charger_count === 0,
      underserved,
      bucket,
      grid_feasibility,
    };
  });

  scored.sort((a, b) => (b.driver_to_plug_ratio ?? -1) - (a.driver_to_plug_ratio ?? -1));

  return {
    state,
    live: true,
    ran_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    mireye_batching: { locations_per_request: BATCH, concurrent_requests: workerCount },
    demand_metric: 'people_per_public_port',
    demand_metric_note:
      'Census 2020 county population per public charging port. Used instead of EV registrations ' +
      'because county-level EV registration data is not published for most states.',
    state_median_driver_to_plug_ratio: median,
    underserved_threshold_multiplier: config.underservedThresholdMultiplier,
    counties_total: scored.length,
    counties_underserved: scored.filter((c) => c.underserved).length,
    counties_fund_charger_now: scored.filter((c) => c.bucket === 'fund_charger_now').length,
    counties_fund_grid_upgrade_first: scored.filter((c) => c.bucket === 'fund_grid_upgrade_first').length,
    counties_insufficient_data: scored.filter((c) => c.bucket === 'insufficient_data').length,
    total_stations,
    charger_join_coverage: {
      ...chargerCoverage,
      resolved: chargerCoverage.county_field + chargerCoverage.zip_crosswalk,
      resolved_percent: total_stations ? Number((((chargerCoverage.county_field + chargerCoverage.zip_crosswalk) / total_stations) * 100).toFixed(1)) : 100,
    },
    data_sources: {
      charger_inventory: { source: 'DOE AFDC', freshness: 'live', fetched_at: new Date().toISOString() },
      grid_evidence: { source: 'Mireye /v1/fetch/batch', freshness: 'live', fetched_at: new Date().toISOString() },
      county_population: livePopulation
        ? { source: 'US Census Bureau ACS 2024 B01003_001E', freshness: 'live', fetched_at: new Date().toISOString() }
        : { source: 'US Census Bureau 2020 county reference', freshness: 'bundled_reference', note: 'Set CENSUS_API_KEY to fetch this input live.' },
    },
    credits_spent: estimated,
    counties: scored,
  };
}
