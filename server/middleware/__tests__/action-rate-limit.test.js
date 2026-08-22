import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../config.js';
import { actionRateLimit } from '../action-rate-limit.js';

function responseRecorder() {
  return {
    statusCode: null,
    status(code) { this.statusCode = code; return this; },
    set() { return this; },
    json() { return this; },
  };
}

test('action rate limiter leaves read-only requests open', () => {
  let called = false;
  actionRateLimit({ method: 'GET' }, responseRecorder(), () => { called = true; });
  assert.equal(called, true);
});

test('action rate limiter throttles repeated unsafe requests', () => {
  const previous = config.actionRateLimitPerMinute;
  config.actionRateLimitPerMinute = 1;
  try {
    const request = { method: 'POST', ip: 'rate-limit-test-ip' };
    actionRateLimit(request, responseRecorder(), () => {});
    const secondResponse = responseRecorder();
    actionRateLimit(request, secondResponse, () => {});
    assert.equal(secondResponse.statusCode, 429);
  } finally {
    config.actionRateLimitPerMinute = previous;
  }
});
