import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCountySamplePoints,
  checkLookupAgreement,
  GRID_FEASIBILITY_FIELDS,
} from '../orchestrator.js';

test('buildCountySamplePoints puts the population center first, then corridor points', () => {
  const points = buildCountySamplePoints({
    populationCenter: { lat: 37.7, lng: -121.9 },
    centroid: { lat: 37.2, lng: -119.7 },
    corridorPoints: [
      { lat: 37.0, lng: -119.5, station_name: 'Station A' },
      { lat: 37.1, lng: -119.6, station_name: 'Station B' },
    ],
  });

  assert.equal(points.length, 3);
  assert.deepEqual(points[0], {
    type: 'population_center',
    lat: 37.7,
    lng: -121.9,
    source: 'census_2020_mean_center_of_population',
  });
  assert.equal(points[1].type, 'corridor');
  assert.equal(points[1].station_name, 'Station A');
  assert.equal(points[2].station_name, 'Station B');
});

test('buildCountySamplePoints falls back to the county internal point', () => {
  const points = buildCountySamplePoints({ populationCenter: null, centroid: { lat: 37.2, lng: -119.7 }, corridorPoints: [] });
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
