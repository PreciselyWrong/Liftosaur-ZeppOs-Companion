import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createSideRouter } from '../app-side/router.js';
import { createWorkoutService } from '../app-side/workout-service.js';
import { createProgramService } from '../app-side/program-service.js';
import { createReferenceData } from '../app-side/reference-data.js';
import { createLiftosaurApiClient } from '../app-side/liftosaur-api-client.js';
import { MESSAGE_TYPES, PROTOCOL_VERSION, createMessage } from '../shared/protocol.js';

const API_KEY = 'zz-test-key-0123456789';
const LFTSK_KEY = 'lftsk_abuse_0123456789';

function response(status, body, { statusText = status < 400 ? 'OK' : 'Error', textError = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async text() {
      if (textError) throw textError;
      return body;
    },
  };
}

function stack(fetcher, { apiKey = API_KEY } = {}) {
  const client = createLiftosaurApiClient({ apiKey, fetcher, deviceId: 'device-1', clientName: 'test/1' });
  const programService = createProgramService({ client, referenceData: createReferenceData({ client }) });
  const workoutService = createWorkoutService({ client, catalogService: programService, getLocalSettings: () => ({}) });
  return createSideRouter({ programService, workoutService });
}

const NETWORK_REQUESTS = [
  [MESSAGE_TYPES.LIST_PROGRAMS, {}],
  [MESSAGE_TYPES.GET_PROGRAM_OUTLINE, { programId: 'p1' }],
  [MESSAGE_TYPES.GET_WORKOUT_NEXT, {}],
  [MESSAGE_TYPES.GET_WORKOUT_CURRENT, {}],
  [MESSAGE_TYPES.START_WORKOUT, { startTime: 1000 }],
  [MESSAGE_TYPES.SYNC_WORKOUT_SETS, { sets: [{ entryIndex: 0, setIndex: 0, completedReps: 5 }] }],
  [MESSAGE_TYPES.FINISH_WORKOUT, { startTime: 1000, endTime: 2000 }],
  [MESSAGE_TYPES.DISCARD_WORKOUT, { startTime: 1000 }],
  [MESSAGE_TYPES.GET_SETTINGS, {}],
];

function assertWellFormedReply(reply, request) {
  assert.equal(reply.protocolVersion, PROTOCOL_VERSION);
  assert.equal(typeof reply.messageId, 'string');
  assert.ok(Object.values(MESSAGE_TYPES).includes(reply.type), `reply type ${reply.type}`);
  assert.equal(reply.replyToId, request?.messageId ?? null);
  assert.equal(typeof reply.payload, 'object');
  if (reply.type === MESSAGE_TYPES.ERROR) {
    assert.equal(typeof reply.payload.code, 'string');
    assert.equal(typeof reply.payload.message, 'string');
  }
}

// The watch keeps retrying a write whose error code is one of these and gives up on any other.
const WATCH_RETRIES = new Set(['NETWORK', 'API_FAILED']);

test('malformed envelopes always get one INVALID_ENVELOPE reply and never throw', async () => {
  const router = createSideRouter({});
  const envelopes = [
    undefined, null, 0, 'LIST_PROGRAMS', [], {}, { type: 'PING' },
    { protocolVersion: PROTOCOL_VERSION, type: 'PING' },
    { protocolVersion: PROTOCOL_VERSION, messageId: '', type: 'PING' },
    { protocolVersion: PROTOCOL_VERSION, messageId: 7, type: 'PING' },
    { protocolVersion: PROTOCOL_VERSION, messageId: 'm', type: 'NOPE' },
    { protocolVersion: '3', messageId: 'm', type: 'PING' },
  ];
  for (const envelope of envelopes) {
    const reply = await router.handle(envelope);
    assert.equal(reply.type, MESSAGE_TYPES.ERROR);
    assert.equal(reply.payload.code, 'INVALID_ENVELOPE');
    assert.equal(reply.protocolVersion, PROTOCOL_VERSION);
  }
});

test('every message type with any payload shape gets exactly one well-formed reply', async () => {
  const router = stack(async () => response(200, JSON.stringify({ data: { programs: [], workout: null } })));
  const payloads = [undefined, null, 'text', 42, [], {}, { sets: 'x' }, { startTime: 'soon' }, { week: 1 }];
  for (const type of Object.values(MESSAGE_TYPES)) {
    for (const payload of payloads) {
      const request = createMessage({ type, payload });
      const reply = await router.handle(request);
      assertWellFormedReply(reply, request);
    }
  }
});

