/**
 * Stateless Workout Service.
 *
 * Side Service may be destroyed between operations. This service delegates
 * catalog operations to the catalog service and workout runtime operations
 * directly to the Liftosaur API client.
 * It performs no guessing, retry, caching, reshaping, or conflict resolution.
 */

export function createWorkoutService({ client, catalogService } = {}) {
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
      return client.getNextWorkout(selection);
    },

    async getCurrentWorkout() {
      return client.getCurrentWorkout();
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
      return client.getSettings();
    },
  };
}
