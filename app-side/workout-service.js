/**
 * Stateless Workout Service.
 *
 * Side Service may be destroyed between operations. This service delegates
 * catalog operations to the catalog service and workout runtime operations
 * directly to the Liftosaur API client. Read responses also carry exercise
 * customizations and recent session comments for the watch details screen.
 * It performs no workout guessing, write retry, or conflict resolution. The settings
 * response also carries the phone-owned display preference used by the watch.
 * Workout replies carry the gym equipment of each plate-loaded or fixed-weight
 * exercise, so the watch can break down a weight the lifter edits.
 */

import { createWorkoutDetailsLoader } from './workout-details.js';
import { normalizeGetReadySeconds } from '../shared/timed-settings.js';
import { normalizeExerciseImages } from '../shared/exercise-images.js';
import { normalizeWorkoutDisplaySettings } from '../shared/workout-display-settings.js';
import { parseWeightString, resolveEquipmentId } from '../shared/weight-rounding.js';
import { withRequestTimeout } from '../shared/request-timeout.js';

const LOADED_TYPES = ['plates', 'fixed'];

function round5(value) {
  return Math.round(value * 100000) / 100000;
}

function entryLoading(entry) {
  for (const set of [...(entry.warmupSets || []), ...(entry.sets || [])]) {
    const loading = set?.loading;
    if (LOADED_TYPES.includes(loading?.instruction?.type) && typeof loading.unit === 'string') return loading;
  }
  return null;
}

function weightsIn(values, unit) {
  return (values || [])
    .map((value) => parseWeightString(value, unit))
    .filter((parsed) => parsed && parsed.unit === unit && parsed.value > 0)
    .map((parsed) => round5(parsed.value));
}

/**
 * The part of one `GET /gyms/:id/equipment` item the watch needs, in the
 * workout's unit only, or null when it does not match how the server loads the
 * set. The flat `bar`, `multiplier`, `plates` and `fixed` fields are the
 * documented view derived from `setup`; a fixed setup's plain `values` are
 * added because a custom fixed equipment may list its weights only there.
 */
function compactEquipment(item, loading) {
  if (!item || item.isDeleted) return null;
  const unit = loading.unit.trim().toLowerCase() === 'lbs' ? 'lb' : loading.unit.trim().toLowerCase();
  const { instruction } = loading;

  if (instruction.type === 'fixed') {
    if (!item.isFixed) return null;
    const setupValues = item.setup?.type === 'fixed' && item.setup.unit === unit && Array.isArray(item.setup.values)
      ? item.setup.values.map((value) => `${value}${unit}`)
      : [];
    const fixed = [...new Set(weightsIn([...(item.fixed || []), ...setupValues], unit))].sort((a, b) => a - b);
    return fixed.length ? { unit, fixed } : null;
  }

  const sides = item.multiplier || 1;
  const bar = parseWeightString(item.bar?.[unit], unit);
  if (item.isFixed || !bar || bar.unit !== unit || sides !== instruction.sides) return null;
  const plates = (item.plates || [])
    .map((plate) => [weightsIn([plate?.weight], unit)[0], Number(plate?.num)])
    .filter(([weight, num]) => weight && Number.isInteger(num) && num > 0)
    .sort((a, b) => b[0] - a[0]);
  return { unit, bar: round5(bar.value), sides, plates };
}

/**
 * Adds `gymEquipment` (deduplicated compact equipment) to the workout and the
 * index into it to each loaded entry. Entries it cannot vouch for are left
 * alone, so the watch falls back to the plates the server proposed.
 */
export function attachGymEquipment(workout, { currentGymId = null, equipment = [], exerciseData = [] } = {}) {
  if (!Array.isArray(workout?.entries)) return workout;
  const byId = new Map(equipment.filter((item) => item?.id).map((item) => [item.id, item]));
  const table = [];
  const indexByKey = new Map();
  const entries = workout.entries.map((entry) => {
    const loading = entryLoading(entry);
    if (!loading) return entry;
    const data = exerciseData.find((item) => item?.key === entry.exerciseId) || null;
    const id = (data ? resolveEquipmentId({ exerciseData: data, currentGymId }) : null)
      || entry.equipment
      || resolveEquipmentId({ exerciseKey: entry.exerciseId });
    const compact = compactEquipment(byId.get(id), loading);
    if (!compact) return entry;
    const key = JSON.stringify(compact);
    if (!indexByKey.has(key)) {
      indexByKey.set(key, table.length);
      table.push(compact);
    }
    return { ...entry, gymEquipment: indexByKey.get(key) };
  });
  return table.length ? { ...workout, gymEquipment: table, entries } : workout;
}

/**
 * Reads the account's equipment once per running workout: a new start time
 * reads it again, every other reply reuses it. A failure is kept for that
 * workout too, so a missing endpoint never turns into a request per poll.
 */
function createGymEquipmentLoader({ client, timeoutMs = 3000, setTimer, clearTimer }) {
  let loadedFor;
  let pending = null;

  async function fetchSource() {
    if (typeof client?.listGyms !== 'function' || typeof client.listEquipment !== 'function') return null;
    const { currentGymId } = await client.listGyms();
    if (!currentGymId) return null;
    const [equipment, exerciseData] = await Promise.all([
      client.listEquipment(currentGymId),
      typeof client.listExerciseData === 'function' ? client.listExerciseData() : [],
    ]);
    return {
      currentGymId,
      equipment: Array.isArray(equipment) ? equipment : [],
      exerciseData: Array.isArray(exerciseData) ? exerciseData : [],
    };
  }

  return async (result) => {
    const workout = result?.workout;
    if (!Array.isArray(workout?.entries) || !workout.entries.some(entryLoading)) return result;
    const startTime = workout.startTime ?? null;
    if (!pending || (startTime !== null && startTime !== loadedFor)) {
      loadedFor = startTime;
      pending = withRequestTimeout(Promise.resolve().then(fetchSource), { timeoutMs, setTimer, clearTimer })
        .catch(() => null);
    }
    const source = await pending;
    return source ? { ...result, workout: attachGymEquipment(workout, source) } : result;
  };
}

export function createWorkoutService({ client, catalogService, getLocalSettings = null } = {}) {
  const enrichDetails = createWorkoutDetailsLoader({ client });
  const attachEquipment = createGymEquipmentLoader({ client });
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
      return attachEquipment(await enrichDetails(await client.getNextWorkout(selection)));
    },

    async getCurrentWorkout() {
      return attachEquipment(await enrichDetails(await client.getCurrentWorkout()));
    },

    async startWorkout(payload) {
      return attachEquipment(await client.startRunningWorkout(payload));
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
        ...normalizeWorkoutDisplaySettings(local),
      };
    },
  };
}
