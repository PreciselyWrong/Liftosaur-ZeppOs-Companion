import { parseLiftohistoryRecord } from '../shared/liftohistory.js';
import { normalizeName } from '../shared/name.js';
import { withRequestTimeout } from '../shared/request-timeout.js';

function cachedSource(load, now, timeout) {
  let pending = null;
  let value;
  let expiresAt = -Infinity;
  return () => {
    if (now() < expiresAt) return Promise.resolve(value);
    if (!pending) {
      pending = withRequestTimeout(Promise.resolve().then(load), timeout).then((result) => {
        value = result;
        expiresAt = now() + 120000;
        return result;
      }).finally(() => { pending = null; });
    }
    return pending;
  };
}

function exerciseNotes(data, entry) {
  if (!entry.exerciseId) return '';
  const matches = data.filter((item) => item?.key === entry.exerciseId);
  return matches.length === 1 && typeof matches[0].notes === 'string' ? matches[0].notes.trim() : '';
}

function historyNotes(records, entry) {
  const name = normalizeName(entry.name);
  const equipment = normalizeName(entry.equipment);
  if (!name) return '';
  const seen = new Set();
  const lines = [];
  for (const record of records) {
    for (const exercise of record.exercises) {
      const note = exercise.note?.trim();
      if (!note || seen.has(note) || normalizeName(exercise.name) !== name
        || normalizeName(exercise.equipment) !== equipment) continue;
      seen.add(note);
      lines.push(`- ${record.date.slice(0, 10)}: ${note}`);
      if (lines.length === 3) return `Past sessions\n${lines.join('\n')}`;
    }
  }
  return lines.length ? `Past sessions\n${lines.join('\n')}` : '';
}

export function createWorkoutDetailsLoader({ client, now = Date.now, setTimer, clearTimer }) {
  const timeout = { timeoutMs: 3000, setTimer, clearTimer };
  const loadExercises = cachedSource(async () => {
    const data = await client.listExerciseData();
    if (!Array.isArray(data)) throw new Error('Invalid exercise details');
    return data;
  }, now, timeout);
  const loadHistory = cachedSource(async () => {
    const data = await client.listHistory({ limit: 20 });
    if (!Array.isArray(data?.records)) throw new Error('Invalid workout history');
    return data.records.slice(0, 20)
      .map((record) => parseLiftohistoryRecord(record?.text))
      .filter((record) => record && typeof record.date === 'string' && Number.isFinite(Date.parse(record.date)))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }, now, timeout);

  return async (result) => {
    const entries = result?.workout?.entries;
    if (!Array.isArray(entries) || !entries.length) return result;
    const [exercises, history] = await Promise.all([
      loadExercises().catch(() => null),
      loadHistory().catch(() => null),
    ]);
    return {
      ...result,
      workout: {
        ...result.workout,
        entries: entries.map((entry) => ({
          ...entry,
          exerciseNotes: exercises !== null ? exerciseNotes(exercises, entry) : null,
          historyNotes: history !== null ? historyNotes(history, entry) : null,
        })),
      },
    };
  };
}
