import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { mireye } from './mireye.js';
import { computeGridFeasibilityScore } from './scoring.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');
const METERS_PER_MILE = 1609.34;

async function loadScoredData(state = config.pilotState) {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `scored-counties-${state}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadJoinData(state = config.pilotState) {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `join-pipeline-${state}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * MCP Tool definitions metadata for LLMs (Gemini / Claude).
 */
export const MCP_TOOL_DEFINITIONS = [
  {
    name: 'get_statewide_summary',
    description: 'Retrieves the California-wide median, underserved threshold, bucket totals, and ranked counties. Use for statewide, ranking, highest/lowest, and broad comparison questions.',
    parameters: {
      type: 'OBJECT',
      properties: {
        limit: { type: 'NUMBER', description: 'Maximum ranked counties to return, from 1 to 20.' },
        underserved_only: { type: 'BOOLEAN', description: 'Return only counties flagged underserved.' },
      },
      required: [],
    },
  },
  {
    name: 'get_county_demand_metrics',
    description: 'Retrieves EV registration counts, existing public charging ports (Level 2 and DC Fast), driver-to-plug ratio, and underserved status for a California county.',
    parameters: {
      type: 'OBJECT',
      properties: {
        county_name_or_fips: {
          type: 'STRING',
          description: 'The name of the county (e.g. "Sutter", "Riverside County") or 5-digit FIPS code (e.g. "06101").',
        },
      },
      required: ['county_name_or_fips'],
    },
  },
  {
    name: 'get_grid_infrastructure',
    description: 'Retrieves physical electrical grid data for a county or coordinate from Mireye (substation distance, voltage, operational status, transmission line count, CAISO interconnection queue).',
    parameters: {
      type: 'OBJECT',
      properties: {
        county_name_or_fips: {
          type: 'STRING',
          description: 'County name or FIPS code to look up physical grid fields for.',
        },
        lat: { type: 'NUMBER', description: 'Optional latitude of specific location.' },
        lng: { type: 'NUMBER', description: 'Optional longitude of specific location.' },
      },
      required: ['county_name_or_fips'],
    },
  },
  {
    name: 'evaluate_feasibility_gates',
    description: 'Evaluates the 3 hard physical grid feasibility gates (substation in-service, distance <= 8km, voltage >= 60kV) and returns a 0-100 score and gate pass/fail reasons.',
    parameters: {
      type: 'OBJECT',
      properties: {
        substation_distance_m: { type: 'NUMBER', description: 'Distance to nearest substation in meters.' },
        substation_voltage_kv: { type: 'NUMBER', description: 'Voltage of nearest substation in kilovolts (kV).' },
        substation_status: { type: 'STRING', description: 'Operational status of the substation (e.g. "IN SERVICE").' },
      },
      required: ['substation_distance_m'],
    },
  },
  {
    name: 'ask_mireye_evidence',
    description: 'Calls Mireye /v1/ask endpoint to get deep physical cited grid evidence and qualitative synthesis for a geographic location.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lat: { type: 'NUMBER', description: 'Latitude coordinate.' },
        lng: { type: 'NUMBER', description: 'Longitude coordinate.' },
        question: { type: 'STRING', description: 'The specific feasibility question to ask Mireye.' },
      },
      required: ['lat', 'lng', 'question'],
    },
  },
  {
    name: 'make_funding_decision',
    description: 'Determines the recommendation bucket, including insufficient_data when physical evidence is missing.',
    parameters: {
      type: 'OBJECT',
      properties: {
        county_name: { type: 'STRING', description: 'The county name.' },
        underserved: { type: 'BOOLEAN', description: 'Whether the county has an EV/port ratio >= 2x state median.' },
        passes_grid_gates: { type: 'BOOLEAN', description: 'Whether local electrical grid passes proximity and voltage gates.' },
        grid_data_sufficient: { type: 'BOOLEAN', description: 'Whether substation distance and voltage are both known.' },
        justification: { type: 'STRING', description: 'The plain-English reasoning supporting the decision.' },
      },
      required: ['county_name', 'underserved', 'passes_grid_gates', 'grid_data_sufficient', 'justification'],
    },
  },
];

/**
 * Resolves a county record from scored data or join data by name or FIPS.
 */
export function resolveCounty(nameOrFips, scoredData) {
  if (!nameOrFips || !scoredData?.counties) return null;
  const target = String(nameOrFips).trim().toLowerCase();
  
  return scoredData.counties.find((c) => {
    if (c.county_fips === target) return true;
    const cName = c.county_name.toLowerCase();
    const bare = cName.replace(/\s+county$/, '');
    return cName === target || bare === target || target.includes(cName) || target.includes(bare);
  }) ?? null;
}

/**
 * Executes an MCP tool invocation and returns structured output with citations.
 */
