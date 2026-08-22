// The agentic loop, per docs/volt-terra-spec.pdf:
//   1. Data ingest       -> afdc.js + registrations.js            [done]
//   2. County sampling   -> population center + corridor points   [done]
//   3. Canonical join    -> mireye.lookup                          [done]
//   4. Cost check        -> mireye.fetchQuote                      [done]
//   5. Grid data fetch   -> mireye.fetchBatchChunked                [done]
//   6. Scoring           -> scoring.js                               [Days 8-9]
//   7. Threshold+bucket  -> scoring.js                               [Days 8-9]
//   8. Memo generation   -> memo-generator.js                        [Days 10-11]
//   9. Persist results   -> server/data/cache/run-<state>.json       [Days 10-11]
//
// Deviation from the spec's step list: no /v1/geocode call. Geocode
// resolves an address string to a coordinate, but every sample point here
// already has one — the county's Census population center, or an AFDC
// station's own lat/lng — so there's no address in the loop to resolve.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { mireye } from './mireye.js';
import { ingestAfdc } from './afdc.js';
import { ingestRegistrations } from './registrations.js';
import { ingestPopulationCenters } from './population-centers.js';
import { listCountiesForState } from '../lib/zip-county.js';
import { getCountyCentroid } from '../lib/county-centroids.js';
import { writeJsonAtomic } from '../lib/atomic-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');

// Curated subset of the grid_interconnect + utilities presets (56 fields
// combined, 4 overlapping) relevant to *EV-charger* grid feasibility:
// substation proximity/voltage, interconnection headroom, transmission
// redundancy, and nearby generation. Excludes utilities' water/sewer/
// wastewater/gas fields (no bearing on whether a charger can get power) and
// the 6 non-CAISO interconnection-queue-capacity variants (this pilot is
// CA/CAISO only) — paying for fields with no decision value fails the
// build brief's "argue why the rule is reasonable" test.
// nearest_osm_substation_* fields added after the Days 5-7 field selection
// was first curated: Mireye's catalog grew from 310 to 325 fields mid-
// project, adding an OpenStreetMap-sourced substation layer alongside the
// EIA one. Found via the Days 10-11 memo cross-check, not proactively —
// /v1/ask pulled OSM fields we weren't fetching ourselves and, for
// Riverside County, found a substation (12.2km away via OSM) where our
// EIA-only fetch had returned nothing at all. scoring.js uses this as a
// fallback source only when the EIA fields are absent (see
// computeGridFeasibilityScore) — EIA stays primary since Mireye's own
// confidence ratings run higher on it.
export const GRID_FEASIBILITY_FIELDS = [
  'nearest_substation_distance_m',
  'nearest_substation_max_voltage_kv',
  'nearest_substation_status',
  'nearest_osm_substation_distance_m',
  'nearest_osm_substation_max_voltage_kv',
  'electric_utility_service_territory',
  'iso_rto',
  'interconnection_queue_active_capacity_caiso_mw',
  'transmission_lines_within_radius_count',
  'substations_within_radius_count',
  'substations_radius_m',
  'transmission_redundancy_flag',
  'nearest_transmission_line_distance_m',
  'nearest_transmission_line_voltage_kv',
  'nearest_transmission_line_voltage_class',
  'nearest_transmission_line_status',
  'max_transmission_line_voltage_kv_within_radius',
  'nearest_power_plant_distance_m',
  'nearest_power_plant_capacity_mw',
  'nearest_power_plant_technology',
  'nearest_proposed_generator_distance_m',
  'nearest_proposed_generator_capacity_mw',
  'nearest_proposed_generator_status',
];

/**
 * Step 2, county sampling: one fixed point per county (its Census mean
 * center of population, an independent demand-geography proxy) with the
 * county internal point as a fallback, plus up to a few "corridor" points.
 * Existing charger locations from the AFDC ingest stand in for corridor
 * dataset this project doesn't have in scope. A county with zero chargers
 * still gets sampled via its population center (or internal-point fallback).
 */
