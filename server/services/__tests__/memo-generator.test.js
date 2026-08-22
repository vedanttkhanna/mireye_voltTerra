import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoQuestion, generateCountyMemo } from '../memo-generator.js';

function scoredCounty(overrides = {}) {
  return {
    county_fips: '06013',
    county_name: 'Contra Costa County',
    driver_to_plug_ratio: 61.76,
    underserved: true,
    bucket: 'fund_charger_now',
    grid_feasibility: {
      sampled_at: { type: 'centroid', lat: 37.919479, lng: -121.951543 },
      inputs: {
        substation_distance_m: 3160,
        substation_voltage_kv: 115,
        substation_status: 'IN SERVICE',
      },
    },
    ...overrides,
  };
}

test('buildMemoQuestion states the ratio and substation distance/voltage in miles and kV', () => {
  const question = buildMemoQuestion(scoredCounty());
  assert.match(question, /Contra Costa County/);
  assert.match(question, /61\.8 registered EVs/);
  assert.match(question, /2\.0 mi away/); // 3160m / 1609.34 = 1.96mi -> rounds to 2.0
  assert.match(question, /115kV/);
  assert.match(question, /IN SERVICE/);
});

test('buildMemoQuestion handles a county with no substation found', () => {
  const county = scoredCounty({
    grid_feasibility: { sampled_at: { lat: 1, lng: 2 }, inputs: { substation_distance_m: null } },
  });
  const question = buildMemoQuestion(county);
  assert.match(question, /no substation found/);
});

test('generateCountyMemo calls ask at the county\'s sampled centroid and shapes the memo', async () => {
  let capturedArgs;
  const askImpl = async (args) => {
    capturedArgs = args;
    return {
      answer: 'Grid is favorable.',
      confidence: 'medium',
      citations: [{ source: 'EIA_POWER', source_url: 'https://atlas.eia.gov/', fields: ['nearest_substation_distance_m'] }],
      data_gaps: [],
      answered_at: '2026-08-21T00:00:00Z',
    };
  };

  const memo = await generateCountyMemo(scoredCounty(), { askImpl });

  assert.equal(capturedArgs.lat, 37.919479);
  assert.equal(capturedArgs.lng, -121.951543);
  assert.match(capturedArgs.question, /Contra Costa County/);
  assert.equal(memo.county_fips, '06013');
  assert.equal(memo.bucket, 'fund_charger_now');
  assert.equal(memo.answer, 'Grid is favorable.');
  assert.equal(memo.citations.length, 1);
});

test('generateCountyMemo refuses a county that was never flagged underserved', async () => {
  const county = scoredCounty({ underserved: false, bucket: null, grid_feasibility: null });
  await assert.rejects(() => generateCountyMemo(county, { askImpl: async () => ({}) }), /no grid feasibility result/);
});

test('generateCountyMemo refuses a flagged county with no grid feasibility (no sample points)', async () => {
  const county = scoredCounty({ grid_feasibility: null });
  await assert.rejects(() => generateCountyMemo(county, { askImpl: async () => ({}) }), /no grid feasibility result/);
});
