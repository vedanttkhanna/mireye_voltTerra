import { config } from '../config.js';
import { MCP_TOOL_DEFINITIONS, executeMcpTool, resolveCounty } from './mcp-tools.js';
import { findCountiesFromText, findCountyFromText } from './chat-agent.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');

/**
 * Builds a Mireye-compatible question about physical geospatial infrastructure
 * at the given coordinate. Only asks about data Mireye actually covers:
 * power utilities, substations, transmission lines, terrain, land cover, parcels.
 */
function buildMireyePhysicalQuestion(county, gridInfo) {
  const subDesc = gridInfo?.substation_distance_miles != null
    ? `The nearest electrical substation appears to be approximately ${gridInfo.substation_distance_miles} miles from this location at ${gridInfo.substation_voltage_kv != null ? `${gridInfo.substation_voltage_kv}kV` : 'an unknown voltage'}.`
    : '';

  return (
    `At this coordinate, what electric power infrastructure is present? ` +
    `${subDesc} ` +
    `Specifically: what is the nearest electrical substation and its operational voltage and status? ` +
    `Are there major transmission lines or utility corridors nearby? ` +
    `What is the terrain slope and land cover type at this location, and are there utility easements or rights-of-way that would affect electrical infrastructure siting?`
  );
}

const GEMINI_SYSTEM_PROMPT = `You are the autonomous EV Infrastructure & Grid Feasibility Agent for VOLT-TERRA.
Your job is to make justifiable, physical-data-driven funding decisions for California counties:
- "fund_charger_now": County is underserved (EV/port ratio >= 2x state median) AND local electrical grid passes all physical proximity and voltage gates (substation <= 8km, >= 60kV, in-service).
- "fund_grid_upgrade_first": County is underserved but local electrical grid fails proximity or voltage gates, requiring utility interconnection work first.
- "insufficient_data": County is underserved but required substation distance or voltage evidence is missing; do not infer that an upgrade is required.
- "not_flagged": County driver-to-plug ratio is within normal state ranges.

Treat STATE_AND_COUNTY_CONTEXT as trusted application data. Answer directly from it when sufficient; do not call a tool merely to retrieve a value already present. Choose tools only for missing counties, missing rankings, explicit funding decisions, or explicitly requested live evidence. Never invent values. Call make_funding_decision only when a decision is requested or clearly implied. Comparisons have per-county outcomes, never one overall verdict. Call ask_mireye_evidence only for explicitly requested deeper live physical evidence. Give enough reasoning to answer fully, normally 400–900 words for analysis and less for simple factual questions. Use short paragraphs with bold labels, no tables or headings. Cite the supplied sources.`;

const CONTEXT_MIREYE_FIELDS = new Set([
  'nearest_substation_distance_m',
  'nearest_substation_max_voltage_kv',
  'nearest_substation_status',
  'nearest_osm_substation_distance_m',
  'nearest_osm_substation_max_voltage_kv',
  'transmission_redundancy_flag',
  'nearest_transmission_line_distance_m',
  'nearest_transmission_line_voltage_kv',
  'interconnection_queue_active_capacity_caiso_mw',
]);

function compactMireyeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).filter(([name]) => CONTEXT_MIREYE_FIELDS.has(name)).map(([name, field]) => [name, {
    value: field?.value ?? null,
    unit: field?.unit ?? null,
    status: field?.status ?? null,
    source: field?.source ?? null,
    source_url: field?.source_url ?? null,
    confidence: field?.confidence ?? null,
    dataset_vintage: field?.dataset_vintage ?? null,
  }]));
}

