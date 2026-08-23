import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePopulationCentersCsv } from '../county-centroids.js';

test('parses CA rows and skips other states', () => {
  const text = 'STATEFP,COUNTYFP,COUNAME,STNAME,POPULATION,LATITUDE,LONGITUDE\n' +
    '06,039,Madera,California,156255,+37.037074,-120.009796\n' +
    '36,001,Albany,New York,314848,+42.600000,-73.970000\n';

  const rows = parsePopulationCentersCsv(text, { stateFips: '06' });

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    county_fips: '06039',
    county_name: 'Madera County',
    population: 156255,
    lat: 37.037074,
    lng: -120.009796,
  });
});

test('throws if an expected column is missing', () => {
  const text = 'STATEFP,COUNTYFP,COUNAME\n06,039,Madera';
  assert.throws(() => parsePopulationCentersCsv(text, { stateFips: '06' }), /missing required columns/);
});
