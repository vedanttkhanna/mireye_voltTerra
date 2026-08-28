import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { config } from '../config.js';
import { conflictWhileRunning, rateLimit } from '../lib/operation-guard.js';
import { findLiveCountyByFips, findLiveSweepByState } from './live.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');

export const countiesRouter = Router();

function coordinateKey([lng, lat]) {
  // County files share coordinates at their borders. Rounding prevents tiny
  // floating point representation differences from creating false seams.
  return `${Number(lng).toFixed(7)},${Number(lat).toFixed(7)}`;
}

function addPolygonRings(geometry, rings) {
  if (!geometry) return;
  if (geometry.type === 'Polygon') {
    rings.push(...geometry.coordinates);
    return;
  }
  if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) rings.push(...polygon);
    return;
  }
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries) addPolygonRings(child, rings);
  }
}

/**
 * Returns only the exterior edges of a state, not its internal county seams.
 * An edge shared by two counties appears twice and is removed; an exterior
 * edge appears once and becomes part of the yellow map outline.
 */
function createStateOutline(boundaries) {
  const edges = new Map();
  const rings = [];
  for (const feature of boundaries.features ?? []) addPolygonRings(feature.geometry, rings);

  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i += 1) {
      const start = ring[i];
      const end = ring[i + 1];
      const startKey = coordinateKey(start);
      const endKey = coordinateKey(end);
      if (startKey === endKey) continue;
      const key = startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
      const existing = edges.get(key);
      if (existing) existing.count += 1;
      else edges.set(key, { count: 1, coordinates: [start, end] });
    }
  }

  return {
    type: 'FeatureCollection',
    features: [...edges.values()]
      .filter((edge) => edge.count === 1)
      .map((edge) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: edge.coordinates },
      })),
  };
}

async function loadJoinPipelineOutput() {
  const raw = await readFile(path.join(CACHE_DIR, `join-pipeline-${config.pilotState}.json`), 'utf8');
  return JSON.parse(raw);
}

/** Returns the Days 8-9 scored/bucketed output, or null if scoring hasn't run yet. */
async function loadScoredCounties() {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `scored-counties-${config.pilotState}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return null;
  }
}

/** Returns the Days 10-11 memos output, or null if none have been generated yet. */
async function loadMemos() {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `memos-${config.pilotState}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return null;
  }
}

