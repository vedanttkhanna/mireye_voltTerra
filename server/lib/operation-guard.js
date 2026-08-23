const activeOperations = new Set();
const requestWindows = new Map();

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
