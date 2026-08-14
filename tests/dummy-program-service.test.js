import test from 'node:test';
import assert from 'node:assert/strict';

import { createDummyProgramService } from '../app-side/dummy-program-service.js';

test('dummy program service lists sample programs', async () => {
  const service = createDummyProgramService();
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

  const latPulldown = plan.exercises.find((e) => e.name === 'Lat Pulldown');
  assert.ok(latPulldown);
  assert.equal(latPulldown.supersetTag, 'A1');

  const triceps = plan.exercises.find((e) => e.name === 'Triceps Rope Pushdown');
  assert.ok(triceps);
  assert.equal(triceps.supersetTag, 'A2');
});

test('dummy program service finishes workout cleanly', async () => {
  const service = createDummyProgramService();
  const res = await service.finishWorkout({ programId: 'dummy-gzclp' });
  assert.equal(res.status, 'SAVED');
  assert.equal(res.programUpdated, true);
});
