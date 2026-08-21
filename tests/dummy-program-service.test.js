import test from 'node:test';
import assert from 'node:assert/strict';

import { createDummyProgramService } from '../app-side/dummy-program-service.js';

test('dummy program service lists sample programs', async () => {
  const service = createDummyProgramService();
  assert.equal(service.mode, 'DEMO');
  const programs = await service.listPrograms();
  assert.ok(Array.isArray(programs));
  assert.ok(programs.length >= 3);
  assert.ok(programs.some((p) => p.isCurrent));
});

test('dummy program service returns outline with weeks and days', async () => {
  const service = createDummyProgramService();
  const outline = await service.getProgramOutline('dummy-gzclp');
  assert.equal(outline.programId, 'dummy-gzclp');
  assert.ok(outline.weeks.length >= 3);
  assert.ok(outline.weeks[0].days.length >= 4);
  assert.equal(outline.lastWorkout.dayInWeek, 1);
});

test('dummy program service returns rich day plan with warmups and supersets', async () => {
  const service = createDummyProgramService();
  const plan = await service.getDayPlan('dummy-gzclp', 1, 1);
  assert.equal(plan.week, 1);
  assert.equal(plan.dayInWeek, 1);
  assert.ok(plan.exercises.length >= 5);

  const squat = plan.exercises.find((e) => e.name === 'Barbell Squat');
  assert.ok(squat);
  assert.equal(squat.warmupSets.length, 3);
  assert.equal(squat.sets.length, 5);
  assert.equal(squat.loadingEquipment.multiplier, 2);
  assert.ok(squat.loadingEquipment.plates.length > 0);

  const latPulldown = plan.exercises.find((e) => e.name === 'Lat Pulldown');
  assert.ok(latPulldown);
  assert.equal(latPulldown.supersetTag, 'A1');
  assert.equal(latPulldown.loadingEquipment.multiplier, 1);

  const triceps = plan.exercises.find((e) => e.name === 'Triceps Rope Pushdown');
  assert.ok(triceps);
  assert.equal(triceps.supersetTag, 'A2');
});

test('every demo exercise includes a description and its latest session note', async () => {
  const service = createDummyProgramService();
  const plans = [
    await service.getDayPlan('dummy-gzclp', 1, 1),
    await service.getDayPlan('dummy-gzclp', 1, 2),
  ];

  for (const exercise of plans.flatMap((plan) => plan.exercises)) {
    assert.match(exercise.notes, /^Description\n.+/s, exercise.name);
    assert.match(exercise.notes, /\n\nPast sessions\n• \d{4}-\d{2}-\d{2}: .+$/s, exercise.name);
  }
});

test('dummy program service finishes workout cleanly', async () => {
  const service = createDummyProgramService();
  const res = await service.finishWorkout({ programId: 'dummy-gzclp' });
  assert.equal(res.status, 'SAVED');
  assert.equal(res.programUpdated, true);
});
