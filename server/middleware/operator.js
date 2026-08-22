import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const attemptsByIp = new Map();

function keysMatch(actual, expected) {
  const actualBuffer = Buffer.from(actual ?? '');
  const expectedBuffer = Buffer.from(expected ?? '');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

/** Protects every non-read-only API request with a separate operator secret. */
export function requireOperatorForUnsafeMethods(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!config.operatorKey) {
    return res.status(503).json({
      error: 'operator_access_disabled',
      detail: 'Set VOLTERRA_OPERATOR_KEY to enable metered or mutating actions.',
    });
  }
  if (!keysMatch(req.get('x-volt-terra-key'), config.operatorKey)) {
    return res.status(401).json({ error: 'unauthorized', detail: 'A valid VOLT-TERRA operator key is required.' });
  }
  next();
}

/** Small in-memory limiter; deployment-level limiting should supplement this. */
export function operatorRateLimit(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const now = Date.now();
  const windowMs = 60_000;
  const key = req.ip;
  const recent = (attemptsByIp.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= config.operatorRateLimitPerMinute) {
    res.set('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limited', detail: 'Too many operator actions; try again shortly.' });
  }
  recent.push(now);
  attemptsByIp.set(key, recent);
  next();
}
