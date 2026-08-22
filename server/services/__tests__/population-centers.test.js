import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePopulationCenters, populationCenterUrl } from '../population-centers.js';

test('parsePopulationCenters maps Census state and county FIPS to coordinates', () => {
  const rows = parsePopulationCenters(
    '\uFEFFSTATEFP,COUNTYFP,COUNAME,STNAME,POPULATION,LATITUDE,LONGITUDE\n06,065,Riverside,California,2418185,+33.799274,-117.076969\n'
  );
  assert.deepEqual(rows[0], {
    county_fips: '06065',
    county_name: 'Riverside County',
    population: 2418185,
    lat: 33.799274,
    lng: -117.076969,
  });
});

test('populationCenterUrl rejects unsupported states', () => {
  assert.throws(() => populationCenterUrl('XX'));
});
