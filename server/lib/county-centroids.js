import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Built by server/services/county-centroids.js from the Census Bureau's
// 2020 county gazetteer file. See that file for the "internal point vs.
// bounding-box centroid" rationale.
const CENTROID_PATHS = {
  CA: path.join(__dirname, '../data/county-centroids-CA.json'),
};

const cache = new Map();

function loadCentroids(state) {
  if (cache.has(state)) return cache.get(state);
  const filePath = CENTROID_PATHS[state];
  if (!filePath) {
    throw new Error(`No county centroids bundled for state "${state}"`);
  }
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  const byFips = new Map(data.counties.map((c) => [c.county_fips, c]));
  cache.set(state, byFips);
  return byFips;
}

/** Returns {county_fips, county_name, lat, lng} for a county, or null if unknown. */
export function getCountyCentroid(fips, state = 'CA') {
  return loadCentroids(state).get(fips) ?? null;
}
