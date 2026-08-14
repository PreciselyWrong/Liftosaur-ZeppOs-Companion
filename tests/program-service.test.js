import test from 'node:test';
import assert from 'node:assert/strict';

import { createProgramService, programVersion } from '../app-side/program-service.js';

const PROGRAM_TEXT = `# Semaine 1
## Mardi: PUSH A
Decline Bench Press / 3x8 @8 / 80kg 120s
Triceps Pushdown / 2x11 @8 / 35kg 75s

## Mercredi: QUADS
Belt Squat / 3x12 @8 / 50kg 120s

# Semaine 2
## Mardi: PUSH A
Decline Bench Press[1,2] / 3x8 @8 / 82.5kg 120s

## Mercredi: QUADS
Belt Squat[1,2] / 3x12 @8 / 52.5kg 120s
`;

function planText({ week = 1, day = 1, dayName = 'Semaine 1 - Mardi: PUSH A' } = {}) {
  return `2026-08-14 12:00:00 +00:00 / program: "Test" / dayName: "${dayName}" / week: ${week} / dayInWeek: ${day} / exercises: {
  Decline Bench Press / 1x8 80kg / target: 3x8 80kg @8 120s
  Triceps Pushdown / 1x11 35kg / target: 2x11 35kg @8 75s
}`;
}

function createFakeClient(overrides = {}) {
  const calls = {
    playground: [],
    updateProgram: [],
    createHistory: [],
    updateHistory: [],
    deleteHistory: [],
  };
  const state = { programText: PROGRAM_TEXT, historyRecords: [] };

  const client = {
    calls,
    state,

    async listPrograms() {
      return [{ id: 'prog-1', name: 'Test', isCurrent: true }];
    },

    async getProgram(id) {
      return { id, name: 'Test', text: state.programText, isCurrent: true };
    },

    async updateProgram(id, body) {
      calls.updateProgram.push({ id, body });
      state.programText = body.text;
      return { id, name: 'Test', text: body.text, isCurrent: true };
    },

    async runPlayground(params) {
      calls.playground.push(params);
      const count = (params.commands || []).filter((c) => c.startsWith('complete_set')).length;
      if (count > 2 && !params.commands.includes('finish_workout()')) {
        const err = new Error('Exercise 3 not found');
        err.apiMessage = 'Exercise 3 not found';
        throw err;
      }
      return {
        workout: planText({ week: params.week, day: params.day }),
        updatedProgramText: params.commands?.includes('finish_workout()')
          ? `${PROGRAM_TEXT}\n// progressed`
          : undefined,
      };
    },

    async listHistory() {
      return { records: state.historyRecords, hasMore: false, nextCursor: null };
    },

    async createHistoryRecord(text) {
      calls.createHistory.push(text);
      const record = { id: 42, text };
      state.historyRecords.unshift(record);
      return record;
    },

    async updateHistoryRecord(id, text) {
      calls.updateHistory.push({ id, text });
      return { id, text };
    },

    async deleteHistoryRecord(id) {
      calls.deleteHistory.push(id);
      return { deleted: true };
    },
  };

  return Object.assign(client, overrides);
}

test('lists programs straight from the API', async () => {
  const service = createProgramService({ client: createFakeClient() });
  assert.deepEqual(await service.listPrograms(), [
    { id: 'prog-1', name: 'Test', isCurrent: true },
  ]);
});

test('outlines the program weeks and days', async () => {
  const service = createProgramService({ client: createFakeClient() });
  const outline = await service.getProgramOutline('prog-1');

  assert.equal(outline.totalWeeks, 2);
  assert.equal(outline.totalDays, 4);
  assert.deepEqual(outline.weeks[0].days.map((d) => d.name), ['Mardi: PUSH A', 'Mercredi: QUADS']);
  assert.equal(outline.programVersion, programVersion(PROGRAM_TEXT));
});

