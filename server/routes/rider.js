import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { fetchRiderContext, routeToStations, fetchRiderPhysical, scoreRiderFeasibility } from '../services/rider.js';
import { findContainingFeature } from '../lib/geo.js';
import { rateLimit } from '../lib/operation-guard.js';
import { STATE_FIPS } from '../services/live-sweep.js';
import { findLiveSweepByState } from './live.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

export const riderRouter = Router();

const US_BOUNDS = { minLat: 18, maxLat: 72, minLng: -180, maxLng: -65 };

async function loadJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * POST /api/rider/check-point — the rider-side counterpart to
 * /api/explore/check-point. Spends no Mireye credits: DOE AFDC answers the
 * station question directly, and county congestion comes from the pipeline
 * cache. Rate-limited generously since it costs nothing to run.
 */
riderRouter.post('/check-point', rateLimit({ name: 'rider-check', max: 60, windowMs: 60 * 60_000 }), async (req, res) => {
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const state = String(req.body?.state ?? '').toUpperCase();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'bad_request', detail: 'Body must include numeric lat and lng' });
  }
  if (lat < US_BOUNDS.minLat || lat > US_BOUNDS.maxLat || lng < US_BOUNDS.minLng || lng > US_BOUNDS.maxLng) {
    return res.status(400).json({ error: 'out_of_range', detail: 'Point falls outside US coverage' });
  }
  if (!STATE_FIPS[state]) {
    return res.status(400).json({ error: 'bad_state', detail: 'Select a valid state before checking a point' });
  }
  const liveSweep = findLiveSweepByState(state);
  if (!liveSweep) {
    return res.status(409).json({ error: 'sweep_required', detail: `Run a live sweep for ${state} before checking a point` });
  }

  try {
    const boundaries = await loadJson(path.join(DATA_DIR, `county-boundaries-${state}.json`));
    const feature = boundaries ? findContainingFeature({ lat, lng }, boundaries) : null;
    if (!feature) {
      return res.status(400).json({ error: 'outside_swept_state', detail: `Choose a point inside the live-swept ${state} boundary` });
    }

    const { stations, nearestDcfcMiles } = await fetchRiderContext({ lat, lng });

    // Mireye does the routing and the physical read; AFDC only supplied the
    // station coordinates, because Mireye has no charging-station layer.
    const [routing, physical] = await Promise.all([
      routeToStations({ lat, lng, stations }),
      fetchRiderPhysical({ lat, lng }),
    ]);

    const scoredCounty = feature
      ? liveSweep.counties?.find((c) => c.county_fips === feature.properties.county_fips) ?? null
      : null;

    const feasibility = scoreRiderFeasibility({
      stations: routing.routed,
      nearestDcfcMiles,
      countyRatio: scoredCounty?.driver_to_plug_ratio ?? null,
      stateMedianRatio: liveSweep.state_median_driver_to_plug_ratio ?? null,
    });

    res.json({
      lat,
      lng,
      state,
      checked_at: new Date().toISOString(),
      county: feature
        ? {
            county_fips: feature.properties.county_fips,
            county_name: feature.properties.county_name,
            driver_to_plug_ratio: scoredCounty?.driver_to_plug_ratio ?? null,
            underserved: scoredCounty?.underserved ?? null,
            bucket: scoredCounty?.bucket ?? null,
          }
        : null,
      feasibility,
      stations: routing.routed,
      physical,
      routing_available: routing.routing_available,
      credits_spent: (routing.credits_spent ?? 0) + (physical.credits_spent ?? 0),
      citations: [
        {
          source: 'DOE Alternative Fuels Data Center (station locations)',
          source_url: 'https://afdc.energy.gov/stations/',
          confidence: 'high',
        },
        {
          source: 'Mireye /v1/proximity (road routing) and /v1/fetch (physical context)',
          source_url: 'https://api.mireye.com/v1/docs',
          confidence: 'high',
        },
      ],
    });
  } catch (err) {
    console.error('[rider/check-point]', err);
    res.status(502).json({ error: 'rider_check_failed' });
  }
});
