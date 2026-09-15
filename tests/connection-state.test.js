import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PHONE_CONNECTING_MESSAGE,
  PHONE_CONNECTION_TITLE,
  isTemporaryPhoneError,
  nextPhoneRetryDelay,
  phoneConnectionMessage,
} from '../shared/connection-state.js';

test('treats a Zepp bridge handshake timeout as temporary', () => {
  assert.equal(isTemporaryPhoneError(new Error('shake timeout')), true);
  assert.equal(isTemporaryPhoneError(new Error('Phone not reachable')), true);
});

test('keeps account errors on the setup path', () => {
  assert.equal(isTemporaryPhoneError(new Error('No programs on this Liftosaur account')), false);
});

test('retries a late Zepp bridge briefly without polling forever', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 99].map(nextPhoneRetryDelay),
    [750, 1500, 3000, null, null],
  );
});

test('connection copy reflects whether an automatic retry remains', () => {
  assert.equal(PHONE_CONNECTING_MESSAGE, 'Connecting to phone...');
  assert.equal(PHONE_CONNECTION_TITLE, 'Phone connection needed');
  assert.equal(phoneConnectionMessage(0), 'Waiting for Zepp connection. Retrying automatically...');
  assert.equal(phoneConnectionMessage(3), 'Zepp connection unavailable. Tap Retry.');
});