export async function buildAgentContext({ message, countyFips } = {}) {
  const [scoredRaw, joinRaw] = await Promise.all([
    readFile(path.join(CACHE_DIR, `scored-counties-${config.pilotState}.json`), 'utf8'),
    readFile(path.join(CACHE_DIR, `join-pipeline-${config.pilotState}.json`), 'utf8'),
  ]);
  const scored = JSON.parse(scoredRaw);
  const joined = JSON.parse(joinRaw);
  const selected = countyFips
    ? resolveCounty(countyFips, scored)
    : findCountyFromText(message, scored.counties);
  const joinedCounty = joined.counties.find((county) => county.county_fips === selected?.county_fips);
  const primaryPoint = joinedCounty?.sample_points?.find((point) => point.type === 'centroid') ?? joinedCounty?.sample_points?.[0];

  return {
    schema_version: 'volt-terra.agent-context.v1',
    state: {
      code: scored.state,
      name: scored.state === 'CA' ? 'California' : scored.state,
      counties_total: scored.counties.length,
      state_median_driver_to_plug_ratio: scored.state_median_driver_to_plug_ratio,
      underserved_threshold_multiplier: scored.underserved_threshold_multiplier,
      counties_underserved: scored.counties_underserved,
      bucket_totals: {
        fund_charger_now: scored.counties_fund_charger_now,
        fund_grid_upgrade_first: scored.counties_fund_grid_upgrade_first,
        insufficient_data: scored.counties_insufficient_data ?? 0,
      },
      highest_charging_stress: scored.counties.filter((county) => county.underserved).map((county) => ({
        county_fips: county.county_fips,
        county_name: county.county_name,
        driver_to_plug_ratio: county.driver_to_plug_ratio,
        bucket: county.bucket,
        grid_score: county.grid_feasibility?.score ?? null,
      })),
    },
    selected_county: selected ? {
      county_fips: selected.county_fips,
      county_name: selected.county_name,
      latest_registrations: selected.latest_registrations,
      charger_count: selected.charger_count,
      driver_to_plug_ratio: selected.driver_to_plug_ratio,
      underserved: selected.underserved,
      bucket: selected.bucket,
      grid_feasibility: selected.grid_feasibility,
      mireye_sample: primaryPoint ? {
        type: primaryPoint.type,
        lat: primaryPoint.lat,
        lng: primaryPoint.lng,
        fields: compactMireyeFields(primaryPoint.grid_fields),
      } : null,
    } : null,
    data_policy: {
      cached_context_costs_mireye_credits: false,
      ask_mireye_evidence_is_live_and_metered: true,
      physical_screen_is_not_a_utility_interconnection_study: true,
    },
  };
}

/**
 * Runs autonomous Gemini tool-calling loop if GEMINI_API_KEY is configured.
 */
export async function callGeminiAgent({
  message,
  history = [],
  apiKey = config.geminiApiKey,
  model = config.geminiModel,
  timeoutMs = config.geminiTimeoutMs,
  fetchImpl = fetch,
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  // Format tools for Gemini API
  const tools = [
    {
      function_declarations: MCP_TOOL_DEFINITIONS.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: t.parameters.properties,
          required: t.parameters.required,
        },
      })),
    },
  ];

  const contents = [
    ...history.map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content }],
    })),
    {
      role: 'user',
      parts: [{ text: message }],
    },
  ];

  const toolExecutions = [];
  const accumulatedCitations = [];
  let finalDecision = null;
  let finalDecisionLabel = null;
  const fundingDecisions = [];

  // Comparisons commonly require several tool round trips before synthesis.
  for (let turn = 0; turn < 8; turn++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: GEMINI_SYSTEM_PROMPT }] },
        contents,
        tools,
        generationConfig: { temperature: 0.2 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0]?.content;
    if (!candidate) throw new Error('No candidate returned from Gemini');

    contents.push(candidate);

    // Check for function calls
    const functionCalls = candidate.parts?.filter((p) => p.functionCall);
    if (!functionCalls || functionCalls.length === 0) {
      // Model produced final text
      const answerText = candidate.parts?.map((p) => p.text).filter(Boolean).join('\n') || '';
      const isComparison = fundingDecisions.length > 1;
      return {
        answer: answerText,
        decision: isComparison ? null : finalDecision,
        decision_label: isComparison ? null : finalDecisionLabel,
        citations: accumulatedCitations,
        tool_executions: toolExecutions,
      };
    }

    // Execute each function call
    const functionResponses = [];
    for (const part of functionCalls) {
      const call = part.functionCall;
      const toolResult = await executeMcpTool(call.name, call.args);
      
      toolExecutions.push({
        tool: call.name,
        args: call.args,
        result: toolResult,
      });

      if (toolResult.citations) {
        accumulatedCitations.push(...toolResult.citations);
      }

      if (call.name === 'make_funding_decision' && toolResult.decision) {
        fundingDecisions.push(toolResult.decision);
        finalDecision = toolResult.decision;
        finalDecisionLabel = toolResult.decision_label;
      }

      functionResponses.push({
        functionResponse: {
          name: call.name,
          response: { result: toolResult },
        },
      });
    }

    contents.push({
      role: 'user',
      parts: functionResponses,
    });
  }

  throw new Error('Agent exceeded maximum tool turns');
}

