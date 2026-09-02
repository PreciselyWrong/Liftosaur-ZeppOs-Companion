import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  SUPPORTED_PRODUCTS,
  normalizeProduct,
  planBuild,
  executeBuild,
  main,
} from '../tools/build-targets.js';

const rootDir = process.cwd();
const defaultTargetDir = path.join(rootDir, 'build', 'workout-extension');

test('validates supported products', () => {
  assert.deepEqual(SUPPORTED_PRODUCTS, ['companion', 'workout', 'all']);
  assert.equal(normalizeProduct('companion'), 'companion');
  assert.equal(normalizeProduct('workout'), 'workout');
  assert.equal(normalizeProduct('all'), 'all');
  assert.equal(normalizeProduct(' COMPANION '), 'companion');
  assert.equal(normalizeProduct('Workout'), 'workout');

  assert.throws(() => normalizeProduct(undefined), /Invalid product/);
  assert.throws(() => normalizeProduct(null), /Invalid product/);
  assert.throws(() => normalizeProduct(''), /Invalid product/);
  assert.throws(() => normalizeProduct('invalid'), /Invalid product/);
  assert.throws(() => normalizeProduct('watch'), /Invalid product/);
});

test('planBuild for companion requires no App ID and targets root directory', () => {
  const plan = planBuild('companion', { env: {} });
  assert.equal(plan.product, 'companion');
  assert.equal(plan.steps.length, 1);

  const step = plan.steps[0];
  assert.equal(step.product, 'companion');
  assert.equal(step.command, 'zeus');
  assert.deepEqual(step.args, ['build']);
  assert.equal(step.cwd, rootDir);
  assert.equal(step.generate, false);
});

test('planBuild for workout validates App ID and targets generated build directory', () => {
  assert.throws(() => planBuild('workout', { env: {} }), /Missing or invalid Workout Extension App ID/);
  assert.throws(() => planBuild('workout', { appId: 'not-a-number' }), /Missing or invalid Workout Extension App ID/);
  assert.throws(() => planBuild('workout', { appId: 0 }), /Missing or invalid Workout Extension App ID/);
  assert.throws(() => planBuild('workout', { appId: -10 }), /Missing or invalid Workout Extension App ID/);

  const plan = planBuild('workout', { appId: 998877 });
  assert.equal(plan.product, 'workout');
  assert.equal(plan.steps.length, 1);

  const step = plan.steps[0];
  assert.equal(step.product, 'workout');
  assert.equal(step.command, 'zeus');
  assert.deepEqual(step.args, ['build']);
  assert.equal(step.cwd, defaultTargetDir);
  assert.equal(step.generate, true);
  assert.equal(step.appId, 998877);

  const environmentPlan = planBuild('workout', {
    appId: undefined,
    env: { ZEPP_WORKOUT_EXTENSION_APP_ID: '112233' },
  });
  assert.equal(environmentPlan.steps[0].appId, 112233);
});

test('planBuild for all validates App ID upfront and orders companion before workout', () => {
  assert.throws(() => planBuild('all', { env: {} }), /Missing or invalid Workout Extension App ID/);
  assert.throws(() => planBuild('all', { appId: 'invalid' }), /Missing or invalid Workout Extension App ID/);

  const plan = planBuild('all', { appId: '123456' });
  assert.equal(plan.product, 'all');
  assert.equal(plan.steps.length, 2);

  assert.equal(plan.steps[0].product, 'companion');
  assert.equal(plan.steps[0].cwd, rootDir);
  assert.equal(plan.steps[0].generate, false);

  assert.equal(plan.steps[1].product, 'workout');
  assert.equal(plan.steps[1].cwd, defaultTargetDir);
  assert.equal(plan.steps[1].generate, true);
  assert.equal(plan.steps[1].appId, 123456);
});

test('executeBuild executes companion with zeus build in repository root', () => {
  const calls = [];
  const fakeSpawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  };
  let generatorCalled = false;
  const fakeGenerator = () => {
    generatorCalled = true;
  };

  const result = executeBuild('companion', {
    spawn: fakeSpawn,
    generator: fakeGenerator,
    env: {},
  });

  assert.equal(result.product, 'companion');
  assert.equal(generatorCalled, false, 'generator should not be called for companion');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.platform === 'win32' ? 'zeus build' : 'zeus');
  assert.deepEqual(calls[0].args, process.platform === 'win32' ? [] : ['build']);
  assert.equal(calls[0].options.cwd, rootDir);
  assert.equal(calls[0].options.stdio, 'inherit');
});

