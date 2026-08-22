import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { mireye } from './mireye.js';
import { listCountiesForState } from '../lib/zip-county.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');
const METERS_PER_MILE = 1609.34;

async function loadScoredCounties(state = config.pilotState) {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `scored-counties-${state}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadJoinPipeline(state = config.pilotState) {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `join-pipeline-${state}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Searches for a county name mention in user text.
 */
export function findCountyFromText(text, countiesList = []) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.toLowerCase();
  
  for (const c of countiesList) {
    const name = c.county_name.toLowerCase();
    const bare = name.replace(/\s+county$/, '');
    if (clean.includes(name) || (bare.length > 3 && new RegExp(`\\b${bare}\\b`, 'i').test(clean))) {
      return c;
    }
  }
  return null;
}

/**
 * Builds a Mireye-compatible physical infrastructure question.
 * Mireye covers: terrain, utilities (power/pipelines/rail), built environment,
 * land cover, parcels & boundaries. It does NOT answer EV policy questions.
 * We send strictly geospatial/physical questions and synthesise the EV demand
 * context ourselves before returning the combined answer to the user.
 */
export function buildGroundedChatQuestion({ county, userMessage }) {
  const inputs = county?.grid_feasibility?.inputs ?? {};

  const substationHint = inputs.substation_distance_m != null
    ? `The nearest known substation is approximately ${(inputs.substation_distance_m / METERS_PER_MILE).toFixed(1)} miles away ` +
      `at ${inputs.substation_voltage_kv != null ? `${inputs.substation_voltage_kv}kV` : 'unknown voltage'}.`
    : '';

  return (
    `At this coordinate${county ? ` in ${county.county_name}, California` : ' in California'}, ` +
    `what electrical power infrastructure is present? ` +
    `${substationHint} ` +
    `What is the nearest electrical substation, its voltage rating, and operational status according to EIA or OpenStreetMap data? ` +
    `Are there overhead or underground transmission lines, utility corridors, or power rights-of-way within 5 miles? ` +
    `What is the terrain slope and land cover type at this location? ` +
    `Are there utility easements or federal/state rights-of-way that would affect placement of electrical infrastructure here?`
  );
}

/**
 * Executes an agentic inquiry about EV charging & grid feasibility.
 */
export async function queryChatAgent({
  message,
  countyFips,
  coordinates,
  state = config.pilotState,
  askImpl = mireye.ask.bind(mireye),
} = {}) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new Error('Message is required');
  }

  const [scoredData, joinData] = await Promise.all([
    loadScoredCounties(state),
    loadJoinPipeline(state),
  ]);

  const counties = scoredData?.counties ?? listCountiesForState(state);
  
  let targetCounty = null;
  if (countyFips) {
    targetCounty = counties.find((c) => c.county_fips === countyFips);
  }

  if (!targetCounty) {
    targetCounty = findCountyFromText(message, counties);
  }

  // Determine coordinate for Mireye /v1/ask
  let targetLat = coordinates?.lat;
  let targetLng = coordinates?.lng;

  if (!targetLat || !targetLng) {
    if (targetCounty?.grid_feasibility?.sampled_at) {
      targetLat = targetCounty.grid_feasibility.sampled_at.lat;
      targetLng = targetCounty.grid_feasibility.sampled_at.lng;
    } else if (targetCounty?.county_fips) {
      const joinCounty = joinData?.counties?.find((c) => c.county_fips === targetCounty.county_fips);
      const point = joinCounty?.sample_points?.[0];
      if (point) {
        targetLat = point.lat;
        targetLng = point.lng;
      }
    }
  }

  // Default coordinate if no specific county/point selected (California center)
  if (!targetLat || !targetLng) {
    targetLat = 37.2;
    targetLng = -119.4;
  }

  const groundedQuestion = buildGroundedChatQuestion({
    county: targetCounty,
    userMessage: message.trim(),
  });

  const response = await askImpl({
    lat: targetLat,
    lng: targetLng,
    question: groundedQuestion,
    includeTrace: false,
  });

  // Suggest contextual follow-up questions
  const followups = [];
  if (targetCounty) {
    followups.push(`What is the nearest substation distance and voltage in ${targetCounty.county_name}?`);
    followups.push(`Are there active CAISO interconnection projects in ${targetCounty.county_name}?`);
    followups.push(`Compare ${targetCounty.county_name} charging ratio with the state median.`);
  } else {
    followups.push('Which California counties have the highest EV-to-charger deficit?');
    followups.push('What grid feasibility criteria determine if a charger can be built immediately?');
  }

  return {
    query: message.trim(),
    answered_at: response.answered_at ?? new Date().toISOString(),
    county: targetCounty
      ? {
          county_fips: targetCounty.county_fips,
          county_name: targetCounty.county_name,
          bucket: targetCounty.bucket,
          driver_to_plug_ratio: targetCounty.driver_to_plug_ratio,
        }
      : null,
    coordinates: { lat: targetLat, lng: targetLng },
    answer: response.answer,
    confidence: response.confidence ?? 'moderate',
    citations: response.citations ?? [],
    data_gaps: response.data_gaps ?? [],
    suggested_followups: followups,
  };
}
