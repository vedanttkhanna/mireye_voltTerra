// Days 12-13: backtest VOLT-TERRA's underserved-flag + bucket verdicts
// against real California NEVI award data — the closest available public
// ground truth to "known outcomes," per the build brief's evaluation ask.
//
// Important disanalogy, named up front rather than glossed over: NEVI
// awards are allocated by a federal Alternative Fuel Corridor coverage-gap
// process (is there a charger every ~50 highway miles on a designated
// corridor), not by county-level demand pressure the way VOLT-TERRA's
// driver-to-plug ratio is. A county can be heavily NEVI-funded because it
// straddles a major freight corridor and NOT be EV-registration-stressed,
// or vice versa. This backtest checks real-world plausibility and surfaces
// disagreements — it does not (and cannot) prove VOLT-TERRA's ratio-based
// signal is "the same as" NEVI's corridor-based one. See summarizeBacktest.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');

// California Energy Commission / Caltrans NEVI program awards, all three
// solicitation rounds, via the CEC's public ArcGIS Hub. Snapshot dated in
// the layer name; re-ingest to pick up newer awards as CEC updates it.
const NEVI_FEATURE_SERVER_URL =
  'https://services3.arcgis.com/bWPjFyq029ChCGur/arcgis/rest/services/' +
  '16_GFO_25_603_NEVI_1_3_Charging_Stations_Addendum_07_14_2026/FeatureServer/0/query';
const NEVI_SOURCE_PAGE = 'https://data.ca.gov/dataset/californias-national-electric-vehicle-infrastructure-funding-program-map';

// The raw CEC export has a few data-entry quirks (trailing whitespace and
// one outright typo) that would otherwise split a county into two rows.
const COUNTY_NAME_FIXES = { 'San Bernadino': 'San Bernardino' };

export function normalizeCountyName(raw) {
  const trimmed = raw.trim();
  return COUNTY_NAME_FIXES[trimmed] ?? trimmed;
}

/** Aggregates raw NEVI award records (one row per awarded station) to per-county counts. */
export function aggregateNeviAwardsByCounty(rows) {
  const byCounty = new Map();
  for (const r of rows) {
    const name = normalizeCountyName(r.County);
    if (!byCounty.has(name)) byCounty.set(name, { county_name: name, station_count: 0, awardees: new Set() });
    const bucket = byCounty.get(name);
    bucket.station_count += 1;
    if (r.Awardee) bucket.awardees.add(r.Awardee);
  }
  return [...byCounty.values()]
    .map(({ county_name, station_count, awardees }) => ({ county_name, station_count, awardee_count: awardees.size }))
    .sort((a, b) => b.station_count - a.station_count);
}

