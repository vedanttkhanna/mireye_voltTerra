import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDriverToPlugRatio,
  flagUnderservedCounties,
  computeGridFeasibilityScore,
  scoreCountyGridFeasibility,
  bucketCounty,
  scoreAllCounties,
  SUBSTATION_DISTANCE_CONSTRAINED_M,
  SUBSTATION_VOLTAGE_MIN_KV,
} from '../scoring.js';

// --- computeDriverToPlugRatio ---

test('computeDriverToPlugRatio divides registrations by charger count', () => {
  assert.equal(computeDriverToPlugRatio({ registrations: 3326, chargerCount: 183 }), 3326 / 183);
});

test('computeDriverToPlugRatio marks registered EVs with zero public ports as unbounded demand', () => {
  assert.equal(computeDriverToPlugRatio({ registrations: 100, chargerCount: 0 }), Infinity);
});

// --- flagUnderservedCounties ---

test('flagUnderservedCounties flags counties at or above multiplier x median', () => {
  const counties = [
    { county_fips: '1', ratio: 10 },
    { county_fips: '2', ratio: 20 },
    { county_fips: '3', ratio: 30 },
    { county_fips: '4', ratio: 100 }, // 5x the median of 20
  ];
  const { median, flagged } = flagUnderservedCounties(counties, { multiplier: 2 });
  assert.equal(median, 25); // (20+30)/2
  assert.deepEqual(flagged.map((c) => c.county_fips), ['4']);
});

test('flagUnderservedCounties ignores counties with a null ratio', () => {
  const counties = [{ ratio: 10 }, { ratio: null }, { ratio: 20 }];
  const { median } = flagUnderservedCounties(counties, { multiplier: 2 });
  assert.equal(median, 15);
});

test('flagUnderservedCounties returns nulls for an all-null input', () => {
  const { median, flagged } = flagUnderservedCounties([{ ratio: null }]);
  assert.equal(median, null);
  assert.deepEqual(flagged, []);
});

test('zero-port counties are always flagged without distorting the finite peer median', () => {
  const { median, flagged } = flagUnderservedCounties([
    { county_fips: 'zero', ratio: Infinity },
    { county_fips: 'a', ratio: 10 },
    { county_fips: 'b', ratio: 20 },
  ], { multiplier: 2 });
  assert.equal(median, 15);
  assert.deepEqual(flagged.map((c) => c.county_fips), ['zero']);
});

// --- computeGridFeasibilityScore ---

function gridFields({ distance, voltage, status, redundant, osmDistance, osmVoltage } = {}) {
  const ok = (value) => ({ value, status: value === undefined ? 'absent' : 'ok' });
  return {
    nearest_substation_distance_m: ok(distance),
    nearest_substation_max_voltage_kv: ok(voltage),
    nearest_substation_status: ok(status),
    transmission_redundancy_flag: ok(redundant),
    nearest_osm_substation_distance_m: ok(osmDistance),
    nearest_osm_substation_max_voltage_kv: ok(osmVoltage),
  };
}

test('computeGridFeasibilityScore passes a close, high-voltage, in-service substation', () => {
  const result = computeGridFeasibilityScore(gridFields({ distance: 500, voltage: 230, status: 'IN SERVICE' }));
  assert.equal(result.passes_gates, true);
  assert.equal(result.gate_failures.length, 0);
  assert.ok(result.score > 80);
  assert.equal(result.inputs.substation_source, 'EIA');
});

test('computeGridFeasibilityScore falls back to the OSM substation when EIA found none', () => {
  const result = computeGridFeasibilityScore(gridFields({ osmDistance: 3000, osmVoltage: 115 }));
  assert.equal(result.passes_gates, true);
  assert.equal(result.inputs.substation_source, 'OSM');
  assert.equal(result.inputs.substation_distance_m, 3000);
  assert.equal(result.inputs.substation_voltage_kv, 115);
  // OSM has no operational-status concept -- shouldn't be disqualified by
  // one, and shouldn't report a stale EIA status either.
  assert.equal(result.inputs.substation_status, null);
});

test('computeGridFeasibilityScore prefers EIA over OSM when both are present', () => {
  const result = computeGridFeasibilityScore(gridFields({ distance: 500, voltage: 230, status: 'IN SERVICE', osmDistance: 100, osmVoltage: 500 }));
  assert.equal(result.inputs.substation_source, 'EIA');
  assert.equal(result.inputs.substation_distance_m, 500);
});


test('computeGridFeasibilityScore fails the distance gate when the substation is far away', () => {
  const result = computeGridFeasibilityScore(
    gridFields({ distance: SUBSTATION_DISTANCE_CONSTRAINED_M + 1, voltage: 230, status: 'IN SERVICE' })
  );
  assert.equal(result.passes_gates, false);
  assert.ok(result.gate_failures.includes('distance_too_far'));
});

