import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { config } from '../config.js';
import { zipToCounty } from '../lib/zip-county.js';
import { listCountiesForState } from '../lib/zip-county.js';
import { writeJsonAtomic } from '../lib/safe-persistence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');

// California DMV "Vehicle Fuel Type Count by Zip Code" dataset, published
// by the CEC/DMV on the state open data portal. One resource per calendar
// year, format Date,ZIP Code,Model Year,Fuel,Make,Duty,Vehicles.
const CA_DMV_PACKAGE_ID = '15179472-adeb-4df6-920a-20640d02b08c';
const CKAN_BASE_URL = 'https://data.ca.gov';

// Counted as "EV registrations" for the driver-to-plug ratio: both rely on
// public charging, unlike a conventional hybrid. This is a judgment call —
// a PHEV-heavy county will look more charger-starved than pure BEV demand
// alone would justify, since PHEVs can also fill up on gas.
const EV_FUEL_TYPES = new Set(['Battery Electric', 'Plug-in Hybrid']);

/** Resolves the last N years of CSV resource URLs from the CKAN package. */
export async function listRegistrationResources({
  yearsBack = 3,
  fetchImpl = fetch,
} = {}) {
  const url = `${CKAN_BASE_URL}/api/3/action/package_show?id=${CA_DMV_PACKAGE_ID}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`CKAN package_show failed: ${res.status}`);
  const data = await res.json();

  if (!Array.isArray(data?.result?.resources)) throw new Error('CKAN response missing result.resources');
  const csvResources = data.result.resources
    .filter((r) => r.format === 'CSV')
    .map((r) => ({
      name: r.name,
      url: r.url,
      // Resource names are "M/D/YYYY Vehicle Fuel Type Count by Zip Code"
      asOfDate: r.name.split(' ')[0],
    }))
    .sort((a, b) => new Date(b.asOfDate) - new Date(a.asOfDate));

  const selected = csvResources.filter((r) => Number.isFinite(Date.parse(r.asOfDate))).slice(0, yearsBack);
  if (selected.length < yearsBack) throw new Error(`CKAN returned only ${selected.length} valid dated CSV resources`);
  return selected;
}

/**
 * Parses one year's CSV into {zip, year, fuel, vehicles} rows, filtered to
 * the EV fuel types. `year` comes from the row's own Date column, not the
 * resource name, since the file is "vehicle population as of" a date.
 */
export function parseRegistrationsCsv(csvText) {
  const records = parse(csvText, { columns: true, skip_empty_lines: true });
  const required = ['Date', 'ZIP Code', 'Fuel', 'Vehicles'];
  if (records.length && required.some((key) => !(key in records[0]))) {
    throw new Error(`Registration CSV missing required columns: ${required.join(', ')}`);
  }
  const rows = [];
  for (const r of records) {
    const fuel = r.Fuel?.trim();
    if (!EV_FUEL_TYPES.has(fuel)) continue;
    const vehicles = Number(r.Vehicles);
    if (!Number.isFinite(vehicles) || vehicles < 0) throw new Error('Registration CSV contains an invalid EV vehicle count');
    const dateMs = Date.parse(r.Date);
    if (!Number.isFinite(dateMs)) throw new Error('Registration CSV contains an invalid EV record date');
    const year = new Date(dateMs).getUTCFullYear();
    rows.push({ zip: r['ZIP Code'], year, fuel, vehicles });
  }
  return rows;
}

/**
 * Aggregates EV registration rows to county x year totals, plus a simple
 * year-over-year growth rate per county where consecutive years exist.
 */
export function aggregateRegistrationsByCounty(rows, { state = config.pilotState } = {}) {
  const byCounty = new Map(); // county_fips -> { county_name, byYear: Map<year, count> }
  const unresolvedZips = new Set();

  for (const { zip, year, vehicles } of rows) {
    const county = zipToCounty(zip, state);
    if (!county) {
      unresolvedZips.add(zip);
      continue;
    }
    if (!byCounty.has(county.county_fips)) {
      byCounty.set(county.county_fips, {
        county_fips: county.county_fips,
        county_name: county.county_name,
        byYear: new Map(),
      });
    }
    const entry = byCounty.get(county.county_fips);
    entry.byYear.set(year, (entry.byYear.get(year) || 0) + vehicles);
  }

  const counties = [...byCounty.values()]
    .map(({ county_fips, county_name, byYear }) => {
      const years = [...byYear.keys()].sort();
      const registrations_by_year = Object.fromEntries(years.map((y) => [y, byYear.get(y)]));
      const latestYear = years.at(-1);
      const priorYear = years.at(-2);
      const yoy_growth_rate =
        priorYear != null && byYear.get(priorYear) > 0
          ? (byYear.get(latestYear) - byYear.get(priorYear)) / byYear.get(priorYear)
          : null;
      return {
        county_fips,
        county_name,
        registrations_by_year,
        latest_registrations: byYear.get(latestYear) ?? null,
        yoy_growth_rate,
      };
    })
    .sort((a, b) => a.county_fips.localeCompare(b.county_fips));

  return { counties, unresolvedZips: [...unresolvedZips] };
}

export async function ingestRegistrations({
  state = config.pilotState,
  yearsBack = 3,
  fetchImpl = fetch,
} = {}) {
  const resources = await listRegistrationResources({ yearsBack, fetchImpl });

  const allRows = [];
  for (const resource of resources) {
    const res = await fetchImpl(resource.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Failed to download ${resource.url}: ${res.status}`);
    const text = await res.text();
    allRows.push(...parseRegistrationsCsv(text));
  }

  const { counties, unresolvedZips } = aggregateRegistrationsByCounty(allRows, { state });
  const expectedCountyCount = listCountiesForState(state).length;
  if (counties.length < Math.ceil(expectedCountyCount * 0.9)) {
    throw new Error(`Registration coverage too low: ${counties.length}/${expectedCountyCount} counties; keeping existing cache`);
  }

  const output = {
    state,
    fetched_at: new Date().toISOString(),
    source: 'California DMV "Vehicle Fuel Type Count by Zip Code" (data.ca.gov)',
    source_resources: resources.map((r) => ({ name: r.name, url: r.url })),
    data_vintages: resources.map((r) => r.asOfDate),
    county_coverage: { resolved: counties.length, expected: expectedCountyCount },
    ev_fuel_types_counted: [...EV_FUEL_TYPES],
    unresolved_zip_count: unresolvedZips.length,
    counties,
    unresolvedZips,
  };

  const outPath = path.join(CACHE_DIR, `ev-registrations-${state}.json`);
  await writeJsonAtomic(outPath, output);
  return { outPath, ...output };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { outPath, counties, unresolved_zip_count } = await ingestRegistrations();
  console.log(
    `Wrote ${outPath}: ${counties.length} counties (${unresolved_zip_count} unresolved ZIPs).`
  );
}