export async function ingestNeviAwards({ state = config.pilotState, fetchImpl = fetch } = {}) {
  if (state !== 'CA') throw new Error(`NEVI award ingest only covers CA (got "${state}")`);

  const url = `${NEVI_FEATURE_SERVER_URL}?where=1=1&outFields=Awardee,County,NEVI_Solicitation,Charging_Station_Address,F_Status&returnGeometry=false&f=json`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`NEVI FeatureServer query failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`NEVI FeatureServer error: ${JSON.stringify(data.error)}`);

  const rows = data.features.map((f) => f.attributes);
  const counties = aggregateNeviAwardsByCounty(rows);

  const output = {
    state,
    fetched_at: new Date().toISOString(),
    source: 'California Energy Commission / Caltrans NEVI program awards (Rounds 1-3), via CEC ArcGIS Hub',
    source_url: NEVI_SOURCE_PAGE,
    layer_url: NEVI_FEATURE_SERVER_URL,
    total_stations_awarded: rows.length,
    counties,
  };

  await mkdir(CACHE_DIR, { recursive: true });
  const outPath = path.join(CACHE_DIR, `nevi-awards-${state}.json`);
  await writeFile(outPath, JSON.stringify(output, null, 2));
  return { outPath, ...output };
}

/**
 * Joins the Days 8-9 scored-counties output to real NEVI award counts.
 * Our county names carry " County" (Census Gazetteer convention); NEVI's
 * export doesn't, so the join strips that suffix rather than requiring an
 * exact string match both ways.
 */
export function joinNeviToScoredCounties(scoredCounties, neviCounties) {
  const neviByName = new Map(neviCounties.map((c) => [c.county_name, c]));
  return scoredCounties.map((c) => {
    const shortName = c.county_name.replace(/ County$/, '');
    const nevi = neviByName.get(shortName) ?? null;
    return {
      county_fips: c.county_fips,
      county_name: c.county_name,
      driver_to_plug_ratio: c.driver_to_plug_ratio,
      underserved: c.underserved,
      bucket: c.bucket,
      nevi_stations_awarded: nevi?.station_count ?? 0,
      nevi_awardee_count: nevi?.awardee_count ?? 0,
    };
  });
}

/**
 * Summarizes the backtest into the four quadrants of {flagged, funded} x
 * {not flagged, not funded} — plainly reporting where the two signals
 * agree and where they don't, per the build brief's "report how it did,
 * including where it failed." Does NOT compute a single pass/fail
 * accuracy number: given the corridor-vs-demand disanalogy documented at
 * the top of this file, a single score would overstate what this
 * comparison can actually prove.
 */
export function summarizeBacktest(joined) {
  const flagged = joined.filter((c) => c.underserved);
  const flaggedWithFunding = flagged.filter((c) => c.nevi_stations_awarded > 0);
  const flaggedWithoutFunding = flagged.filter((c) => c.nevi_stations_awarded === 0);
  const notFlagged = joined.filter((c) => !c.underserved);
  const notFlaggedWithFunding = notFlagged.filter((c) => c.nevi_stations_awarded > 0);

  return {
    counties_total: joined.length,
    counties_flagged_underserved: flagged.length,
    counties_with_any_nevi_funding: joined.filter((c) => c.nevi_stations_awarded > 0).length,
    flagged_and_nevi_funded: flaggedWithFunding.map((c) => ({ county_name: c.county_name, nevi_stations: c.nevi_stations_awarded })),
    flagged_but_not_nevi_funded: flaggedWithoutFunding.map((c) => c.county_name),
    not_flagged_but_nevi_funded_count: notFlaggedWithFunding.length,
    flagged_nevi_funding_rate: flagged.length ? flaggedWithFunding.length / flagged.length : null,
  };
}

async function loadScoredCounties(state) {
  const raw = await readFile(path.join(CACHE_DIR, `scored-counties-${state}.json`), 'utf8');
  return JSON.parse(raw);
}

export async function runNeviBacktest({ state = config.pilotState } = {}) {
  const [scored, nevi] = await Promise.all([loadScoredCounties(state), ingestNeviAwards({ state })]);

  const joined = joinNeviToScoredCounties(scored.counties, nevi.counties);
  const summary = summarizeBacktest(joined);

  const output = {
    state,
    backtested_at: new Date().toISOString(),
    ground_truth_source: nevi.source,
    ground_truth_source_url: nevi.source_url,
    caveat:
      'NEVI awards are allocated by federal Alternative Fuel Corridor coverage-gap rules, not county-level ' +
      'EV-registration-per-charger demand pressure. Agreement is a plausibility signal, not proof of a correct answer.',
    summary,
    counties: joined,
  };

  await mkdir(CACHE_DIR, { recursive: true });
  const outPath = path.join(CACHE_DIR, `backtest-${state}.json`);
  await writeFile(outPath, JSON.stringify(output, null, 2));
  return { outPath, ...output };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runNeviBacktest();
  console.log(`Wrote ${r.outPath}`);
  console.log(
    `${r.summary.counties_flagged_underserved} counties flagged underserved; ` +
      `${r.summary.flagged_and_nevi_funded.length} of those have real NEVI funding ` +
      `(${(r.summary.flagged_nevi_funding_rate * 100).toFixed(0)}%).`
  );
  if (r.summary.flagged_but_not_nevi_funded.length) {
    console.log('Flagged but not (yet) NEVI-funded:', r.summary.flagged_but_not_nevi_funded.join(', '));
  }
  console.log(`${r.summary.not_flagged_but_nevi_funded_count} counties received NEVI funding despite not being flagged by our ratio signal — expected, given the corridor-vs-demand disanalogy above.`);
}
