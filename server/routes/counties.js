import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { config } from '../config.js';
import { conflictWhileRunning, rateLimit } from '../lib/operation-guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');

export const countiesRouter = Router();

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
    res.status(500).json({ error: 'cache_read_failed' });
  }
});

// GET /api/counties/boundaries — GeoJSON county polygons (Census
// cartographic boundary file, server/services/county-boundaries.js) merged
// with each county's current bucket/ratio, for the map's choropleth layer.
// A static file lookup with one merge pass, not a live pipeline output.
countiesRouter.get('/boundaries', async (_req, res) => {
  try {
    const raw = await readFile(path.join(__dirname, `../data/county-boundaries-${config.pilotState}.json`), 'utf8');
    const boundaries = JSON.parse(raw);
    const scored = await loadScoredCounties();
    const scoredByFips = new Map((scored?.counties ?? []).map((c) => [c.county_fips, c]));

    res.json({
      ...boundaries,
      features: boundaries.features.map((f) => {
        const s = scoredByFips.get(f.properties.county_fips);
        return {
          ...f,
          properties: {
            ...f.properties,
            driver_to_plug_ratio: s?.driver_to_plug_ratio ?? null,
            underserved: s?.underserved ?? null,
            bucket: s?.bucket ?? null,
          },
        };
      }),
    });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'not_found', detail: 'No county boundaries ingested yet — npm run ingest:boundaries' });
    console.error('[counties/boundaries]', err);
    res.status(500).json({ error: 'cache_read_failed' });
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
    res.status(500).json({ error: 'cache_read_failed' });
  }
});

// GET /api/counties/:fips — county drill-down: join pipeline data (per-
// sample-point cited grid fields) merged with the Days 8-9 score/bucket
// for that county when available. Matches the spec's drill-down spec:
// "the exact registrations-per-charger ratio, the grid_interconnect fields
// that decide its bucket, and the per-field citation."
countiesRouter.get('/:fips', async (req, res) => {
  try {
    const data = await loadJoinPipelineOutput();
    const county = data.counties.find((c) => c.county_fips === req.params.fips);
    if (!county) return res.status(404).json({ error: 'not_found', detail: `No county with FIPS ${req.params.fips}` });

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
    res.status(500).json({ error: 'cache_read_failed' });
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
    res.status(500).json({ error: 'cache_read_failed' });
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
    res.status(500).json({ error: 'memo_generation_failed' });
  }
}));
