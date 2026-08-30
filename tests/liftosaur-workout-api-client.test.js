import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createLiftosaurApiClient,
  LiftosaurApiError,
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

describe('Liftosaur Running a Workout API client slice', () => {
  const defaultOptions = {
    apiKey: 'lftsk_valid_api_key_12345',
    deviceId: 'dev_stable_watch_uuid_001',
    clientName: 'lifto-companion/0.3.2',
  };

  test('getNextWorkout performs GET /workout/next and unwraps workout data', async () => {
    const fetcher = fakeFetch(async () =>
      jsonResponse({
        data: {
          workout: {
            programId: 'prog123',
            programName: 'GZCLP',
            dayName: 'A1',
            dayData: { day: 1, week: 1, dayInWeek: 1 },
            startTime: 1738274512000,
            entries: [],
          },
        },
      })
    );
    const client = createLiftosaurApiClient({ ...defaultOptions, fetcher });

    const result = await client.getNextWorkout();

    assert.equal(fetcher.calls.length, 1);
    assert.equal(fetcher.calls[0].url, 'https://www.liftosaur.com/api/v1/workout/next');
    assert.equal(fetcher.calls[0].options.method, 'GET');
    assert.equal(fetcher.calls[0].options.headers.Authorization, 'Bearer lftsk_valid_api_key_12345');
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Device-Id'], undefined);
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Client'], undefined);
    assert.equal(result.workout.programName, 'GZCLP');
  });

  test('getNextWorkout builds query params omitting nulls and undefined', async () => {
    const fetcher = fakeFetch(async () => jsonResponse({ data: { workout: { programId: 'prog123' } } }));
    const client = createLiftosaurApiClient({ ...defaultOptions, fetcher });

    await client.getNextWorkout({ programId: 'p1', week: 2, dayInWeek: 3 });
    assert.equal(fetcher.calls[0].url, 'https://www.liftosaur.com/api/v1/workout/next?programId=p1&week=2&dayInWeek=3');

    await client.getNextWorkout({ programId: 'p1', week: null, dayInWeek: undefined });
    assert.equal(fetcher.calls[1].url, 'https://www.liftosaur.com/api/v1/workout/next?programId=p1');
  });

  test('startRunningWorkout sends POST /workout/start with required headers and omits null body fields', async () => {
    const fetcher = fakeFetch(async () =>
      jsonResponse({
        data: {
          workout: {
            programId: 'prog123',
            startTime: 1738274512000,
            entries: [],
          },
        },
      })
    );
    const client = createLiftosaurApiClient({ ...defaultOptions, fetcher });

    const result = await client.startRunningWorkout({
      programId: 'prog123',
      week: 1,
      dayInWeek: 2,
      startTime: 1738274512000,
    });

    assert.equal(fetcher.calls.length, 1);
    assert.equal(fetcher.calls[0].url, 'https://www.liftosaur.com/api/v1/workout/start');
    assert.equal(fetcher.calls[0].options.method, 'POST');
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Device-Id'], 'dev_stable_watch_uuid_001');
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Client'], 'lifto-companion/0.3.2');
    assert.deepEqual(JSON.parse(fetcher.calls[0].options.body), {
      programId: 'prog123',
      week: 1,
      dayInWeek: 2,
      startTime: 1738274512000,
    });
    assert.equal(result.workout.startTime, 1738274512000);

    await client.startRunningWorkout();
    assert.deepEqual(JSON.parse(fetcher.calls[1].options.body), {});
  });

  test('getCurrentWorkout sends GET /workout/current without device headers and unwraps workout or null', async () => {
    let responseBody = { data: { workout: { programId: 'prog123' } } };
    const fetcher = fakeFetch(async () => jsonResponse(responseBody));
    const client = createLiftosaurApiClient({ ...defaultOptions, fetcher });

    const active = await client.getCurrentWorkout();
    assert.equal(fetcher.calls[0].url, 'https://www.liftosaur.com/api/v1/workout/current');
    assert.equal(fetcher.calls[0].options.method, 'GET');
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Device-Id'], undefined);
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Client'], undefined);
    assert.equal(active.workout.programId, 'prog123');

    responseBody = { data: { workout: null } };
    const none = await client.getCurrentWorkout();
    assert.deepEqual(none, { workout: null });
  });

  test('logWorkoutSet sends POST /workout/set with headers and preserves full payload including completed: null and append', async () => {
    const fetcher = fakeFetch(async () => jsonResponse({ data: { workout: { entries: [] } } }));
    const client = createLiftosaurApiClient({ ...defaultOptions, fetcher });

    const setPayload = {
      entryId: 'squat_barbell',
      setId: 'qwertz',
      completed: { reps: 8, repsLeft: 8, weight: '100kg', rpe: 8.5, setTimer: 45, userVars: { rpe: 9 } },
    };
    await client.logWorkoutSet(setPayload);

    assert.equal(fetcher.calls[0].url, 'https://www.liftosaur.com/api/v1/workout/set');
    assert.equal(fetcher.calls[0].options.method, 'POST');
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Device-Id'], 'dev_stable_watch_uuid_001');
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Client'], 'lifto-companion/0.3.2');
    assert.deepEqual(JSON.parse(fetcher.calls[0].options.body), setPayload);

    const uncompletePayload = { entryId: 'squat_barbell', setId: 'qwertz', completed: null };
    await client.logWorkoutSet(uncompletePayload);
    assert.deepEqual(JSON.parse(fetcher.calls[1].options.body), uncompletePayload);

    const appendPayload = {
      entryId: 'squat_barbell',
      setId: 'kdmwpa',
      append: true,
      completed: { reps: 8, weight: '100kg' },
    };
    await client.logWorkoutSet(appendPayload);
    assert.deepEqual(JSON.parse(fetcher.calls[2].options.body), appendPayload);
  });

  test('logWorkoutSets sends POST /workout/sets with { sets } wire body', async () => {
    const fetcher = fakeFetch(async () => jsonResponse({ data: { workout: { entries: [] } } }));
    const client = createLiftosaurApiClient({ ...defaultOptions, fetcher });

    const sets = [
      { entryId: 'squat', setId: 's1', completed: { reps: 5, weight: '100kg' } },
      { entryId: 'squat', setId: 's2', completed: { reps: 5, weight: '100kg' } },
    ];
    await client.logWorkoutSets(sets);

    assert.equal(fetcher.calls[0].url, 'https://www.liftosaur.com/api/v1/workout/sets');
    assert.equal(fetcher.calls[0].options.method, 'POST');
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Device-Id'], 'dev_stable_watch_uuid_001');
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Client'], 'lifto-companion/0.3.2');
    assert.deepEqual(JSON.parse(fetcher.calls[0].options.body), { sets });
  });

  test('finishRunningWorkout sends POST /workout/finish and preserves intervals, times and notes', async () => {
    const fetcher = fakeFetch(async () =>
      jsonResponse({
        data: {
          workout: {
            id: 1738274512000,
            startTime: 1738274512000,
            endTime: 1738278112000,
            nextDay: { day: 2, week: 1, dayInWeek: 2, dayName: 'A2' },
          },
        },
      })
    );
    const client = createLiftosaurApiClient({ ...defaultOptions, fetcher });

    const finishPayload = {
      startTime: 1738274512000,
      endTime: 1738278112000,
      notes: 'felt strong',
      intervals: [
        [1738274512000, 1738276000000],
        [1738276600000, 1738278112000],
      ],
    };
    const summary = await client.finishRunningWorkout(finishPayload);

    assert.equal(fetcher.calls[0].url, 'https://www.liftosaur.com/api/v1/workout/finish');
    assert.equal(fetcher.calls[0].options.method, 'POST');
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Device-Id'], 'dev_stable_watch_uuid_001');
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Client'], 'lifto-companion/0.3.2');
    assert.deepEqual(JSON.parse(fetcher.calls[0].options.body), finishPayload);
    assert.equal(summary.workout.id, 1738274512000);
  });

  test('discardCurrentWorkout sends DELETE /workout/current with { startTime } wire body', async () => {
    const fetcher = fakeFetch(async () => jsonResponse({ data: { deleted: true } }));
    const client = createLiftosaurApiClient({ ...defaultOptions, fetcher });

    const result = await client.discardCurrentWorkout(1738274512000);

    assert.equal(fetcher.calls[0].url, 'https://www.liftosaur.com/api/v1/workout/current');
    assert.equal(fetcher.calls[0].options.method, 'DELETE');
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Device-Id'], 'dev_stable_watch_uuid_001');
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Client'], 'lifto-companion/0.3.2');
    assert.deepEqual(JSON.parse(fetcher.calls[0].options.body), { startTime: 1738274512000 });
    assert.deepEqual(result, { deleted: true });
  });

  test('getSettings sends GET /settings without device headers and unwraps settings data', async () => {
    const fetcher = fakeFetch(async () =>
      jsonResponse({
        data: {
          units: 'kg',
          timers: { warmup: 90, workout: 180, superset: 60 },
        },
      })
    );
    const client = createLiftosaurApiClient({ ...defaultOptions, fetcher });

    const settings = await client.getSettings();

    assert.equal(fetcher.calls[0].url, 'https://www.liftosaur.com/api/v1/settings');
    assert.equal(fetcher.calls[0].options.method, 'GET');
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Device-Id'], undefined);
    assert.equal(fetcher.calls[0].options.headers['X-Liftosaur-Client'], undefined);
    assert.deepEqual(settings, {
      units: 'kg',
      timers: { warmup: 90, workout: 180, superset: 60 },
    });
  });

  test('workout writes fail locally before fetch when deviceId or clientName is missing', async () => {
    const fetcher = fakeFetch(async () => jsonResponse({ data: {} }));

    const clientWithoutDevice = createLiftosaurApiClient({
      apiKey: 'lftsk_valid_api_key_12345',
      deviceId: null,
      clientName: 'lifto-companion/0.3.2',
      fetcher,
    });
    const clientWithoutClientName = createLiftosaurApiClient({
      apiKey: 'lftsk_valid_api_key_12345',
      deviceId: 'dev_stable_watch_uuid_001',
      clientName: '',
      fetcher,
    });

    const writeCalls = [
      (c) => c.startRunningWorkout(),
      (c) => c.logWorkoutSet({ entryId: 's', setId: '1', completed: { reps: 5, weight: '100kg' } }),
      (c) => c.logWorkoutSets([{ entryId: 's', setId: '1', completed: { reps: 5, weight: '100kg' } }]),
      (c) => c.finishRunningWorkout({ startTime: 123 }),
      (c) => c.discardCurrentWorkout(123),
    ];

    for (const writeCall of writeCalls) {
      await assert.rejects(
        () => writeCall(clientWithoutDevice),
        (err) => err instanceof LiftosaurApiError && err.code === 'NO_DEVICE_ID' && err.status === 400
      );
      await assert.rejects(
        () => writeCall(clientWithoutClientName),
        (err) => err instanceof LiftosaurApiError && err.code === 'NO_CLIENT_NAME' && err.status === 400
      );
    }
    assert.equal(fetcher.calls.length, 0);

    // Existing non-workout writes and reads work fine without deviceId/clientName
    const clientNoIdentity = createLiftosaurApiClient({
      apiKey: 'lftsk_valid_api_key_12345',
      fetcher,
    });
    await clientNoIdentity.listPrograms();
    await clientNoIdentity.getNextWorkout();
    await clientNoIdentity.getCurrentWorkout();
    await clientNoIdentity.getSettings();
    assert.equal(fetcher.calls.length, 4);
  });

  test('preserves documented Liftosaur workout error codes, status and secret redaction', async () => {
    const errorCases = [
      { status: 400, code: 'invalid_input', message: 'Malformed body or missing header lftsk_secret' },
      { status: 400, code: 'missing_set_input', message: 'Missing reps for AMRAP set' },
      { status: 404, code: 'no_active_workout', message: 'No active workout' },
      { status: 404, code: 'set_not_found', message: 'Set not found' },
      { status: 404, code: 'entry_not_found', message: 'Entry not found' },
      { status: 404, code: 'day_not_found', message: 'Day not found' },
      { status: 409, code: 'ambiguous_entry', message: 'Ambiguous entry' },
      { status: 409, code: 'workout_already_active', message: 'Workout already active' },
      { status: 409, code: 'workout_start_time_taken', message: 'Start time taken' },
      { status: 409, code: 'workout_mismatch', message: 'Workout mismatch' },
      { status: 422, code: 'program_error', message: 'Script runtime failure' },
    ];

    for (const ec of errorCases) {
      const fetcher = fakeFetch(async () =>
        jsonResponse({ error: { code: ec.code, message: ec.message } }, { ok: false, status: ec.status })
      );
      const client = createLiftosaurApiClient({ ...defaultOptions, fetcher });

      await assert.rejects(
        () => client.startRunningWorkout({ startTime: 12345 }),
        (err) => {
          assert.equal(err.status, ec.status);
          assert.equal(err.code, ec.code);
          if (ec.message.includes('lftsk_secret')) {
            assert.doesNotMatch(err.message, /lftsk_secret/);
            assert.match(err.message, /lftsk_\*\*\*/);
          }
          return true;
        }
      );
    }
  });
});
