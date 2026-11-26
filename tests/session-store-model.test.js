/**
 * Seeded random workouts against the real watch file adapter over a fake `@zos/fs` that fails in
 * every way its typings allow (see helpers/fake-zos-fs.js), with reboots after every death and at
 * random. After each reboot the restored session must be the last confirmed save or one attempted
 * since, null only after a clear, and a store with a file that does not read must say so and leave
 * every file as it was until a later launch reads it.
 *
 * SEQUENCES per fault kind keeps `npm test` fast; raise it locally to search further.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionStore, createWatchFileAdapter, SESSION_UNREADABLE } from '../shared/session-storage.js';
import { createFakeZosFs, seeded } from './helpers/fake-zos-fs.js';

const SEQUENCES = Number(process.env.SESSION_MODEL_SEQUENCES) || 25;

const WRITE_FAULTS = ['crash', 'torn', 'zero', 'oldSuffix', 'throw', 'throwPartial', 'noop'];
const APPEND_FAULTS = [...WRITE_FAULTS, 'twice', 'short'];
const REMOVE_FAULTS = ['crash', 'rmFails', 'rmLies'];
// One fault per sequence, at a random operation; `multi` spreads faults over every operation
// (without the lying stat, which no check short of reading can see when it hides two failures).
const KINDS = [...new Set([...APPEND_FAULTS, ...REMOVE_FAULTS]), 'unreadable', 'multi'];

const canonical = (value) => (Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value));
const keyOf = (snapshot) => (snapshot
  ? canonical({ p: snapshot.plan.id, j: snapshot.journal, s: snapshot.sync, t: snapshot.startedAt })
  : 'null');

function faultsFor(kind, rnd) {
  if (kind === 'unreadable') return () => null;
  if (kind === 'multi') {
    return ({ kind: op }) => {
      if (rnd() >= 0.03) return null;
      const pool = op === 'remove' ? ['crash', 'rmFails'] : op === 'append' ? APPEND_FAULTS : WRITE_FAULTS;
      return pool[Math.floor(rnd() * pool.length)];
    };
  }
  const at = 1 + Math.floor(rnd() * 150);
  let fired = false;
  return ({ kind: op, index }) => {
    if (fired || index < at) return null;
    const pool = op === 'remove' ? REMOVE_FAULTS : op === 'append' ? APPEND_FAULTS : WRITE_FAULTS;
    if (!pool.includes(kind)) return null;
    fired = true;
    return kind;
  };
}

/** Returns null, or what went wrong. */
function runSequence(seed, kind) {
  const rnd = seeded(seed);
  const fs = createFakeZosFs({ rnd });
  fs.fault = faultsFor(kind, rnd);
  const legacy = { value: null, read: () => legacy.value, remove: () => { legacy.value = null; } };
  const open = () => createSessionStore(createWatchFileAdapter(fs), { legacy });
  let planId = 1;
  const newPlan = () => ({ id: planId++, source: 'WORKOUT_API', pad: 'x'.repeat(500 + Math.floor(rnd() * 4000)) });

  let plan = newPlan();
  let journal = [];
  let sync = { mode: 'DIRECT', acknowledgedSetCount: 0 };
  let startedAt = null;
  let confirmed = 'null';
  let candidates = new Set(['null']);
  const adopt = (snapshot) => {
    if (snapshot) ({ plan, journal, sync, startedAt } = snapshot);
    else {
      plan = newPlan();
      journal = [];
      sync = { mode: 'DIRECT', acknowledgedSetCount: 0 };
      startedAt = null;
    }
    confirmed = keyOf(snapshot);
    candidates = new Set([confirmed]);
  };
  if (rnd() < 0.3) {
    journal = [{ type: 'COMPLETE_SET', n: 0 }];
    startedAt = 5;
    legacy.value = JSON.stringify({ version: 2, plan, journal, startedAt, sync });
    confirmed = keyOf({ plan, journal, sync, startedAt });
    candidates = new Set([confirmed]);
  }
  let store = open();

  function reboot(step) {
    fs.reboot();
    let blockedBy = null;
    const present = [...fs.files.keys()].filter((name) => fs.files.get(name).length > 0);
    if (kind === 'unreadable' && present.length && rnd() < 0.6) {
      blockedBy = present[Math.floor(rnd() * present.length)];
      fs.unreadable.add(blockedBy);
    }
    store = open();
    if (blockedBy) {
      const before = new Map(fs.files);
      const legacyBefore = legacy.value;
      try {
        store.load();
        return `step ${step}: ${blockedBy} did not read and load() did not say so`;
      } catch (err) {
        if (err.code !== SESSION_UNREADABLE) throw err;
      }
      const other = { plan: newPlan(), journal: [{ type: 'COMPLETE_SET', n: -1 }], sync: { mode: 'DIRECT' }, startedAt: 1 };
      if (store.save(other) !== false) return `step ${step}: a save over an unread store reported success`;
      store.clear();
      store.save({ ...other, journal: [...other.journal, { type: 'TAP', n: -2 }] });
      const changed = [...new Set([...before.keys(), ...fs.files.keys()])].filter((name) => before.get(name) !== fs.files.get(name));
      if (changed.length || legacy.value !== legacyBefore) return `step ${step}: an unread store was changed: ${changed.join(', ')}`;
      fs.unreadable.clear();
      store = open();
    }
    const restored = store.load();
    const key = keyOf(restored);
    if (!candidates.has(key)) {
      return `step ${step}: restored ${key.slice(0, 120)}, confirmed ${confirmed.slice(0, 120)}`;
    }
    adopt(restored);
    if (restored) store.save(restored);
    return null;
  }

  const first = reboot(-1);
  if (first) return first;
  const steps = 40 + Math.floor(rnd() * 160);
  let event = 1;
  for (let step = 0; step < steps; step++) {
    const roll = rnd();
    let op = 'save';
    if (roll < 0.5) journal = [...journal, { type: 'TAP', n: event++, w: Math.floor(rnd() * 200) }];
    else if (roll < 0.58 && journal.length) journal = [...journal.slice(0, -1), { ...journal.at(-1), w: -1, c: event++ }];
    else if (roll < 0.62 && journal.length) journal = journal.slice(0, -1);
    else if (roll < 0.7) sync = { ...sync, acknowledgedSetCount: sync.acknowledgedSetCount + 1, preservedIntervals: [[0, step]] };
    else if (roll < 0.72) {
      const { remoteMissing, ...rest } = sync;
      sync = remoteMissing ? rest : { ...sync, remoteMissing: true };
    } else if (roll < 0.74) startedAt = 1000 + step;
    else if (roll < 0.78) plan = newPlan();
    else if (roll < 0.8) op = 'clear';
    else if (roll < 0.83) op = 'load';
    else if (roll < 0.86) op = 'reboot';

    if (op === 'load') {
      const key = keyOf(store.load());
      if (!candidates.has(key)) return `step ${step}: load() mid-run gave ${key.slice(0, 120)}`;
      continue;
    }
    if (op === 'clear') {
      candidates.add('null');
      const gone = store.clear();
      if (gone === true && !fs.dead) {
        adopt(null);
      }
    } else if (op === 'save') {
      const snapshot = { plan, journal, sync, startedAt };
      const key = keyOf(snapshot);
      candidates.add(key);
      if (store.save(snapshot) === true && !fs.dead) {
        confirmed = key;
        candidates = new Set([key]);
      }
    }
    if (fs.dead || op === 'reboot') {
      const failure = reboot(step);
      if (failure) return failure;
    }
  }
  return reboot('end');
}

for (const kind of KINDS) {
  test(`session store model: ${kind}`, (t) => {
    t.mock.method(console, 'log', () => {});
    for (let index = 0; index < SEQUENCES; index++) {
      const seed = 7919 * (index + 1) + kind.length * 104729;
      const failure = runSequence(seed, kind);
      assert.equal(failure, null, `seed ${seed}`);
    }
  });
}
