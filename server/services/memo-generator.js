// Days 10-11: turns a scored, bucketed county (Days 8-9) into a plain-
// English, cited justification memo via Mireye's /v1/ask — "ready to
// attach to a BEAD or NEVI funding request," per the spec.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { mireye } from './mireye.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');
const METERS_PER_MILE = 1609.34;

/**
 * Builds the /v1/ask question for one flagged county, grounded in the
 * exact numbers our own scoring (scoring.js) produced — not a generic
 * "tell me about this county" prompt. Mireye answers independently from
 * its own fetched fields (it doesn't see our bucket verdict), so the
 * answer is a genuine cross-check on our gate logic, not just narration
 * of a number we already had.
 */
export function buildMemoQuestion(scoredCounty) {
  const { county_name, driver_to_plug_ratio, grid_feasibility } = scoredCounty;
  const inputs = grid_feasibility?.inputs ?? {};

  const substationDesc =
    inputs.substation_distance_m != null
      ? `${(inputs.substation_distance_m / METERS_PER_MILE).toFixed(1)} mi away at ` +
        `${inputs.substation_voltage_kv != null ? `${inputs.substation_voltage_kv}kV` : 'an unpublished voltage'}, ` +
        `status ${inputs.substation_status ?? 'not published'}`
      : 'no substation found within the search radius of the county centroid';

  return (
    `${county_name} shows ${driver_to_plug_ratio.toFixed(1)} registered EVs per public charging port ` +
    `(Level 2 + DC fast). The nearest electric substation to the county's population center is ${substationDesc}. ` +
    `Based on this, is the local electrical grid infrastructure adequate to support a new DC fast charging ` +
    `deployment here without a utility upgrade first, or does this location need grid capacity work before a ` +
    `charger can be sited? Give a clear recommendation and cite your sources.`
  );
}

/**
 * Calls /v1/ask at the county's centroid (the same point scoring.js used
 * to decide the bucket, so the memo and the bucket are talking about the
 * same location) and returns a memo record. Requires the county to have
 * gone through scoring — `bucketCounty` runs on flagged counties only, and
 * a memo only makes sense for a funding decision that was actually made.
 */
export async function generateCountyMemo(scoredCounty, { askImpl = mireye.ask.bind(mireye) } = {}) {
  if (!scoredCounty.underserved || !scoredCounty.grid_feasibility) {
    throw new Error(
      `generateCountyMemo: ${scoredCounty.county_name} has no grid feasibility result to build a memo from ` +
        `(not flagged underserved, or scoring found no sample points)`
    );
  }

  const { lat, lng } = scoredCounty.grid_feasibility.sampled_at;
  const question = buildMemoQuestion(scoredCounty);
  const response = await askImpl({ lat, lng, question, includeTrace: false });

  return {
    county_fips: scoredCounty.county_fips,
    county_name: scoredCounty.county_name,
    bucket: scoredCounty.bucket,
    driver_to_plug_ratio: scoredCounty.driver_to_plug_ratio,
    question,
    answer: response.answer,
    confidence: response.confidence,
    citations: response.citations,
    data_gaps: response.data_gaps,
    answered_at: response.answered_at,
  };
}

async function loadScoredCounties(state) {
  const raw = await readFile(path.join(CACHE_DIR, `scored-counties-${state}.json`), 'utf8');
  return JSON.parse(raw);
}

async function loadExistingMemos(state) {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `memos-${state}.json`), 'utf8');
    return JSON.parse(raw).memos ?? [];
  } catch {
    return [];
  }
}

async function persistMemos(state, memos) {
  const output = {
    state,
    generated_at: new Date().toISOString(),
    memo_count: memos.length,
    memos,
  };
  await mkdir(CACHE_DIR, { recursive: true });
  const outPath = path.join(CACHE_DIR, `memos-${state}.json`);
  await writeFile(outPath, JSON.stringify(output, null, 2));
  return { outPath, ...output };
}

/**
 * Generates (or regenerates) the memo for exactly one flagged county and
 * merges it into the persisted memos-<state>.json cache, leaving every
 * other county's memo untouched. This is the operation the dashboard's
 * per-county "Generate memo" button calls — a memo is a deliberate,
 * ~10-credit action per county, not something to fan out automatically
 * across every flagged county on every request.
 */
export async function generateMemoForCounty(fips, { state = config.pilotState } = {}) {
  const scored = await loadScoredCounties(state);
  const county = scored.counties.find((c) => c.county_fips === fips);
  if (!county) throw new Error(`No county with FIPS ${fips} in scored-counties-${state}.json`);

  const memo = await generateCountyMemo(county);
  const existing = await loadExistingMemos(state);
  const merged = [...existing.filter((m) => m.county_fips !== fips), memo].sort((a, b) =>
    a.county_fips.localeCompare(b.county_fips)
  );

  await persistMemos(state, merged);
  return memo;
}

/** Generates memos for every currently-flagged county that doesn't already have one. */
export async function generateAllMemos({ state = config.pilotState, regenerate = false } = {}) {
  const scored = await loadScoredCounties(state);
  const flagged = scored.counties.filter((c) => c.underserved && c.grid_feasibility);
  const existing = await loadExistingMemos(state);
  const existingFips = new Set(existing.map((m) => m.county_fips));

  const toGenerate = regenerate ? flagged : flagged.filter((c) => !existingFips.has(c.county_fips));

  const newMemos = [];
  for (const county of toGenerate) {
    newMemos.push(await generateCountyMemo(county));
  }

  const merged = [...existing.filter((m) => regenerate || !toGenerate.some((c) => c.county_fips === m.county_fips)), ...newMemos].sort(
    (a, b) => a.county_fips.localeCompare(b.county_fips)
  );

  return persistMemos(state, merged);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await generateAllMemos();
  console.log(`Wrote ${r.outPath}: ${r.memo_count} memos on file.`);
  for (const m of r.memos) {
    console.log(`  - ${m.county_name} (${m.bucket}): ${m.answer.slice(0, 100)}...`);
  }
}