test('executeBuild generates project before running zeus build for workout', () => {
  const calls = [];
  const fakeSpawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  };
  const generatorCalls = [];
  const fakeGenerator = (opts) => {
    generatorCalls.push(opts);
  };

  const result = executeBuild('workout', {
    appId: 789012,
    spawn: fakeSpawn,
    generator: fakeGenerator,
  });

  assert.equal(result.product, 'workout');
  assert.equal(generatorCalls.length, 1);
  assert.equal(generatorCalls[0].appId, 789012);
  assert.equal(generatorCalls[0].targetDir, defaultTargetDir);
  assert.equal(generatorCalls[0].rootDir, rootDir);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.platform === 'win32' ? 'zeus build' : 'zeus');
  assert.deepEqual(calls[0].args, process.platform === 'win32' ? [] : ['build']);
  assert.equal(calls[0].options.cwd, defaultTargetDir);
  assert.equal(calls[0].options.stdio, 'inherit');
});

test('executeBuild for all fails before starting companion process if App ID is missing', () => {
  let spawnCalled = false;
  const fakeSpawn = () => {
    spawnCalled = true;
    return { status: 0 };
  };

  assert.throws(
    () => executeBuild('all', { env: {}, spawn: fakeSpawn }),
    /Missing or invalid Workout Extension App ID/,
  );
  assert.equal(spawnCalled, false, 'spawn should not be called if validation fails');
});

test('executeBuild for all runs companion then workout in sequence', () => {
  const order = [];
  const fakeSpawn = (command, args, options) => {
    order.push({ type: 'spawn', command, args, cwd: options.cwd });
    return { status: 0 };
  };
  const fakeGenerator = (opts) => {
    order.push({ type: 'generator', ...opts });
  };

  const result = executeBuild('all', {
    appId: 345678,
    spawn: fakeSpawn,
    generator: fakeGenerator,
  });

  assert.equal(result.product, 'all');
  assert.equal(order.length, 3);
  assert.deepEqual(order[0], {
    type: 'spawn',
    command: process.platform === 'win32' ? 'zeus build' : 'zeus',
    args: process.platform === 'win32' ? [] : ['build'],
    cwd: rootDir,
  });
  assert.deepEqual(order[1], {
    type: 'generator',
    appId: 345678,
    targetDir: defaultTargetDir,
    rootDir,
  });
  assert.deepEqual(order[2], {
    type: 'spawn',
    command: process.platform === 'win32' ? 'zeus build' : 'zeus',
    args: process.platform === 'win32' ? [] : ['build'],
    cwd: defaultTargetDir,
  });
});

test('executeBuild propagates non-zero exit and aborts immediately on first failure', () => {
  const spawnCalls = [];
  const fakeSpawn = (command, args, options) => {
    spawnCalls.push({ command, args, cwd: options.cwd });
    return { status: 42 };
  };
  let generatorCalled = false;
  const fakeGenerator = () => {
    generatorCalled = true;
  };

  assert.throws(
    () =>
      executeBuild('all', {
        appId: 555666,
        spawn: fakeSpawn,
        generator: fakeGenerator,
      }),
    (err) => err.status === 42 && err.product === 'companion',
  );

  assert.equal(spawnCalls.length, 1);
  assert.equal(generatorCalled, false, 'generator must not run after companion build failure');

  assert.throws(
    () => executeBuild('companion', { spawn: () => ({ status: null, signal: 'SIGTERM' }) }),
    (err) => err.status === 1 && err.product === 'companion',
  );
});

test('executeBuild propagates spawn error exceptions', () => {
  const spawnError = new Error('spawn ENOENT');
  const fakeSpawn = () => ({ error: spawnError });

  assert.throws(
    () => executeBuild('companion', { spawn: fakeSpawn }),
    /spawn ENOENT/,
  );
});

test('main handles CLI args and exit status', () => {
  let exitCode = null;
  const mockExit = (code) => {
    exitCode = code;
  };

  const fakeSpawn = () => ({ status: 0 });
  const fakeGen = () => {};

  main(['companion'], { spawn: fakeSpawn, generator: fakeGen, exit: mockExit });
  assert.equal(exitCode, null);

  main(['unknown-target'], { exit: mockExit });
  assert.equal(exitCode, 1);

  exitCode = null;
  main(['workout'], { env: {}, exit: mockExit });
  assert.equal(exitCode, 1);
});

test('package.json defines build:companion, build:workout, and build:all scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

  assert.equal(pkg.scripts['build:companion'], 'node tools/build-targets.js companion');
  assert.equal(pkg.scripts['build:workout'], 'node tools/build-targets.js workout');
  assert.equal(pkg.scripts['build:all'], 'node tools/build-targets.js all');
});
