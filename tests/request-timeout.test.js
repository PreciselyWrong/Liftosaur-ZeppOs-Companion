import assert from 'node:assert/strict';
import test from 'node:test';

import { withRequestTimeout } from '../shared/request-timeout.js';

test('rejects a request that never settles and ignores its late result', async () => {
  let fireTimeout;
  let resolveRequest;
  const request = new Promise((resolve) => {
    resolveRequest = resolve;
  });

  const bounded = withRequestTimeout(request, {
    timeoutMs: 20_000,
    setTimer: (callback) => {
      fireTimeout = callback;
      return 1;
    },
    clearTimer: () => {},
  });

  fireTimeout();
  await assert.rejects(bounded, (error) => {
    assert.equal(error.code, 'NETWORK');
    assert.match(error.message, /request timeout/i);
    return true;
  });

  resolveRequest('late response');
  await Promise.resolve();
});

test('clears the timeout when the request settles normally', async () => {
  let clearedTimer = null;
  const result = await withRequestTimeout(Promise.resolve('ok'), {
    timeoutMs: 20_000,
    setTimer: () => 42,
    clearTimer: (timer) => {
      clearedTimer = timer;
    },
  });

  assert.equal(result, 'ok');
  assert.equal(clearedTimer, 42);
});
