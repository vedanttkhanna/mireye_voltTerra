import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');

export const pipelineRouter = Router();

let lastRunStatus = null;
let lastScoreStatus = null;

// POST /api/pipeline/run — full sweep: data ingest, county sampling,
// canonical join (/v1/lookup), cost check (/v1/fetch/quote), grid data
// fetch (/v1/fetch/batch), then scoring (Days 8-9) on top of that output.
// Memo generation (Days 10-11) still needs to run separately, per county.
pipelineRouter.post('/run', async (_req, res) => {
  try {
    const { runFullSweep } = await import('../services/orchestrator.js');
    const result = await runFullSweep({ state: config.pilotState });
    lastRunStatus = {
      ok: true,
      at: result.generated_at,
      counties_processed: result.counties_processed,
      sample_points_total: result.sample_points_total,
      credits_spent: result.credits_spent,
      lookup_mismatches: result.lookup_mismatches.length,
    };

    const { runScoring } = await import('../services/scoring.js');
    const scoreResult = await runScoring({ state: config.pilotState });
    lastScoreStatus = {
      ok: true,
      at: scoreResult.scored_at,
      counties_underserved: scoreResult.counties_underserved,
      counties_fund_charger_now: scoreResult.counties_fund_charger_now,
      counties_fund_grid_upgrade_first: scoreResult.counties_fund_grid_upgrade_first,
    };

    res.json({ sweep: lastRunStatus, scoring: lastScoreStatus });
  } catch (err) {
    lastRunStatus = { ok: false, message: err.message, at: new Date().toISOString() };
    res.status(500).json({ error: 'sweep_failed', detail: err.message });
  }
});

pipelineRouter.post('/run/:fips', (_req, res) => {
  res
    .status(501)
    .json({ error: 'not_implemented', detail: 'Single-county re-run is a Days 10-11 dashboard feature' });
});

// POST /api/pipeline/score — re-run scoring alone against the existing
// join-pipeline cache, without spending any Mireye credits. Useful for
// iterating on scoring.js's thresholds without re-fetching grid data.
pipelineRouter.post('/score', async (_req, res) => {
  try {
    const { runScoring } = await import('../services/scoring.js');
    const result = await runScoring({ state: config.pilotState });
    lastScoreStatus = {
      ok: true,
      at: result.scored_at,
      counties_underserved: result.counties_underserved,
      counties_fund_charger_now: result.counties_fund_charger_now,
      counties_fund_grid_upgrade_first: result.counties_fund_grid_upgrade_first,
    };
    res.json(lastScoreStatus);
  } catch (err) {
    lastScoreStatus = { ok: false, message: err.message, at: new Date().toISOString() };
    res.status(500).json({ error: 'scoring_failed', detail: err.message });
  }
});

pipelineRouter.get('/status', async (_req, res) => {
  let lastJoinPipelineRun = null;
  try {
    const raw = await readFile(path.join(CACHE_DIR, `join-pipeline-${config.pilotState}.json`), 'utf8');
    const data = JSON.parse(raw);
    lastJoinPipelineRun = {
      generated_at: data.generated_at,
      counties_processed: data.counties_processed,
      sample_points_total: data.sample_points_total,
      credits_spent: data.credits_spent,
      lookup_mismatches: data.lookup_mismatches.length,
    };
  } catch {
    // No sweep has run yet — leave null.
  }

  let lastScoredRun = null;
  try {
    const raw = await readFile(path.join(CACHE_DIR, `scored-counties-${config.pilotState}.json`), 'utf8');
    const data = JSON.parse(raw);
    lastScoredRun = {
      scored_at: data.scored_at,
      state_median_driver_to_plug_ratio: data.state_median_driver_to_plug_ratio,
      counties_underserved: data.counties_underserved,
      counties_fund_charger_now: data.counties_fund_charger_now,
      counties_fund_grid_upgrade_first: data.counties_fund_grid_upgrade_first,
    };
  } catch {
    // No scoring run yet — leave null.
  }

  res.json({
    pilot_state: config.pilotState,
    last_run: lastRunStatus,
    last_score_run: lastScoreStatus,
    last_join_pipeline_run: lastJoinPipelineRun,
    last_scored_counties_run: lastScoredRun,
    stages_implemented: ['data_ingest', 'county_sampling', 'canonical_join', 'grid_fetch', 'scoring', 'bucketing', 'memo_generation'],
    stages_pending: [],
  });
});

// GET /api/pipeline/backtest — Day 12: cross-check of the underserved-flag
// + bucket verdicts against real California NEVI award data. See
// server/services/nevi-backtest.js for the important caveat about what
// this comparison can and can't prove.
pipelineRouter.get('/backtest', async (_req, res) => {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `backtest-${config.pilotState}.json`), 'utf8');
    res.json(JSON.parse(raw));
  } catch {
    res.status(501).json({ error: 'not_implemented', detail: 'No backtest run yet — npm run backtest' });
  }
});
