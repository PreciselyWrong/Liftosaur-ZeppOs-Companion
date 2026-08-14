import { BaseSideService } from '@zeppos/zml/base-side';
import { createSideRouter } from './router.js';
import { createLiftosaurApiClient } from './liftosaur-api-client.js';
import { formatWorkoutHistoryToLiftoscript } from '../shared/history-formatter.js';


let sideServiceInstance = null;

function extractApiKeyString(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    let str = val.trim();
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith('{') && str.endsWith('}'))) {
      try {
        const parsed = JSON.parse(str);
        return extractApiKeyString(parsed);
      } catch (e) {}
    }
    if (str.length > 5) {
      return str;
    }
  } else if (typeof val === 'object' && val !== null) {
    if (typeof val.value === 'string') return extractApiKeyString(val.value);
    if (typeof val.apiKey === 'string') return extractApiKeyString(val.apiKey);
  }
  return null;
}

function getEffectiveApiKey() {
  try {
    let allSettings = {};

    // 1. Try global settingsStorage
    if (typeof settings !== 'undefined' && settings?.settingsStorage) {
      const direct = settings.settingsStorage.getItem('apiKey');
      const directExtracted = extractApiKeyString(direct);
      if (directExtracted) {
        console.log('[liftosaur-side] found direct apiKey in settingsStorage');
        return directExtracted;
      }
      if (typeof settings.settingsStorage.toObject === 'function') {
        allSettings = { ...allSettings, ...(settings.settingsStorage.toObject() || {}) };
      }
    }

    // 2. Try sideServiceInstance.settings
    if (sideServiceInstance?.settings) {
      const fromInstance = sideServiceInstance.settings.getItem('apiKey');
      const instExtracted = extractApiKeyString(fromInstance);
      if (instExtracted) {
        console.log('[liftosaur-side] found apiKey in sideServiceInstance.settings');
        return instExtracted;
      }
      if (typeof sideServiceInstance.settings.getAll === 'function') {
        allSettings = { ...allSettings, ...(sideServiceInstance.settings.getAll() || {}) };
      }
    }

    // 3. Search all collected settings entries
    for (const [k, v] of Object.entries(allSettings)) {
      const candidate = extractApiKeyString(v);
      if (candidate) {
        console.log('[liftosaur-side] found apiKey in setting entry key:', k);
        return candidate;
      }
    }
  } catch (e) {
    console.log('[liftosaur-side] getEffectiveApiKey exception:', e?.message || String(e));
  }
  return null;
}

function getApiClient() {
  const apiKey = getEffectiveApiKey();
  return createLiftosaurApiClient({ apiKey });
}

const router = createSideRouter({
  programProvider: async () => {
    const apiKey = getEffectiveApiKey();
    if (!apiKey) {
      console.log('[liftosaur-side] no API key found in mobile settings storage');
      return null;
    }
    const client = getApiClient();
    return await client.getCurrentProgram();
  },

  historyProvider: async () => {
    const apiKey = getEffectiveApiKey();
    if (!apiKey) return null;
    const client = getApiClient();
    return await client.getRecentHistory({ limit: 10 });
  },

  playgroundSimulator: async (params = {}) => {
    const client = getApiClient();
    try {
      if (params.programText) {
        return await client.runPlayground(params);
      }
      return null;
    } catch (err) {
      console.log('[liftosaur-side] playground error:', err?.message || String(err));
      return null;
    }
  },


  historySubmitter: async (history) => {
    const client = getApiClient();
    try {
      const liftoscriptText = formatWorkoutHistoryToLiftoscript(history);
      console.log('[liftosaur-side] submitting history to Liftosaur Cloud API');
      return await client.submitWorkoutHistory({ text: liftoscriptText });
    } catch (err) {
      console.log('[liftosaur-side] history submit error:', err?.message || String(err));
      return { id: 'offline-saved-' + Date.now(), status: 'queued_offline' };
    }
  },

  workoutAbandoner: async (payload) => {
    console.log('[liftosaur-side] workout session abandoned/canceled:', payload?.workoutName || 'unnamed');
    return { status: 'abandoned' };
  },
});

AppSideService(
  BaseSideService({
    onInit() {
      console.log('[liftosaur-side] onInit');
      sideServiceInstance = this;
    },

    onSettingsChange({ key, newValue, oldValue } = {}) {
      console.log('[liftosaur-side] onSettingsChange key:', key);
      sideServiceInstance = this;
    },

    onRequest(req, res) {
      sideServiceInstance = this;
      console.log('[liftosaur-side] onRequest', JSON.stringify(req));
      router
        .handle(req)
        .then((response) => {
          console.log('[liftosaur-side] response', JSON.stringify(response));
          res(null, response);
        })
        .catch((err) => {
          console.log('[liftosaur-side] error', err?.message || String(err));
          res({ code: 500, message: err?.message || 'Internal error' });
        });
    },

    onRun() {
      console.log('[liftosaur-side] onRun');
      sideServiceInstance = this;
    },

    onDestroy() {
      console.log('[liftosaur-side] onDestroy');
      sideServiceInstance = null;
    },
  })
);
