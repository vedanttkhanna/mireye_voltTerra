// Days 8-9: peer-relative underserved threshold + grid-feasibility score +
// the fund-now/fund-grid-upgrade split, built on top of the join pipeline's
// output (server/data/cache/join-pipeline-<state>.json, Days 5-7).

import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { writeJsonAtomic } from '../lib/atomic-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');

// "Charger count" = Level 2 + DC fast ports, excluding Level 1. Level 1
// (120V, ~5 mi range/hour) is a negligible slice of the public network —
// 663 of 77,435 ports statewide in the Days 1-2 AFDC ingest, under 1% — and
// isn't a serious public/road-trip charging resource the way L2 and DC fast
// are. Counting L2 and DC fast equally (rather than weighting DC fast
// higher for its faster turnover) avoids inventing an unverifiable
// throughput multiplier; it's a real limitation, named below rather than
// hidden — see README's Known blind spots.
export function computeDriverToPlugRatio({ registrations, chargerCount }) {
  if (!chargerCount) return null;
  return registrations / chargerCount;
}

/**
 * Flags a county once its ratio exceeds `multiplier` x the state median,
 * per the build brief's "keep the threshold relative to regional peers"
 * requirement.
 */
export function flagUnderservedCounties(
  countiesWithRatio,
  { multiplier = config.underservedThresholdMultiplier } = {}
) {
  const ratios = countiesWithRatio.map((c) => c.ratio).filter((r) => r != null).sort((a, b) => a - b);
  const zeroPortCounties = countiesWithRatio.filter((c) => c.chargerCount === 0 && c.latestRegistrations > 0);
  if (ratios.length === 0) return { median: null, flagged: zeroPortCounties };

  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid];

  const flagged = countiesWithRatio.filter(
    (c) => (c.chargerCount === 0 && c.latestRegistrations > 0) || (c.ratio != null && c.ratio >= median * multiplier)
  );
  return { median, flagged };
}

// --- Grid feasibility ---------------------------------------------------
//
// Thresholds picked from what nearest_substation_distance_m and
// nearest_substation_max_voltage_kv actually mean (per Mireye's own field
// catalog, GET /v1/meta/fields), not fit to our sample or picked round for
// their own sake:
//
// - Distance is the dominant real-world cost driver: Mireye's own
//   interpretation_hints for nearest_substation_distance_m say interconnect
//   cost "scales with gen-tie/feeder distance: within a few km is
//   materially cheaper/faster; >10-20km often kills a site." A public EV
//   charger project has a far smaller budget than the generation projects
//   that hint is calibrated for, so SUBSTATION_DISTANCE_CONSTRAINED_M sits
//   well under that ceiling rather than at it. Distance also gets more
//   weight than voltage in the score below for the same reason: a
//   too-small substation can often be upgraded in place, but a long new
//   feeder run cannot be engineered away.
// - Voltage measures headroom, not cost: 60kV is the conventional
//   sub-transmission floor — below it a substation is local-distribution
//   plant, sized for its immediate neighborhood rather than a new multi-MW
//   load. Only 2 of 192 substations resolved in the Days 5-7 CA sweep fall
//   under 60kV, so this gate is narrow, not a guess dressed up as a rule.
// - A substation's published status other than "IN SERVICE" (retired,
//   proposed, under construction) is a real disqualifier — you cannot
//   interconnect to a substation that isn't energized. An *unpublished*
//   status is NOT the same thing: per null_meaning, it just means EIA
//   hasn't published a status for that record (75 of 232 points in the
//   Days 5-7 sweep), so it does not gate on its own.
//
// What this deliberately does NOT use:
// interconnection_queue_active_capacity_caiso_mw looks like a natural fit
// (it's literally in the grid_interconnect preset, and the spec's own
// worked example cites "CAISO Interconnection Queue" for a county's
// grid-capacity story) but per its own field description it counts active
// GENERATOR interconnection requests in a county — solar/wind/storage
// projects queued to connect, not spare load capacity for something like
// an EV charger, which interconnects as a distribution load through an
// entirely different utility process. A large county-level queue number
// could mean genuine grid stress, or just that the county is an attractive
// place to build new generation — it doesn't resolve either way at the
// substation level a charger actually needs. Using it as a hard gate would
// overclaim precision the field doesn't have; it's carried through in
// grid_context below as citable, informational context instead.
export const SUBSTATION_DISTANCE_CHEAP_M = 3218; // 2 miles
export const SUBSTATION_DISTANCE_CONSTRAINED_M = 8000; // ~5 miles
export const SUBSTATION_VOLTAGE_MIN_KV = 60;
export const SUBSTATION_VOLTAGE_HIGH_KV = 230;

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function fieldValue(gridFields, name) {
  const f = gridFields?.[name];
  return f?.status === 'ok' ? f.value : null;
}

