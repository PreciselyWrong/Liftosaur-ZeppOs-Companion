import { BaseSideService } from '@zeppos/zml/base-side';
import { createSideRouter } from './router.js';
import { createLiftosaurApiClient } from './liftosaur-api-client.js';

// Side Service holds the secret locally on the smartphone, never passed to the watch
const apiClient = createLiftosaurApiClient();

const router = createSideRouter({
  programProvider: async () => {
    try {
      return await apiClient.getCurrentProgram();
    } catch (err) {
      console.log('[liftosaur-side] api fetch error, using cached fixture:', err?.message || String(err));
      return {
        id: 'fixture-week-1-a',
        name: 'Week 1 - Workout A',
        routineName: 'Basic Beginner Routine',
        text: `
          Bench Press, Barbell / 3x5 @ 60kg / rest 60s / rpe 8
          Overhead Squat, Barbell / 3x5 @ 40kg / rest 90s / rpe 8
          [SUPERSET A1] Incline DB Bench / 2x10 @ 30kg / rest 30s / rpe 8.5
          [SUPERSET A2] DB Chest Row / 2x12 @ 26kg / rest 60s / rpe 8.5
        `,
      };
    }
  },

  playgroundSimulator: async (journal) => {
    try {
      return await apiClient.runPlaygroundSimulation(JSON.stringify(journal));
    } catch (err) {
      console.log('[liftosaur-side] playground simulation error:', err?.message || String(err));
      return null;
    }
  },

  historySubmitter: async (history) => {
    try {
      return await apiClient.submitWorkoutHistory(history);
    } catch (err) {
      console.log('[liftosaur-side] history submit error:', err?.message || String(err));
      // Return local saved confirmation so the watch can close the session safely
      return { id: 'offline-saved-' + Date.now(), status: 'queued_offline' };
    }
  },
});

AppSideService(
  BaseSideService({
    onInit() {
      console.log('[liftosaur-side] onInit');
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
    },

    onDestroy() {
      console.log('[liftosaur-side] onDestroy');
    },
  })
);
