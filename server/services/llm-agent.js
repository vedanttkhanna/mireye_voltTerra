import { config } from '../config.js';
import { MCP_TOOL_DEFINITIONS, executeMcpTool, resolveCounty } from './mcp-tools.js';
import { findCountyFromText } from './chat-agent.js';
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
- "not_flagged": County driver-to-plug ratio is within normal state ranges.

Always use your tools to fetch real data before concluding. Always cite specific sources (EIA, OpenStreetMap, DOE AFDC, CA DMV).`;

/**
 * Runs autonomous Gemini tool-calling loop if GEMINI_API_KEY is configured.
 */
async function callGeminiAgent({ message, apiKey = config.geminiApiKey }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

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
    {
      role: 'user',
      parts: [{ text: message }],
    },
  ];

  const toolExecutions = [];
  const accumulatedCitations = [];
  let finalDecision = null;
  let finalDecisionLabel = null;

  // Multi-turn tool execution loop (max 4 turns)
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      return {
        answer: answerText,
        decision: finalDecision,
        decision_label: finalDecisionLabel,
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

/**
 * Intelligent deterministic fallback orchestrator when GEMINI_API_KEY is not supplied.
 */
async function callDeterministicAgent({ message, countyFips, coordinates }) {
  let scoredData = null;
  try {
    const raw = await readFile(path.join(CACHE_DIR, `scored-counties-${config.pilotState}.json`), 'utf8');
    scoredData = JSON.parse(raw);
  } catch {}

  const counties = scoredData?.counties ?? [];
  let county = countyFips ? resolveCounty(countyFips, scoredData) : null;
  if (!county) {
    county = findCountyFromText(message, counties);
  }

  const toolExecutions = [];
  const accumulatedCitations = [];

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
    decisionResult = await executeMcpTool('make_funding_decision', {
      county_name: county.county_name,
      underserved: isUnderserved,
      passes_grid_gates: passesGates,
      justification: `EV ratio of ${county.driver_to_plug_ratio?.toFixed(1)} vs state median of ${scoredData?.state_median_driver_to_plug_ratio?.toFixed(1)}. Substation is ${gridInfo.substation_distance_miles} mi away at ${gridInfo.substation_voltage_kv}kV.`,
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
        `### Autonomous Feasibility Verdict: **${decisionResult.decision_label}**\n\n` +
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
        `### Autonomous Feasibility Verdict: **${decisionResult.decision_label}**\n\n` +
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
export async function runAutonomousAgent({ message, countyFips, coordinates }) {
  if (config.geminiApiKey) {
    try {
      const geminiResult = await callGeminiAgent({ message });
      return {
        ok: true,
        query: message,
        answered_at: new Date().toISOString(),
        ...geminiResult,
      };
    } catch (err) {
      console.warn(`[VOLT-TERRA] Gemini agent error, falling back to deterministic tool orchestrator: ${err.message}`);
    }
  }

  // Fallback or default deterministic tool orchestrator
  const result = await callDeterministicAgent({ message, countyFips, coordinates });
  return {
    ok: true,
    query: message,
    answered_at: new Date().toISOString(),
    ...result,
  };
}