test('transient HTTP failures map to codes the watch retries', async () => {
  const transient = [
    ['network drop', async () => { throw new TypeError('Failed to fetch'); }],
    ['500 JSON with a server code', async () => response(500, JSON.stringify({ error: { code: 'internal_error', message: 'Boom' } }))],
    ['503 HTML', async () => response(503, '<!DOCTYPE html><html><body>Service Unavailable</body></html>', { statusText: 'Service Unavailable' })],
    ['429 with a server code', async () => response(429, JSON.stringify({ error: { code: 'rate_limited', message: 'Slow down' } }))],
    ['200 truncated JSON', async () => response(200, '{"data":{"workout":{"startTi')],
    ['200 body lost mid-read', async () => response(200, '', { textError: new TypeError('network connection was lost') })],
    ['200 HTML captive portal', async () => response(200, '<html>Sign in to Wi-Fi</html>')],
  ];
  for (const [label, fetcher] of transient) {
    const router = stack(fetcher);
    for (const [type, payload] of NETWORK_REQUESTS) {
      const request = createMessage({ type, payload });
      const reply = await router.handle(request);
      assertWellFormedReply(reply, request);
      assert.equal(reply.type, MESSAGE_TYPES.ERROR, `${label} ${type}`);
      assert.ok(WATCH_RETRIES.has(reply.payload.code), `${label} ${type} -> ${reply.payload.code}`);
    }
  }
});

test('documented workout rejections keep their permanent code for the watch', async () => {
  const router = stack(async () => response(409, JSON.stringify({ error: { code: 'workout_already_active', message: 'Already active' } })));
  const request = createMessage({ type: MESSAGE_TYPES.START_WORKOUT, payload: { startTime: 1000 } });
  const reply = await router.handle(request);
  assert.equal(reply.payload.code, 'workout_already_active');
});

test('error replies carry a short readable message, never an HTML page or an object dump', async () => {
  const html = `<!DOCTYPE html><html><head><title>502</title></head><body>${'x'.repeat(4000)}</body></html>`;
  const cases = [
    async () => response(502, html, { statusText: 'Bad Gateway' }),
    async () => response(401, JSON.stringify({ error: { code: 'unauthorized' } })),
  ];
  for (const fetcher of cases) {
    const reply = await stack(fetcher).handle(createMessage({ type: MESSAGE_TYPES.GET_WORKOUT_CURRENT }));
    assert.equal(reply.type, MESSAGE_TYPES.ERROR);
    assert.doesNotMatch(reply.payload.message, /<html|<!DOCTYPE|\[object Object\]/i);
    assert.ok(reply.payload.message.length <= 200, `message length ${reply.payload.message.length}`);
  }
});

test('the API key never reaches a reply, even when the server echoes it', async () => {
  for (const apiKey of [API_KEY, LFTSK_KEY]) {
    const echoes = [
      async () => response(401, JSON.stringify({ error: { code: 'unauthorized', message: `Invalid key ${apiKey}` } })),
      async () => response(403, `Forbidden for Bearer ${apiKey}`),
      async () => { throw new Error(`socket closed while sending ${apiKey}`); },
    ];
    for (const fetcher of echoes) {
      const router = stack(fetcher, { apiKey });
      for (const [type, payload] of NETWORK_REQUESTS) {
        const reply = await router.handle(createMessage({ type, payload }));
        assert.doesNotMatch(JSON.stringify(reply), new RegExp(apiKey), `${type} leaked the key`);
      }
    }
  }
});

test('concurrent and duplicated set syncs each get their own reply, whatever order they finish in', async () => {
  const pending = [];
  const fetcher = (url, init) => new Promise((resolve) => pending.push({ url, init, resolve }));
  const router = stack(fetcher);
  const requests = [1, 2, 2, 3].map((n) => createMessage({
    type: MESSAGE_TYPES.SYNC_WORKOUT_SETS,
    payload: { sets: [{ entryIndex: 0, setIndex: n, completedReps: n }] },
  }));
  const replies = requests.map((request) => router.handle(request));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 4);
  for (const index of [2, 0, 3, 1]) {
    pending[index].resolve(response(200, JSON.stringify({ data: { workout: { startTime: 1000 + index, entries: [] } } })));
  }
  const settled = await Promise.all(replies);
  settled.forEach((reply, index) => {
    assertWellFormedReply(reply, requests[index]);
    assert.deepEqual(reply.payload, { workout: { startTime: 1000 + index } });
  });
});

test('only the Liftosaur API client calls fetch', () => {
  const files = [];
  for (const dir of ['app-side', 'shared', 'setting', 'page/common', 'data-widget/common']) {
    for (const name of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
      if (name.endsWith('.js')) files.push(`${dir}/${name}`);
    }
  }
  const callers = files.filter((file) => /\bfetch\s*\(/.test(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')));
  assert.deepEqual(callers, []);
  const client = readFileSync(new URL('../app-side/liftosaur-api-client.js', import.meta.url), 'utf8');
  assert.match(client, /typeof fetch !== 'undefined' \? fetch : null/);
});
