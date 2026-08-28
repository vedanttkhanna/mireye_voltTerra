// Live EV-registration adapters. The country has no single county-level DMV
// feed, so we use the issuing public source whenever it exists and never
// silently turn a population proxy into an "EV registration" number.

import { parse } from 'csv-parse/sync';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NATIONAL_DIR = path.join(__dirname, '../data/national');
const ATLAS_INDEX_URL = 'https://www.atlasevhub.com/market-data/state-ev-registration-data/';
const CA_DMV_URL = 'https://data.ca.gov/dataset/15179472-adeb-4df6-920a-20640d02b08c/resource/b459d957-5d94-4b10-999d-770419870364/download/vehicle-fuel-type-counts-2025.csv';

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function column(row, candidates) {
  const keys = Object.keys(row);
  const key = keys.find((name) => candidates.includes(normalize(name)));
  return key == null ? undefined : row[key];
}

function isElectric(value) {
  const normalized = normalize(value);
  return normalized.includes('batteryelectric') || normalized.includes('pluginhybrid') || normalized === 'bev' || normalized === 'phev';
}

function isLatestSnapshot(row) {
  const value = column(row, ['latestdmvsnapshotflag', 'latestsnapshotflag']);
  return value == null || ['true', 'yes', '1', 'y'].includes(String(value).trim().toLowerCase());
}

function nationalCrosswalk() {
  return JSON.parse(readFileSync(path.join(NATIONAL_DIR, 'zip-county-national.json'), 'utf8'));
}

function add(byCounty, countyFips, count) {
  if (!countyFips || !Number.isFinite(count) || count <= 0) return false;
  byCounty.set(countyFips, (byCounty.get(countyFips) ?? 0) + count);
  return true;
}

export function aggregateLiveRegistrationRows(rows, counties) {
  const crosswalk = nationalCrosswalk();
  const countyByName = new Map(
    counties.map((county) => [
      normalize(String(county.county_name).replace(/\b(county|parish|borough|census area|municipality|city and borough|city)\b/gi, '')),
      county.county_fips,
    ])
  );
  const byCounty = new Map();
  let resolved = 0;
  let unresolved = 0;

  for (const row of rows) {
    if (!isLatestSnapshot(row)) continue;
    const fuel = column(row, ['fueltype', 'fuel', 'powertraintype']);
    if (!isElectric(fuel)) continue;
    const count = Number(column(row, ['vehiclecount', 'count', 'vehicles', 'total']) ?? 0);
    const countyName = normalize(String(column(row, ['county', 'countyname']) ?? '').replace(/\b(county|parish|borough|census area|municipality|city and borough|city)\b/gi, ''));
    const zip = String(column(row, ['zipcode', 'zip', 'zip5']) ?? '').trim().slice(0, 5);
    const countyFips = countyByName.get(countyName) ?? crosswalk[zip]?.county_fips;
    if (add(byCounty, countyFips, count)) resolved += count;
    else unresolved += count;
  }
  return { byCounty, resolved, unresolved };
}

async function fetchCsv(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: 'text/csv,text/plain,*/*' } });
  if (!response.ok) throw new Error(`EV registration source failed: ${response.status}`);
  const csv = await response.text();
  return parse(csv, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
}

async function atlasUrlForState(state, fetchImpl) {
  const response = await fetchImpl(ATLAS_INDEX_URL);
  if (!response.ok) throw new Error(`Atlas EV Hub index failed: ${response.status}`);
  const page = await response.text();
  const pattern = new RegExp(`https?:[^"'\\s]+/public/dmv/${state}_EV_Registrations_[^"'\\s<]+\\.csv`, 'i');
  return page.match(pattern)?.[0]?.replace(/&amp;/g, '&') ?? null;
}

/**
 * Returns a fresh, county-aggregated EV-registration source when the state
 * publishes one. `null` means that a DMV-grade source is not publicly
 * available, not that the county has zero EVs.
 */
export async function fetchLiveEvRegistrations(state, { fetchImpl = fetch, counties = [] } = {}) {
  const sourceUrl = state === 'CA' ? CA_DMV_URL : await atlasUrlForState(state, fetchImpl);
  if (!sourceUrl) return null;

  const rows = await fetchCsv(sourceUrl, fetchImpl);
  const aggregated = aggregateLiveRegistrationRows(rows, counties);
  if (aggregated.byCounty.size === 0) {
    throw new Error(`EV registration source for ${STATE_NAMES[state] ?? state} returned no county-resolvable electric vehicles`);
  }
  return {
    ...aggregated,
    source: state === 'CA' ? 'California DMV Vehicle Fuel Type Count by ZIP Code' : 'Atlas EV Hub Open Vehicle Registration Initiative',
    source_url: sourceUrl,
    fetched_at: new Date().toISOString(),
  };
}
