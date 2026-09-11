/**
 * Stateless Workout Service.
 *
 * Side Service may be destroyed between operations. This service delegates
 * catalog operations to the catalog service and workout runtime operations
 * directly to the Liftosaur API client. Read responses also carry exercise
 * customizations and recent session comments for the watch details screen.
 * It performs no workout guessing, write retry, or conflict resolution. The settings
 * response also carries the phone-owned display preference used by the watch.
 */

import { createWorkoutDetailsLoader } from './workout-details.js';
import { normalizeGetReadySeconds } from '../shared/timed-settings.js';
import { normalizeExerciseImages } from '../shared/exercise-images.js';

export function createWorkoutService({ client, catalogService, getLocalSettings = null } = {}) {
  const enrichDetails = createWorkoutDetailsLoader({ client });
  return {
    get mode() {
      return catalogService?.mode || 'CLOUD';
    },

    async listPrograms() {
      return catalogService.listPrograms();
    },

    async getProgramOutline(programId) {
      return catalogService.getProgramOutline(programId);
    },

    async getNextWorkout(selection) {
      return enrichDetails(await client.getNextWorkout(selection));
    },

    async getCurrentWorkout() {
      return enrichDetails(await client.getCurrentWorkout());
    },

    async startWorkout(payload) {
      return client.startRunningWorkout(payload);
    },

    async syncWorkoutSets(sets) {
      return client.logWorkoutSets(sets);
    },

    async finishWorkout(payload) {
      return client.finishRunningWorkout(payload);
    },

    async discardWorkout(startTime) {
      return client.discardCurrentWorkout(startTime);
    },

    async getSettings() {
      const remote = await client.getSettings();
      const local = typeof getLocalSettings === 'function' ? getLocalSettings() : null;
      return {
        ...remote,
        screenOnDuration: local?.screenOnDuration ?? 120,
        getReadySeconds: normalizeGetReadySeconds(local?.getReadySeconds),
        exerciseImages: normalizeExerciseImages(local?.exerciseImages),
      };
    },
  };
}