/**
 * Scores one sample point's grid_fields (the shape produced by the join
 * pipeline, Days 5-7) for EV-charger interconnection feasibility. Returns
 * both a 0-100 score (for ranking/display) and a `passes_gates` verdict
 * (the actual fund-now/fund-grid-upgrade decision, in bucketCounty below)
 * — the score never overrides the gates; it's a display aid, not a second
 * source of truth.
 */
export function computeGridFeasibilityScore(gridFields) {
  const eiaDistance = fieldValue(gridFields, 'nearest_substation_distance_m');
  const eiaVoltage = fieldValue(gridFields, 'nearest_substation_max_voltage_kv');
  const status = fieldValue(gridFields, 'nearest_substation_status');
  const redundant = fieldValue(gridFields, 'transmission_redundancy_flag');

  // OSM substation fallback (see orchestrator.js's GRID_FEASIBILITY_FIELDS
  // comment): only consulted when EIA found nothing. EIA stays primary
  // when both are present — nothing here suggests OSM is *more* accurate,
  // it's a second independent source used to fill EIA's gaps, not to
  // second-guess EIA where it already has an answer. OSM has no published
  // operational-status field, so the status gate simply doesn't apply when
  // running on the fallback — there's no "unpublished status" ambiguity to
  // resolve because the concept doesn't exist in this source.
  const osmDistance = fieldValue(gridFields, 'nearest_osm_substation_distance_m');
  const osmVoltage = fieldValue(gridFields, 'nearest_osm_substation_max_voltage_kv');
  const usingOsmFallback = eiaDistance == null && osmDistance != null;

  const distance = usingOsmFallback ? osmDistance : eiaDistance;
  const voltage = usingOsmFallback ? osmVoltage : eiaVoltage;
  const substationSource = usingOsmFallback ? 'OSM' : eiaDistance != null ? 'EIA' : null;

  const substationFound = distance != null;
  const statusDisqualifies = !usingOsmFallback && status != null && status !== 'IN SERVICE';
  const hasDecisionData = substationFound && voltage != null;

  const distanceScore = distance == null ? 0 : Math.round(60 * clamp01(1 - distance / SUBSTATION_DISTANCE_CONSTRAINED_M));
  const voltageScore = voltage == null ? 0 : voltage >= SUBSTATION_VOLTAGE_HIGH_KV ? 40 : voltage >= SUBSTATION_VOLTAGE_MIN_KV ? 25 : 0;
  const redundancyBonus = redundant === true ? 10 : 0;

  const score = substationFound && !statusDisqualifies ? Math.min(100, distanceScore + voltageScore + redundancyBonus) : 0;

  const passesGates =
    substationFound &&
    !statusDisqualifies &&
    distance <= SUBSTATION_DISTANCE_CONSTRAINED_M &&
    voltage != null &&
    voltage >= SUBSTATION_VOLTAGE_MIN_KV;

  const gateFailures = [
    !substationFound && 'no_substation_found',
    statusDisqualifies && `substation_not_in_service:${status}`,
    substationFound && distance > SUBSTATION_DISTANCE_CONSTRAINED_M && 'distance_too_far',
    substationFound && !statusDisqualifies && (voltage == null || voltage < SUBSTATION_VOLTAGE_MIN_KV) && 'voltage_too_low',
  ].filter(Boolean);

  return {
    score,
    passes_gates: passesGates,
    data_status: hasDecisionData ? 'sufficient' : 'insufficient',
    gate_failures: gateFailures,
    inputs: {
      substation_distance_m: distance,
      substation_voltage_kv: voltage,
      substation_status: usingOsmFallback ? null : status,
      substation_source: substationSource,
      transmission_redundant: redundant,
    },
  };
}

