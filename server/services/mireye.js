import { config } from '../config.js';

const MAX_BATCH_LOCATIONS = 25;
const RATE_LIMIT_PER_MINUTE = 60;
const RETRYABLE_STATUS = new Set([429, 502, 504]);

export class MireyeApiError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = 'MireyeApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * Sliding-window limiter: Mireye caps the build plan at 60 requests/minute.
 * Batching (fetch/batch) is how you stay under it for a sweep, not by
 * raising this number.
 */
class RateLimiter {
  constructor(maxPerWindow = RATE_LIMIT_PER_MINUTE, windowMs = 60_000) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
    this.timestamps = [];
  }

  async acquire() {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
      if (this.timestamps.length < this.maxPerWindow) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldest) + 5;
      await sleep(waitMs);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MireyeClient {
  constructor({
    apiKey = config.mireyeApiKey,
    baseUrl = config.mireyeBaseUrl,
    maxRetries = 4,
    fetchImpl = fetch,
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.maxRetries = maxRetries;
    this.fetchImpl = fetchImpl;
    this.limiter = new RateLimiter();
  }

  async _request(method, path, { body, headers = {}, auth = true } = {}) {
    const url = `${this.baseUrl}${path}`;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.limiter.acquire();

      const res = await this.fetchImpl(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (res.ok) {
        if (res.status === 204) return null;
        return res.json();
      }

      const retryable = RETRYABLE_STATUS.has(res.status);
      if (!retryable || attempt === this.maxRetries) {
        let parsed;
        try {
          parsed = await res.json();
        } catch {
          parsed = await res.text().catch(() => null);
        }
        throw new MireyeApiError(
          `Mireye ${method} ${path} failed: ${res.status}`,
          { status: res.status, code: parsed?.code, body: parsed }
        );
      }

      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : 2 ** attempt * 500;
      await sleep(retryAfterMs);
    }

    throw new MireyeApiError(`Mireye ${method} ${path} failed after retries`);
  }

  /** GET /v1/meta/fields — free, no key needed. */
  getFieldCatalog({ lifecycle } = {}) {
    const qs = lifecycle ? `?lifecycle=${encodeURIComponent(lifecycle)}` : '';
    return this._request('GET', `/v1/meta/fields${qs}`, { auth: false });
  }

  /** GET /v1/meta/plans */
  getPlans() {
    return this._request('GET', '/v1/meta/plans', { auth: false });
  }

  /**
   * POST /v1/fetch/quote — price a fetch/batch before running it.
   * Authenticated but unmetered; call this before every real sweep.
   */
  fetchQuote({ fields, preset, locations = 1 } = {}) {
    return this._request('POST', '/v1/fetch/quote', {
      body: { fields, preset, locations },
    });
  }

  /** POST /v1/fetch — single location, by lat/lng or address. */
  fetch({ lat, lng, address, fields, preset } = {}) {
    return this._request('POST', '/v1/fetch', {
      body: { lat, lng, address, fields, preset },
    });
  }

  /**
   * POST /v1/fetch/batch — up to 25 locations per call, one field
   * selection for the whole batch. Throws if given more than 25; use
   * fetchBatchChunked for larger sweeps.
   */
  async fetchBatch({ locations, fields, preset } = {}, { idempotencyKey } = {}) {
    if (!Array.isArray(locations) || locations.length === 0) {
      throw new Error('fetchBatch requires a non-empty locations array');
    }
    if (locations.length > MAX_BATCH_LOCATIONS) {
      throw new Error(
        `fetchBatch accepts at most ${MAX_BATCH_LOCATIONS} locations per call (got ${locations.length}); use fetchBatchChunked`
      );
    }
    return this._request('POST', '/v1/fetch/batch', {
      body: { locations, fields, preset },
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    });
  }

  /**
   * Chunks an arbitrarily long location list into <=25-sized batch calls,
   * respecting the rate limiter between chunks. Returns results
   * index-aligned with the input.
   */
  async fetchBatchChunked({ locations, fields, preset } = {}) {
    const results = [];
    for (let i = 0; i < locations.length; i += MAX_BATCH_LOCATIONS) {
      const chunk = locations.slice(i, i + MAX_BATCH_LOCATIONS);
      const { results: chunkResults } = await this.fetchBatch({
        locations: chunk,
        fields,
        preset,
      });
      results.push(...chunkResults);
    }
    return results;
  }

  /** POST /v1/geocode — resolve a US street address to a coordinate. */
  geocode(address) {
    return this._request('POST', '/v1/geocode', { body: { address } });
  }

  /**
   * POST /v1/lookup — resolve an address/coordinate/APN (kind: 'address' |
   * 'coord' | 'apn') to canonical join keys. `includeParcel` defaults to
   * false: per the live pricing (GET /v1/meta/plans), a lookup with
   * include_parcel:true bills `resolve_credits` (300 on the build plan)
   * instead of the 1-credit geocode price — parcel data is out of scope
   * per the build brief, and 300x is an easy accidental overspend.
   */
  lookup(input, { includeParcel = false, kind } = {}) {
    return this._request('POST', '/v1/lookup', {
      body: { input, include_parcel: includeParcel, kind },
    });
  }

  /**
   * POST /v1/ask — plain-English cited answer. Slow (typically 6-20s,
   * hard-bounded at 110s). Caller should set a generous timeout; this
   * client relies on the platform fetch's default (no abort here).
   */
  ask({ lat, lng, address, question, includeTrace = false } = {}) {
    return this._request('POST', '/v1/ask', {
      body: { lat, lng, address, question, include_trace: includeTrace },
    });
  }

  /** POST /v1/field-requests — spend a scarce field request. */
  createFieldRequest(payload) {
    return this._request('POST', '/v1/field-requests', { body: payload });
  }
}

export const mireye = new MireyeClient();
