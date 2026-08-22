import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Built from the Census Bureau's 2020 ZCTA-to-county relationship file
// (www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt),
// filtered to California (FIPS prefix 06). A ZCTA that straddles more than
// one county is assigned to whichever county holds the larger land-area
// share of that ZCTA — an approximation, not a parcel-exact join. ZCTAs
// also don't perfectly match USPS ZIP delivery areas. This is the blind
// spot: a charger or registration right at a county line can land on the
// wrong side.
const CROSSWALK_PATHS = {
  CA: path.join(__dirname, '../data/zip-county-crosswalk-ca.json'),
};

const cache = new Map();

function loadCrosswalk(state) {
  if (cache.has(state)) return cache.get(state);
  const filePath = CROSSWALK_PATHS[state];
  if (!filePath) {
    throw new Error(`No ZIP-county crosswalk bundled for state "${state}"`);
  }
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  cache.set(state, data);
  return data;
}

/**
 * Resolve a 5-digit ZIP to its primary county FIPS + name for the given
 * state. Returns null if the ZIP isn't in the crosswalk (e.g. a PO-box-only
 * ZIP with no residential ZCTA, or a typo).
 */
export function zipToCounty(zip, state = 'CA') {
  if (!zip) return null;
  const normalized = String(zip).trim().slice(0, 5);
  const crosswalk = loadCrosswalk(state);
  return crosswalk[normalized] ?? null;
}

export function listCountiesForState(state = 'CA') {
  const crosswalk = loadCrosswalk(state);
  const byFips = new Map();
  for (const entry of Object.values(crosswalk)) {
    byFips.set(entry.county_fips, entry.county_name);
  }
  return [...byFips.entries()].map(([county_fips, county_name]) => ({
    county_fips,
    county_name,
  }));
}