/** Returns the Day 12 NEVI backtest output, or null if it hasn't run yet. */
async function loadBacktest() {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `backtest-${config.pilotState}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return null;
  }
}

// GET /api/counties — raw per-county join pipeline output (Days 5-7):
// registrations and charger counts. Enriched with the Days 8-9 ratio/
// underserved/bucket verdict when scoring has run, so this doubles as the
// spec's "ranked county view" data source once sorted by ratio client-side.
countiesRouter.get('/', async (_req, res) => {
  try {
    const data = await loadJoinPipelineOutput();
    const scored = await loadScoredCounties();
    const scoredByFips = new Map((scored?.counties ?? []).map((c) => [c.county_fips, c]));

    res.json({
      state: data.state,
      generated_at: data.generated_at,
      scored_at: scored?.scored_at ?? null,
      counties: data.counties.map(({ county_fips, county_name, registrations, chargers }) => {
        const s = scoredByFips.get(county_fips);
        return {
          county_fips,
          county_name,
          registrations,
          chargers,
          driver_to_plug_ratio: s?.driver_to_plug_ratio ?? null,
          underserved: s?.underserved ?? null,
          bucket: s?.bucket ?? null,
        };
      }),
    });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'not_found', detail: 'No join pipeline run yet — POST /api/pipeline/run' });
    console.error('[counties]', err);
    res.status(503).json({ error: 'cache_unavailable' });
  }
});

// GET /api/counties/boundaries — GeoJSON county polygons (Census
// cartographic boundary file, server/services/county-boundaries.js) merged
// with each county's current bucket/ratio, for the map's choropleth layer.
countiesRouter.get('/boundaries/:state?', async (req, res) => {
  try {
    const state = String(req.params.state || req.query.state || config.pilotState).toUpperCase();
    const raw = await readFile(path.join(__dirname, `../data/county-boundaries-${state}.json`), 'utf8');
    const boundaries = JSON.parse(raw);

    // Map colouring is tied only to the current in-memory live run, including
    // California. Never blend it with the legacy scored-counties cache.
    const liveResult = findLiveSweepByState(state);
    const scoredByFips = new Map((liveResult?.counties ?? []).map((c) => [c.county_fips, c]));

    res.json({
      ...boundaries,
      features: boundaries.features.map((f) => {
        const s = scoredByFips.get(f.properties.county_fips);
        return {
          ...f,
          properties: {
            ...f.properties,
            driver_to_plug_ratio: s?.driver_to_plug_ratio ?? s?.people_per_port ?? null,
            underserved: s?.underserved ?? null,
            bucket: s?.bucket ?? null,
          },
        };
      }),
    });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'not_found', detail: `No county boundaries found for state ${req.params.state || req.query.state || config.pilotState}` });
    console.error('[counties/boundaries]', err);
    res.status(503).json({ error: 'cache_unavailable' });
  }
});

// GET /api/counties/state-outline/:state — a single state perimeter for the
// live-sweep map. Internal county borders are intentionally omitted so a
// grid-upgrade bucket never looks like a red route or zone on the basemap.
countiesRouter.get('/state-outline/:state', async (req, res) => {
  try {
    const state = String(req.params.state).toUpperCase();
    const raw = await readFile(path.join(__dirname, `../data/county-boundaries-${state}.json`), 'utf8');
    res.json({ state, ...createStateOutline(JSON.parse(raw)) });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'not_found', detail: `No county boundaries found for state ${req.params.state}` });
    console.error('[counties/state-outline]', err);
    res.status(503).json({ error: 'cache_unavailable' });
  }
});

// GET /api/counties/stats — the Days 8-9 scored, ranked, bucketed output:
// state median ratio, underserved threshold, and every county's bucket.
// The spec's "ranked county view" (Days 10-11) is this data, sorted and
// rendered — no scoring logic runs client-side.
countiesRouter.get('/stats', async (_req, res) => {
  try {
    const scored = await loadScoredCounties();
    if (!scored) return res.status(404).json({ error: 'not_found', detail: 'No scoring run yet — npm run pipeline:score' });
    res.json(scored);
  } catch (err) {
    console.error('[counties/stats]', err);
    res.status(503).json({ error: 'cache_unavailable' });
  }
});

// GET /api/counties/:fips — county drill-down: join pipeline data (per-
// sample-point cited grid fields) merged with the Days 8-9 score/bucket
// for that county when available. Matches the spec's drill-down spec:
// "the exact registrations-per-charger ratio, the grid_interconnect fields
// that decide its bucket, and the per-field citation."
countiesRouter.get('/:fips', async (req, res) => {
  try {
    let county = null;
    try {
      const data = await loadJoinPipelineOutput();
      county = data.counties.find((c) => c.county_fips === req.params.fips);
    } catch {
      // ignore cache missing
    }

    if (!county) {
      const liveCounty = findLiveCountyByFips(req.params.fips);
      if (liveCounty) {
        return res.json(liveCounty);
      }
      return res.status(404).json({ error: 'not_found', detail: `No county with FIPS ${req.params.fips}` });
    }

    const scored = await loadScoredCounties();
    const scoredCounty = scored?.counties.find((c) => c.county_fips === req.params.fips) ?? null;

    const backtest = await loadBacktest();
    const backtestCounty = backtest?.counties.find((c) => c.county_fips === req.params.fips) ?? null;

    res.json({
      ...county,
      driver_to_plug_ratio: scoredCounty?.driver_to_plug_ratio ?? null,
      underserved: scoredCounty?.underserved ?? null,
      bucket: scoredCounty?.bucket ?? null,
      grid_feasibility: scoredCounty?.grid_feasibility ?? null,
      nevi_stations_awarded: backtestCounty?.nevi_stations_awarded ?? null,
      nevi_awardee_count: backtestCounty?.nevi_awardee_count ?? null,
    });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'not_found', detail: 'No join pipeline run yet — POST /api/pipeline/run' });
    console.error('[counties/:fips]', err);
    res.status(503).json({ error: 'cache_unavailable' });
  }
});

// GET /api/counties/:fips/memo — the cached /v1/ask justification memo for
// a flagged county, if one has been generated.
countiesRouter.get('/:fips/memo', async (req, res) => {
  try {
    const memos = await loadMemos();
    const memo = memos?.memos.find((m) => m.county_fips === req.params.fips);
    if (!memo) return res.status(404).json({ error: 'not_found', detail: 'No memo generated yet for this county — POST this URL to generate one' });
    res.json(memo);
  } catch (err) {
    console.error('[counties/:fips/memo read]', err);
    res.status(503).json({ error: 'cache_unavailable' });
  }
});

// POST /api/counties/:fips/memo — generate (or regenerate) the memo for
// exactly one county, ~10 Mireye credits. Deliberately per-county rather
// than automatic for every flagged county, so a dashboard click spends
// credits on purpose, not as a side effect of some other action.
countiesRouter.post('/:fips/memo', rateLimit({ name: 'memo', max: 6, windowMs: 60 * 60_000 }), conflictWhileRunning('memo', async (req, res) => {
  try {
    const { generateMemoForCounty } = await import('../services/memo-generator.js');
    const memo = await generateMemoForCounty(req.params.fips, { state: config.pilotState });
    res.json(memo);
  } catch (err) {
    console.error('[counties/:fips/memo]', err);
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'not_found', detail: 'Scoring data has not been generated.' });
    if (err.message?.startsWith('No county with FIPS')) return res.status(404).json({ error: 'not_found' });
    res.status(500).json({ error: 'memo_generation_failed' });
  }
}));
