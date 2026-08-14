import { BaseSideService } from '@zeppos/zml/base-side';
import { createSideRouter } from './router.js';
import { createLiftosaurApiClient } from './liftosaur-api-client.js';

let sideServiceInstance = null;

function getEffectiveApiKey() {
  try {
    let raw = null;
    if (sideServiceInstance?.settings?.getItem) {
      raw = sideServiceInstance.settings.getItem('apiKey');
    }
    if (!raw && typeof settings !== 'undefined' && settings?.settingsStorage?.getItem) {
      raw = settings.settingsStorage.getItem('apiKey');
    }
    if (raw && typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
  } catch (e) {}
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
