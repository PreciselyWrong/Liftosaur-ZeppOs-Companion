/**
 * Watch-to-phone test harness: the real Side Service router and workout
 * service in front of an in-memory model of the Liftosaur running-workout API,
 * reached through a scripted Bluetooth link the test controls message by
 * message. Each reply is JSON round-tripped like the real link.
 *
 * The cloud model is an assumption about the API, kept to the behavior the
 * watch relies on: start is idempotent for the same start time, set writes
 * are keyed by setId, finish and discard need the matching running workout.
 */

import { createSideRouter } from '../../app-side/router.js';
import { createWorkoutService } from '../../app-side/workout-service.js';
import { MESSAGE_TYPES, createMessage } from '../../shared/protocol.js';

export function createRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max) => Math.floor(next() * max),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}

function apiError(code, message = code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * Builds an API workout: `shape` lists [warmupCount, workCount, extraSetFields]
 * per exercise, for example `{ setTimer: 30, isUnilateral: true }`.
 */
export function buildApiWorkout(shape, { programId = 'prog-1', restSeconds = 60, unit = 'kg' } = {}) {
  return {
    programId,
    programName: 'Program',
    dayName: 'Day 1',
    dayData: { week: 1, dayInWeek: 1 },
    startTime: null,
    entries: shape.map(([warmups, works, extra = {}], exerciseIndex) => {
      const entryId = `entry-${exerciseIndex + 1}`;
      const set = (kind, index) => ({
        setId: `${entryId}-${kind}-${index + 1}`,
        index,
        isWarmup: kind === 'warmup',
        reps: 5,
        weight: `${kind === 'warmup' ? 20 : 60 + exerciseIndex}${unit}`,
        timer: restSeconds,
        ...extra,
        completed: null,
      });
      return {
        entryId,
        exerciseId: `exercise-${exerciseIndex + 1}`,
        name: `Exercise ${exerciseIndex + 1}`,
        warmupSets: Array.from({ length: warmups }, (_, i) => set('warmup', i)),
        sets: Array.from({ length: works }, (_, i) => set('work', i)),
      };
    }),
  };
}

/**
 * `strictStart`: a repeated start is refused even for the running workout's own start time.
 * `account`: `{ currentGymId, equipment, exerciseData }` answers GET /gyms, GET
 * /gyms/:id/equipment and GET /exercise-data; without it those endpoints are absent.
 */
export function createFakeCloud(template, { strictStart = false, account = null } = {}) {
  let current = null;
  let startCount = 0;
  const history = [];
  const log = [];

  const allSets = (workout) => workout.entries.flatMap((entry) => [...entry.warmupSets, ...entry.sets]);

  const client = {
    async getNextWorkout() {
      return { workout: clone(template) };
    },
    async getCurrentWorkout() {
      return { workout: clone(current) };
    },
    async startRunningWorkout({ startTime }) {
      if (current) {
        if (current.startTime === startTime) {
          if (strictStart) throw apiError('workout_start_time_taken');
          return { workout: clone(current) };
        }
        throw apiError('workout_already_active');
      }
      startCount += 1;
      current = clone(template);
      current.startTime = startTime;
      // The live workout gets its own set identifiers.
      for (const set of allSets(current)) set.setId = `live${startCount}-${set.setId}`;
      return { workout: clone(current) };
    },
    async logWorkoutSets(sets) {
      if (!current) throw apiError('no_active_workout');
      const byId = new Map(allSets(current).map((set) => [set.setId, set]));
      for (const write of sets) {
        if (!byId.has(write.setId)) throw apiError('set_not_found');
      }
      for (const write of sets) {
        byId.get(write.setId).completed = clone(write.completed);
        log.push(clone(write));
      }
      return { workout: clone(current) };
    },
    async finishRunningWorkout({ startTime, endTime, intervals }) {
      if (!current || current.startTime !== startTime) throw apiError('no_active_workout');
      history.push({ workout: clone(current), endTime, intervals: clone(intervals) });
      current = null;
      return { status: 'SAVED' };
    },
    async discardCurrentWorkout(startTime) {
      if (!current || current.startTime !== startTime) throw apiError('no_active_workout');
      current = null;
      return { deleted: true };
    },
    async listExerciseData() { return clone(account?.exerciseData || []); },
    ...(account ? {
      async listGyms() { return { currentGymId: account.currentGymId, gyms: [] }; },
      async listEquipment(gymId) { return gymId === account.currentGymId ? clone(account.equipment) : []; },
    } : {}),
    async listHistory() { return { records: [] }; },
    async getSettings() { return { units: 'kg' }; },
  };

  return {
    client,
    current: () => current,
    setCurrent: (workout) => { current = clone(workout); },
    history,
    log,
    completedSets: (workout = current) =>
      workout ? allSets(workout).filter((set) => set.completed) : [],
  };
}

/**
 * Bluetooth link between one watch controller and the phone. Requests queue
 * until the test delivers them, so replies can arrive late, out of order, or
 * never, while the lifter keeps tapping.
 */
export function createPhoneLink(cloud) {
  const router = createSideRouter({
    workoutService: createWorkoutService({ client: cloud.client, catalogService: null }),
  });
  const queue = [];
  const sent = [];
  let auto = false;

  async function phoneHandle(type, payload) {
    const reply = await router.handle(JSON.parse(JSON.stringify(createMessage({ type, payload }))));
    return JSON.parse(JSON.stringify(reply));
  }

  function settle(item, reply) {
    if (reply && reply.type === MESSAGE_TYPES.ERROR) {
      const err = new Error(reply.payload?.message || 'Liftosaur API error');
      err.code = reply.payload?.code;
      item.reject(err);
    } else {
      item.resolve(reply);
    }
  }

  function timeout() {
    const err = new Error('Phone request timeout');
    err.code = 'NETWORK';
    return err;
  }

  function request(type, payload = {}) {
    sent.push({ type, payload: clone(payload) });
    return new Promise((resolve, reject) => {
      const item = { type, payload: clone(payload), resolve, reject };
      if (auto) {
        phoneHandle(type, payload).then((reply) => settle(item, reply), reject);
      } else {
        queue.push(item);
      }
    });
  }

  return {
    request,
    sent,
    queue,
    phoneHandle,
    /** Answers every request immediately from now on. */
    setAuto(value) { auto = value; },
    /**
     * fate: 'ok' delivers, 'lost' never reaches the phone, 'noReply' reaches
     * the phone but the watch times out, 'late' times out now and reaches the
     * phone only when `flushLate` runs.
     */
    async deliver(index = 0, fate = 'ok', late = []) {
      const [item] = queue.splice(index, 1);
      if (!item) return null;
      if (fate === 'lost') item.reject(timeout());
      else if (fate === 'late') {
        item.reject(timeout());
        late.push(item);
      } else {
        const reply = await phoneHandle(item.type, item.payload);
        if (fate === 'noReply') item.reject(timeout());
        else settle(item, reply);
      }
      return item;
    },
    /** Drops every queued request as a dead link would. */
    failAll() {
      while (queue.length) queue.shift().reject(timeout());
    },
  };
}

export async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}
