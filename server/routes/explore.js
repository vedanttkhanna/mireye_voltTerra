import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { config } from '../config.js';
import { mireye } from '../services/mireye.js';
import { GRID_FEASIBILITY_FIELDS } from '../services/orchestrator.js';
import { computeGridFeasibilityScore } from '../services/scoring.js';
import { findContainingFeature } from '../lib/geo.js';
import { conflictWhileRunning, rateLimit } from '../lib/operation-guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');

export const exploreRouter = Router();

// Contiguous US bounding box — Mireye's own coverage envelope
// (GET /v1/meta/fields reports `us_envelope`). A generous sanity check,
// not a CA-only restriction: this project's registration-ratio analysis is
// CA-only, but the underlying grid-physical screen (computeGridFeasibilityScore)
// is just Mireye field data and works anywhere Mireye does.
const US_BOUNDS = { minLat: 18, maxLat: 72, minLng: -180, maxLng: -65 };

async function loadScoredCounties() {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `scored-counties-${config.pilotState}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return null;
  }
}

async function loadCountyBoundaries() {
  try {
    const raw = await readFile(path.join(DATA_DIR, `county-boundaries-${config.pilotState}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return null;
  }
}

/**
 * POST /api/explore/check-point — ad-hoc grid-feasibility check at any
 * coordinate, reusing the exact same gate logic (computeGridFeasibilityScore)
 * and field list (GRID_FEASIBILITY_FIELDS) as the county-level pipeline, so
 * a point check and a county's own bucket are directly comparable, not a
 * separate parallel implementation.
 *
 * Deliberately NOT restricted to VOLT-TERRA's 6 flagged counties: per
 * product direction, this is offered as a general "verify a specific spot"
 * tool alongside the primary county-level recommendation view — but it
 * stays a citation-and-gate readout, not a ranked "here's where to build"
 * output. It answers "does this point clear the same physical screen a
 * flagged county did," not "is this the best site" — VOLT-TERRA doesn't
 * rank, sort, or recommend individual coordinates, which is the site-
 * selection product the build brief says is out of scope for this
 * challenge ("Not site selection... go somewhere else").
 *
 * Costs GRID_FEASIBILITY_FIELDS.length credits per call (~21, deterministic
 * at 1 credit/field since no metered field group is in the list) — no live
 * /v1/fetch/quote call first, unlike the full sweep: pricing here is fixed
 * and already known, and quoting a single ad-hoc point on every click would
 * only add latency, not new cost information.
 */
exploreRouter.post('/check-point', rateLimit({ name: 'point-check', max: 10, windowMs: 60 * 60_000 }), conflictWhileRunning('point-check', async (req, res) => {
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'bad_request', detail: 'Body must include numeric lat and lng' });
  }
  if (lat < US_BOUNDS.minLat || lat > US_BOUNDS.maxLat || lng < US_BOUNDS.minLng || lng > US_BOUNDS.maxLng) {
    return res.status(400).json({ error: 'out_of_range', detail: 'Point falls outside Mireye\'s US coverage envelope' });
  }

  try {
    const response = await mireye.fetch({ lat, lng, fields: GRID_FEASIBILITY_FIELDS });
    const feasibility = computeGridFeasibilityScore(response.fields);

    const boundaries = await loadCountyBoundaries();
    const containingFeature = boundaries ? findContainingFeature({ lat, lng }, boundaries) : null;

    let resolvedCounty = null;
    if (containingFeature) {
      const scored = await loadScoredCounties();
      const scoredCounty = scored?.counties.find((c) => c.county_fips === containingFeature.properties.county_fips);
      resolvedCounty = {
        county_fips: containingFeature.properties.county_fips,
        county_name: containingFeature.properties.county_name,
        driver_to_plug_ratio: scoredCounty?.driver_to_plug_ratio ?? null,
        underserved: scoredCounty?.underserved ?? null,
        bucket: scoredCounty?.bucket ?? null,
      };
    }

    res.json({
      lat,
      lng,
      checked_at: response.fetched_at,
      resolved_county: resolvedCounty,
      feasibility,
      fields: response.fields,
      credits_spent: GRID_FEASIBILITY_FIELDS.length,
    });
  } catch (err) {
    console.error('[explore/check-point]', err);
    res.status(502).json({ error: 'check_failed' });
  }
}));