/**
 * Scores a county's sample points and picks the bucket-deciding ("primary")
 * site, with the best-scoring remaining point carried along as
 * informational context only.
 *
 * Primary point priority: Census population center > county internal point
 * fallback > best remaining point.
 *
 * Earlier version of this function picked whichever sample point scored
 * highest, corridor points included, on the reasoning that "is there a
 * feasible site somewhere in this county" is the real funding question.
 * That's true in principle, but corridor points are existing AFDC charger
 * locations — sites a utility or developer already built specifically
 * because they had easy grid access. Letting them win the "best site" pick
 * means every county with even one existing charger tends to score well
 * regardless of the surrounding area, which quietly biases every flagged
 * county toward fund_charger_now. Confirmed on the live Days 5-7 CA run:
 * Riverside County's centroid has NO substation within radius at all
 * (status: absent — genuinely inconclusive grid data), but an existing
 * charger's corridor point 913m from a 66kV substation was picked as
 * "best," flipping the bucket to fund_charger_now on data that shouldn't
 * have supported it. The centroid — the spec's own worked example frames
 * Madera's grid story around "2.1 mi from county centroid," not the
 * nearest existing charger — is the fairer, unbiased read on county-wide
 * demand geography, so it became primary instead.
 *
 * A county's Census mean center of population is now the primary point.
 * Unlike an average of existing charger locations, it is independent of
 * historic charging supply and remains representative for large or oddly
 * shaped counties. The Gazetteer internal point is only a data fallback.
 */
export function scoreCountyGridFeasibility(samplePoints = []) {
  const populationCenter = samplePoints.find((p) => p.type === 'population_center') ?? null;
  const centroid = samplePoints.find((p) => p.type === 'centroid') ?? null;
  const primaryPoint = populationCenter ?? centroid;

  const others = samplePoints.filter((p) => p !== primaryPoint).map((point) => ({
    point,
    feasibility: computeGridFeasibilityScore(point.grid_fields),
  }));

  // Defensive fallback for a county with no centroid sample point (doesn't
  // happen with the bundled CA data — all 58 counties resolve one — but a
  // future state's centroid ingest could fail for one county without
  // failing the whole sweep). Falls back to the best-scoring point with the
  // same self-selection caveat as above, and says so.
  const usedFallback = primaryPoint == null;
  const primaryEntry = primaryPoint
    ? { point: primaryPoint, feasibility: computeGridFeasibilityScore(primaryPoint.grid_fields) }
    : others.length
      ? others.reduce((a, b) => (b.feasibility.score > a.feasibility.score ? b : a))
      : null;

  const bestAlternative = others.length ? others.reduce((a, b) => (b.feasibility.score > a.feasibility.score ? b : a)) : null;

  return { primary: primaryEntry, bestAlternative, usedFallback, usedPopulationCenter: populationCenter != null };
}

/** Turns a feasibility result into a funding bucket or an explicit review state. */
export function bucketCounty(feasibility) {
  if (!feasibility) throw new Error('bucketCounty requires a feasibility result');
  if (feasibility.data_status === 'insufficient') return 'insufficient_data';
  return feasibility.passes_gates ? 'fund_charger_now' : 'fund_grid_upgrade_first';
}

/**
 * Ties the whole Days 8-9 signal chain together for the join pipeline's
 * output: ratio -> peer-relative flag -> (if flagged) grid feasibility at
 * the county's best sample point -> bucket. Non-flagged counties are
 * returned too (ranking context) but skip the grid-fetch-dependent scoring
 * — no funding decision to make for a county that isn't underserved.
 */