test('reports the last workout without selecting anything', async () => {
  const client = createFakeClient();
  client.state.historyRecords = [
    {
      id: 7,
      text: '2026-08-13 10:00:00 +00:00 / program: "Test" / dayName: "Semaine 1 - Mardi: PUSH A" / week: 1 / dayInWeek: 1 / exercises: {\n  Squat / 3x5 100kg\n}',
    },
  ];

  const outline = await createProgramService({ client }).getProgramOutline('prog-1');

  assert.equal(outline.lastWorkout.week, 1);
  assert.equal(outline.lastWorkout.dayInWeek, 1);
  assert.equal(outline.lastWorkout.dayName, 'Semaine 1 - Mardi: PUSH A');
});

test('probes the exercise count from the playground error, then reads the targets', async () => {
  const client = createFakeClient();
  const service = createProgramService({ client });
  await service.getProgramOutline('prog-1');

  const plan = await service.getDayPlan('prog-1', 1, 1);

  const probeCalls = client.calls.playground;
  assert.equal(probeCalls.length, 2);
  assert.ok(probeCalls[0].commands.length > 2, 'first call probes a generous ceiling');
  assert.deepEqual(probeCalls[1].commands, ['complete_set(1, 1)', 'complete_set(2, 1)']);

  assert.equal(plan.exercises.length, 2);
  assert.equal(plan.exercises[0].sets.length, 3);
  assert.equal(plan.exercises[0].sets[0].targetWeight, 80);
  assert.equal(plan.week, 1);
  assert.equal(plan.dayInWeek, 1);
  assert.equal(plan.outlineNameMatches, true);
});

test('accepts the day name with or without the week prefix', async () => {
  const client = createFakeClient({
    async runPlayground(params) {
      const count = (params.commands || []).filter((c) => c.startsWith('complete_set')).length;
      if (count > 2) {
        const err = new Error('Exercise 3 not found');
        err.apiMessage = 'Exercise 3 not found';
        throw err;
      }
      // Single-week spelling: Liftosaur drops the week prefix.
      return { workout: planText({ week: 1, day: 1, dayName: 'Mardi: PUSH A' }) };
    },
  });

  const plan = await createProgramService({ client }).getDayPlan('prog-1', 1, 1);
  assert.equal(plan.outlineNameMatches, true);
});

test('passes the requested week and day to the playground unchanged', async () => {
  const client = createFakeClient();
  const service = createProgramService({ client });
  await service.getDayPlan('prog-1', 2, 2);

  for (const call of client.calls.playground) {
    assert.equal(call.week, 2);
    assert.equal(call.day, 2);
  }
});

test('refuses a day the program does not contain', async () => {
  const service = createProgramService({ client: createFakeClient() });

  await assert.rejects(() => service.getDayPlan('prog-1', 9, 1), /DAY_NOT_IN_PROGRAM|not part of/);
  await assert.rejects(() => service.getDayPlan('prog-1', 1, 7), /DAY_NOT_IN_PROGRAM|not part of/);
});

test('fails loudly when the playground answers about another day', async () => {
  const client = createFakeClient({
    async runPlayground(params) {
      const count = (params.commands || []).filter((c) => c.startsWith('complete_set')).length;
      if (count > 2) {
        const err = new Error('Exercise 3 not found');
        err.apiMessage = 'Exercise 3 not found';
        throw err;
      }
      return { workout: planText({ week: 1, day: 2 }) };
    },
  });

  await assert.rejects(
    () => createProgramService({ client }).getDayPlan('prog-1', 1, 1),
    (err) => err.code === 'DAY_MISMATCH'
  );
});

