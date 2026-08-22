import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

// Same 2020 vintage as the ZIP-to-county crosswalk (server/lib/zip-county.js),
// for consistency between the two Census-derived reference datasets.
// INTPTLAT/INTPTLONG is the Bureau's "internal point" per county: a
// representative interior point guaranteed to fall inside the county's land
// area, unlike a naive bounding-box centroid (which can land outside a
// concave or coastal county, or in the ocean).
const GAZETTEER_URL =
  'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_counties_national.zip';
const GAZETTEER_ENTRY = '2020_Gaz_counties_national.txt';

const STATE_USPS = { CA: 'CA' }; // extend if a second pilot state is ever added

/**
 * Parses the gazetteer's tab-delimited text (header + fixed columns) into
 * {county_fips, county_name, lat, lng} rows for one state's USPS code.
 */
export function parseGazetteerText(text, { usps }) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  // The gazetteer's fixed-width origins leave trailing spaces on the last
  // tab-delimited column of every line (header and data rows alike).
  const header = lines[0].split('\t').map((c) => c.trim());
  const col = {
    usps: header.indexOf('USPS'),
    geoid: header.indexOf('GEOID'),
    name: header.indexOf('NAME'),
    lat: header.indexOf('INTPTLAT'),
    lng: header.indexOf('INTPTLONG'),
  };
  for (const [key, idx] of Object.entries(col)) {
    if (idx === -1) throw new Error(`Gazetteer file missing expected column for "${key}"`);
  }

  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = line.split('\t').map((c) => c.trim());
    if (cols[col.usps] !== usps) continue;
    rows.push({
      county_fips: cols[col.geoid],
      county_name: cols[col.name],
      lat: Number(cols[col.lat]),
      lng: Number(cols[col.lng]),
    });
  }
  return rows;
}

/**
 * Downloads and extracts the Census county gazetteer, filters to one
 * state, and caches {county_fips, county_name, lat, lng} rows as this
 * project's county "centroid" — used as the fixed sample point for
 * counties (or parts of counties) with no existing charger to sample near.
 * Requires the system `unzip` utility (present by default on macOS/Linux);
 * there's no pure-JS zip dependency elsewhere in this project, and this is
 * a one-off/occasional ingest, not a hot path.
 */
export async function ingestCountyCentroids({ state = config.pilotState, fetchImpl = fetch } = {}) {
  const usps = STATE_USPS[state];
  if (!usps) throw new Error(`No USPS mapping for state "${state}"`);

  const res = await fetchImpl(GAZETTEER_URL);
  if (!res.ok) throw new Error(`Gazetteer download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const tmpDir = await mkdtemp(path.join(tmpdir(), 'volt-terra-gazetteer-'));
  try {
    const zipPath = path.join(tmpDir, 'gazetteer.zip');
    await writeFile(zipPath, buf);
    const { stdout } = await execFileAsync('unzip', ['-p', zipPath, GAZETTEER_ENTRY], {
      maxBuffer: 20 * 1024 * 1024,
    });

    const counties = parseGazetteerText(stdout, { usps }).sort((a, b) =>
      a.county_fips.localeCompare(b.county_fips)
    );

    const output = {
      state,
      fetched_at: new Date().toISOString(),
      source: 'US Census Bureau 2020 Gazetteer Files — county internal points',
      source_url: GAZETTEER_URL,
      counties,
    };

    const outPath = path.join(DATA_DIR, `county-centroids-${state}.json`);
    await writeFile(outPath, JSON.stringify(output, null, 2));
    return { outPath, ...output };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { outPath, counties } = await ingestCountyCentroids();
  console.log(`Wrote ${outPath}: ${counties.length} county centroids.`);
}
