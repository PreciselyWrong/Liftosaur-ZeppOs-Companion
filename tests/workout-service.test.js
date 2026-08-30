import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorkoutService } from '../app-side/workout-service.js';

function createMockClient() {
  const calls = [];
  return {
    calls,
    async getNextWorkout(selection) {
      calls.push({ method: 'getNextWorkout', selection });
      return { workout: { programName: 'Test Next', selection } };
    },
    async getCurrentWorkout() {
      calls.push({ method: 'getCurrentWorkout' });
      return { workout: { programName: 'Test Current' } };
    },
    async startRunningWorkout(payload) {
      calls.push({ method: 'startRunningWorkout', payload });
      return { workout: { id: 1001, ...payload } };
    },
    async logWorkoutSets(sets) {
      calls.push({ method: 'logWorkoutSets', sets });
      return { workout: { setsLogged: sets.length } };
    },
    async finishRunningWorkout(payload) {
      calls.push({ method: 'finishRunningWorkout', payload });
      return { workout: { id: payload?.startTime, finished: true } };
    },
    async discardCurrentWorkout(startTime) {
      calls.push({ method: 'discardCurrentWorkout', startTime });
      return { deleted: true };
    },
    async getSettings() {
      calls.push({ method: 'getSettings' });
      return { units: 'kg', timers: { warmup: 60, workout: 120 } };
    },
  };
}

function createMockCatalogService() {
  const calls = [];
  return {
    calls,
    mode: 'TEST_MODE',
    async listPrograms() {
      calls.push({ method: 'listPrograms' });
      return [{ id: 'p1', name: 'Program 1' }];
    },
    async getProgramOutline(programId) {
      calls.push({ method: 'getProgramOutline', programId });
      return { programId, weeks: [] };
    },
  };
}

describe('Workout Service', () => {
  test('delegates listPrograms and getProgramOutline to catalogService', async () => {
    const catalogService = createMockCatalogService();
    const client = createMockClient();
    const service = createWorkoutService({ client, catalogService });

    const programs = await service.listPrograms();
    assert.equal(programs.length, 1);
    assert.equal(catalogService.calls[0].method, 'listPrograms');

    const outline = await service.getProgramOutline('p-custom');
    assert.equal(outline.programId, 'p-custom');
    assert.equal(catalogService.calls[1].method, 'getProgramOutline');
    assert.equal(catalogService.calls[1].programId, 'p-custom');
    assert.equal(service.mode, 'TEST_MODE');
  });

  test('delegates getNextWorkout to client', async () => {
    const client = createMockClient();
    const catalogService = createMockCatalogService();
    const service = createWorkoutService({ client, catalogService });

    const res = await service.getNextWorkout({ programId: 'p1', week: 2, dayInWeek: 1 });
    assert.equal(res.workout.programName, 'Test Next');
    assert.deepEqual(client.calls[0], {
      method: 'getNextWorkout',
      selection: { programId: 'p1', week: 2, dayInWeek: 1 },
    });
  });

  test('delegates getCurrentWorkout to client', async () => {
    const client = createMockClient();
    const catalogService = createMockCatalogService();
    const service = createWorkoutService({ client, catalogService });

    const res = await service.getCurrentWorkout();
    assert.equal(res.workout.programName, 'Test Current');
    assert.deepEqual(client.calls[0], { method: 'getCurrentWorkout' });
  });

  test('delegates startWorkout to client.startRunningWorkout', async () => {
    const client = createMockClient();
    const catalogService = createMockCatalogService();
    const service = createWorkoutService({ client, catalogService });

    const payload = { programId: 'p1', week: 1, dayInWeek: 2, startTime: 1738274512000 };
    const res = await service.startWorkout(payload);

    assert.equal(res.workout.id, 1001);
    assert.deepEqual(client.calls[0], { method: 'startRunningWorkout', payload });
  });

  test('delegates syncWorkoutSets to client.logWorkoutSets', async () => {
    const client = createMockClient();
    const catalogService = createMockCatalogService();
    const service = createWorkoutService({ client, catalogService });

    const sets = [
      { entryId: 'e1', setId: 's1', completed: { reps: 5, weight: '80kg' } },
      { entryId: 'e1', setId: 's2', completed: { reps: 5, weight: '80kg' } },
    ];
    const res = await service.syncWorkoutSets(sets);

    assert.equal(res.workout.setsLogged, 2);
    assert.deepEqual(client.calls[0], { method: 'logWorkoutSets', sets });
  });

  test('delegates finishWorkout to client.finishRunningWorkout', async () => {
    const client = createMockClient();
    const catalogService = createMockCatalogService();
    const service = createWorkoutService({ client, catalogService });

    const finishPayload = {
      startTime: 1738274512000,
      endTime: 1738278112000,
      notes: 'great session',
      intervals: [[1738274512000, 1738278112000]],
    };
    const res = await service.finishWorkout(finishPayload);

    assert.equal(res.workout.finished, true);
    assert.deepEqual(client.calls[0], { method: 'finishRunningWorkout', payload: finishPayload });
  });

  test('delegates discardWorkout to client.discardCurrentWorkout', async () => {
    const client = createMockClient();
    const catalogService = createMockCatalogService();
    const service = createWorkoutService({ client, catalogService });

    const res = await service.discardWorkout(1738274512000);

    assert.deepEqual(res, { deleted: true });
    assert.deepEqual(client.calls[0], { method: 'discardCurrentWorkout', startTime: 1738274512000 });
  });

  test('delegates getSettings to client.getSettings', async () => {
    const client = createMockClient();
    const catalogService = createMockCatalogService();
    const service = createWorkoutService({ client, catalogService });

    const res = await service.getSettings();

    assert.equal(res.units, 'kg');
    assert.deepEqual(client.calls[0], { method: 'getSettings' });
  });

  test('is stateless and propagates client errors directly without retries', async () => {
    const failingClient = {
      async getCurrentWorkout() {
        const err = new Error('No active workout');
        err.code = 'no_active_workout';
        err.status = 404;
        throw err;
      },
    };
    const service = createWorkoutService({ client: failingClient, catalogService: createMockCatalogService() });

    await assert.rejects(
      () => service.getCurrentWorkout(),
      (err) => {
        assert.equal(err.code, 'no_active_workout');
        assert.equal(err.status, 404);
        return true;
      }
    );
  });
});
