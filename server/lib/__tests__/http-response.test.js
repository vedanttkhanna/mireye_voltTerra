import test from 'node:test';
import assert from 'node:assert/strict';
import { readJsonResponse } from '../../../src/utils/http.js';

test('readJsonResponse returns a successful JSON body', async () => {
  const response = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assert.deepEqual(await readJsonResponse(response, 'GET /api/health'), { ok: true });
});

test('readJsonResponse exposes status and text when a host returns non-JSON', async () => {
  const response = new Response('The page could not be found', { status: 404, statusText: 'Not Found' });

  await assert.rejects(
    () => readJsonResponse(response, 'GET /api/health'),
    /GET \/api\/health returned 404 Not Found as non-JSON: The page could not be found/
  );
});

test('readJsonResponse uses a JSON error detail when present', async () => {
  const response = new Response(JSON.stringify({ detail: 'Missing API key' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });

  await assert.rejects(() => readJsonResponse(response, 'GET /api/health'), /Missing API key/);
});
