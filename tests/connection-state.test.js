import test from 'node:test';
import assert from 'node:assert/strict';

import { isTemporaryPhoneError } from '../shared/connection-state.js';

test('treats a Zepp bridge handshake timeout as temporary', () => {
  assert.equal(isTemporaryPhoneError(new Error('shake timeout')), true);
  assert.equal(isTemporaryPhoneError(new Error('Phone not reachable')), true);
});

test('keeps account errors on the setup path', () => {
  assert.equal(isTemporaryPhoneError(new Error('No programs on this Liftosaur account')), false);
});
