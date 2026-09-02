import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseWorkoutExtensionAppId,
  generateWorkoutExtensionProject,
} from '../tools/generate-workout-extension.js';

test('validates and parses Workout Extension App ID', () => {
  assert.equal(parseWorkoutExtensionAppId(7654321), 7654321);
  assert.equal(parseWorkoutExtensionAppId('7654321'), 7654321);

  assert.throws(() => parseWorkoutExtensionAppId(undefined), /Missing or invalid Workout Extension App ID/);
  assert.throws(() => parseWorkoutExtensionAppId(null), /Missing or invalid Workout Extension App ID/);
  assert.throws(() => parseWorkoutExtensionAppId(''), /Missing or invalid Workout Extension App ID/);
  assert.throws(() => parseWorkoutExtensionAppId(0), /Missing or invalid Workout Extension App ID/);
  assert.throws(() => parseWorkoutExtensionAppId(-10), /Missing or invalid Workout Extension App ID/);
  assert.throws(() => parseWorkoutExtensionAppId(3.14), /Missing or invalid Workout Extension App ID/);
  assert.throws(() => parseWorkoutExtensionAppId('not-a-number'), /Missing or invalid Workout Extension App ID/);
});

test('generates a complete Workout Extension project in target directory', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifto-ext-gen-test-'));

  try {
    const staleSharedDir = path.join(tempDir, 'shared');
    fs.mkdirSync(staleSharedDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'app.json'),
      JSON.stringify({ app: { extType: 'workout' } }),
    );
    fs.writeFileSync(path.join(staleSharedDir, 'removed-prototype.js'), 'stale\n');

    const result = generateWorkoutExtensionProject({
      appId: 987654,
      targetDir: tempDir,
    });

    assert.equal(result.appId, 987654);
    assert.equal(result.targetDir, tempDir);

    const appJsonPath = path.join(tempDir, 'app.json');
    assert.ok(fs.existsSync(appJsonPath), 'app.json must exist');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

    assert.equal(appJson.app.appId, 987654);
    assert.equal(appJson.app.extType, 'workout');
    assert.equal(appJson.runtime.apiVersion.minVersion, '3.6');
    assert.deepEqual(appJson.permissions, [
      'device:os.local_storage',
      'data:os.device.info',
      'data:user.hd.workout',
    ]);

    const commonDataWidget = appJson.targets.common.module['data-widget'].widgets[0];
    assert.equal(commonDataWidget.path, 'data-widget/common/index');
    assert.deepEqual(commonDataWidget.runtime.ability, [{ type: 1, subType: [52] }]);

    const squareDataWidget = appJson.targets.square.module['data-widget'].widgets[0];
    assert.equal(squareDataWidget.path, 'data-widget/common/index');
    assert.deepEqual(squareDataWidget.runtime.ability, [{ type: 1, subType: [52] }]);

    assert.equal(appJson.targets.common.module['app-side'].path, 'app-side/index');
    assert.equal(appJson.targets.common.module.setting.path, 'setting/index');

    assert.ok(fs.existsSync(path.join(tempDir, 'app.js')), 'app.js must exist');
    assert.ok(fs.existsSync(path.join(tempDir, 'package.json')), 'package.json must exist');
    assert.ok(
      fs.existsSync(path.join(tempDir, 'data-widget', 'common', 'index.js')),
      'data-widget/common/index.js must exist',
    );

    assert.ok(fs.existsSync(path.join(tempDir, 'app-side', 'index.js')), 'app-side/index.js must exist');
    assert.ok(fs.existsSync(path.join(tempDir, 'app-side', 'router.js')), 'app-side/router.js must exist');
    assert.ok(
      fs.existsSync(path.join(tempDir, 'app-side', 'workout-service.js')),
      'app-side/workout-service.js must exist',
    );

    assert.ok(fs.existsSync(path.join(tempDir, 'setting', 'index.js')), 'setting/index.js must exist');

    assert.ok(
      fs.existsSync(path.join(tempDir, 'shared', 'workout-extension-metrics.js')),
      'shared/workout-extension-metrics.js must exist',
    );
    assert.ok(fs.existsSync(path.join(tempDir, 'shared', 'protocol.js')), 'shared/protocol.js must exist');
    assert.ok(fs.existsSync(path.join(tempDir, 'shared', 'screen-layout.js')), 'shared/screen-layout.js must exist');
    assert.equal(
      fs.existsSync(path.join(tempDir, 'shared', 'removed-prototype.js')),
      false,
      'stale generated files must not survive regeneration',
    );

    assert.ok(
      fs.existsSync(path.join(tempDir, 'assets', 'common.r', 'icon.png')),
      'assets/common.r/icon.png must exist',
    );
    assert.ok(
      fs.existsSync(path.join(tempDir, 'assets', 'square.s', 'icon.png')),
      'assets/square.s/icon.png must exist',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('refuses to clean a non-empty directory that is not a generated Workout project', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifto-ext-safe-target-test-'));

  try {
    const unrelatedPath = path.join(tempDir, 'keep.txt');
    fs.writeFileSync(unrelatedPath, 'unrelated\n');

    assert.throws(
      () => generateWorkoutExtensionProject({ appId: 987654, targetDir: tempDir }),
      /not a generated Workout Extension project/,
    );
    assert.equal(fs.readFileSync(unrelatedPath, 'utf8'), 'unrelated\n');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ships the official single-page DataWidget lifecycle and click-only interaction', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'data-widget', 'common', 'index.js'),
    'utf8',
  );

  assert.match(source, /DataWidget\(\s*BasePage\(/);
  for (const lifecycle of ['onInit', 'build', 'onResume', 'onPause', 'onDestroy']) {
    assert.match(source, new RegExp(`${lifecycle}\\(\\)`));
  }
  assert.match(source, /getSportData\(\{ type: 'duration' \}/);
  assert.match(source, /MESSAGE_TYPES\.(GET_SETTINGS|GET_WORKOUT_CURRENT|START_WORKOUT)/);
  assert.match(source, /click_func:/);
  assert.doesNotMatch(source, /onGesture|SCROLL_LIST|VIEW_CONTAINER/);
});
