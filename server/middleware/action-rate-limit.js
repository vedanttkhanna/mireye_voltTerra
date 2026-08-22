import { config } from '../config.js';

const attemptsByIp = new Map();

/** Small in-memory limiter for metered or mutating actions. */
export function actionRateLimit(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const now = Date.now();
  const windowMs = 60_000;
  const key = req.ip;
  const recent = (attemptsByIp.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= config.actionRateLimitPerMinute) {
    res.set('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limited', detail: 'Too many actions; try again shortly.' });
  }
  recent.push(now);
  attemptsByIp.set(key, recent);
  next();
}
