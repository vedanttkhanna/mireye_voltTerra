import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { config } from '../config.js';
import { writeJsonAtomic } from '../lib/atomic-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');
const STATE_FIPS = { CA: '06' };

export function populationCenterUrl(state) {
  const stateFips = STATE_FIPS[state];
  if (!stateFips) throw new Error(`No Census population-center source configured for state "${state}"`);
  return `https://www2.census.gov/geo/docs/reference/cenpop2020/county/CenPop2020_Mean_CO${stateFips}.txt`;
}

export function parsePopulationCenters(csvText) {
  const records = parse(csvText.replace(/^\uFEFF/, ''), { columns: true, skip_empty_lines: true, trim: true });
  return records.map((record) => {
    const lat = Number(record.LATITUDE);
    const lng = Number(record.LONGITUDE);
    if (!record.STATEFP || !record.COUNTYFP || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('Census population-center file contains an invalid row');
    }
    return {
      county_fips: `${record.STATEFP}${record.COUNTYFP}`,
      county_name: `${record.COUNAME} County`,
      population: Number(record.POPULATION),
      lat,
      lng,
    };
  });
}

/** Downloads the Census county mean centers of population used as demand proxies. */
export async function ingestPopulationCenters({ state = config.pilotState, fetchImpl = fetch } = {}) {
  const sourceUrl = populationCenterUrl(state);
  const response = await fetchImpl(sourceUrl);
  if (!response.ok) throw new Error(`Census population-center download failed: ${response.status}`);
  const counties = parsePopulationCenters(await response.text()).sort((a, b) => a.county_fips.localeCompare(b.county_fips));
  const output = {
    state,
    fetched_at: new Date().toISOString(),
    source: 'US Census Bureau 2020 county mean centers of population',
    source_url: sourceUrl,
    counties,
  };
  await mkdir(CACHE_DIR, { recursive: true });
  const outPath = path.join(CACHE_DIR, `population-centers-${state}.json`);
  await writeJsonAtomic(outPath, output);
  return { outPath, ...output };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await ingestPopulationCenters();
  console.log(`Wrote ${result.outPath}: ${result.counties.length} population centers.`);
}
