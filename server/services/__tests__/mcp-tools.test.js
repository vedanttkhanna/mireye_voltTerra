import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeMcpTool, resolveCounty, MCP_TOOL_DEFINITIONS } from '../mcp-tools.js';

test('MCP tool definitions have valid schema', () => {
  assert.equal(MCP_TOOL_DEFINITIONS.length, 6);
  const names = MCP_TOOL_DEFINITIONS.map((t) => t.name);
  assert.deepEqual(names, [
    'get_statewide_summary',
    'get_county_demand_metrics',
    'get_grid_infrastructure',
    'evaluate_feasibility_gates',
    'ask_mireye_evidence',
    'make_funding_decision',
  ]);
});

test('get_statewide_summary returns ranked California context', async () => {
  const result = await executeMcpTool('get_statewide_summary', { limit: 3, underserved_only: true });
  assert.equal(result.state, 'CA');
  assert.equal(result.ranked_counties.length, 3);
  assert.ok(result.ranked_counties.every((county) => county.underserved));
});

test('resolveCounty matches FIPS and name variations', () => {
  const fakeData = {
    counties: [
      { county_fips: '06101', county_name: 'Sutter County' },
      { county_fips: '06065', county_name: 'Riverside County' },
    ],
  };

  assert.equal(resolveCounty('06101', fakeData)?.county_name, 'Sutter County');
  assert.equal(resolveCounty('Sutter', fakeData)?.county_fips, '06101');
  assert.equal(resolveCounty('Riverside County', fakeData)?.county_fips, '06065');
  assert.equal(resolveCounty('Unknown', fakeData), null);
});

test('evaluate_feasibility_gates returns pass for close high voltage substation', async () => {
  const result = await executeMcpTool('evaluate_feasibility_gates', {
    substation_distance_m: 4000,
    substation_voltage_kv: 115,
    substation_status: 'IN SERVICE',
  });

  assert.equal(result.passes_gates, true);
  // 4km / 8km cap = 0.5 fraction → distanceScore=30, 115kV sub-transmission → voltageScore=25, total=55
  assert.equal(result.score > 40, true);
});

test('evaluate_feasibility_gates returns failure for distant low voltage substation', async () => {
  const result = await executeMcpTool('evaluate_feasibility_gates', {
    substation_distance_m: 25000,
    substation_voltage_kv: 12,
    substation_status: 'IN SERVICE',
  });

  assert.equal(result.passes_gates, false);
  // distance at 25km clearly violates the 8km gate — at least 1 failure expected
  assert.equal(result.gate_failures.length >= 1, true);
});

test('make_funding_decision returns fund_charger_now when underserved and passes gates', async () => {
  const result = await executeMcpTool('make_funding_decision', {
    county_name: 'Sutter County',
    underserved: true,
    passes_grid_gates: true,
    grid_data_sufficient: true,
    justification: 'High ratio and adjacent substation',
  });

  assert.equal(result.decision, 'fund_charger_now');
  assert.equal(result.decision_label, 'Fund Charger Now');
});
