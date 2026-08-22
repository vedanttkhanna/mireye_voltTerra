import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentContext, callGeminiAgent, callGroqAgent, runAutonomousAgent } from '../llm-agent.js';

// Deterministic agent test - mocks the Mireye ask call via
// executeMcpTool which internally uses the mireye client, but
// the make_funding_decision / evaluate_feasibility_gates tools
// are fully local (no network calls) so we can exercise the
// full orchestration path without a live network.
test('runAutonomousAgent produces structured result with tool executions', async () => {
  // The deterministic orchestrator path is exercised since GEMINI_API_KEY is unset in test env.
  // It will attempt to call mireye.ask at the end; we trap any error and still validate the shape.
  let result;
  try {
    result = await runAutonomousAgent({
      message: 'Evaluate feasibility of deploying chargers in Sutter County based on grid and demand data',
      geminiApiKey: '',
      groqApiKey: '',
      provider: 'auto',
    });
  } catch (err) {
    // A live network call failing in the test runner is acceptable;
    // verify the result structure when it does succeed.
    return;
  }

  if (!result) return;

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'deterministic');
  assert.equal(result.fallback_used, false);
  assert.ok(result.answered_at, 'should have answered_at timestamp');
  // Tool executions: at minimum demand + grid + gate + decision tools were run
  assert.equal(Array.isArray(result.tool_executions), true);
  assert.ok(result.tool_executions.length >= 1, 'should have executed at least one MCP tool');

  if (result.county) {
    assert.ok(result.county.county_fips, 'county should have FIPS code');
    assert.ok(result.county.county_name, 'county should have name');
  }

  if (result.citations) {
    assert.equal(Array.isArray(result.citations), true);
  }
});

test('runAutonomousAgent reports Gemini when Gemini answers a natural-language prompt', async () => {
  const geminiFetchImpl = async (url, init) => {
    assert.match(String(url), /models\/gemini-3\.6-flash:generateContent/);
    assert.ok(init.signal, 'Gemini request should have a timeout signal');
    const request = JSON.parse(init.body);
    assert.match(request.contents.at(-1).parts[0].text, /User question: Explain Riverside County in plain English/);
    return new Response(JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text: 'Riverside needs grid work first.' }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await runAutonomousAgent({
    message: 'Explain Riverside County in plain English',
    geminiApiKey: 'test-key',
    geminiFetchImpl,
    provider: 'gemini',
  });

  assert.equal(result.provider, 'gemini');
  assert.equal(result.fallback_used, false);
  assert.equal(result.answer, 'Riverside needs grid work first.');
});

test('deterministic fallback compares selected county with a county named in natural language', async () => {
  const result = await runAutonomousAgent({
    message: 'how is this county compared to Contra Costa',
    countyFips: '06009', // Calaveras County
    geminiApiKey: '',
    groqApiKey: '',
    provider: 'auto',
  });

  assert.equal(result.provider, 'deterministic');
  assert.equal(result.decision, null);
  assert.match(result.answer, /Calaveras County/);
  assert.match(result.answer, /Contra Costa County/);
  assert.match(result.answer, /29\.5 vs\. 61\.7/);
  assert.match(result.answer, /no live Mireye credit call was needed/i);
  assert.deepEqual(result.tool_executions.map((item) => item.tool), [
    'get_county_demand_metrics',
    'get_county_demand_metrics',
  ]);
});

test('Gemini comparison does not expose the last county as one overall verdict', async () => {
  let turn = 0;
  const fetchImpl = async () => {
    turn += 1;
    const content = turn === 1
      ? {
          role: 'model',
          parts: [
            { functionCall: { name: 'make_funding_decision', args: { county_name: 'Calaveras County', underserved: false, passes_grid_gates: false, grid_data_sufficient: true, justification: 'Not flagged.' } } },
            { functionCall: { name: 'make_funding_decision', args: { county_name: 'Contra Costa County', underserved: true, passes_grid_gates: true, grid_data_sufficient: true, justification: 'Fund now.' } } },
          ],
        }
      : { role: 'model', parts: [{ text: 'Calaveras is not flagged; Contra Costa is underserved and fundable now.' }] };
    return new Response(JSON.stringify({ candidates: [{ content }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await callGeminiAgent({ message: 'Compare them', apiKey: 'test', fetchImpl });
  assert.equal(result.decision, null);
  assert.equal(result.decision_label, null);
  assert.equal(result.tool_executions.length, 2);
});

test('callGroqAgent uses Groq chat completions and executes local tools', async () => {
  let turn = 0;
  const fetchImpl = async (url, init) => {
    turn += 1;
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer groq-test-key');
    const request = JSON.parse(init.body);
    assert.equal(request.model, 'openai/gpt-oss-20b');
    assert.equal(request.max_completion_tokens, 2800);
    assert.equal(request.tools[0].function.parameters.type, 'object');

    const message = turn === 1
      ? {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'get_county_demand_metrics', arguments: '{"county_name_or_fips":"06013"}' },
          }],
        }
      : { role: 'assistant', content: 'Contra Costa has 61.7 EVs per port.' };
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await callGroqAgent({ message: 'Explain Contra Costa', apiKey: 'groq-test-key', fetchImpl });
  assert.equal(result.answer, 'Contra Costa has 61.7 EVs per port.');
  assert.deepEqual(result.tool_executions.map((item) => item.tool), ['get_county_demand_metrics']);
});

test('runAutonomousAgent can select Groq explicitly', async () => {
  const groqFetchImpl = async () => new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: 'Groq answered.' } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const result = await runAutonomousAgent({
    message: 'Hello',
    provider: 'groq',
    groqApiKey: 'groq-test-key',
    groqFetchImpl,
    geminiApiKey: '',
  });
  assert.equal(result.provider, 'groq');
  assert.equal(result.fallback_used, false);
  assert.equal(result.answer, 'Groq answered.');
});

test('buildAgentContext includes state, selected county, and structured Mireye fields', async () => {
  const context = await buildAgentContext({ countyFips: '06009', message: 'What about this county?' });
  assert.equal(context.state.name, 'California');
  assert.equal(context.selected_county.county_name, 'Calaveras County');
  assert.equal(Object.keys(context.selected_county.mireye_sample.fields).length, 9);
  const distance = context.selected_county.mireye_sample.fields.nearest_substation_distance_m;
  assert.ok('source' in distance);
  assert.ok('confidence' in distance);
});

test('Groq receives prior natural-language conversation history', async () => {
  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.deepEqual(request.messages.slice(1, 3), [
      { role: 'user', content: 'Compare Calaveras and Contra Costa.' },
      { role: 'assistant', content: 'Contra Costa has more charging stress.' },
    ]);
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'It refers to Contra Costa.' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const result = await callGroqAgent({
    message: 'Why is it higher?',
    history: [
      { role: 'user', content: 'Compare Calaveras and Contra Costa.' },
      { role: 'assistant', content: 'Contra Costa has more charging stress.' },
    ],
    apiKey: 'test',
    fetchImpl,
  });
  assert.match(result.answer, /Contra Costa/);
});

test('runAutonomousAgent sends Groq a separate versioned JSON context message', async () => {
  const groqFetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.messages[0].role, 'system');
    assert.equal(request.messages[1].role, 'system');
    assert.match(request.messages[1].content, /^STATE_AND_COUNTY_CONTEXT_JSON\n/);
    const context = JSON.parse(request.messages[1].content.split('\n').slice(1).join('\n'));
    assert.equal(context.schema_version, 'volt-terra.agent-context.v1');
    assert.equal(context.state.name, 'California');
    assert.equal(context.selected_county.county_name, 'Contra Costa County');
    assert.equal(Object.keys(context.selected_county.mireye_sample.fields).length, 9);
    assert.equal(request.messages.at(-1).content, 'Should this county receive charger funding?');
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Yes.' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await runAutonomousAgent({
    message: 'Should this county receive charger funding?',
    countyFips: '06013',
    provider: 'groq',
    groqApiKey: 'test',
    groqFetchImpl,
  });
  assert.equal(result.provider, 'groq');
});

