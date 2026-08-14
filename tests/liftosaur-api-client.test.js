import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLiftosaurApiClient,
  LiftosaurApiError,
  redactSecret,
} from '../app-side/liftosaur-api-client.js';

function fakeFetch(handler) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  fetcher.calls = calls;
  return fetcher;
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    text: async () => JSON.stringify(body),
  };
}

test('redacts the key everywhere it could leak', () => {
  assert.equal(redactSecret('lftsk_abcdefghijklmnop'), 'lftsk_***mnop');
  assert.equal(redactSecret('Bearer lftsk_abcdefghijklmnop'), 'Bearer lftsk_***mnop');
  assert.equal(redactSecret('short'), '***');
  assert.equal(redactSecret(''), '<empty>');
});

test('an error message never carries the key', () => {
  const err = new LiftosaurApiError('bad key lftsk_supersecretvalue rejected', {
    status: 401,
    endpoint: '/programs',
  });

  assert.ok(!err.message.includes('supersecret'));
  assert.match(err.message, /lftsk_\*\*\*/);
  assert.equal(err.status, 401);
});

test('sends the bearer token and unwraps data', async () => {
  const fetcher = fakeFetch(async () =>
    jsonResponse({ data: { programs: [{ id: 'p1', name: 'Test', isCurrent: true }] } })
  );
  const client = createLiftosaurApiClient({ apiKey: 'lftsk_key_value', fetcher });

  const programs = await client.listPrograms();

  assert.deepEqual(programs, [{ id: 'p1', name: 'Test', isCurrent: true }]);
  assert.equal(fetcher.calls[0].url, 'https://www.liftosaur.com/api/v1/programs');
  assert.equal(fetcher.calls[0].options.headers.Authorization, 'Bearer lftsk_key_value');
});

test('refuses to call the API without a key', async () => {
  const fetcher = fakeFetch(async () => jsonResponse({ data: {} }));
  const client = createLiftosaurApiClient({ apiKey: null, fetcher });

  await assert.rejects(() => client.listPrograms(), (err) => err.code === 'NO_API_KEY');
  assert.equal(fetcher.calls.length, 0);
});

test('posts a playground run with only the fields that were given', async () => {
  const fetcher = fakeFetch(async () =>
    jsonResponse({ data: { workout: 'text', updatedProgramText: 'updated' } })
  );
  const client = createLiftosaurApiClient({ apiKey: 'lftsk_key_value', fetcher });

  await client.runPlayground({ programText: 'P', week: 2, day: 3, commands: ['finish_workout()'] });
  const firstBody = JSON.parse(fetcher.calls[0].options.body);
  assert.deepEqual(firstBody, {
    programText: 'P',
    week: 2,
    day: 3,
    commands: ['finish_workout()'],
  });

  await client.runPlayground({ programText: 'P' });
  assert.deepEqual(JSON.parse(fetcher.calls[1].options.body), { programText: 'P' });
});

test('builds the history query and normalizes the response', async () => {
  const fetcher = fakeFetch(async () =>
    jsonResponse({ data: { records: [{ id: 1, text: 'x' }], hasMore: true, nextCursor: 7 } })
  );
  const client = createLiftosaurApiClient({ apiKey: 'lftsk_key_value', fetcher });

  const history = await client.listHistory({ limit: 5, cursor: 7 });

  assert.match(fetcher.calls[0].url, /\/history\?limit=5&cursor=7$/);
  assert.equal(history.records.length, 1);
  assert.equal(history.hasMore, true);
  assert.equal(history.nextCursor, 7);
});

test('turns an API error body into a typed error', async () => {
  const fetcher = fakeFetch(async () =>
    jsonResponse({ error: { message: 'Parse error on line 3' } }, { ok: false, status: 422 })
  );
  const client = createLiftosaurApiClient({ apiKey: 'lftsk_key_value', fetcher });

  await assert.rejects(
    () => client.runPlayground({ programText: 'bad' }),
    (err) => {
      assert.equal(err.status, 422);
      assert.equal(err.apiMessage, 'Parse error on line 3');
      return true;
    }
  );
});

test('reports a network failure as status 0', async () => {
  const fetcher = fakeFetch(async () => {
    throw new Error('socket hang up');
  });
  const client = createLiftosaurApiClient({ apiKey: 'lftsk_key_value', fetcher });

  await assert.rejects(
    () => client.getProgram('current'),
    (err) => err.status === 0 && err.code === 'NETWORK'
  );
});

test('creates a history record from raw Liftohistory text', async () => {
  const fetcher = fakeFetch(async () => jsonResponse({ data: { id: 5, text: 'record' } }));
  const client = createLiftosaurApiClient({ apiKey: 'lftsk_key_value', fetcher });

  const created = await client.createHistoryRecord('record');

  assert.equal(created.id, 5);
  assert.equal(fetcher.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(fetcher.calls[0].options.body), { text: 'record' });
});
