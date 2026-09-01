import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  SUPPORTED_PREVIEW_PRODUCTS,
  DEFAULT_PREVIEW_OUTPUTS,
  DEFAULT_PREVIEW_SCALE,
  normalizePreviewProduct,
  planPreview,
  executePreview,
  main,
} from '../tools/preview-targets.js';

const rootDir = process.cwd();
const defaultWorkoutDir = path.join(rootDir, 'build', 'workout-extension');
const defaultBuilderScript = path.join(rootDir, 'tools', 'build-preview.mjs');
const defaultCompanionQr = path.join(rootDir, 'docs', 'test-build-qr.png');
const defaultWorkoutQr = path.join(rootDir, 'build', 'workout-extension-preview-qr.png');

test('validates supported preview products', () => {
  assert.deepEqual(SUPPORTED_PREVIEW_PRODUCTS, ['companion', 'workout']);
  assert.equal(normalizePreviewProduct('companion'), 'companion');
  assert.equal(normalizePreviewProduct('workout'), 'workout');
  assert.equal(normalizePreviewProduct(' COMPANION '), 'companion');
  assert.equal(normalizePreviewProduct('Workout'), 'workout');

  assert.throws(() => normalizePreviewProduct(undefined), /Invalid product/);
  assert.throws(() => normalizePreviewProduct(null), /Invalid product/);
  assert.throws(() => normalizePreviewProduct(''), /Invalid product/);
  assert.throws(() => normalizePreviewProduct('all'), /Invalid product/);
  assert.throws(() => normalizePreviewProduct('invalid'), /Invalid product/);
});

test('exposes default preview outputs and scale', () => {
  assert.equal(DEFAULT_PREVIEW_OUTPUTS.companion, 'docs/test-build-qr.png');
  assert.equal(DEFAULT_PREVIEW_OUTPUTS.workout, 'build/workout-extension-preview-qr.png');
  assert.equal(DEFAULT_PREVIEW_SCALE, 10);
});

test('planPreview for companion requires no App ID and targets root directory', () => {
  const plan = planPreview('companion', { env: {} });
  assert.equal(plan.product, 'companion');
  assert.equal(plan.steps.length, 1);

  const step = plan.steps[0];
  assert.equal(step.product, 'companion');
  assert.equal(step.command, process.execPath);
  assert.deepEqual(step.args, [defaultBuilderScript, defaultCompanionQr, '10']);
  assert.equal(step.cwd, rootDir);
  assert.equal(step.generate, false);
  assert.equal(step.outPath, defaultCompanionQr);
  assert.equal(step.scale, 10);
});

test('planPreview for companion accepts custom outPath, scale, and execPath', () => {
  const customOut = path.join(rootDir, 'custom', 'preview.png');
  const plan = planPreview('companion', {
    outPath: customOut,
    scale: 15,
    execPath: 'node',
  });

  const step = plan.steps[0];
  assert.equal(step.command, 'node');
  assert.deepEqual(step.args, [defaultBuilderScript, customOut, '15']);
  assert.equal(step.outPath, customOut);
  assert.equal(step.scale, 15);
});

test('planPreview rejects an invalid scale before starting a preview', () => {
  assert.throws(() => planPreview('companion', { scale: 0 }), /positive number/);
  assert.throws(() => planPreview('companion', { scale: -1 }), /positive number/);
  assert.throws(() => planPreview('companion', { scale: Number.NaN }), /positive number/);
});

test('planPreview for workout validates App ID and targets generated build directory', () => {
  assert.throws(() => planPreview('workout', { env: {} }), /Missing or invalid Workout Extension App ID/);
  assert.throws(() => planPreview('workout', { appId: 'invalid' }), /Missing or invalid Workout Extension App ID/);
  assert.throws(() => planPreview('workout', { appId: 0 }), /Missing or invalid Workout Extension App ID/);
  assert.throws(() => planPreview('workout', { appId: -5 }), /Missing or invalid Workout Extension App ID/);

  const plan = planPreview('workout', { appId: 887766 });
  assert.equal(plan.product, 'workout');
  assert.equal(plan.steps.length, 1);

  const step = plan.steps[0];
  assert.equal(step.product, 'workout');
  assert.equal(step.command, process.execPath);
  assert.deepEqual(step.args, [defaultBuilderScript, defaultWorkoutQr, '10']);
  assert.equal(step.cwd, defaultWorkoutDir);
  assert.equal(step.generate, true);
  assert.equal(step.appId, 887766);
  assert.equal(step.outPath, defaultWorkoutQr);
  assert.equal(step.scale, 10);

  const envPlan = planPreview('workout', {
    appId: undefined,
    env: { ZEPP_WORKOUT_EXTENSION_APP_ID: '445566' },
  });
  assert.equal(envPlan.steps[0].appId, 445566);
});

