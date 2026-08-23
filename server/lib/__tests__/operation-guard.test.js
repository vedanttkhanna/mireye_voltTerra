import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../config.js';
import { requireOperationKey } from '../operation-guard.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('requireOperationKey rejects protected operations when the server key is unset', () => {
  const previous = config.operationApiKey;
  config.operationApiKey = '';
  try {
    const res = responseRecorder();
    requireOperationKey({ get: () => null }, res, () => assert.fail('next must not run'));
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'operation_key_not_configured');
  } finally {
    config.operationApiKey = previous;
  }
});

test('requireOperationKey accepts only an exact X-Operation-Key value', () => {
  const previous = config.operationApiKey;
  config.operationApiKey = 'correct-secret';
  try {
    const rejected = responseRecorder();
    requireOperationKey({ get: () => 'wrong-secret' }, rejected, () => assert.fail('next must not run'));
    assert.equal(rejected.statusCode, 401);

    let nextCalled = false;
    requireOperationKey({ get: () => 'correct-secret' }, responseRecorder(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  } finally {
    config.operationApiKey = previous;
  }
});
