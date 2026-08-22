import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCountySamplePoints,
  checkLookupAgreement,
  GRID_FEASIBILITY_FIELDS,
} from '../orchestrator.js';

test('buildCountySamplePoints puts the centroid first, then corridor points', () => {
  const points = buildCountySamplePoints({
    centroid: { lat: 37.2, lng: -119.7 },
    corridorPoints: [
      { lat: 37.0, lng: -119.5, station_name: 'Station A' },
      { lat: 37.1, lng: -119.6, station_name: 'Station B' },
    ],
  });

  assert.equal(points.length, 3);
  assert.deepEqual(points[0], { type: 'centroid', lat: 37.2, lng: -119.7, source: 'census_gazetteer_2020' });
  assert.equal(points[1].type, 'corridor');
  assert.equal(points[1].station_name, 'Station A');
  assert.equal(points[2].station_name, 'Station B');
});

test('buildCountySamplePoints handles a county with no chargers (centroid only)', () => {
  const points = buildCountySamplePoints({ centroid: { lat: 37.2, lng: -119.7 }, corridorPoints: [] });
  assert.equal(points.length, 1);
  assert.equal(points[0].type, 'centroid');
});

test('buildCountySamplePoints omits the centroid if none is found', () => {
  const points = buildCountySamplePoints({
    centroid: null,
    corridorPoints: [{ lat: 37.0, lng: -119.5 }],
  });
  assert.equal(points.length, 1);
  assert.equal(points[0].type, 'corridor');
});

test('buildCountySamplePoints never treats the existing-charger mean as a demand point', () => {
  const points = buildCountySamplePoints({
    centroid: { lat: 33.729828, lng: -116.002239 },
    corridorPoints: [],
    demandCentroid: { lat: 33.85, lng: -117.0 },
  });

  assert.equal(points.some((p) => p.type === 'demand_centroid'), false);
});

test('buildCountySamplePoints does NOT add a demand_centroid point when divergence is small', () => {
  const points = buildCountySamplePoints({
    centroid: { lat: 37.2, lng: -119.7 },
    corridorPoints: [],
    demandCentroid: { lat: 37.21, lng: -119.71 }, // ~1.3km away
  });
  assert.equal(points.some((p) => p.type === 'demand_centroid'), false);
});

test('buildCountySamplePoints omits demand_centroid when the county has no chargers to compute one from', () => {
  const points = buildCountySamplePoints({
    centroid: { lat: 37.2, lng: -119.7 },
    corridorPoints: [],
    demandCentroid: null,
  });
  assert.equal(points.some((p) => p.type === 'demand_centroid'), false);
});

test('checkLookupAgreement flags a mismatch between our join key and Mireye\'s', () => {
  const point = { type: 'centroid', lat: 37.2, lng: -119.7 };
  const lookupResult = { county_fips: '06099', county: 'Stanislaus County', confidence: 0.7 };
  const result = checkLookupAgreement(point, lookupResult, '06039');

  assert.equal(result.mireye_lookup.matches_expected, false);
  assert.equal(result.mireye_lookup.county_fips, '06099');
  assert.equal(result.lat, 37.2); // original point fields preserved
});

test('checkLookupAgreement passes when both sources agree', () => {
  const point = { type: 'centroid', lat: 37.2, lng: -119.7 };
  const lookupResult = { county_fips: '06039', county: 'Madera County', confidence: 0.9 };
  const result = checkLookupAgreement(point, lookupResult, '06039');

  assert.equal(result.mireye_lookup.matches_expected, true);
});

test('checkLookupAgreement handles a null/failed lookup result without throwing', () => {
  const result = checkLookupAgreement({ lat: 1, lng: 2 }, null, '06039');
  assert.equal(result.mireye_lookup.matches_expected, false);
  assert.equal(result.mireye_lookup.county_fips, null);
});

test('GRID_FEASIBILITY_FIELDS has no duplicate field names', () => {
  assert.equal(new Set(GRID_FEASIBILITY_FIELDS).size, GRID_FEASIBILITY_FIELDS.length);
});
