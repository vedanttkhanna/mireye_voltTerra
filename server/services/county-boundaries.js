// County polygon boundaries, for the map's choropleth layer. A different
// Census product than county-centroids.js (which only has a single point
// per county) — this pulls the actual polygon geometry.
//
// Census doesn't publish these as GeoJSON directly (shapefile, geodatabase,
// KML, or geopackage only). KML is the one of those that's plain XML, so it
// converts without a GDAL/shapefile toolchain — @tmcw/togeojson handles the
// real KML geometry semantics (MultiGeometry, interior-ring holes) that a
// hand-rolled parser would risk getting subtly wrong. San Francisco is a
// concrete reason this matters: its official boundary is 5 separate
// polygons (mainland plus the Farallon Islands and others), which KML
// represents as MultiGeometry — togeojson correctly turns that into a
// GeometryCollection rather than silently keeping only one polygon.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import { config } from '../config.js';
import { writeJsonAtomic } from '../lib/safe-persistence.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

// 2020 vintage, matching county-centroids.js and the ZIP-county crosswalk.
// 500k = 1:500,000 scale — Census's most detailed cartographic (not
// legal/TIGER) boundary resolution, small enough to ship in a dashboard
// without a simplification step.
const BOUNDARY_KML_URL = 'https://www2.census.gov/geo/tiger/GENZ2020/kml/cb_2020_us_county_500k.zip';
const BOUNDARY_KML_ENTRY = 'cb_2020_us_county_500k.kml';

const STATE_FIPS = { CA: '06' }; // extend if a second pilot state is ever added

export async function ingestCountyBoundaries({ state = config.pilotState, fetchImpl = fetch } = {}) {
  const stateFips = STATE_FIPS[state];
  if (!stateFips) throw new Error(`No STATEFP mapping for state "${state}"`);

  const res = await fetchImpl(BOUNDARY_KML_URL);
  if (!res.ok) throw new Error(`County boundary KML download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const tmpDir = await mkdtemp(path.join(tmpdir(), 'volt-terra-boundaries-'));
  try {
    const zipPath = path.join(tmpDir, 'boundaries.zip');
    await writeFile(zipPath, buf);
    const { stdout: kmlText } = await execFileAsync('unzip', ['-p', zipPath, BOUNDARY_KML_ENTRY], {
      maxBuffer: 100 * 1024 * 1024,
    });

    const dom = new DOMParser().parseFromString(kmlText, 'text/xml');
    const national = kmlToGeoJson(dom);

    const features = national.features
      .filter((f) => f.properties?.STATEFP === stateFips)
      .map((f) => ({
        type: 'Feature',
        properties: {
          county_fips: f.properties.GEOID,
          county_name: f.properties.NAMELSAD,
        },
        geometry: f.geometry,
      }))
      .sort((a, b) => a.properties.county_fips.localeCompare(b.properties.county_fips));
    if (features.length === 0 || features.some((f) => !/^\d{5}$/.test(f.properties.county_fips) || !f.geometry?.type)) {
      throw new Error('Census boundary file produced invalid or empty features; keeping existing file');
    }
    if (new Set(features.map((f) => f.properties.county_fips)).size !== features.length) {
      throw new Error('Census boundary file produced duplicate county FIPS values; keeping existing file');
    }

    const output = {
      type: 'FeatureCollection',
      state,
      fetched_at: new Date().toISOString(),
      source: 'US Census Bureau 2020 Cartographic Boundary Files (1:500,000), county KML',
      source_url: 'https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html',
      features,
    };

    const outPath = path.join(DATA_DIR, `county-boundaries-${state}.json`);
    await writeJsonAtomic(outPath, output);
    return { outPath, ...output };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { outPath, features } = await ingestCountyBoundaries();
  console.log(`Wrote ${outPath}: ${features.length} county boundaries.`);
}