test('computeGridFeasibilityScore fails the voltage gate below the sub-transmission floor', () => {
  const result = computeGridFeasibilityScore(
    gridFields({ distance: 500, voltage: SUBSTATION_VOLTAGE_MIN_KV - 1, status: 'IN SERVICE' })
  );
  assert.equal(result.passes_gates, false);
  assert.ok(result.gate_failures.includes('voltage_too_low'));
});

test('computeGridFeasibilityScore fails outright when neither EIA nor OSM found a substation', () => {
  const result = computeGridFeasibilityScore(gridFields({}));
  assert.equal(result.passes_gates, false);
  assert.equal(result.score, 0);
  assert.equal(result.inputs.substation_source, null);
  assert.ok(result.gate_failures.includes('no_substation_found'));
});

test('computeGridFeasibilityScore disqualifies an explicitly non-in-service substation', () => {
  const result = computeGridFeasibilityScore(gridFields({ distance: 200, voltage: 230, status: 'RETIRED' }));
  assert.equal(result.passes_gates, false);
  assert.equal(result.score, 0);
  assert.ok(result.gate_failures.some((f) => f.startsWith('substation_not_in_service')));
});

test('computeGridFeasibilityScore does NOT disqualify an unpublished (absent) status', () => {
  const result = computeGridFeasibilityScore(gridFields({ distance: 200, voltage: 230 })); // status undefined -> absent
  assert.equal(result.passes_gates, true);
  assert.equal(result.gate_failures.length, 0);
});

test('computeGridFeasibilityScore adds a small bonus for transmission redundancy', () => {
  // distance/voltage picked to leave headroom under the 100-point cap, so
  // the +10 bonus isn't masked by clamping.
  const withoutRedundancy = computeGridFeasibilityScore(gridFields({ distance: 3000, voltage: 100, status: 'IN SERVICE' }));
  const withRedundancy = computeGridFeasibilityScore(
    gridFields({ distance: 3000, voltage: 100, status: 'IN SERVICE', redundant: true })
  );
  assert.equal(withRedundancy.score, withoutRedundancy.score + 10);
});

// --- scoreCountyGridFeasibility ---

test('scoreCountyGridFeasibility decides the bucket from the centroid, not the best corridor point', () => {
  // Regression test for the selection-bias bug found on the live CA run:
  // an existing charger (corridor point) sits near a substation, but the
  // county centroid itself has none within radius. The centroid's poor
  // data should NOT be papered over by the better-looking corridor point.
  const weakCentroid = { type: 'centroid', grid_fields: gridFields({}) }; // no substation found
  const strongCorridor = {
    type: 'corridor',
    station_name: 'Existing Charger',
    grid_fields: gridFields({ distance: 200, voltage: 230, status: 'IN SERVICE' }),
  };

  const { primary, bestAlternative, usedFallback } = scoreCountyGridFeasibility([weakCentroid, strongCorridor]);

  assert.equal(usedFallback, false);
  assert.equal(primary.point, weakCentroid);
  assert.equal(primary.feasibility.passes_gates, false);
  assert.equal(bestAlternative.point, strongCorridor);
  assert.equal(bestAlternative.feasibility.passes_gates, true);
});

test('scoreCountyGridFeasibility falls back to the best point when no centroid is present', () => {
  const onlyCorridor = { type: 'corridor', grid_fields: gridFields({ distance: 200, voltage: 230, status: 'IN SERVICE' }) };
  const { primary, usedFallback } = scoreCountyGridFeasibility([onlyCorridor]);
  assert.equal(usedFallback, true);
  assert.equal(primary.point, onlyCorridor);
});

test('scoreCountyGridFeasibility handles an empty sample point list', () => {
  const { primary, bestAlternative, usedFallback } = scoreCountyGridFeasibility([]);
  assert.equal(primary, null);
  assert.equal(bestAlternative, null);
  assert.equal(usedFallback, true);
});

test('scoreCountyGridFeasibility does not treat the existing-charger mean as demand', () => {
  const desertCentroid = { type: 'centroid', grid_fields: gridFields({}) }; // no substation found
  const demandCentroid = {
    type: 'demand_centroid',
    grid_fields: gridFields({ distance: 1000, voltage: 115, status: 'IN SERVICE' }),
  };

  const { primary, usedDemandCentroid } = scoreCountyGridFeasibility([desertCentroid, demandCentroid]);

  assert.equal(usedDemandCentroid, false);
  assert.equal(primary.point, desertCentroid);
  assert.equal(primary.feasibility.passes_gates, false);
});

