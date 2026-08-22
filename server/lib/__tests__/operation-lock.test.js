import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tryAcquireOperation, withOperationLock } from '../operation-lock.js';

test('tryAcquireOperation rejects overlap and allows reuse after release', () => {
  const release = tryAcquireOperation('test-operation');
  assert.equal(typeof release, 'function');
  assert.equal(tryAcquireOperation('test-operation'), null);
  release();
  const releaseAgain = tryAcquireOperation('test-operation');
  assert.equal(typeof releaseAgain, 'function');
  releaseAgain();
});

test('withOperationLock releases the lock after an exception', async () => {
  await assert.rejects(() => withOperationLock('throwing-operation', async () => { throw new Error('boom'); }));
  const release = tryAcquireOperation('throwing-operation');
  assert.equal(typeof release, 'function');
  release();
});
