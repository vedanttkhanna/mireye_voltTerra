import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../config.js';
import { requireOperatorForUnsafeMethods } from '../operator.js';

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('operator guard leaves read-only requests open', () => {
  let called = false;
  requireOperatorForUnsafeMethods({ method: 'GET' }, responseRecorder(), () => { called = true; });
  assert.equal(called, true);
});

test('operator guard rejects an invalid key', () => {
  const previous = config.operatorKey;
  config.operatorKey = 'expected-key';
  try {
    const res = responseRecorder();
    requireOperatorForUnsafeMethods({ method: 'POST', get: () => 'wrong-key' }, res, () => {});
    assert.equal(res.statusCode, 401);
  } finally {
    config.operatorKey = previous;
  }
});

test('operator guard accepts the configured key', () => {
  const previous = config.operatorKey;
  config.operatorKey = 'expected-key';
  try {
    let called = false;
    requireOperatorForUnsafeMethods({ method: 'POST', get: () => 'expected-key' }, responseRecorder(), () => { called = true; });
    assert.equal(called, true);
  } finally {
    config.operatorKey = previous;
  }
});