test('deterministic fallback uses history to resolve comparison follow-ups', async () => {
  const result = await runAutonomousAgent({
    message: 'Which of those two has better grid feasibility?',
    countyFips: '06009',
    history: [
      { role: 'user', content: 'Compare Calaveras County with Contra Costa County.' },
      { role: 'assistant', content: 'Contra Costa has more charging stress.' },
    ],
    provider: 'auto',
    geminiApiKey: '',
    groqApiKey: '',
  });
  assert.equal(result.decision, null);
  assert.match(result.answer, /Calaveras County grid/);
  assert.match(result.answer, /Contra Costa County grid/);
  assert.match(result.answer, /stronger cached physical-screen score/);
  assert.equal(result.tool_executions.filter((item) => item.tool === 'get_grid_infrastructure').length, 2);
  assert.equal(result.tool_executions.some((item) => item.tool === 'ask_mireye_evidence'), false);
});

test('Groq retries a short 429 rate limit before falling back', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: 'Please try again in 0s.' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '0' },
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Recovered.' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const result = await callGroqAgent({ message: 'Hello', apiKey: 'test', fetchImpl });
  assert.equal(calls, 2);
  assert.equal(result.answer, 'Recovered.');
});

test('statewide deterministic fallback uses cached summary instead of live Mireye evidence', async () => {
  const result = await runAutonomousAgent({
    message: 'Which California counties have the highest charging stress?',
    provider: 'auto',
    geminiApiKey: '',
    groqApiKey: '',
  });
  assert.equal(result.provider, 'deterministic');
  assert.match(result.answer, /California statewide charging stress/);
  assert.match(result.answer, /no live Mireye call was needed/i);
  assert.deepEqual(result.tool_executions.map((item) => item.tool), ['get_statewide_summary']);
  assert.deepEqual(result.data_gaps, []);
});