test('finishes by replaying the session, saving history, then the progression', async () => {
  const client = createFakeClient();
  const service = createProgramService({ client });
  const plan = await service.getDayPlan('prog-1', 1, 1);

  const result = await service.finishWorkout({
    programId: 'prog-1',
    programVersion: plan.programVersion,
    week: 1,
    day: 1,
    startedAt: Date.parse('2026-08-14T09:00:00.000Z'),
    durationSeconds: 3600,
    completedSets: [
      { exerciseIndex: 1, setIndex: 1, weight: 80, reps: 8, rpe: 8, unit: 'kg' },
      { exerciseIndex: 1, setIndex: 2, weight: 80, reps: 8, rpe: 9, unit: 'kg' },
    ],
  });

  assert.equal(result.status, 'SAVED');
  assert.equal(result.historyId, 42);
  assert.equal(result.programUpdated, true);

  const finishCall = client.calls.playground.at(-1);
  assert.deepEqual(finishCall.commands, [
    'change_weight(1, 1, 80kg)',
    'change_reps(1, 1, 8)',
    'complete_set(1, 1)',
    'change_rpe(1, 1, 8)',
    'change_weight(1, 2, 80kg)',
    'change_reps(1, 2, 8)',
    'complete_set(1, 2)',
    'change_rpe(1, 2, 9)',
    'finish_workout()',
  ]);

  const submitted = client.calls.createHistory[0];
  assert.ok(submitted.startsWith('2026-08-14 09:00:00 +00:00 /'), 'uses the watch start time');
  assert.ok(submitted.includes('duration: 3600s'), 'states the measured duration');
  assert.ok(submitted.includes('Decline Bench Press'), 'keeps the server exercises block');

  assert.equal(client.calls.updateProgram.length, 1);
  assert.ok(client.calls.updateProgram[0].body.text.includes('// progressed'));
});

test('saves history but never overwrites a program edited elsewhere', async () => {
  const client = createFakeClient();
  const service = createProgramService({ client });
  const plan = await service.getDayPlan('prog-1', 1, 1);

  // Someone edits the program in the Liftosaur app while the workout runs.
  client.state.programText = `${PROGRAM_TEXT}\n// edited on the phone`;

  const result = await service.finishWorkout({
    programId: 'prog-1',
    programVersion: plan.programVersion,
    week: 1,
    day: 1,
    completedSets: [{ exerciseIndex: 1, setIndex: 1, weight: 80, reps: 8, rpe: 8, unit: 'kg' }],
  });

  assert.equal(result.status, 'HISTORY_SAVED_PROGRAM_CONFLICT');
  assert.equal(result.historyId, 42, 'the workout happened, so it is recorded');
  assert.equal(result.programUpdated, false);
  assert.equal(client.calls.updateProgram.length, 0, 'the remote edit survives');
});

test('writes nothing when the program the plan was built from is gone', async () => {
  const client = createFakeClient();
  const service = createProgramService({ client });

  // The Side Service restarted, and the program changed in the meantime.
  client.state.programText = `${PROGRAM_TEXT}\n// rewritten`;

  const result = await service.finishWorkout({
    programId: 'prog-1',
    programVersion: 'a-version-that-no-longer-exists',
    week: 1,
    day: 1,
    completedSets: [{ exerciseIndex: 1, setIndex: 1, weight: 80, reps: 8, rpe: 8, unit: 'kg' }],
  });

  assert.equal(result.status, 'BASE_PROGRAM_UNAVAILABLE');
  assert.equal(client.calls.createHistory.length, 0);
  assert.equal(client.calls.updateProgram.length, 0);
});

test('a lost history response is resolved by searching before retrying', async () => {
  const existing = {
    id: 99,
    text: '2026-08-14T09:00:00.000Z / program: "Test" / dayName: "Semaine 1 - Mardi: PUSH A" / week: 1 / dayInWeek: 1 / duration: 3600s / exercises: {\n  Decline Bench Press / 1x8 80kg\n}',
  };

  const client = createFakeClient({
    async createHistoryRecord() {
      const err = new Error('Network failure');
      err.status = 0;
      throw err;
    },
    async listHistory() {
      return { records: [existing], hasMore: false, nextCursor: null };
    },
  });

  const service = createProgramService({ client });
  const result = await service.commitHistory(existing.text, Date.parse('2026-08-14T09:00:00.000Z'));

  assert.equal(result.id, 99);
  assert.equal(result.alreadyExisted, true);
});

