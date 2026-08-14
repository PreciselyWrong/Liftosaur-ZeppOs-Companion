/**
 * Account reference data: gyms, equipment and per-exercise settings.
 *
 * This changes rarely, so it is fetched once and reused for the life of the
 * Side Service. It answers one question the playground cannot: what weight can
 * this exercise actually be loaded with, so a `warmup: 1x8 40%` becomes a real
 * number instead of a percentage.
 *
 * Matching an exercise to its settings is the risky part - `Bench Press` exists
 * for barbell and for dumbbell. When the equipment cannot be pinned down the
 * lookup returns `ambiguous`, and the caller shows the percentage rather than a
 * weight that might be wrong.
 */

import { roundToLoadable, resolveEquipmentId } from '../shared/weight-rounding.js';

function normalizeName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function createReferenceData({ client } = {}) {
  if (!client) throw new Error('createReferenceData requires a Liftosaur API client');

  let cache = null;
  let inFlight = null;

  function index({ currentGymId, equipment, exerciseData }) {
    const equipmentById = new Map();
    for (const item of equipment) {
      if (item && item.id) equipmentById.set(item.id, item);
    }

    const byName = new Map();
    for (const entry of exerciseData) {
      const key = normalizeName(entry.exerciseName);
      if (!key) continue;
      const list = byName.get(key) || [];
      list.push(entry);
      byName.set(key, list);
    }

    return { currentGymId, equipmentById, exerciseDataByName: byName, fetchedAt: Date.now() };
  }

  /**
   * One round of fetching, shared by concurrent callers. A failure is not
   * cached: the next workout tries again.
   */
  function load({ force = false } = {}) {
    if (cache && !force) return Promise.resolve(cache);
    if (inFlight) return inFlight;

    inFlight = client
      .listGyms()
      .then(({ currentGymId }) =>
        Promise.all([
          currentGymId ? client.listEquipment(currentGymId) : Promise.resolve([]),
          client.listExerciseData(),
        ]).then(([equipment, exerciseData]) => index({ currentGymId, equipment, exerciseData }))
      )
      .then((indexed) => {
        cache = indexed;
        inFlight = null;
        return cache;
      })
      .catch((err) => {
        inFlight = null;
        throw err;
      });

    return inFlight;
  }

  return {
    load,

    isLoaded: () => cache !== null,

    /** Test seam and manual refresh. */
    reset() {
      cache = null;
      inFlight = null;
    },

    /**
     * Settings for one exercise as it appears in a Liftohistory line.
     * `ambiguous` is true when several exercises share the name and nothing
     * distinguishes them.
     */
    lookupExercise(exerciseName, equipmentName = null) {
      if (!cache) return { found: false, ambiguous: false, data: null, equipment: null };

      const candidates = cache.exerciseDataByName.get(normalizeName(exerciseName)) || [];
      const wanted = equipmentName ? resolveEquipmentId({ equipmentName }) : null;

      let data = null;
      let ambiguous = false;

      if (candidates.length === 1) {
        data = candidates[0];
      } else if (candidates.length > 1) {
        const matches = wanted
          ? candidates.filter(
              (entry) =>
                resolveEquipmentId({
                  exerciseData: entry,
                  exerciseKey: entry.key,
                  currentGymId: cache.currentGymId,
                }) === wanted
            )
          : [];

        if (matches.length === 1) {
          data = matches[0];
        } else {
          ambiguous = true;
        }
      }

      const equipmentId = resolveEquipmentId({
        exerciseData: data,
        exerciseKey: data?.key ?? null,
        equipmentName,
        currentGymId: cache.currentGymId,
      });

      return {
        found: data !== null,
        ambiguous,
        data,
        equipmentId,
        equipment: equipmentId ? cache.equipmentById.get(equipmentId) || null : null,
      };
    },

    /**
     * Turns a target weight into one that can be loaded for this exercise.
     * Returns `resolved: false` whenever the answer would be a guess.
     */
    resolveWeight(exerciseName, equipmentName, target, unit = 'kg') {
      const lookup = this.lookupExercise(exerciseName, equipmentName);
      if (lookup.ambiguous || !lookup.equipment) {
        return { value: target, exact: false, resolved: false };
      }
      return roundToLoadable(target, lookup.equipment, unit);
    },

    resolveNotes(exerciseName) {
      if (!cache) return null;
      const candidates = cache.exerciseDataByName.get(normalizeName(exerciseName)) || [];
      for (const entry of candidates) {
        if (entry && entry.notes) return entry.notes;
      }
      return null;
    },
  };
}
