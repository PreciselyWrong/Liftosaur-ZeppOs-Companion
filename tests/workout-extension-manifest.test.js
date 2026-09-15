import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkoutExtensionManifest } from '../shared/workout-extension-manifest.js';

test('builds a Workout Extension for Strength Training and Free Training', () => {
  const manifest = createWorkoutExtensionManifest({ appId: 7654321, version: '0.3.3', versionCode: 24 });

  assert.equal(manifest.app.appType, 'app');
  assert.equal(manifest.app.extType, 'workout');
  assert.equal(manifest.app.appId, 7654321);
  assert.equal(manifest.i18n['en-US'].appName, 'Lifto Workout');
  assert.equal(manifest.runtime.apiVersion.minVersion, '3.6');
  assert.deepEqual(manifest.permissions, [
    'device:os.local_storage',
    'data:os.device.info',
    'data:user.hd.workout',
  ]);
  assert.deepEqual(manifest.targets.common.module['data-widget'].widgets[0].runtime.ability, [
    { type: 1, subType: [52, 5] },
  ]);
  assert.doesNotMatch(manifest.app.description, /Strength Training/);
});

test('rejects placeholder App IDs and invalid versions', () => {
  assert.throws(() => createWorkoutExtensionManifest({ appId: 0, version: '0.3.3', versionCode: 24 }));
  assert.throws(() => createWorkoutExtensionManifest({ appId: 7654321, version: 'bad', versionCode: 24 }));
});
