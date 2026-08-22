import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCountyName,
  aggregateNeviAwardsByCounty,
  joinNeviToScoredCounties,
  summarizeBacktest,
} from '../nevi-backtest.js';

test('normalizeCountyName trims whitespace and fixes the known "San Bernadino" typo', () => {
  assert.equal(normalizeCountyName('Placer '), 'Placer');
  assert.equal(normalizeCountyName('San Bernadino'), 'San Bernardino');
  assert.equal(normalizeCountyName('Riverside'), 'Riverside');
});

test('aggregateNeviAwardsByCounty counts stations and distinct awardees per county, sorted by count', () => {
  const rows = [
    { County: 'Riverside', Awardee: 'A' },
    { County: 'Riverside', Awardee: 'A' },
    { County: 'Riverside ', Awardee: 'B' }, // trailing space, should merge with 'Riverside'
    { County: 'Yuba', Awardee: 'C' },
  ];
  const counties = aggregateNeviAwardsByCounty(rows);

  assert.deepEqual(counties, [
    { county_name: 'Riverside', station_count: 3, awardee_count: 2 },
    { county_name: 'Yuba', station_count: 1, awardee_count: 1 },
  ]);
});

test('aggregateNeviAwardsByCounty handles a missing Awardee without crashing', () => {
  const counties = aggregateNeviAwardsByCounty([{ County: 'Yuba', Awardee: null }]);
  assert.equal(counties[0].awardee_count, 0);
});

test('joinNeviToScoredCounties matches "X County" against NEVI\'s bare "X"', () => {
  const scored = [{ county_fips: '06065', county_name: 'Riverside County', driver_to_plug_ratio: 42.8, underserved: true, bucket: 'fund_grid_upgrade_first' }];
  const nevi = [{ county_name: 'Riverside', station_count: 14, awardee_count: 3 }];

  const [joined] = joinNeviToScoredCounties(scored, nevi);
  assert.equal(joined.nevi_stations_awarded, 14);
  assert.equal(joined.nevi_awardee_count, 3);
});

test('joinNeviToScoredCounties defaults to zero funding for a county absent from the NEVI data', () => {
  const scored = [{ county_fips: '06115', county_name: 'Yuba County', driver_to_plug_ratio: 45.2, underserved: true, bucket: 'fund_charger_now' }];
  const [joined] = joinNeviToScoredCounties(scored, []);
  assert.equal(joined.nevi_stations_awarded, 0);
});

test('summarizeBacktest reports flagged-with-funding, flagged-without-funding, and the reverse case', () => {
  const joined = [
    { county_name: 'Funded And Flagged', underserved: true, nevi_stations_awarded: 3 },
    { county_name: 'Flagged No Funding', underserved: true, nevi_stations_awarded: 0 },
    { county_name: 'Funded Not Flagged', underserved: false, nevi_stations_awarded: 5 },
    { county_name: 'Neither', underserved: false, nevi_stations_awarded: 0 },
  ];

  const summary = summarizeBacktest(joined);

  assert.equal(summary.counties_total, 4);
  assert.equal(summary.counties_flagged_underserved, 2);
  assert.equal(summary.flagged_and_nevi_funded.length, 1);
  assert.equal(summary.flagged_and_nevi_funded[0].county_name, 'Funded And Flagged');
  assert.deepEqual(summary.flagged_but_not_nevi_funded, ['Flagged No Funding']);
  assert.equal(summary.not_flagged_but_nevi_funded_count, 1);
  assert.equal(summary.flagged_nevi_funding_rate, 0.5);
});

test('summarizeBacktest handles zero flagged counties without dividing by zero', () => {
  const summary = summarizeBacktest([{ county_name: 'A', underserved: false, nevi_stations_awarded: 0 }]);
  assert.equal(summary.flagged_nevi_funding_rate, null);
});
