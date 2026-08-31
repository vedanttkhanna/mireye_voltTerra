import app from '../server/app.js';

// Vercel rewrites every /api/* request to this single function. Rebuild the
// public URL before handing it to Express so the existing route tree works in
// production exactly as it does under the local Node server.
export default function handler(req, res) {
  const rewrittenPath = req.query?.__vercel_path;
  if (typeof rewrittenPath === 'string') {
    const url = new URL(req.url, 'http://localhost');
    url.searchParams.delete('__vercel_path');
    const query = url.searchParams.toString();
    req.url = `/api/${rewrittenPath}${query ? `?${query}` : ''}`;
  }

  return app(req, res);
}
