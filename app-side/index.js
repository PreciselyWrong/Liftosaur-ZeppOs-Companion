import { BaseSideService } from '@zeppos/zml/base-side';
import { createSideRouter } from './router.js';
import { createLiftosaurApiClient } from './liftosaur-api-client.js';
import { createProgramService } from './program-service.js';
import { createReferenceData } from './reference-data.js';

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

function getEffectiveSettings() {
  const apiKey = getEffectiveApiKey();
  let standardRest = 120;
  let warmupRest = 60;
  let supersetRest = 90;

  try {
    const storage = (typeof settings !== 'undefined' && settings?.settingsStorage)
      ? settings.settingsStorage
      : sideServiceInstance?.settings;

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
  };
}

/**
 * A new service is built per request so a key entered in the Zepp app takes
 * effect without restarting the watch app. The program text cache lives in the
 * service, so it is kept across requests for as long as the key is unchanged.
 */
import { createDummyProgramService } from './dummy-program-service.js';

let cachedKey = null;
let cachedService = null;

function getProgramService() {
  const effective = getEffectiveSettings();
  const apiKey = effective.apiKey;
  if (!apiKey || apiKey.toLowerCase() === 'dummy' || apiKey.toLowerCase() === 'demo') {
    if (!cachedService || cachedKey !== 'dummy') {
      cachedKey = 'dummy';
      cachedService = createDummyProgramService();
    }
    return cachedService;
  }
  if (apiKey !== cachedKey || !cachedService) {
    cachedKey = apiKey;
    const client = createLiftosaurApiClient({ apiKey });
    const referenceData = createReferenceData({ client });
    cachedService = createProgramService({
      client,
      referenceData,
      getSettings: getEffectiveSettings,
    });
  }
  return cachedService;
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
      cachedService = null;
    },

    onRequest(req, res) {
      sideServiceInstance = this;
      console.log('[liftosaur-side] request', req?.type);

      const router = createSideRouter({
        programService: getProgramService(),
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
