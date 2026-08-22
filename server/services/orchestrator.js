// The agentic loop, per docs/volt-terra-spec.pdf:
//   1. Data ingest       -> afdc.js + registrations.js            [done]
//   2. County sampling   -> centroid + corridor points per county [done]
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
// already has one — the county's Census-gazetteer centroid, or an AFDC
// station's own lat/lng — so there's no address in the loop to resolve.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { mireye } from './mireye.js';
import { ingestAfdc } from './afdc.js';
import { ingestRegistrations } from './registrations.js';
import { listCountiesForState } from '../lib/zip-county.js';
import { getCountyCentroid } from '../lib/county-centroids.js';
import { haversineDistanceMeters } from '../lib/geo.js';

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

// Trigger for adding a demand_centroid sample point (below): the distance
// between a county's Census-gazetteer centroid and its charger-weighted
// demand centroid (afdc.js's demand_centroid — mean of every charger in
// the county). Below this, evaluating grid data at the geographic centroid
// is a reasonable proxy for "where people/infrastructure are" and any
// divergence is normal county elongation. Above it, the centroid can be
// evaluating a place with no real relationship to where charging demand
// or infrastructure actually sits — confirmed on real CA data, not a
// hypothetical: Riverside County's centroid sits 84km from where its
// chargers cluster (a remote desert vs. the urban Inland Empire), and San
// Bernardino's is 125km off (its centroid lands in the Mojave). San
// Francisco's is a different flavor of the same problem — the county's
// official land area includes the Farallon Islands, ~55km offshore, which
// pulls its Census internal point away from the entirely urban mainland
// where every one of its 509 chargers sits. 50km sits well above the
// state median divergence (17.6km across all 58 CA counties) and below
// these three's actual values, so it catches genuinely broken cases
// without firing on ordinary geographic spread.
export const CENTROID_DIVERGENCE_THRESHOLD_M = 50_000;

/**
 * Step 2, county sampling: one fixed point per county (its Census-gazetteer
 * centroid) plus up to a few "corridor" points — existing charger
 * locations from the AFDC ingest, standing in for a highway-corridor
 * dataset this project doesn't have in scope. A county with zero chargers
 * still gets sampled via its centroid alone.
 *
 * When the county's demand_centroid (afdc.js) diverges from the geographic
 * centroid by more than CENTROID_DIVERGENCE_THRESHOLD_M, an additional
 * `demand_centroid` sample point is added — scoring.js prefers it as the
 * primary bucket-deciding point over the geographic centroid in that case
 * (see scoreCountyGridFeasibility), since the geographic centroid has been
 * shown to be a poor proxy for that county specifically.
 */
export function buildCountySamplePoints({ centroid, corridorPoints = [], demandCentroid = null }) {
  const points = [];
  if (centroid) {
    points.push({ type: 'centroid', lat: centroid.lat, lng: centroid.lng, source: 'census_gazetteer_2020' });
  }
  if (centroid && demandCentroid) {
    const divergenceM = haversineDistanceMeters(centroid, demandCentroid);
    if (divergenceM > CENTROID_DIVERGENCE_THRESHOLD_M) {
      points.push({
        type: 'demand_centroid',
        lat: demandCentroid.lat,
        lng: demandCentroid.lng,
        source: 'afdc_station_mean',
        divergence_from_centroid_m: Math.round(divergenceM),
      });
    }
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
  const [afdc, registrations] = await Promise.all([ingestAfdc({ state }), ingestRegistrations({ state })]);

  const registrationsByFips = new Map(registrations.counties.map((c) => [c.county_fips, c]));
  const chargersByFips = new Map(afdc.counties.map((c) => [c.county_fips, c]));

  const counties = listCountiesForState(state).map((county) => ({
    county_fips: county.county_fips,
    county_name: county.county_name,
    sample_points: buildCountySamplePoints({
      centroid: getCountyCentroid(county.county_fips, state),
      corridorPoints: chargersByFips.get(county.county_fips)?.corridor_points ?? [],
      demandCentroid: chargersByFips.get(county.county_fips)?.demand_centroid ?? null,
    }),
  }));

  const flatPoints = counties.flatMap((c) =>
    c.sample_points.map((p) => ({ ...p, county_fips: c.county_fips }))
  );

  // Step 3: canonical join, one /v1/lookup per sample point. include_parcel
  // stays false throughout (see mireye.js) — parcel data is 300 credits/
  // location vs. 1, and out of scope per the build brief.
  const lookupResults = [];
  for (const point of flatPoints) {
    const result = await mireye.lookup(`${point.lat},${point.lng}`, { kind: 'coord', includeParcel: false });
    lookupResults.push(result);
  }

  // Step 4: cost check. Quote before every real sweep, per the build brief.
  // /v1/fetch/quote caps `locations` at 25 (mirroring /v1/fetch/batch), so
  // this quotes one location and scales linearly — billing is deterministic
  // (fetch_per_field x fields x locations, per GET /v1/meta/plans), and a
  // 1-location quote still catches a stale/renamed field before it costs
  // anything for real.
  const perLocationQuote = await mireye.fetchQuote({ fields: GRID_FEASIBILITY_FIELDS, locations: 1 });
  const estimatedCredits = perLocationQuote.credits_total * flatPoints.length;
  if (estimatedCredits > maxSweepCredits) {
    throw new Error(
      `Sweep would cost ~${estimatedCredits} credits ` +
        `(${flatPoints.length} locations x ${perLocationQuote.credits_total} credits/location), ` +
        `over the ${maxSweepCredits}-credit safety cap (MAX_SWEEP_CREDITS). ` +
        `Raise the cap or reduce sample points before re-running.`
    );
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
    credits_spent: estimatedCredits + flatPoints.length, // batch fetch + 1-credit lookups
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
  await writeFile(outPath, JSON.stringify(output, null, 2));

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