function jsonSchemaForGroq(parameters) {
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      key === 'type' && typeof item === 'string' ? item.toLowerCase() : normalize(item),
    ]));
  };
  return normalize(parameters);
}

/** Runs the same local MCP tools through Groq's OpenAI-compatible API. */
export async function callGroqAgent({
  message,
  context = null,
  history = [],
  apiKey = config.groqApiKey,
  model = config.groqModel,
  timeoutMs = config.groqTimeoutMs,
  maxCompletionTokens = config.groqMaxCompletionTokens,
  fetchImpl = fetch,
}) {
  const tools = MCP_TOOL_DEFINITIONS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: jsonSchemaForGroq(tool.parameters),
    },
  }));
  const messages = [
    { role: 'system', content: GEMINI_SYSTEM_PROMPT },
    ...(context ? [{
      role: 'system',
      content: `STATE_AND_COUNTY_CONTEXT_JSON\n${JSON.stringify(context)}`,
    }] : []),
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: message },
  ];
  const toolExecutions = [];
  const accumulatedCitations = [];
  const fundingDecisions = [];
  let finalDecision = null;
  let finalDecisionLabel = null;
  const tokenUsage = { prompt: 0, completion: 0, total: 0 };

  const requestTurn = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: 'auto',
          temperature: 0.2,
          max_completion_tokens: maxCompletionTokens,
        }),
      });
      if (res.ok) return res.json();

      const body = await res.text();
      if (![429, 503].includes(res.status) || attempt === 2) {
        throw new Error(`Groq API error (${res.status}): ${body}`);
      }
      const retryAfterHeader = res.headers.get('retry-after');
      const headerSeconds = retryAfterHeader == null ? NaN : Number(retryAfterHeader);
      const messageSeconds = Number(body.match(/try again in ([\d.]+)s/i)?.[1]);
      const waitMs = Number.isFinite(headerSeconds)
        ? headerSeconds * 1000
        : Number.isFinite(messageSeconds) ? messageSeconds * 1000 : 1000 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, waitMs + Math.random() * 250)));
    }
    throw new Error('Groq request failed after retries');
  };

  for (let turn = 0; turn < 8; turn++) {
    const data = await requestTurn();
    tokenUsage.prompt += data.usage?.prompt_tokens ?? 0;
    tokenUsage.completion += data.usage?.completion_tokens ?? 0;
    tokenUsage.total += data.usage?.total_tokens ?? 0;
    const assistant = data.choices?.[0]?.message;
    if (!assistant) throw new Error('No message returned from Groq');
    messages.push(assistant);

    const toolCalls = assistant.tool_calls ?? [];
    if (toolCalls.length === 0) {
      const isComparison = fundingDecisions.length > 1;
      return {
        answer: assistant.content ?? '',
        decision: isComparison ? null : finalDecision,
        decision_label: isComparison ? null : finalDecisionLabel,
        citations: accumulatedCitations,
        tool_executions: toolExecutions,
        token_usage: tokenUsage,
      };
    }

    for (const call of toolCalls) {
      let args;
      try {
        args = JSON.parse(call.function?.arguments ?? '{}');
      } catch {
        throw new Error(`Groq returned invalid arguments for ${call.function?.name ?? 'unknown tool'}`);
      }
      const toolResult = await executeMcpTool(call.function.name, args);
      toolExecutions.push({ tool: call.function.name, args, result: toolResult });
      if (toolResult.citations) accumulatedCitations.push(...toolResult.citations);
      if (call.function.name === 'make_funding_decision' && toolResult.decision) {
        fundingDecisions.push(toolResult.decision);
        finalDecision = toolResult.decision;
        finalDecisionLabel = toolResult.decision_label;
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(toolResult),
      });
    }
  }
  throw new Error('Groq agent exceeded maximum tool turns');
}