export function scoreAllCounties(joinPipelineOutput) {
  const withRatio = joinPipelineOutput.counties.map((c) => {
    const chargerCount = (c.chargers?.level2_ports || 0) + (c.chargers?.dc_fast_ports || 0);
    const registrations = c.registrations?.latest_registrations ?? null;
    const ratio = registrations != null ? computeDriverToPlugRatio({ registrations, chargerCount }) : null;
    return { ...c, chargerCount, latestRegistrations: registrations, ratio };
  });

  const { median, flagged } = flagUnderservedCounties(withRatio);
  const flaggedFips = new Set(flagged.map((c) => c.county_fips));

  const counties = withRatio.map((c) => {
    const underserved = flaggedFips.has(c.county_fips);
    let gridFeasibility = null;
    let bucket = null;

    if (underserved) {
      const { primary, bestAlternative, usedFallback, usedPopulationCenter } = scoreCountyGridFeasibility(c.sample_points);
      if (primary) {
        gridFeasibility = {
          ...primary.feasibility,
          sampled_at: { type: primary.point.type, lat: primary.point.lat, lng: primary.point.lng },
          used_fallback_site: usedFallback,
          // True when the independent Census population center was used;
          // false only for a Gazetteer/corridor fallback.
          used_population_center: usedPopulationCenter,
          grid_context: {
            interconnection_queue_active_capacity_caiso_mw: fieldValue(
              primary.point.grid_fields,
              'interconnection_queue_active_capacity_caiso_mw'
            ),
            // Informational only — NOT part of the bucket decision (see
            // scoreCountyGridFeasibility). Useful for a future memo: "though
            // the county centroid is grid-constrained, an existing charger
            // Nm away already sits near a substation with capacity."
            best_alternative_site: bestAlternative
              ? {
                  type: bestAlternative.point.type,
                  lat: bestAlternative.point.lat,
                  lng: bestAlternative.point.lng,
                  station_name: bestAlternative.point.station_name ?? null,
                  passes_gates: bestAlternative.feasibility.passes_gates,
                  score: bestAlternative.feasibility.score,
                }
              : null,
          },
        };
        bucket = bucketCounty(gridFeasibility);
      }
    }

    return {
      county_fips: c.county_fips,
      county_name: c.county_name,
      latest_registrations: c.latestRegistrations,
      charger_count: c.chargerCount,
      zero_charging_ports: c.chargerCount === 0,
      driver_to_plug_ratio: c.ratio,
      underserved,
      grid_feasibility: gridFeasibility,
      bucket,
    };
  });

  counties.sort((a, b) => {
    if (a.zero_charging_ports !== b.zero_charging_ports) return a.zero_charging_ports ? -1 : 1;
    return (b.driver_to_plug_ratio ?? -1) - (a.driver_to_plug_ratio ?? -1);
  });

  return {
    state: joinPipelineOutput.state,
    scored_at: new Date().toISOString(),
    state_median_driver_to_plug_ratio: median,
    underserved_threshold_multiplier: config.underservedThresholdMultiplier,
    counties_underserved: flagged.length,
    counties_fund_charger_now: counties.filter((c) => c.bucket === 'fund_charger_now').length,
    counties_fund_grid_upgrade_first: counties.filter((c) => c.bucket === 'fund_grid_upgrade_first').length,
    counties_insufficient_data: counties.filter((c) => c.bucket === 'insufficient_data').length,
    counties,
  };
}

export async function runScoring({ state = config.pilotState } = {}) {
  const raw = await readFile(path.join(CACHE_DIR, `join-pipeline-${state}.json`), 'utf8');
  const joinPipelineOutput = JSON.parse(raw);
  const result = scoreAllCounties(joinPipelineOutput);

  await mkdir(CACHE_DIR, { recursive: true });
  const outPath = path.join(CACHE_DIR, `scored-counties-${state}.json`);
  await writeJsonAtomic(outPath, result);
  return { outPath, ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runScoring();
  console.log(
    `Wrote ${r.outPath}: ${r.counties_underserved} of ${r.counties.length} counties underserved ` +
      `(ratio >= ${config.underservedThresholdMultiplier}x state median of ${r.state_median_driver_to_plug_ratio?.toFixed(1)}); ` +
      `${r.counties_fund_charger_now} fund_charger_now, ${r.counties_fund_grid_upgrade_first} fund_grid_upgrade_first.`
  );
  console.log(
    'Top 5 by ratio:',
    r.counties.slice(0, 5).map((c) => `${c.county_name} (${c.driver_to_plug_ratio?.toFixed(0)}, ${c.bucket ?? 'not flagged'})`)
  );
}
