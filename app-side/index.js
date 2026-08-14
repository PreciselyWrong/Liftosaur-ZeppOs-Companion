import { BaseSideService } from '@zeppos/zml/base-side';
import { createSideRouter } from './router.js';
import { createLiftosaurApiClient } from './liftosaur-api-client.js';

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
    let raw = null;
    if (sideServiceInstance?.settings?.getItem) {
      raw = sideServiceInstance.settings.getItem('apiKey');
    }
    if (!raw && typeof settings !== 'undefined' && settings?.settingsStorage?.getItem) {
      raw = settings.settingsStorage.getItem('apiKey');
    }
    const extracted = extractApiKeyString(raw);
    if (extracted) {
      console.log('[liftosaur-side] effective API key loaded (length:', extracted.length, ')');
      return extracted;
    }
  } catch (e) {
    console.log('[liftosaur-side] error loading api key:', e?.message || String(e));
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
      console.log('[liftosaur-side] no API key configured in mobile settings');
      return null;
    }
    const client = getApiClient();
    return await client.getCurrentProgram();
  },

  playgroundSimulator: async (journal) => {
    const client = getApiClient();
    try {
      return await client.runPlaygroundSimulation(JSON.stringify(journal));
    } catch (err) {
      console.log('[liftosaur-side] playground simulation error:', err?.message || String(err));
      return null;
    }
  },

  historySubmitter: async (history) => {
    const client = getApiClient();
    try {
      return await client.submitWorkoutHistory(history);
    } catch (err) {
      console.log('[liftosaur-side] history submit error:', err?.message || String(err));
      return { id: 'offline-saved-' + Date.now(), status: 'queued_offline' };
    }
  },
});

AppSideService(
  BaseSideService({
    onInit() {
      console.log('[liftosaur-side] onInit');
      sideServiceInstance = this;
    },

    onRequest(req, res) {
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