/**
 * Intelligent deterministic fallback orchestrator when GEMINI_API_KEY is not supplied.
 */
async function callDeterministicAgent({ message, countyFips, coordinates, history = [] }) {
  let scoredData = null;
  try {
    const raw = await readFile(path.join(CACHE_DIR, `scored-counties-${config.pilotState}.json`), 'utf8');
    scoredData = JSON.parse(raw);
  } catch {}

  const counties = scoredData?.counties ?? [];
  let county = countyFips ? resolveCounty(countyFips, scoredData) : null;
  const conversationText = [...history.map((item) => item.content), message].join('\n');
  if (!county) {
    county = findCountyFromText(conversationText, counties);
  }

  const toolExecutions = [];
  const accumulatedCitations = [];

  const mentioned = findCountiesFromText(conversationText, counties);
  const comparisonCounties = [...(county ? [county] : []), ...mentioned]
    .filter((candidate, index, all) => all.findIndex((c) => c.county_fips === candidate.county_fips) === index);

  if (comparisonCounties.length >= 2) {
    const metrics = [];
    const gridComparisons = [];
    const asksForGrid = /grid|substation|feasib|voltage|infrastructure/i.test(message);
    for (const candidate of comparisonCounties) {
      const result = await executeMcpTool('get_county_demand_metrics', { county_name_or_fips: candidate.county_fips });
      metrics.push(result);
      toolExecutions.push({ tool: 'get_county_demand_metrics', args: { county_name_or_fips: candidate.county_fips }, result });
      if (result.citations) accumulatedCitations.push(...result.citations);
      if (asksForGrid) {
        const grid = await executeMcpTool('get_grid_infrastructure', { county_name_or_fips: candidate.county_fips });
        gridComparisons.push(grid);
        toolExecutions.push({ tool: 'get_grid_infrastructure', args: { county_name_or_fips: candidate.county_fips }, result: grid });
        if (grid.citations) accumulatedCitations.push(...grid.citations);
      }
    }

    const [base, ...others] = metrics;
    const comparisons = others.map((other) => {
      const ratioDifference = base.driver_to_plug_ratio - other.driver_to_plug_ratio;
      const direction = ratioDifference > 0 ? 'higher' : ratioDifference < 0 ? 'lower' : 'the same';
      return `${base.county_name} has **${Math.abs(ratioDifference).toFixed(1)} ${direction} EVs per port** than ${other.county_name} ` +
        `(${base.driver_to_plug_ratio.toFixed(1)} vs. ${other.driver_to_plug_ratio.toFixed(1)}). ` +
        `${base.county_name} is **${base.underserved ? 'flagged underserved' : 'not flagged'}**; ` +
        `${other.county_name} is **${other.underserved ? 'flagged underserved' : 'not flagged'}**.`;
    });

    const rows = metrics.map((item) =>
      `- **${item.county_name}:** ${item.latest_registrations.toLocaleString()} EVs, ${item.charger_ports_total.toLocaleString()} ports, ` +
      `${item.driver_to_plug_ratio.toFixed(1)} EVs/port, ${item.underserved ? 'underserved' : 'not flagged'}`
    ).join('\n');
    const gridRows = asksForGrid ? '\n\n' + gridComparisons.map((grid) =>
      `- **${grid.county_name} grid:** ${grid.substation_distance_miles != null ? `${grid.substation_distance_miles} mi to the nearest known substation` : 'distance unavailable'}, ` +
      `${grid.substation_voltage_kv != null ? `${grid.substation_voltage_kv}kV` : 'voltage unavailable'}, score ${grid.grid_feasibility_score ?? 'unavailable'}/100.`
    ).join('\n') : '';
    const scoredGrid = gridComparisons.filter((grid) => Number.isFinite(grid.grid_feasibility_score));
    const gridConclusion = asksForGrid && scoredGrid.length >= 2
      ? `\n\n**Grid comparison:** ${[...scoredGrid].sort((a, b) => b.grid_feasibility_score - a.grid_feasibility_score)[0].county_name} has the stronger cached physical-screen score. ` +
        `This is a screening comparison, not a utility interconnection study.`
      : '';

    return {
      answer: `**County comparison**\n\n${comparisons.join('\n\n')}\n\n${rows}${gridRows}${gridConclusion}\n\n` +
        `The statewide median is **${base.state_median_ratio.toFixed(1)} EVs/port** and the underserved threshold is twice that median. ` +
        `This comparison uses cached CA DMV registration and DOE AFDC charging data, so no live Mireye credit call was needed.`,
      decision: null,
      decision_label: null,
      confidence: 'high',
      citations: accumulatedCitations,
      data_gaps: [],
      tool_executions: toolExecutions,
      county: county ? {
        county_fips: county.county_fips,
        county_name: county.county_name,
        bucket: county.bucket,
        driver_to_plug_ratio: county.driver_to_plug_ratio,
      } : null,
    };
  }

  let demandMetrics = null;
  let gridInfo = null;
  let gateEval = null;
  let decisionResult = null;

  if (county) {
    // 1. Tool: get_county_demand_metrics
    demandMetrics = await executeMcpTool('get_county_demand_metrics', { county_name_or_fips: county.county_fips });
    toolExecutions.push({ tool: 'get_county_demand_metrics', args: { county_name_or_fips: county.county_fips }, result: demandMetrics });
    if (demandMetrics.citations) accumulatedCitations.push(...demandMetrics.citations);

    // 2. Tool: get_grid_infrastructure
    gridInfo = await executeMcpTool('get_grid_infrastructure', { county_name_or_fips: county.county_fips });
    toolExecutions.push({ tool: 'get_grid_infrastructure', args: { county_name_or_fips: county.county_fips }, result: gridInfo });
    if (gridInfo.citations) accumulatedCitations.push(...gridInfo.citations);

    // 3. Tool: evaluate_feasibility_gates
    if (gridInfo.substation_distance_m != null) {
      gateEval = await executeMcpTool('evaluate_feasibility_gates', {
        substation_distance_m: gridInfo.substation_distance_m,
        substation_voltage_kv: gridInfo.substation_voltage_kv,
        substation_status: gridInfo.substation_status,
      });
      toolExecutions.push({ tool: 'evaluate_feasibility_gates', args: { substation_distance_m: gridInfo.substation_distance_m }, result: gateEval });
    }

    // 4. Tool: make_funding_decision
    const isUnderserved = Boolean(demandMetrics.underserved);
    const passesGates = Boolean(gateEval?.passes_gates);
    const gridDataSufficient = Boolean(gateEval?.data_sufficient);
    decisionResult = await executeMcpTool('make_funding_decision', {
      county_name: county.county_name,
      underserved: isUnderserved,
      passes_grid_gates: passesGates,
      grid_data_sufficient: gridDataSufficient,
      justification: `EV ratio of ${county.driver_to_plug_ratio?.toFixed(1)} vs state median of ${scoredData?.state_median_driver_to_plug_ratio?.toFixed(1)}. ` +
        (gridInfo.substation_distance_miles != null
          ? `Substation is ${gridInfo.substation_distance_miles} mi away at ${gridInfo.substation_voltage_kv ?? 'unknown'}kV.`
          : 'Cached substation evidence is insufficient for a physical recommendation.'),
    });
    toolExecutions.push({ tool: 'make_funding_decision', args: { county_name: county.county_name }, result: decisionResult });

    // 5. Deep Mireye /v1/ask evidence call
    try {
      const mireyeQuestion = buildMireyePhysicalQuestion(county, gridInfo);
      const askResult = await executeMcpTool('ask_mireye_evidence', {
        lat: gridInfo.sampled_coordinates.lat,
        lng: gridInfo.sampled_coordinates.lng,
        question: mireyeQuestion,
      });
      if (askResult.citations) accumulatedCitations.push(...askResult.citations);
      
      // Synthesise: local demand/decision data + Mireye physical evidence
      const synthesis =
        `**Autonomous Feasibility Verdict: ${decisionResult.decision_label}**\n\n` +
        `**Demand Stress:** ${county.county_name} has **${county.driver_to_plug_ratio?.toFixed(1)} EVs per public charging port** ` +
        `(${county.latest_registrations?.toLocaleString()} registered EVs, ${county.charger_count} ports), ` +
        `vs. the California state median of **${scoredData?.state_median_driver_to_plug_ratio?.toFixed(1)} EVs/port**. ` +
        `This county is ${county.underserved ? 'flagged as underserved' : 'within normal state ranges'}.\n\n` +
        `**Physical Grid Evidence (Mireye):**\n${askResult.answer}\n\n` +
        `**Recommendation:** ${decisionResult.justification}`;

      return {
        answer: synthesis,
        decision: decisionResult.decision,
        decision_label: decisionResult.decision_label,
        confidence: askResult.confidence ?? 'high',
        citations: accumulatedCitations,
        data_gaps: askResult.data_gaps ?? [],
        tool_executions: toolExecutions,
        county: {
          county_fips: county.county_fips,
          county_name: county.county_name,
          bucket: decisionResult.decision,
          driver_to_plug_ratio: county.driver_to_plug_ratio,
        },
      };
    } catch {
      // Fallback synthesis if live network ask is unavailable
      const synthesis =
        `**Autonomous Feasibility Verdict: ${decisionResult.decision_label}**\n\n` +
        `**Demand Stress:** ${county.county_name} has **${county.driver_to_plug_ratio?.toFixed(1)} EVs per public port** ` +
        `(${county.latest_registrations?.toLocaleString()} registered EVs across ${county.charger_count} ports), ` +
        `compared to the California state median of **${scoredData?.state_median_driver_to_plug_ratio?.toFixed(1)} EVs/port**.\n\n` +
        `**Grid Feasibility:** The nearest electrical substation is **${gridInfo.substation_distance_miles} miles away** ` +
        `operating at **${gridInfo.substation_voltage_kv != null ? `${gridInfo.substation_voltage_kv}kV` : 'standard voltage'}** ` +
        `(${gridInfo.substation_status}, cited by ${gridInfo.substation_source}).\n\n` +
        `**Recommendation:** ${decisionResult.justification}`;

      return {
        answer: synthesis,
        decision: decisionResult.decision,
        decision_label: decisionResult.decision_label,
        confidence: 'high',
        citations: accumulatedCitations,
        data_gaps: [],
        tool_executions: toolExecutions,
        county: {
          county_fips: county.county_fips,
          county_name: county.county_name,
          bucket: decisionResult.decision,
          driver_to_plug_ratio: county.driver_to_plug_ratio,
        },
      };
    }
  }

  // Statewide or generic inquiry
  if (!coordinates) {
    const statewide = await executeMcpTool('get_statewide_summary', { limit: 10, underserved_only: true });
    toolExecutions.push({ tool: 'get_statewide_summary', args: { limit: 10, underserved_only: true }, result: statewide });
    const rows = statewide.ranked_counties.map((county) =>
      `- **${county.county_name}:** ${county.driver_to_plug_ratio?.toFixed(1) ?? 'unknown'} EVs/port, ` +
      `${county.bucket ?? 'no funding bucket'}`
    ).join('\n');
    return {
      answer: `**California statewide charging stress**\n\nCalifornia has **${statewide.counties_underserved} underserved counties** ` +
        `using a threshold of ${statewide.underserved_threshold_multiplier}× the state median ` +
        `(${statewide.state_median_driver_to_plug_ratio.toFixed(1)} EVs/port).\n\n${rows}\n\n` +
        `This fallback summary uses cached CA DMV, DOE AFDC, and scored grid results; no live Mireye call was needed.`,
      decision: null,
      decision_label: null,
      confidence: 'high',
      citations: statewide.citations,
      data_gaps: [],
      tool_executions: toolExecutions,
      county: null,
    };
  }

  // A supplied coordinate is an explicit request for live physical context.
  const sampleLat = coordinates?.lat ?? 37.2;
  const sampleLng = coordinates?.lng ?? -119.4;
  const askResult = await executeMcpTool('ask_mireye_evidence', {
    lat: sampleLat,
    lng: sampleLng,
    question:
      `At this coordinate in California, what electrical power infrastructure is present? ` +
      `What is the nearest electrical substation, its voltage, and operational status? ` +
      `Are there transmission lines, utility corridors, or power rights-of-way nearby? ` +
      `What is the terrain slope, land cover, and are there any utility easements at this location?`,
  });

  return {
    answer: askResult.answer,
    decision: null,
    decision_label: null,
    confidence: askResult.confidence,
    citations: askResult.citations ?? [],
    data_gaps: askResult.data_gaps ?? [],
    tool_executions: toolExecutions,
    county: null,
  };
}