test('scoreCountyGridFeasibility uses the plain centroid when no demand_centroid point is present', () => {
  const centroid = { type: 'centroid', grid_fields: gridFields({ distance: 500, voltage: 230, status: 'IN SERVICE' }) };
  const { primary, usedDemandCentroid } = scoreCountyGridFeasibility([centroid]);
  assert.equal(usedDemandCentroid, false);
  assert.equal(primary.point, centroid);
});

test('scoreCountyGridFeasibility prioritizes the Census population center over a legacy centroid', () => {
  const legacy = { type: 'centroid', grid_fields: gridFields({ distance: 100, voltage: 230, status: 'IN SERVICE' }) };
  const populationCenter = { type: 'population_center', grid_fields: gridFields({ distance: 9000, voltage: 230, status: 'IN SERVICE' }) };
  const { primary, usedPopulationCenter } = scoreCountyGridFeasibility([legacy, populationCenter]);
  assert.equal(primary.point, populationCenter);
  assert.equal(usedPopulationCenter, true);
});

// --- bucketCounty ---

test('bucketCounty maps passing gates to fund_charger_now', () => {
  assert.equal(bucketCounty({ passes_gates: true }), 'fund_charger_now');
});

test('bucketCounty maps failing gates to fund_grid_upgrade_first', () => {
  assert.equal(bucketCounty({ passes_gates: false }), 'fund_grid_upgrade_first');
});

test('bucketCounty maps missing physical evidence to insufficient_data', () => {
  assert.equal(bucketCounty({ passes_gates: false, data_sufficient: false }), 'insufficient_data');
});

test('bucketCounty throws without a feasibility result', () => {
  assert.throws(() => bucketCounty(null));
});

// --- scoreAllCounties (integration of the above) ---

function fakeCounty({ fips, name, registrations, level2 = 0, dcFast = 0, samplePoints = [] }) {
  return {
    county_fips: fips,
    county_name: name,
    registrations: { latest_registrations: registrations },
    chargers: { level2_ports: level2, dc_fast_ports: dcFast, level1_ports: 0 },
    sample_points: samplePoints,
  };
}

test('scoreAllCounties flags an outlier county and buckets it by grid feasibility', () => {
  const goodSite = { type: 'centroid', grid_fields: gridFields({ distance: 200, voltage: 230, status: 'IN SERVICE' }) };
  const badSite = { type: 'centroid', grid_fields: gridFields({ distance: 20000, voltage: 60, status: 'IN SERVICE' }) };

  // 3 baseline counties (ratio 10) keep the median anchored to the baseline
  // cluster; with an even 2-vs-2 split the median would sit at the midpoint
  // between clusters and no county could ever clear multiplier x median.
  const joinPipelineOutput = {
    state: 'CA',
    counties: [
      fakeCounty({ fips: '1', name: 'Baseline County A', registrations: 1000, level2: 100 }), // ratio 10
      fakeCounty({ fips: '2', name: 'Baseline County B', registrations: 2000, level2: 200 }), // ratio 10
      fakeCounty({ fips: '5', name: 'Baseline County C', registrations: 3000, level2: 300 }), // ratio 10
      fakeCounty({ fips: '3', name: 'Shovel-Ready County', registrations: 100000, level2: 100, samplePoints: [goodSite] }), // ratio 1000
      fakeCounty({ fips: '4', name: 'Grid-Constrained County', registrations: 100000, level2: 100, samplePoints: [badSite] }), // ratio 1000
    ],
  };

  const result = scoreAllCounties(joinPipelineOutput);

  assert.equal(result.state_median_driver_to_plug_ratio, 10);
  assert.equal(result.counties_underserved, 2);
  assert.equal(result.counties_fund_charger_now, 1);
  assert.equal(result.counties_fund_grid_upgrade_first, 1);

  const shovelReady = result.counties.find((c) => c.county_fips === '3');
  assert.equal(shovelReady.bucket, 'fund_charger_now');

  const gridConstrained = result.counties.find((c) => c.county_fips === '4');
  assert.equal(gridConstrained.bucket, 'fund_grid_upgrade_first');

  const baseline = result.counties.find((c) => c.county_fips === '1');
  assert.equal(baseline.underserved, false);
  assert.equal(baseline.bucket, null);
});

test('scoreAllCounties ranks counties by driver-to-plug ratio, highest first', () => {
  const joinPipelineOutput = {
    state: 'CA',
    counties: [
      fakeCounty({ fips: '1', name: 'Low', registrations: 100, level2: 100 }),
      fakeCounty({ fips: '2', name: 'High', registrations: 1000, level2: 100 }),
    ],
  };
  const { counties } = scoreAllCounties(joinPipelineOutput);
  assert.deepEqual(counties.map((c) => c.county_fips), ['2', '1']);
});
