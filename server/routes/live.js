import { Router } from 'express';
import { runLiveSweep, quoteSweep, STATE_FIPS } from '../services/live-sweep.js';
import { conflictWhileRunning, rateLimit } from '../lib/operation-guard.js';

export const liveRouter = Router();

// In-memory only, keyed by state. Deliberately NOT written to disk: a live
// sweep is meant to reflect the moment it ran, and persisting it would quietly
// recreate the cached behaviour this endpoint exists to replace. Lost on
// restart, which is correct.
const lastSweep = new Map();

liveRouter.get('/quote/:state', (req, res) => {
  const state = String(req.params.state).toUpperCase();
  if (!STATE_FIPS[state]) return res.status(400).json({ error: 'unknown_state' });
  res.json(quoteSweep(state));
});

liveRouter.get('/result/:state', (req, res) => {
  const state = String(req.params.state).toUpperCase();
  const result = lastSweep.get(state);
  if (!result) return res.status(404).json({ error: 'not_run', detail: `No live sweep has been run for ${state}` });
  res.json(result);
});

liveRouter.post(
  '/sweep/:state',
  rateLimit({ name: 'live-sweep', max: 20, windowMs: 60 * 60_000 }),
  conflictWhileRunning('live-sweep', async (req, res) => {
    const state = String(req.params.state).toUpperCase();
    if (!STATE_FIPS[state]) return res.status(400).json({ error: 'unknown_state' });
    try {
      const result = await runLiveSweep({ state });
      lastSweep.set(state, result);
      res.json(result);
    } catch (err) {
      console.error('[live/sweep]', err);
      res.status(502).json({ error: 'sweep_failed', detail: err.message });
    }
  })
);

export function findLiveSweepByState(state) {
  return lastSweep.get(String(state).toUpperCase()) || null;
}

export function findLiveCountyByFips(fips) {
  for (const sweep of lastSweep.values()) {
    const found = sweep.counties?.find((c) => c.county_fips === fips);
    if (found) return found;
  }
  return null;
}