/**
 * Main autonomous agent entrypoint.
 */
export async function runAutonomousAgent({
  message,
  history = [],
  countyFips,
  coordinates,
  geminiApiKey = config.geminiApiKey,
  geminiFetchImpl = fetch,
  groqApiKey = config.groqApiKey,
  groqFetchImpl = fetch,
  provider = config.llmProvider,
}) {
  const normalizedProvider = String(provider).toLowerCase();
  if (!['auto', 'gemini', 'groq'].includes(normalizedProvider)) {
    throw new Error('LLM_PROVIDER must be auto, gemini, or groq');
  }
  const providerErrors = [];
  const agentContext = await buildAgentContext({ message, countyFips });
  const contextualMessage = `STATE_AND_COUNTY_CONTEXT:\n${JSON.stringify(agentContext)}\n\nUser question: ${message}`;
  const providers = normalizedProvider === 'auto' ? ['gemini', 'groq'] : [normalizedProvider];

  for (const candidateProvider of providers) {
    const apiKey = candidateProvider === 'gemini' ? geminiApiKey : groqApiKey;
    if (!apiKey) {
      if (normalizedProvider !== 'auto') providerErrors.push(`${candidateProvider}: API key is not configured`);
      continue;
    }
    try {
      const agentResult = candidateProvider === 'gemini'
        ? await callGeminiAgent({ message: contextualMessage, history, apiKey, fetchImpl: geminiFetchImpl })
        : await callGroqAgent({ message, context: agentContext, history, apiKey, fetchImpl: groqFetchImpl });
      return {
        ok: true,
        provider: candidateProvider,
        fallback_used: false,
        query: message,
        answered_at: new Date().toISOString(),
        context_scope: {
          state: agentContext.state.name,
          county: agentContext.selected_county?.county_name ?? null,
          history_messages: history.length,
          mireye_fields: Object.keys(agentContext.selected_county?.mireye_sample?.fields ?? {}).length,
        },
        ...agentResult,
      };
    } catch (err) {
      providerErrors.push(`${candidateProvider}_request_failed`);
      console.warn(`[VOLT-TERRA] ${candidateProvider} agent error: ${err.message}`);
    }
  }

  // Fallback or default deterministic tool orchestrator
  const result = await callDeterministicAgent({ message, countyFips, coordinates, history });
  return {
    ok: true,
    provider: 'deterministic',
    fallback_used: providerErrors.length > 0,
    fallback_reason: providerErrors.join('; ') || null,
    query: message,
    answered_at: new Date().toISOString(),
    context_scope: {
      state: agentContext.state.name,
      county: agentContext.selected_county?.county_name ?? null,
      history_messages: history.length,
      mireye_fields: Object.keys(agentContext.selected_county?.mireye_sample?.fields ?? {}).length,
    },
    ...result,
  };
}
