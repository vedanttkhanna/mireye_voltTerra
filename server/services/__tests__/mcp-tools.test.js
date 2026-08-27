import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeMcpTool, resolveCounty, interiorPoints, MCP_TOOL_DEFINITIONS } from '../mcp-tools.js';

test('MCP tool definitions have valid schema', () => {
  const names = MCP_TOOL_DEFINITIONS.map((t) => t.name);
  assert.deepEqual(names, [
    'get_statewide_summary',
    'get_county_demand_metrics',
    'get_grid_infrastructure',
    'evaluate_feasibility_gates',
    'ask_mireye_evidence',
    'fetch_live_grid_fields',
    'sample_county_points',
    'find_nearest_substations',
    'get_labor_shed',
    'make_funding_decision',
  ]);
  assert.equal(MCP_TOOL_DEFINITIONS.length, names.length);
});

test('every live tool declares its metered cost and requires a stated reason', () => {
  // The agent decides on its own when to spend credits, so the cost has to be
  // legible to it from the tool description alone.
  for (const name of ['fetch_live_grid_fields', 'sample_county_points', 'find_nearest_substations', 'get_labor_shed']) {
    const tool = MCP_TOOL_DEFINITIONS.find((t) => t.name === name);
    assert.match(tool.description, /METERED|EXPENSIVE/, `${name} must flag that it costs money`);
    assert.match(tool.description, /credits/, `${name} must state the cost in credits`);
    assert.ok(tool.parameters.required.includes('reason'), `${name} must require a stated reason`);
  }
});

const SQUARE = {
  type: 'Polygon',
  coordinates: [[[-120, 34], [-119, 34], [-119, 35], [-120, 35], [-120, 34]]],
};

test('interiorPoints returns points inside the polygon', () => {
  const points = interiorPoints(SQUARE, 3);
  assert.equal(points.length, 3);
  for (const p of points) {
    assert.ok(p.lat > 34 && p.lat < 35, `lat ${p.lat} inside`);
    assert.ok(p.lng > -120 && p.lng < -119, `lng ${p.lng} inside`);
  }
});

test('interiorPoints spreads picks rather than clustering on one axis', () => {
  // Regression guard: an earlier version took evenly-spaced indices out of a
  // row-major candidate list, which returned three points sharing a single
  // longitude on a wide county.
  const points = interiorPoints(SQUARE, 3);
  assert.ok(new Set(points.map((p) => p.lng)).size > 1, 'picks share one longitude');
});

test('interiorPoints returns everything it has when asked for more than fits', () => {
  const points = interiorPoints(SQUARE, 500);
  assert.ok(points.length > 0);
  assert.ok(points.length < 500);
});

test('interiorPoints handles a geometry with no coordinates', () => {
  assert.deepEqual(interiorPoints({ type: 'Polygon', coordinates: [] }, 3), []);
  assert.deepEqual(interiorPoints(null, 3), []);
});

test('fetch_live_grid_fields rejects a non-numeric coordinate without spending credits', async () => {
  const result = await executeMcpTool(
    'fetch_live_grid_fields',
    { lat: 'nope', lng: -117, reason: 'test' },
    { fetchImpl: async () => { throw new Error('must not call Mireye'); } }
  );
  assert.match(result.error, /numeric/);
  assert.equal(result.credits_spent, 0);
});

test('fetch_live_grid_fields reports its credit cost and computes gates', async () => {
  const fetchImpl = async () => ({
    fetched_at: '2026-08-24T00:00:00Z',
    fields: {
      nearest_substation_distance_m: { status: 'ok', value: 1000 },
      nearest_substation_max_voltage_kv: { status: 'ok', value: 115 },
      nearest_substation_status: { status: 'ok', value: 'IN SERVICE' },
    },
  });
  const result = await executeMcpTool('fetch_live_grid_fields', { lat: 33.7, lng: -117.2, reason: 'why' }, { fetchImpl });

  assert.equal(result.live, true);
  assert.equal(result.passes_gates, true);
  assert.equal(result.substation_voltage_kv, 115);
  assert.equal(result.reason, 'why');
  assert.ok(result.credits_spent > 0, 'must report a non-zero metered cost');
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

test('find_nearest_substations returns named candidates and flags the strongest', async () => {
  const proximityImpl = async (op) => {
    assert.equal(op.op, 'nearest');
    assert.equal(op.set, '@substations');
    assert.equal(op.mode, 'straightline');
    assert.ok(op.max_credits > 0, 'must always send a max_credits ceiling');
    return {
      credits_charged: 2,
      candidates: [
        { name: 'SAN JACINTO', lat: 33.78, lng: -116.95, attributes: { max_voltage_kv: 115 }, distance_miles: 3.13 },
        { name: 'DEVERS', lat: 33.92, lng: -116.57, attributes: { max_voltage_kv: 230 }, distance_miles: 6.4 },
      ],
    };
  };
  const r = await executeMcpTool('find_nearest_substations', { lat: 33.79, lng: -116.9, reason: 'why' }, { proximityImpl });

  assert.equal(r.substations_found, 2);
  assert.equal(r.nearest.name, 'SAN JACINTO');
  // The closest is not the strongest: that distinction is the whole point.
  assert.equal(r.highest_voltage_nearby.name, 'DEVERS');
  assert.equal(r.highest_voltage_nearby.max_voltage_kv, 230);
  assert.equal(r.credits_spent, 2);
});

test('find_nearest_substations sends a much higher ceiling for driving mode', async () => {
  let seen;
  const proximityImpl = async (op) => { seen = op; return { credits_charged: 300, candidates: [] }; };
  await executeMcpTool('find_nearest_substations', { lat: 1, lng: 2, mode: 'driving', reason: 'r' }, { proximityImpl });
  assert.equal(seen.mode, 'driving');
  assert.ok(seen.max_credits >= 300, 'driving ceiling must clear the ~300 credit price');
});

test('get_labor_shed quotes for free by default and does not report a result', async () => {
  const proximityImpl = async (op) => {
    assert.equal(op.estimate, true, 'unconfirmed calls must run in estimate mode');
    return { would_cost_credits: 1200, annulus_tracts: 100, credits_charged: 0 };
  };
  const r = await executeMcpTool('get_labor_shed', { lat: 33.79, lng: -116.9, reason: 'r' }, { proximityImpl });

  assert.equal(r.quote_only, true);
  assert.equal(r.would_cost_credits, 1200);
  assert.equal(r.credits_spent, 0);
  assert.equal(r.population_within_shed, undefined);
});

test('get_labor_shed only spends once explicitly confirmed', async () => {
  const proximityImpl = async (op) => {
    assert.equal(op.estimate, false, 'confirmed calls must leave estimate mode');
    return { population: 92502, civilian_labor_force: 39130, tracts_counted: 22, credits_charged: 1200 };
  };
  const r = await executeMcpTool('get_labor_shed', { lat: 33.79, lng: -116.9, confirm: true, reason: 'r' }, { proximityImpl });

  assert.equal(r.quote_only, undefined);
  assert.equal(r.population_within_shed, 92502);
  assert.equal(r.credits_spent, 1200);
});

test('proximity tool failures degrade to an error instead of throwing', async () => {
  const proximityImpl = async () => { throw new Error('upstream boom'); };
  const r = await executeMcpTool('find_nearest_substations', { lat: 1, lng: 2, reason: 'r' }, { proximityImpl });
  assert.equal(r.error, 'substation_lookup_failed');
  assert.equal(r.credits_spent, 0);
});
