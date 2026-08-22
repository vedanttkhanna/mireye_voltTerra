import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPresetsPresent, checkCountyCoverage, checkSampleFetch } from '../verify-pilot-setup.js';

test('checkPresetsPresent flags a preset missing from the catalog', () => {
  const catalog = { presets: { grid_interconnect: ['a', 'b'] } };
  const { ok, presets } = checkPresetsPresent(catalog, ['grid_interconnect', 'utilities']);

  assert.equal(ok, false);
  assert.deepEqual(presets, [
    { preset: 'grid_interconnect', found: true, field_count: 2 },
    { preset: 'utilities', found: false, field_count: 0 },
  ]);
});

test('checkPresetsPresent passes when every preset is in the catalog', () => {
  const catalog = { presets: { grid_interconnect: ['a'], utilities: ['b', 'c'] } };
  const { ok } = checkPresetsPresent(catalog, ['grid_interconnect', 'utilities']);
  assert.equal(ok, true);
});

test('checkCountyCoverage reports counties missing from DMV or charger data', () => {
  const crosswalkCounties = [
    { county_fips: '06001', county_name: 'Alameda County' },
    { county_fips: '06039', county_name: 'Madera County' },
  ];
  const dmvCounties = [{ county_fips: '06001' }];
  const chargerCounties = [{ county_fips: '06001' }, { county_fips: '06039' }];

  const result = checkCountyCoverage({ crosswalkCounties, dmvCounties, chargerCounties });

  assert.equal(result.total_counties, 2);
  assert.equal(result.dmv_counties_present, 1);
  assert.equal(result.charger_counties_present, 2);
  assert.deepEqual(result.missing_from_dmv, ['Madera County']);
  assert.deepEqual(result.missing_from_chargers, []);
  assert.equal(result.ok, false);
});

test('checkCountyCoverage passes when every county resolves in both datasets', () => {
  const crosswalkCounties = [{ county_fips: '06001', county_name: 'Alameda County' }];
  const result = checkCountyCoverage({
    crosswalkCounties,
    dmvCounties: [{ county_fips: '06001' }],
    chargerCounties: [{ county_fips: '06001' }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.dmv_coverage_ratio, 1);
});

test('checkSampleFetch fails when an expected field is missing or uncited', () => {
  const response = {
    fields: {
      nearest_substation_distance_m: { value: 100, source: 'EIA_POWER', status: 'ok' },
      electric_utility_service_territory: { value: null, source: null, status: 'absent' },
    },
  };
  const { ok, fields } = checkSampleFetch(response, [
    'nearest_substation_distance_m',
    'electric_utility_service_territory',
    'not_in_response',
  ]);

  assert.equal(ok, false);
  assert.deepEqual(
    fields.map((f) => f.field),
    ['nearest_substation_distance_m', 'electric_utility_service_territory', 'not_in_response']
  );
  assert.equal(fields[0].present, true);
  assert.equal(fields[1].has_source, false);
  assert.equal(fields[2].present, false);
});