export async function executeMcpTool(toolName, args, { askImpl = mireye.ask.bind(mireye) } = {}) {
  const scoredData = await loadScoredData();
  const joinData = await loadJoinData();

  switch (toolName) {
    case 'get_statewide_summary': {
      const limit = Math.max(1, Math.min(20, Math.trunc(Number(args.limit) || 10)));
      const counties = (scoredData?.counties ?? []).filter((county) => !args.underserved_only || county.underserved);
      return {
        state: scoredData?.state ?? config.pilotState,
        state_median_driver_to_plug_ratio: scoredData?.state_median_driver_to_plug_ratio,
        underserved_threshold_multiplier: scoredData?.underserved_threshold_multiplier,
        counties_total: scoredData?.counties?.length ?? 0,
        counties_underserved: scoredData?.counties_underserved ?? 0,
        bucket_totals: {
          fund_charger_now: scoredData?.counties_fund_charger_now ?? 0,
          fund_grid_upgrade_first: scoredData?.counties_fund_grid_upgrade_first ?? 0,
          insufficient_data: scoredData?.counties_insufficient_data ?? 0,
        },
        ranked_counties: counties.slice(0, limit).map((county) => ({
          county_fips: county.county_fips,
          county_name: county.county_name,
          driver_to_plug_ratio: county.driver_to_plug_ratio,
          underserved: county.underserved,
          bucket: county.bucket,
        })),
        citations: [
          { source: 'CA DMV Vehicle Fuel Type Counts', source_url: 'https://data.ca.gov/dataset/vehicle-fuel-type-count-by-zip-code', confidence: 'high' },
          { source: 'DOE Alternative Fuels Data Center (AFDC)', source_url: 'https://developer.nlr.gov', confidence: 'high' },
        ],
      };
    }
    case 'get_county_demand_metrics': {
      const county = resolveCounty(args.county_name_or_fips, scoredData);
      if (!county) {
        return { error: `County "${args.county_name_or_fips}" not found in California dataset.` };
      }

      return {
        county_fips: county.county_fips,
        county_name: county.county_name,
        latest_registrations: county.latest_registrations,
        charger_ports_total: county.charger_count,
        driver_to_plug_ratio: county.driver_to_plug_ratio,
        state_median_ratio: scoredData.state_median_driver_to_plug_ratio,
        underserved: county.underserved,
        citations: [
          { source: 'CA DMV Vehicle Fuel Type Counts', source_url: 'https://data.ca.gov/dataset/vehicle-fuel-type-count-by-zip-code', confidence: 'high' },
          { source: 'DOE Alternative Fuels Data Center (AFDC)', source_url: 'https://developer.nlr.gov', confidence: 'high' },
        ],
      };
    }

    case 'get_grid_infrastructure': {
      const county = resolveCounty(args.county_name_or_fips, scoredData);
      const joinCounty = joinData?.counties?.find((c) => c.county_fips === county?.county_fips);
      const cachedPoint = joinCounty?.sample_points?.find((p) => p.type === 'centroid') ?? joinCounty?.sample_points?.[0];
      const computed = cachedPoint?.grid_fields ? computeGridFeasibilityScore(cachedPoint.grid_fields) : null;
      const gf = county?.grid_feasibility ?? (computed ? {
        ...computed,
        sampled_at: { type: cachedPoint.type, lat: cachedPoint.lat, lng: cachedPoint.lng },
      } : null);
      const inputs = gf?.inputs ?? {};
      const samplePoint = gf?.sampled_at ?? { lat: args.lat ?? 37.2, lng: args.lng ?? -119.4 };

      const citations = [
        {
          source: inputs.substation_source === 'OSM' ? 'OpenStreetMap Power' : 'EIA Substation Dataset',
          source_url: inputs.substation_source === 'OSM' ? 'https://www.openstreetmap.org' : 'https://www.eia.gov/electricity/data.php',
          confidence: gf?.confidence ?? 'high',
        },
      ];

      return {
        county_name: county?.county_name ?? 'Custom Location',
        sampled_coordinates: samplePoint,
        substation_distance_m: inputs.substation_distance_m,
        substation_distance_miles: inputs.substation_distance_m != null ? Number((inputs.substation_distance_m / METERS_PER_MILE).toFixed(2)) : null,
        substation_voltage_kv: inputs.substation_voltage_kv,
        substation_status: inputs.substation_status ?? null,
        substation_source: inputs.substation_source ?? null,
        grid_feasibility_score: gf?.score ?? null,
        citations,
      };
    }

    case 'evaluate_feasibility_gates': {
      // Build the field-object shape that computeGridFeasibilityScore / fieldValue() expects:
      // { fieldName: { status: 'ok', value: <raw value> } }
      const makeField = (v) => (v != null ? { status: 'ok', value: v } : null);
      const gridFields = {
        nearest_substation_distance_m: makeField(args.substation_distance_m),
        nearest_substation_max_voltage_kv: makeField(args.substation_voltage_kv),
        nearest_substation_status: makeField(args.substation_status ?? null),
      };
      const evalResult = computeGridFeasibilityScore(gridFields);

      return {
        passes_gates: evalResult.passes_gates,
        data_sufficient: evalResult.data_sufficient,
        score: evalResult.score,
        gate_failures: evalResult.gate_failures,
        summary: evalResult.passes_gates
          ? 'Passes all 3 physical gates (within 8km, >= 60kV sub-transmission, in-service).'
          : `Fails grid feasibility screen: ${evalResult.gate_failures.join(', ')}`,
      };
    }

    case 'ask_mireye_evidence': {
      const response = await askImpl({
        lat: args.lat,
        lng: args.lng,
        question: args.question,
      });

      return {
        answer: response.answer,
        confidence: response.confidence ?? 'moderate',
        citations: response.citations ?? [],
        data_gaps: response.data_gaps ?? [],
      };
    }

    case 'make_funding_decision': {
      let decision = 'not_flagged';
      if (args.underserved) {
        decision = !args.grid_data_sufficient
          ? 'insufficient_data'
          : args.passes_grid_gates ? 'fund_charger_now' : 'fund_grid_upgrade_first';
      }

      return {
        county_name: args.county_name,
        decision,
        decision_label: decision === 'fund_charger_now' ? 'Fund Charger Now' : decision === 'fund_grid_upgrade_first' ? 'Fund Grid Upgrade First' : decision === 'insufficient_data' ? 'Needs Data Review' : 'Not Flagged for Intervention',
        justification: args.justification,
        timestamp: new Date().toISOString(),
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