export function buildCountySamplePoints({ populationCenter, centroid, corridorPoints = [] }) {
  const points = [];
  if (populationCenter) {
    points.push({
      type: 'population_center',
      lat: populationCenter.lat,
      lng: populationCenter.lng,
      source: 'census_2020_mean_center_of_population',
    });
  } else if (centroid) {
    points.push({ type: 'centroid', lat: centroid.lat, lng: centroid.lng, source: 'census_gazetteer_2020' });
  }
  for (const cp of corridorPoints) {
    points.push({
      type: 'corridor',
      lat: cp.lat,
      lng: cp.lng,
      source: 'afdc_station',
      station_name: cp.station_name,
    });
  }
  return points;
}

/**
 * Step 3, canonical join: compares our own ZIP/gazetteer-based county
 * assignment for a sample point against Mireye's own /v1/lookup result.
 * Surfaces disagreement rather than silently trusting one source — the
 * ZIP-crosswalk's own docs (README) already flag county-line ZIPs as a
 * blind spot, so a mismatch here is expected occasionally, not a bug.
 */
export function checkLookupAgreement(samplePoint, lookupResult, expectedFips) {
  const resolvedFips = lookupResult?.county_fips ?? null;
  return {
    ...samplePoint,
    mireye_lookup: {
      county_fips: resolvedFips,
      county: lookupResult?.county ?? null,
      confidence: lookupResult?.confidence ?? null,
      matches_expected: resolvedFips === expectedFips,
    },
  };
}

