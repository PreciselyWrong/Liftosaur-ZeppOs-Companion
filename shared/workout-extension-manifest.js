const STRENGTH_TRAINING_SUBTYPE = 52;

function assertAppId(appId) {
  if (!Number.isInteger(appId) || appId <= 0) {
    throw new Error('Workout Extension appId must be a positive integer');
  }
}

function assertVersion(version, versionCode) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !Number.isInteger(versionCode) || versionCode <= 0) {
    throw new Error('Workout Extension version must be semantic with a positive numeric code');
  }
}

export function createWorkoutExtensionManifest({ appId, version, versionCode }) {
  assertAppId(appId);
  assertVersion(version, versionCode);

  return {
    configVersion: 'v3',
    app: {
      appId,
      appName: 'Lifto Workout',
      appType: 'app',
      extType: 'workout',
      version: { code: versionCode, name: version },
      icon: 'icon.png',
      vender: 'Sni3rs',
      description: 'Liftosaur session companion for Zepp Strength Training',
    },
    permissions: [
      'device:os.local_storage',
      'data:os.device.info',
      'data:user.hd.workout',
    ],
    runtime: {
      apiVersion: { compatible: '3.6', target: '3.6', minVersion: '3.6' },
    },
    targets: {
      common: {
        module: {
          'data-widget': {
            widgets: [{
              path: 'data-widget/common/index',
              name: 'Lifto',
              icon: 'icon.png',
              window: { isPinned: 1 },
              runtime: { ability: [{ type: 1, subType: [STRENGTH_TRAINING_SUBTYPE] }] },
            }],
          },
          'app-side': { path: 'app-side/index' },
          setting: { path: 'setting/index' },
        },
        platforms: [{ st: 'r' }],
        designWidth: 480,
      },
      square: {
        module: {
          'data-widget': {
            widgets: [{
              path: 'data-widget/common/index',
              name: 'Lifto',
              icon: 'icon.png',
              window: { isPinned: 1 },
              runtime: { ability: [{ type: 1, subType: [STRENGTH_TRAINING_SUBTYPE] }] },
            }],
          },
          'app-side': { path: 'app-side/index' },
          setting: { path: 'setting/index' },
        },
        platforms: [{ st: 's' }],
        designWidth: 480,
      },
    },
    defaultLanguage: 'en-US',
    i18n: { 'en-US': { 'data-widget': { widgets: [{ name: 'Lifto' }] } } },
  };
}
