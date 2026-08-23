import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCountiesFromText, findCountyFromText, buildGroundedChatQuestion, queryChatAgent } from '../chat-agent.js';

test('findCountyFromText detects county mentions in user query', () => {
  const counties = [
    { county_fips: '06101', county_name: 'Sutter County' },
    { county_fips: '06065', county_name: 'Riverside County' },
    { county_fips: '06013', county_name: 'Contra Costa County' },
  ];

  assert.equal(findCountyFromText('What is the feasibility in Sutter County?', counties)?.county_fips, '06101');
  assert.equal(findCountyFromText('Can we install chargers in Riverside near highway 91?', counties)?.county_fips, '06065');
  assert.equal(findCountyFromText('Tell me about Contra Costa grid constraints', counties)?.county_fips, '06013');
  assert.equal(findCountyFromText('How does overall California policy work?', counties), null);
});

test('findCountiesFromText detects every county in a comparison', () => {
  const counties = [
    { county_name: 'Calaveras County', county_fips: '06009' },
    { county_name: 'Contra Costa County', county_fips: '06013' },
  ];
  assert.deepEqual(
    findCountiesFromText('Compare Calaveras with Contra Costa County', counties).map((c) => c.county_fips),
    ['06009', '06013']
  );
});

test('buildGroundedChatQuestion generates physical geospatial question for Mireye', () => {
  const county = {
    county_name: 'Sutter County',
    driver_to_plug_ratio: 61.2,
    latest_registrations: 4200,
    charger_count: 68,
    bucket: 'fund_charger_now',
    grid_feasibility: {
      inputs: {
        substation_distance_m: 3200,
        substation_voltage_kv: 115,
        substation_status: 'in_service',
      },
    },
  };

  const prompt = buildGroundedChatQuestion({ county, userMessage: 'Can we build 4 fast chargers here?' });
  // Should ask about physical infrastructure Mireye covers, not EV policy
  assert.match(prompt, /Sutter County/);
  assert.match(prompt, /electrical power infrastructure/);
  assert.match(prompt, /115kV/);
  assert.match(prompt, /electrical substation/);
  assert.match(prompt, /transmission lines/);
  // Should NOT include EV demand numbers (those are synthesised locally, not sent to Mireye)
  assert.doesNotMatch(prompt, /61\.2 registered EVs/);
});

test('queryChatAgent calls askImpl and returns structured cited response', async () => {
  const fakeAsk = async ({ lat, lng, question }) => ({
    answer: `Feasibility in this location is high. Substation is 2.0 miles away.`,
    confidence: 'high',
    citations: [{ source: 'EIA_POWER', source_url: 'https://eia.gov', confidence: 'high' }],
    data_gaps: [],
    answered_at: '2026-08-22T15:00:00Z',
  });

  const result = await queryChatAgent({
    message: 'Is it feasible to add DC fast charging in Sutter County?',
    askImpl: fakeAsk,
  });

  assert.equal(result.confidence, 'high');
  assert.match(result.answer, /Feasibility in this location is high/);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].source, 'EIA_POWER');
  assert.equal(result.suggested_followups.length > 0, true);
});
