import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../page/common/index.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

test('a second Companion Retry tap during a launch load starts no second load', () => {
  let loads = 0;
  const state = {
    isBusy: false, errorMessage: '', statusMessage: '', connectionRetryTimer: null, connectionRetryAttempt: 0,
    PHONE_CONNECTING_MESSAGE: '', MESSAGE_TYPES: { LIST_PROGRAMS: 'LIST_PROGRAMS' },
    renderUI() {}, clearTimeout() {},
    send() { loads += 1; return new Promise(() => {}); },
  };
  const names = ['retryConnection', 'resetConnectionRetry', 'loadPrograms', 'beginRequest', 'handleInitialLoadFailure'];
  const scope = new Proxy(state, { has: (target, key) => key in target });
  const retry = new Function('scope', `with (scope) { ${names.map(extractFunction).join('\n')}; return retryConnection; }`)(scope);
  retry();
  retry();
  assert.equal(loads, 1);
});

test('a Companion outline failure on the loading screen moves to a screen with Retry', async () => {
  for (const temporary of [true, false]) {
    const state = {
      screen: 'LOADING', isBusy: false, statusMessage: '', errorMessage: '', isTearingDown: false,
      selectedProgram: null, outline: null, listPage: 0, retries: 0, console: { log() {} },
      SCREEN: { CONNECTION: 'CONNECTION', SETUP: 'SETUP', LOADING: 'LOADING', PROGRAMS: 'PROGRAMS', HOME: 'HOME', WEEKS: 'WEEKS' },
      MESSAGE_TYPES: { GET_PROGRAM_OUTLINE: 'GET_PROGRAM_OUTLINE' },
      renderUI() {}, resetConnectionRetry() {},
      isTemporaryPhoneError: (err) => err.message === 'Phone request timeout',
      scheduleConnectionRetry() { state.retries += 1; },
      send: () => Promise.reject(new Error(temporary ? 'Phone request timeout' : 'Liftosaur API error')),
    };
    const names = ['loadOutline', 'failRequest', 'beginRequest'];
    if (source.includes('function handleInitialLoadFailure(')) names.push('handleInitialLoadFailure');
    const scope = new Proxy(state, { has: (target, key) => key in target });
    const loadOutline = new Function('scope', `with (scope) { ${names.map(extractFunction).join('\n')}; return loadOutline; }`)(scope);
    loadOutline({ id: 'p1' }, { nextScreen: 'HOME' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(state.screen, temporary ? 'CONNECTION' : 'SETUP', `temporary=${temporary}`);
    assert.equal(state.retries, temporary ? 1 : 0);
  }
});
