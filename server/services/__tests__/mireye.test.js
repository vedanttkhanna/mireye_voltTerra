import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MireyeClient, MireyeApiError, parseRetryAfter } from '../mireye.js';

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

test('sends Bearer auth header and JSON body on fetch()', async () => {
  let capturedRequest;
  const fetchImpl = async (url, init) => {
    capturedRequest = { url: String(url), init };
    return jsonResponse({ ok: true });
  };
  const client = new MireyeClient({ apiKey: 'test-key', baseUrl: 'https://api.example.com', fetchImpl });

  await client.fetch({ lat: 34.05, lng: -118.25, preset: 'grid_interconnect' });

  assert.equal(capturedRequest.url, 'https://api.example.com/v1/fetch');
  assert.equal(capturedRequest.init.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(JSON.parse(capturedRequest.init.body), {
    lat: 34.05,
    lng: -118.25,
    preset: 'grid_interconnect',
  });
});

test('getFieldCatalog omits auth header (free endpoint)', async () => {
  let capturedHeaders;
  const fetchImpl = async (_url, init) => {
    capturedHeaders = init.headers;
    return jsonResponse({ fields: [] });
  };
  const client = new MireyeClient({ apiKey: 'test-key', baseUrl: 'https://api.example.com', fetchImpl });

  await client.getFieldCatalog();
  assert.equal(capturedHeaders.Authorization, undefined);
});

test('fetchBatch rejects more than 25 locations without calling the network', async () => {
  const fetchImpl = async () => {
    throw new Error('should not be called');
  };
  const client = new MireyeClient({ apiKey: 'k', baseUrl: 'https://api.example.com', fetchImpl });
  const locations = Array.from({ length: 26 }, (_, i) => ({ lat: i, lng: i }));

  await assert.rejects(() => client.fetchBatch({ locations, preset: 'utilities' }), /at most 25/);
});

test('fetchBatchChunked splits >25 locations into multiple <=25 calls', async () => {
  const callSizes = [];
  const idempotencyKeys = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    callSizes.push(body.locations.length);
    idempotencyKeys.push(init.headers['Idempotency-Key']);
    return jsonResponse({ results: body.locations.map(() => ({ ok: true })) });
  };
  const client = new MireyeClient({ apiKey: 'k', baseUrl: 'https://api.example.com', fetchImpl });
  const locations = Array.from({ length: 60 }, (_, i) => ({ lat: i, lng: i }));

  const results = await client.fetchBatchChunked({ locations, preset: 'grid_interconnect' });

  assert.deepEqual(callSizes, [25, 25, 10]);
  assert.equal(results.length, 60);
  assert.equal(new Set(idempotencyKeys).size, 3);
  assert.ok(idempotencyKeys.every(Boolean));
});

test('parseRetryAfter supports seconds and HTTP dates', () => {
  const now = Date.parse('2026-08-22T12:00:00Z');
  assert.equal(parseRetryAfter('3', now), 3000);
  assert.equal(parseRetryAfter('Sat, 22 Aug 2026 12:00:05 GMT', now), 5000);
});

test('retries on 429 respecting Retry-After, then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'Retry-After': '0' },
      });
    }
    return jsonResponse({ credits_total: 10 });
  };
  const client = new MireyeClient({ apiKey: 'k', baseUrl: 'https://api.example.com', fetchImpl, maxRetries: 2 });

  const result = await client.fetchQuote({ preset: 'grid_interconnect', locations: 1 });
  assert.equal(calls, 2);
  assert.equal(result.credits_total, 10);
});

test('throws MireyeApiError with status+body on a non-retryable error', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ code: 'resolve_invalid_input' }), { status: 422 });
  const client = new MireyeClient({ apiKey: 'k', baseUrl: 'https://api.example.com', fetchImpl });

  await assert.rejects(
    () => client.lookup('not-a-real-input'),
    (err) => {
      assert.ok(err instanceof MireyeApiError);
      assert.equal(err.status, 422);
      assert.equal(err.code, 'resolve_invalid_input');
      return true;
    }
  );
});

test('exhausts retries on persistent 502 and throws', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('bad gateway', { status: 502 });
  };
  const client = new MireyeClient({ apiKey: 'k', baseUrl: 'https://api.example.com', fetchImpl, maxRetries: 2 });

  await assert.rejects(() => client.ask({ lat: 1, lng: 1, question: 'q?' }));
  assert.equal(calls, 3); // initial + 2 retries
});
