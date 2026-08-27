import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { mireye } from './mireye.js';
import { computeGridFeasibilityScore } from './scoring.js';
import { GRID_FEASIBILITY_FIELDS } from './orchestrator.js';
import { pointInGeometry, haversineDistanceMeters } from '../lib/geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const METERS_PER_MILE = 1609.34;

// Every field in GRID_FEASIBILITY_FIELDS bills at 1 credit/location and none
// belong to a metered group (parcel fields are deliberately excluded), so a
// live point fetch costs exactly this much — deterministic, no quote needed.
const CREDITS_PER_LIVE_POINT = GRID_FEASIBILITY_FIELDS.length;

// /v1/ask is priced flat per the build brief ("POST /v1/ask - ask in plain
// English - 10 credits"), independent of how many fields it fetches internally.
const ASK_CREDITS = 10;

// /v1/proximity prices per op and mode, not per field. These ceilings are
// passed as max_credits so a wrong mode is refused with a 422 stating the real
// price rather than silently charged. Observed live: nearest/@substations is
// 2 credits straightline and 300 driving; a 15-minute labor_shed is ~1,200.
const PROXIMITY_STRAIGHTLINE_CEILING = 25;
const PROXIMITY_DRIVING_CEILING = 400;
// A 15-minute shed in a dense metro was observed to price at 5,388 credits
// (the price is the number of census tracts in the uncertain ring, which grows
// fast in a city), so a 5,000 ceiling refused exactly the urban sheds that are
// most worth running. Sized to clear those while still stopping a runaway.
const LABOR_SHED_CEILING = 9000;

