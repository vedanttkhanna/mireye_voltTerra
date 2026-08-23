import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { config } from '../config.js';
import { writeJsonAtomic } from '../lib/safe-persistence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

// Census computes these from the location of every resident, making them a
// defensible population-weighted demand proxy. This replaces the old county
// geographic internal point and, importantly, never derives demand from the
// historical placement of existing chargers.
const STATE_FIPS = { CA: '06' }; // extend alongside additional pilot states
const CENTER_URL = (stateFips) =>
  `https://www2.census.gov/geo/docs/reference/cenpop2020/county/CenPop2020_Mean_CO${stateFips}.txt`;

/** Parses Census county mean-population-center CSV with strict columns. */
export function parsePopulationCentersCsv(text, { stateFips }) {
  const records = parse(text.replace(/^\uFEFF/, ''), { columns: true, skip_empty_lines: true, trim: true });
  const required = ['STATEFP', 'COUNTYFP', 'COUNAME', 'POPULATION', 'LATITUDE', 'LONGITUDE'];
  if (!records.length || required.some((field) => !(field in records[0]))) {
    throw new Error(`Population center file missing required columns: ${required.join(', ')}`);
  }
  return records.filter((row) => row.STATEFP === stateFips).map((row) => ({
    county_fips: `${row.STATEFP}${row.COUNTYFP}`,
    county_name: `${row.COUNAME} County`,
    population: Number(row.POPULATION),
    lat: Number(row.LATITUDE),
    lng: Number(row.LONGITUDE),
  }));
}

/** Downloads and atomically caches one population-weighted point per county. */
export async function ingestCountyCentroids({ state = config.pilotState, fetchImpl = fetch } = {}) {
  const stateFips = STATE_FIPS[state];
  if (!stateFips) throw new Error(`No Census FIPS mapping for state "${state}"`);
  const sourceUrl = CENTER_URL(stateFips);
  const res = await fetchImpl(sourceUrl);
  if (!res.ok) throw new Error(`Census population-center download failed: ${res.status}`);

  const counties = parsePopulationCentersCsv(await res.text(), { stateFips }).sort((a, b) =>
    a.county_fips.localeCompare(b.county_fips)
  );
  if (counties.length === 0 || counties.some((c) => !/^\d{5}$/.test(c.county_fips) || !Number.isFinite(c.population) || c.population < 0 || !Number.isFinite(c.lat) || !Number.isFinite(c.lng))) {
    throw new Error('Census produced invalid or empty population-center data; keeping existing file');
  }
  if (new Set(counties.map((c) => c.county_fips)).size !== counties.length) {
    throw new Error('Census produced duplicate county FIPS values; keeping existing file');
  }

  const output = {
    state,
    fetched_at: new Date().toISOString(),
    data_vintage: '2020 Census',
    weighting: 'population',
    source: 'US Census Bureau 2020 Mean Centers of Population by County',
    source_url: sourceUrl,
    counties,
  };

  const outPath = path.join(DATA_DIR, `county-centroids-${state}.json`);
  await writeJsonAtomic(outPath, output);
  return { outPath, ...output };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { outPath, counties } = await ingestCountyCentroids();
  console.log(`Wrote ${outPath}: ${counties.length} population-weighted county centers.`);
}