test('a lost history response with no matching record still fails', async () => {
  const client = createFakeClient({
    async createHistoryRecord() {
      throw new Error('Network failure');
    },
    async listHistory() {
      return { records: [], hasMore: false, nextCursor: null };
    },
  });

  await assert.rejects(
    () =>
      createProgramService({ client }).commitHistory(
        '2026-08-14T09:00:00.000Z / dayName: "X" / exercises: {\n  Squat / 1x5 100kg\n}',
        Date.parse('2026-08-14T09:00:00.000Z')
      ),
    /Network failure/
  );
});

test('programVersion changes with the text and is stable for the same text', () => {
  assert.equal(programVersion(PROGRAM_TEXT), programVersion(PROGRAM_TEXT));
  assert.notEqual(programVersion(PROGRAM_TEXT), programVersion(`${PROGRAM_TEXT} `));
});

test('getDayPlan resolves warmups against referenceData and attaches superset tags', async () => {
  const customProgram = `# Semaine 1
## Mardi: PUSH A
Decline Bench Press / 3x8 @8 / 87.5kg 120s / warmup: 1x8 40%, 1x5 70%, 1x3 85% / superset: A
Triceps Pushdown / 2x11 @8 / 90kg 75s / warmup: 1x8 60% / superset: A
`;

  const client = createFakeClient({
    async getProgram() {
      return { id: 'prog-1', name: 'Test', text: customProgram, isCurrent: true };
    },
    async runPlayground() {
      return {
        workout: `2026-08-14 12:00:00 +00:00 / program: "Test" / dayName: "Semaine 1 - Mardi: PUSH A" / week: 1 / dayInWeek: 1 / exercises: {
  Decline Bench Press / 1x8 87.5kg / target: 3x8 87.5kg @8 120s
  Triceps Pushdown / 1x11 90kg / target: 2x11 90kg @8 75s
}`,
      };
    },
  });

  const fakeReference = {
    isLoaded: () => true,
    load: async () => {},
    resolveWeight: (name, eq, target, unit) => {
      // Barbell 87.5kg: 40% -> 35, 70% -> 60, 85% -> 72.5 (from our verified tests)
      if (name === 'Decline Bench Press') {
        if (Math.abs(target - 0.4 * 87.5) < 1e-3) return { value: 35, exact: true, resolved: true };
        if (Math.abs(target - 0.7 * 87.5) < 1e-3) return { value: 60, exact: true, resolved: true };
        if (Math.abs(target - 0.85 * 87.5) < 1e-3) return { value: 72.5, exact: false, resolved: true };
      }
      if (name === 'Triceps Pushdown') {
        if (Math.abs(target - 0.6 * 90) < 1e-3) return { value: 52.5, exact: false, resolved: true };
      }
      return { value: target, exact: false, resolved: false };
    },
  };

  const service = createProgramService({ client, referenceData: fakeReference });
  const plan = await service.getDayPlan('prog-1', 1, 1);

  assert.equal(plan.exercises.length, 2);
  assert.equal(plan.exercises[0].supersetGroup, 'A');
  assert.equal(plan.exercises[0].warmupSets.length, 3);
  assert.deepEqual(
    plan.exercises[0].warmupSets.map((w) => [w.targetReps, w.targetWeight, w.targetWeightPercent]),
    [
      [8, 35, 40],
      [5, 60, 70],
      [3, 72.5, 85],
    ]
  );

  assert.equal(plan.exercises[1].supersetGroup, 'A');
  assert.equal(plan.exercises[1].warmupSets.length, 1);
  assert.deepEqual(
    plan.exercises[1].warmupSets.map((w) => [w.targetReps, w.targetWeight, w.targetWeightPercent]),
    [[8, 52.5, 60]]
  );
});
