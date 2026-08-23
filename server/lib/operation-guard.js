import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const activeOperations = new Set();
const requestWindows = new Map();

function secretsEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Protect server-side credit spending and cache mutations without user accounts. */
export function requireOperationKey(req, res, next) {
  if (!config.operationApiKey) {
    return res.status(503).json({
      error: 'operation_key_not_configured',
      detail: 'Set OPERATION_API_KEY on the server before using protected operations.',
    });
  }
  const supplied = req.get('x-operation-key');
  if (!supplied || !secretsEqual(supplied, config.operationApiKey)) {
    return res.status(401).json({ error: 'unauthorized', detail: 'A valid X-Operation-Key header is required.' });
  }
  next();
}

export function conflictWhileRunning(operation, handler) {
  return async (req, res, next) => {
    if (activeOperations.has(operation)) return res.status(409).json({ error: 'operation_in_progress' });
    activeOperations.add(operation);
    try {
      await handler(req, res, next);
    } finally {
      activeOperations.delete(operation);
    }
  };
}

export function rateLimit({ name, max, windowMs }) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const recent = (requestWindows.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length >= max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000))));
      return res.status(429).json({ error: 'rate_limited' });
    }
    recent.push(now);
    requestWindows.set(key, recent);
    next();
  };
}