test('planPreview for workout accepts custom outPath and scale', () => {
  const customOut = path.join(rootDir, 'out', 'ext.png');
  const plan = planPreview('workout', {
    appId: 123456,
    outPath: customOut,
    scale: 8,
  });

  const step = plan.steps[0];
  assert.deepEqual(step.args, [defaultBuilderScript, customOut, '8']);
  assert.equal(step.outPath, customOut);
  assert.equal(step.scale, 8);
});

test('executePreview executes companion preview in repository root without generator', () => {
  const calls = [];
  const fakeSpawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  };
  let generatorCalled = false;
  const fakeGenerator = () => {
    generatorCalled = true;
  };

  const result = executePreview('companion', {
    spawn: fakeSpawn,
    generator: fakeGenerator,
    env: {},
  });

  assert.equal(result.product, 'companion');
  assert.equal(generatorCalled, false, 'generator should not be called for companion preview');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args, [defaultBuilderScript, defaultCompanionQr, '10']);
  assert.equal(calls[0].options.cwd, rootDir);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.stdio, 'inherit');
});

test('executePreview generates project before running QR builder for workout', () => {
  const calls = [];
  const fakeSpawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  };
  const generatorCalls = [];
  const fakeGenerator = (opts) => {
    generatorCalls.push(opts);
  };

  const result = executePreview('workout', {
    appId: 654321,
    spawn: fakeSpawn,
    generator: fakeGenerator,
  });

  assert.equal(result.product, 'workout');
  assert.equal(generatorCalls.length, 1);
  assert.equal(generatorCalls[0].appId, 654321);
  assert.equal(generatorCalls[0].targetDir, defaultWorkoutDir);
  assert.equal(generatorCalls[0].rootDir, rootDir);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args, [defaultBuilderScript, defaultWorkoutQr, '10']);
  assert.equal(calls[0].options.cwd, defaultWorkoutDir);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.stdio, 'inherit');
});

test('executePreview for workout fails before generation or spawn if App ID is missing', () => {
  let spawnCalled = false;
  let generatorCalled = false;
  const fakeSpawn = () => {
    spawnCalled = true;
    return { status: 0 };
  };
  const fakeGenerator = () => {
    generatorCalled = true;
  };

  assert.throws(
    () => executePreview('workout', { env: {}, spawn: fakeSpawn, generator: fakeGenerator }),
    /Missing or invalid Workout Extension App ID/,
  );
  assert.equal(spawnCalled, false, 'spawn should not be called when App ID is missing');
  assert.equal(generatorCalled, false, 'generator should not be called when App ID is missing');
});

test('executePreview propagates non-zero exit and signal failures', () => {
  const fakeSpawnNonZero = () => ({ status: 42 });

  assert.throws(
    () => executePreview('companion', { spawn: fakeSpawnNonZero }),
    (err) => err.status === 42 && err.product === 'companion' && err.message.includes('exit code 42'),
  );

  const fakeSpawnSignal = () => ({ status: null, signal: 'SIGTERM' });

  assert.throws(
    () => executePreview('companion', { spawn: fakeSpawnSignal }),
    (err) => err.status === 1 && err.signal === 'SIGTERM' && err.product === 'companion' && err.message.includes('signal SIGTERM'),
  );
});

test('executePreview propagates spawn error exceptions', () => {
  const spawnError = new Error('spawn ENOENT');
  const fakeSpawn = () => ({ error: spawnError });

  assert.throws(
    () => executePreview('companion', { spawn: fakeSpawn }),
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

test('package.json defines preview:companion and preview:workout scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

  assert.equal(pkg.scripts['preview:companion'], 'node tools/preview-targets.js companion');
  assert.equal(pkg.scripts['preview:workout'], 'node tools/preview-targets.js workout');
});
