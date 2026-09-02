import { BaseSideService } from '@zeppos/zml/base-side';
import { createSideRouter } from './router.js';
import { createLiftosaurApiClient } from './liftosaur-api-client.js';
import { createProgramService } from './program-service.js';
import { createReferenceData } from './reference-data.js';
import { createDummyProgramService } from './dummy-program-service.js';
import { createDummyWorkoutService } from './dummy-workout-service.js';
import { getOrCreateClientIdentity } from './client-identity.js';
import { createWorkoutService } from './workout-service.js';

let sideServiceInstance = null;

function extractApiKeyString(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    const str = val.trim();
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith('{') && str.endsWith('}'))) {
      try {
        return extractApiKeyString(JSON.parse(str));
      } catch (e) {
        // Not JSON: fall through and use the raw string.
      }
    }
    return str.length > 5 ? str : null;
  }
  if (typeof val === 'object') {
    if (typeof val.value === 'string') return extractApiKeyString(val.value);
    if (typeof val.apiKey === 'string') return extractApiKeyString(val.apiKey);
  }
  return null;
}

function getEffectiveApiKey() {
  try {
    if (typeof settings !== 'undefined' && settings?.settingsStorage) {
      const direct = extractApiKeyString(settings.settingsStorage.getItem('apiKey'));
      if (direct) return direct;
    }
    if (sideServiceInstance?.settings) {
      const fromInstance = extractApiKeyString(sideServiceInstance.settings.getItem('apiKey'));
      if (fromInstance) return fromInstance;
    }
  } catch (err) {
    console.log('[liftosaur-side] settings read failed:', err?.message || String(err));
  }
  return null;
}

function getEffectiveStorage() {
  const storage = (typeof settings !== 'undefined' && settings?.settingsStorage)
    ? settings.settingsStorage
    : (sideServiceInstance?.settings?.settingsStorage || sideServiceInstance?.settings);
  if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') {
    return storage;
  }
  return null;
}

function getEffectiveSettings() {
  const apiKey = getEffectiveApiKey();
  let standardRest = 120;
  let warmupRest = 60;
  let supersetRest = 90;
  let screenOnDuration = 120;

  try {
    const storage = getEffectiveStorage();
    if (!storage) {
      throw new Error('Persistent phone storage unavailable');
    }

    if (storage) {
      const readVal = (key, defaultVal) => {
        const raw = storage.getItem(key);
        if (raw === undefined || raw === null) return defaultVal;
        let v = raw;
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw);
            v = typeof parsed === 'object' && parsed !== null ? (parsed.value ?? parsed) : parsed;
          } catch (e) {
            v = raw;
          }
        } else if (typeof raw === 'object') {
          v = raw.value ?? defaultVal;
        }
        const num = parseInt(v, 10);
        return Number.isFinite(num) ? num : defaultVal;
      };

      standardRest = readVal('defaultStandardRest', 120);
      warmupRest = readVal('defaultWarmupRest', 60);
      supersetRest = readVal('defaultSupersetRest', 90);

      const rawScreenDuration = storage.getItem('screenOnDuration');
      let parsedScreenDuration = rawScreenDuration;
      if (typeof rawScreenDuration === 'string') {
        try {
          parsedScreenDuration = JSON.parse(rawScreenDuration);
        } catch (e) {
          parsedScreenDuration = rawScreenDuration;
        }
      }
      if (typeof parsedScreenDuration === 'object' && parsedScreenDuration !== null) {
        parsedScreenDuration = parsedScreenDuration.value;
      }
      if (parsedScreenDuration === 'always') {
        screenOnDuration = 'always';
      } else {
        const seconds = Number(parsedScreenDuration);
        screenOnDuration = [60, 120, 240].includes(seconds) ? seconds : 120;
      }
    }
  } catch (err) {
    console.log('[liftosaur-side] timer settings read failed:', err?.message || String(err));
  }

  return {
    apiKey,
    defaultTimers: {
      standardRest: standardRest > 0 ? standardRest : null,
      warmupRest: warmupRest > 0 ? warmupRest : null,
      supersetRest: supersetRest > 0 ? supersetRest : null,
    },
    screenOnDuration,
  };
}

let cachedKey = null;
let cachedDeviceId = null;
let cachedProgramService = null;
let cachedWorkoutService = null;

function getServices() {
  const effective = getEffectiveSettings();
  const apiKey = effective.apiKey;
  const isDemo = !apiKey || apiKey.toLowerCase() === 'dummy' || apiKey.toLowerCase() === 'demo';

  if (isDemo) {
    if (!cachedProgramService || !cachedWorkoutService || cachedKey !== 'dummy') {
      cachedKey = 'dummy';
      cachedDeviceId = null;
      cachedProgramService = createDummyProgramService();
      cachedWorkoutService = createDummyWorkoutService({
        catalogService: cachedProgramService,
        getLocalSettings: getEffectiveSettings,
      });
    }
    return {
      programService: cachedProgramService,
      workoutService: cachedWorkoutService,
    };
  }

  const storage = getEffectiveStorage();
  let deviceId = null;
  try {
    deviceId = storage ? getOrCreateClientIdentity(storage) : null;
  } catch (err) {
    console.log('[liftosaur-side] device identity unavailable');
  }

  if (
    apiKey !== cachedKey ||
    deviceId !== cachedDeviceId ||
    !cachedProgramService ||
    !cachedWorkoutService
  ) {
    cachedKey = apiKey;
    cachedDeviceId = deviceId;
    const client = createLiftosaurApiClient({
      apiKey,
      deviceId,
      clientName: 'liftosaur-zepp-os/0.4.0',
    });
    const referenceData = createReferenceData({ client });
    cachedProgramService = createProgramService({
      client,
      referenceData,
      getSettings: getEffectiveSettings,
    });
    cachedWorkoutService = createWorkoutService({
      client,
      catalogService: cachedProgramService,
      getLocalSettings: getEffectiveSettings,
    });
  }

  return {
    programService: cachedProgramService,
    workoutService: cachedWorkoutService,
  };
}

AppSideService(
  BaseSideService({
    onInit() {
      console.log('[liftosaur-side] onInit');
      sideServiceInstance = this;
    },

    onSettingsChange({ key } = {}) {
      console.log('[liftosaur-side] settings changed:', key);
      sideServiceInstance = this;
      cachedKey = null;
      cachedDeviceId = null;
      cachedProgramService = null;
      cachedWorkoutService = null;
    },

    onRequest(req, res) {
      sideServiceInstance = this;
      console.log('[liftosaur-side] request', req?.type);

      const { programService, workoutService } = getServices();
      const router = createSideRouter({
        programService,
        workoutService,
        workoutAbandoner: async () => {
          console.log('[liftosaur-side] workout abandoned');
          return { status: 'abandoned' };
        },
      });

      router
        .handle(req)
        .then((response) => {
          console.log('[liftosaur-side] reply', response?.type, response?.payload?.code || '');
          res(null, response);
        })
        .catch((err) => {
          console.log('[liftosaur-side] unhandled error:', err?.message || String(err));
          res({ code: 500, message: err?.message || 'Internal error' });
        });
    },

    onRun() {
      sideServiceInstance = this;
    },

    onDestroy() {
      sideServiceInstance = null;
    },
  })
);