async function loadCountyBoundaries(state = config.pilotState) {
  try {
    const raw = await readFile(path.join(DATA_DIR, `county-boundaries-${state}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function loadScoredData(state = config.pilotState) {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `scored-counties-${state}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function loadJoinData(state = config.pilotState) {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `join-pipeline-${state}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
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
    name: 'fetch_live_grid_fields',
    description:
      `LIVE AND METERED (~${CREDITS_PER_LIVE_POINT} Mireye credits per call). Fetches fresh cited grid fields ` +
      'straight from Mireye at one exact coordinate and evaluates the feasibility gates on them. This is the ' +
      'only tool that can produce evidence not already in the cache. Use it when cached evidence is missing, ' +
      'marked insufficient, or contradicts another source — never to re-read a value already present in context.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lat: { type: 'NUMBER', description: 'Latitude of the point to investigate.' },
        lng: { type: 'NUMBER', description: 'Longitude of the point to investigate.' },
        reason: {
          type: 'STRING',
          description: 'Why live evidence is needed at this point rather than the cached value. Shown to the user.',
        },
      },
      required: ['lat', 'lng', 'reason'],
    },
  },
  {
    name: 'sample_county_points',
    description:
      `LIVE AND METERED (~${CREDITS_PER_LIVE_POINT} Mireye credits per point). Fetches fresh grid fields at ` +
      'several points spread across a county, to test whether its single population-center sample is ' +
      'representative of the whole county. Use for large or geographically varied counties, or when one ' +
      'sample point contradicts other evidence.',
    parameters: {
      type: 'OBJECT',
      properties: {
        county_name_or_fips: { type: 'STRING', description: 'County name or 5-digit FIPS code.' },
        count: { type: 'NUMBER', description: 'How many points to sample, 1 to 4. Defaults to 3.' },
        reason: {
          type: 'STRING',
          description: 'Why extra sampling is warranted for this county. Shown to the user.',
        },
      },
      required: ['county_name_or_fips', 'reason'],
    },
  },
  {
    name: 'find_nearest_substations',
    description:
      'LIVE AND METERED (about 2 credits straightline). Returns the N nearest electrical substations to a ' +
      'coordinate, each with its NAME, coordinates and max voltage, from Mireye\'s curated @substations set. ' +
      'The cached grid fields only describe the single closest substation, so use this when the question is ' +
      'which substation to interconnect to, whether a higher-voltage option exists slightly further out, or ' +
      'when a memo should name real infrastructure. Set mode to driving only if road distance genuinely ' +
      'matters: it costs about 300 credits instead of 2.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lat: { type: 'NUMBER', description: 'Latitude of the origin point.' },
        lng: { type: 'NUMBER', description: 'Longitude of the origin point.' },
        n: { type: 'NUMBER', description: 'How many substations to return, 1 to 25. Defaults to 5.' },
        mode: { type: 'STRING', description: '"straightline" (default, ~2 credits) or "driving" (~300 credits).' },
        reason: { type: 'STRING', description: 'Why this lookup is needed. Shown to the user.' },
      },
      required: ['lat', 'lng', 'reason'],
    },
  },
  {
    name: 'get_labor_shed',
    description:
      'Population and civilian labor force reachable within a driving-time shed of a coordinate. This is a ' +
      'DEMAND signal the county-level registration ratio cannot give you: it says how many people can ' +
      'actually reach this exact point, which is how you test whether a sample point sits in populated ' +
      'territory or empty land. EXPENSIVE when run for real (roughly 1,200 credits). It defaults to a FREE ' +
      'exact price quote — call it first without confirm, read would_cost_credits, and only pass confirm ' +
      'true if the answer genuinely needs the real number.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lat: { type: 'NUMBER', description: 'Latitude of the origin point.' },
        lng: { type: 'NUMBER', description: 'Longitude of the origin point.' },
        minutes: { type: 'NUMBER', description: 'Driving-minutes radius, 5 to 90. Defaults to 15.' },
        confirm: {
          type: 'BOOLEAN',
          description: 'False (default) returns a free exact price quote. True actually runs and charges it.',
        },
        reason: { type: 'STRING', description: 'Why this shed is needed. Shown to the user.' },
      },
      required: ['lat', 'lng', 'reason'],
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

/** Flattens any GeoJSON geometry's coordinates into a flat [lng, lat][] list. */
function collectCoords(geometry, out = []) {
  if (!geometry) return out;
  if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries) collectCoords(g, out);
    return out;
  }
  const walk = (arr) => {
    if (typeof arr[0] === 'number') {
      out.push(arr);
      return;
    }
    for (const item of arr) walk(item);
  };
  if (geometry.coordinates) walk(geometry.coordinates);
  return out;
}

function geometryBbox(geometry) {
  const coords = collectCoords(geometry);
  if (!coords.length) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, maxLng, minLat, maxLat };
}

/**
 * Picks up to `count` points spread across a county's interior. Walks a grid
 * over the bounding box and keeps only points that actually fall inside the
 * polygon (pointInGeometry handles holes and multi-part counties like San
 * Francisco), then spreads the picks across the accepted list. These are
 * genuinely new coordinates — deliberately not the county's cached
 * population-center or corridor points, since re-fetching those would spend
 * credits to learn nothing the cache doesn't already hold.
 */
export function interiorPoints(geometry, count = 3, steps = 7) {
  const bbox = geometryBbox(geometry);
  if (!bbox) return [];
  const candidates = [];
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const lat = bbox.minLat + ((bbox.maxLat - bbox.minLat) * i) / steps;
      const lng = bbox.minLng + ((bbox.maxLng - bbox.minLng) * j) / steps;
      if (pointInGeometry({ lat, lng }, geometry)) candidates.push({ lat, lng });
    }
  }
  if (candidates.length <= count) return candidates;

  // Farthest-point sampling. Taking evenly-spaced indices out of the candidate
  // list clusters badly, because the grid walk emits candidates in row-major
  // order — on a wide county like Riverside that returned three points sharing
  // one longitude, sampling a single edge. Greedily picking the candidate
  // farthest from everything already chosen spreads across the real extent.
  const start = candidates.reduce((best, c) => {
    const center = {
      lat: (bbox.minLat + bbox.maxLat) / 2,
      lng: (bbox.minLng + bbox.maxLng) / 2,
    };
    return haversineDistanceMeters(c, center) < haversineDistanceMeters(best, center) ? c : best;
  }, candidates[0]);

  const picked = [start];
  while (picked.length < count) {
    let farthest = null;
    let farthestDistance = -1;
    for (const c of candidates) {
      if (picked.includes(c)) continue;
      const nearest = Math.min(...picked.map((p) => haversineDistanceMeters(c, p)));
      if (nearest > farthestDistance) {
        farthestDistance = nearest;
        farthest = c;
      }
    }
    if (!farthest) break;
    picked.push(farthest);
  }
  return picked;
}

function substationCitation(inputs, confidence = 'high') {
  return {
    source: inputs.substation_source === 'OSM' ? 'OpenStreetMap Power' : 'EIA Substation Dataset',
    source_url:
      inputs.substation_source === 'OSM'
        ? 'https://www.openstreetmap.org'
        : 'https://www.eia.gov/electricity/data.php',
    confidence,
  };
}

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
export async function executeMcpTool(
  toolName,
  args,
  {
    askImpl = mireye.ask.bind(mireye),
    fetchImpl = mireye.fetch.bind(mireye),
    proximityImpl = mireye.proximity.bind(mireye),
  } = {}
) {
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
      const cachedPoint = joinCounty?.sample_points?.find((p) => p.type === 'population_center') ??
        joinCounty?.sample_points?.find((p) => p.type === 'centroid') ?? joinCounty?.sample_points?.[0];
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
        credits_spent: ASK_CREDITS,
      };
    }

    case 'fetch_live_grid_fields': {
      const lat = Number(args.lat);
      const lng = Number(args.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { error: 'fetch_live_grid_fields requires numeric lat and lng.', credits_spent: 0 };
      }

      const response = await fetchImpl({ lat, lng, fields: GRID_FEASIBILITY_FIELDS });
      if (!response?.fields || typeof response.fields !== 'object' || Array.isArray(response.fields)) {
        return { error: 'Mireye returned an invalid field response for this point.', credits_spent: 0 };
      }
      const feasibility = computeGridFeasibilityScore(response.fields);

      return {
        live: true,
        lat,
        lng,
        reason: args.reason ?? null,
        fetched_at: response.fetched_at ?? null,
        passes_gates: feasibility.passes_gates,
        data_sufficient: feasibility.data_sufficient,
        score: feasibility.score,
        gate_failures: feasibility.gate_failures,
        substation_distance_m: feasibility.inputs.substation_distance_m,
        substation_distance_miles:
          feasibility.inputs.substation_distance_m != null
            ? Number((feasibility.inputs.substation_distance_m / METERS_PER_MILE).toFixed(2))
            : null,
        substation_voltage_kv: feasibility.inputs.substation_voltage_kv,
        substation_status: feasibility.inputs.substation_status,
        substation_source: feasibility.inputs.substation_source,
        credits_spent: CREDITS_PER_LIVE_POINT,
        citations: [substationCitation(feasibility.inputs)],
      };
    }

    case 'sample_county_points': {
      const county = resolveCounty(args.county_name_or_fips, scoredData);
      if (!county) {
        return { error: `County "${args.county_name_or_fips}" not found.`, credits_spent: 0 };
      }
      const boundaries = await loadCountyBoundaries();
      const feature = boundaries?.features?.find((f) => f.properties.county_fips === county.county_fips);
      if (!feature) {
        return { error: `No boundary geometry for ${county.county_name}.`, credits_spent: 0 };
      }

      const count = Math.max(1, Math.min(4, Math.trunc(Number(args.count) || 3)));
      const points = interiorPoints(feature.geometry, count);
      if (points.length === 0) {
        return { error: `Could not derive interior points for ${county.county_name}.`, credits_spent: 0 };
      }

      const samples = [];
      let creditsSpent = 0;
      for (const point of points) {
        const response = await fetchImpl({ lat: point.lat, lng: point.lng, fields: GRID_FEASIBILITY_FIELDS });
        if (!response?.fields || typeof response.fields !== 'object' || Array.isArray(response.fields)) continue;
        creditsSpent += CREDITS_PER_LIVE_POINT;
        const feasibility = computeGridFeasibilityScore(response.fields);
        samples.push({
          lat: point.lat,
          lng: point.lng,
          passes_gates: feasibility.passes_gates,
          data_sufficient: feasibility.data_sufficient,
          score: feasibility.score,
          gate_failures: feasibility.gate_failures,
          substation_distance_miles:
            feasibility.inputs.substation_distance_m != null
              ? Number((feasibility.inputs.substation_distance_m / METERS_PER_MILE).toFixed(2))
              : null,
          substation_voltage_kv: feasibility.inputs.substation_voltage_kv,
          substation_source: feasibility.inputs.substation_source,
        });
      }

      const passing = samples.filter((s) => s.passes_gates).length;
      const cachedVerdict = county.grid_feasibility?.passes_gates ?? null;
      const agrees = cachedVerdict == null ? null : samples.every((s) => s.passes_gates === cachedVerdict);

      return {
        live: true,
        county_name: county.county_name,
        reason: args.reason ?? null,
        points_sampled: samples.length,
        points_passing_gates: passing,
        cached_population_center_passes_gates: cachedVerdict,
        // The whole point of this tool: does the county's single cached
        // sample actually represent the rest of it?
        samples_agree_with_cached_verdict: agrees,
        representativeness: agrees === null ? 'unknown' : agrees ? 'consistent' : 'inconsistent',
        samples,
        credits_spent: creditsSpent,
        citations: samples.length ? [substationCitation({ substation_source: samples[0].substation_source })] : [],
      };
    }

    case 'find_nearest_substations': {
      const lat = Number(args.lat);
      const lng = Number(args.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { error: 'find_nearest_substations requires numeric lat and lng.', credits_spent: 0 };
      }
      const mode = args.mode === 'driving' ? 'driving' : 'straightline';
      const n = Math.max(1, Math.min(25, Math.trunc(Number(args.n) || 5)));
      // Ceiling sized to the op so a mis-typed mode can't quietly cost 300
      // credits when 2 was intended; the 422 states the real price.
      const maxCredits = mode === 'driving' ? PROXIMITY_DRIVING_CEILING : PROXIMITY_STRAIGHTLINE_CEILING;

      let response;
      try {
        response = await proximityImpl({
          op: 'nearest',
          origin: `${lat},${lng}`,
          set: '@substations',
          n,
          mode,
          max_credits: maxCredits,
        });
      } catch (err) {
        return {
          error: 'substation_lookup_failed',
          detail: err.body?.detail?.message ?? err.message,
          credits_spent: 0,
        };
      }

      const candidates = (response.candidates ?? []).map((c) => ({
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        max_voltage_kv: c.attributes?.max_voltage_kv ?? null,
        distance_miles: c.distance_miles != null ? Number(c.distance_miles.toFixed(2)) : null,
        duration_minutes: c.duration_minutes ?? null,
      }));

      // The point of returning N rather than 1: the closest substation is not
      // always the best interconnection target if a higher-voltage one sits
      // only slightly further out.
      const strongest = candidates.reduce(
        (best, c) => (c.max_voltage_kv != null && (best == null || c.max_voltage_kv > best.max_voltage_kv) ? c : best),
        null
      );

      return {
        live: true,
        mode,
        reason: args.reason ?? null,
        substations_found: candidates.length,
        nearest: candidates[0] ?? null,
        highest_voltage_nearby: strongest,
        candidates,
        credits_spent: response.credits_charged ?? 0,
        citations: [
          {
            source: 'Mireye curated substation set (@substations)',
            source_url: 'https://www.eia.gov/electricity/data.php',
            confidence: 'high',
          },
        ],
      };
    }

    case 'get_labor_shed': {
      const lat = Number(args.lat);
      const lng = Number(args.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { error: 'get_labor_shed requires numeric lat and lng.', credits_spent: 0 };
      }
      const minutes = Math.max(5, Math.min(90, Math.trunc(Number(args.minutes) || 15)));
      const confirmed = args.confirm === true;

      let response;
      try {
        response = await proximityImpl({
          op: 'labor_shed',
          origin: `${lat},${lng}`,
          minutes,
          estimate: !confirmed,
          ...(confirmed ? { max_credits: LABOR_SHED_CEILING } : {}),
        });
      } catch (err) {
        return {
          error: 'labor_shed_failed',
          detail: err.body?.detail?.message ?? err.message,
          credits_spent: 0,
        };
      }

      // Unconfirmed calls come back as a free, exact quote rather than an
      // answer — the same quote-before-you-spend discipline the sweep uses.
      if (!confirmed) {
        return {
          quote_only: true,
          reason: args.reason ?? null,
          minutes,
          would_cost_credits: response.would_cost_credits ?? null,
          tracts_to_query: response.annulus_tracts ?? null,
          note: 'This is a free exact quote, not a result. Call again with confirm true to actually run it.',
          credits_spent: 0,
        };
      }

      return {
        live: true,
        reason: args.reason ?? null,
        minutes,
        population_within_shed: response.population ?? null,
        civilian_labor_force_within_shed: response.civilian_labor_force ?? null,
        tracts_counted: response.tracts_counted ?? null,
        tracts_unreachable: response.tracts_unreachable ?? null,
        credits_spent: response.credits_charged ?? 0,
        citations: [
          {
            source: 'US Census ACS tract labor force via Mireye proximity',
            source_url: 'https://www.census.gov/programs-surveys/acs',
            confidence: 'high',
          },
        ],
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