export async function runFullSweep({ state = config.pilotState, maxSweepCredits = config.maxSweepCredits } = {}) {
  const [afdc, registrations, populationCenters] = await Promise.all([
    ingestAfdc({ state }),
    ingestRegistrations({ state }),
    ingestPopulationCenters({ state }),
  ]);

  const registrationsByFips = new Map(registrations.counties.map((c) => [c.county_fips, c]));
  const chargersByFips = new Map(afdc.counties.map((c) => [c.county_fips, c]));
  const populationCentersByFips = new Map(populationCenters.counties.map((c) => [c.county_fips, c]));

  const counties = listCountiesForState(state).map((county) => ({
    county_fips: county.county_fips,
    county_name: county.county_name,
    sample_points: buildCountySamplePoints({
      populationCenter: populationCentersByFips.get(county.county_fips) ?? null,
      centroid: getCountyCentroid(county.county_fips, state),
      corridorPoints: chargersByFips.get(county.county_fips)?.corridor_points ?? [],
    }),
  }));

  const flatPoints = counties.flatMap((c) =>
    c.sample_points.map((p) => ({ ...p, county_fips: c.county_fips }))
  );

  // Cost check before every metered call. The guard includes both the batch
  // fetch and the one-credit canonical lookup for every point, so rejecting
  // an oversized sweep cannot itself consume lookup credits.
  // /v1/fetch/quote caps `locations` at 25 (mirroring /v1/fetch/batch), so
  // this quotes one location and scales linearly — billing is deterministic
  // (fetch_per_field x fields x locations, per GET /v1/meta/plans), and a
  // 1-location quote still catches a stale/renamed field before it costs
  // anything for real.
  const perLocationQuote = await mireye.fetchQuote({ fields: GRID_FEASIBILITY_FIELDS, locations: 1 });
  const estimatedFetchCredits = perLocationQuote.credits_total * flatPoints.length;
  const estimatedLookupCredits = flatPoints.length;
  const estimatedCredits = estimatedFetchCredits + estimatedLookupCredits;
  if (estimatedCredits > maxSweepCredits) {
    throw new Error(
      `Sweep would cost ~${estimatedCredits} credits ` +
        `(${estimatedFetchCredits} fetch + ${estimatedLookupCredits} lookup credits), ` +
        `over the ${maxSweepCredits}-credit safety cap (MAX_SWEEP_CREDITS). ` +
        `Raise the cap or reduce sample points before re-running.`
    );
  }
  const creditsRemaining = perLocationQuote.allowance?.credits_remaining;
  if (Number.isFinite(creditsRemaining) && estimatedCredits > creditsRemaining) {
    throw new Error(`Sweep would cost ~${estimatedCredits} credits, but only ${creditsRemaining} remain.`);
  }

  // Canonical join, one /v1/lookup per sample point. include_parcel stays
  // false throughout (see mireye.js): parcel resolution is out of scope and
  // far more expensive than a coordinate lookup.
  const lookupResults = [];
  for (const point of flatPoints) {
    const result = await mireye.lookup(`${point.lat},${point.lng}`, { kind: 'coord', includeParcel: false });
    lookupResults.push(result);
  }

  // Step 5: grid data fetch, batched (<=25 locations/call) and rate-limited
  // inside MireyeClient.
  const gridResults = await mireye.fetchBatchChunked({
    locations: flatPoints.map((p) => ({ lat: p.lat, lng: p.lng })),
    fields: GRID_FEASIBILITY_FIELDS,
  });

  const enrichedPoints = flatPoints.map((point, i) => ({
    ...checkLookupAgreement(point, lookupResults[i], point.county_fips),
    grid_fields: gridResults[i]?.fields ?? null,
  }));
  const lookupMismatches = enrichedPoints.filter((p) => !p.mireye_lookup.matches_expected);

  const pointsByCounty = new Map();
  for (const point of enrichedPoints) {
    if (!pointsByCounty.has(point.county_fips)) pointsByCounty.set(point.county_fips, []);
    pointsByCounty.get(point.county_fips).push(point);
  }

  const joinedCounties = counties.map((c) => {
    const charger = chargersByFips.get(c.county_fips);
    return {
      county_fips: c.county_fips,
      county_name: c.county_name,
      registrations: registrationsByFips.get(c.county_fips) ?? null,
      chargers: {
        station_count: charger?.station_count ?? 0,
        level2_ports: charger?.level2_ports ?? 0,
        dc_fast_ports: charger?.dc_fast_ports ?? 0,
        level1_ports: charger?.level1_ports ?? 0,
      },
      sample_points: (pointsByCounty.get(c.county_fips) ?? []).map(({ county_fips: _omit, ...point }) => point),
    };
  });

  const output = {
    state,
    generated_at: new Date().toISOString(),
    fields_fetched: GRID_FEASIBILITY_FIELDS,
    credits_spent: estimatedCredits,
    counties_processed: joinedCounties.length,
    sample_points_total: flatPoints.length,
    // Split by reason: `different_county` is a genuine cross-validation
    // disagreement (Mireye's coordinate-based resolution names a real,
    // different county — the ZIP-crosswalk blind spot this check exists to
    // catch). `unresolved` is /v1/lookup returning no county at all for a
    // coordinate — observed on the Days 12-13 re-run to be transient, not a
    // real geographic ambiguity: every unresolved coordinate from that run
    // resolved correctly to the expected county on an immediate manual
    // retry against the live API. Conflating the two under one count would
    // overstate genuine disagreement with our ZIP crosswalk.
    lookup_mismatches: lookupMismatches.map((p) => ({
      county_fips: p.county_fips,
      lat: p.lat,
      lng: p.lng,
      expected_county_fips: p.county_fips,
      mireye_county_fips: p.mireye_lookup.county_fips,
      reason: p.mireye_lookup.county_fips == null ? 'unresolved' : 'different_county',
    })),
    counties: joinedCounties,
  };

  await mkdir(CACHE_DIR, { recursive: true });
  const outPath = path.join(CACHE_DIR, `join-pipeline-${state}.json`);
  await writeJsonAtomic(outPath, output);

  return { outPath, ...output };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runFullSweep();
  console.log(
    `Wrote ${result.outPath}: ${result.counties_processed} counties, ` +
      `${result.sample_points_total} sample points, ~${result.credits_spent} credits spent, ` +
      `${result.lookup_mismatches.length} lookup mismatches.`
  );
}
