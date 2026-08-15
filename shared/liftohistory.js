/**
 * Liftohistory reader and writer.
 *
 * Liftohistory is the documented text format Liftosaur Cloud uses for workout
 * records. It is produced by `POST /api/v1/playground` (field `workout`) and by
 * `GET /api/v1/history` (field `records[].text`), and it is accepted by
 * `POST /api/v1/history` (field `text`).
 *
 * Grammar implemented here, taken from the published format reference:
 *
 *   <date> / program: "<name>" / dayName: "<name>" / week: N / dayInWeek: N /
 *   duration: Ns / exercises: {
 *     <Exercise>[, <Equipment>] / <completed sets> / warmup: <sets> / target: <sets>
 *   }
 *
 * Set group notation:
 *   3x8 185lb              three sets of eight at 185lb
 *   3x8-12 185lb           rep range
 *   1x5+ 185lb             AMRAP
 *   3x8 185lb @7           with RPE
 *   3x8 185lb @8+          RPE was logged by the user
 *   3x8|7 0lb              unilateral: eight right, seven left
 *   3x8 185lb @8 90s       target sets carry the rest timer
 *
 * This module performs no interpretation beyond the grammar: it never guesses a
 * weight, a day or an exercise. Whatever the API did not state stays null.
 */

const SET_GROUP_RE = new RegExp(
  '^' +
    '(?:([0-9]+)\\s*x\\s*)?' + //        1 set count
    '([0-9]+)' + //                      2 reps
    '(?:-([0-9]+))?' + //                3 max reps of a range
    '(?:\\|([0-9]+))?' + //              4 reps of the weaker side (unilateral)
    '(\\+)?' + //                        5 AMRAP marker
    '(?:\\s+([0-9]*\\.?[0-9]+)\\s*(kg|lb|lbs|%)(\\+)?)?' + // 6 weight or percent 7 unit 8 ask-weight marker
    '(?:\\s*@\\s*([0-9]*\\.?[0-9]+)(\\+)?)?' + //           9 RPE 10 logged marker
    '(?:\\s+([0-9]+)\\s*s\\b)?' + //     11 rest timer
    '(?:\\s*\\(([^)]*)\\))?' + //        12 label
    '\\s*$'
);

/** Splits on ` / ` only, so exercise names containing a slash stay intact. */
function splitOnSlash(line) {
  return line
    .split(' / ')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseSetGroup(raw) {
  const match = String(raw).trim().match(SET_GROUP_RE);
  if (!match) return null;

  const count = match[1] ? parseInt(match[1], 10) : 1;
  const reps = parseInt(match[2], 10);
  if (!Number.isFinite(reps) || !Number.isFinite(count) || count < 1) return null;

  const isPercent = match[7] === '%';
  const rawNum = match[6] !== undefined ? parseFloat(match[6]) : null;

  return {
    count,
    reps,
    maxReps: match[3] ? parseInt(match[3], 10) : null,
    repsLeft: match[4] ? parseInt(match[4], 10) : null,
    isAmrap: Boolean(match[5]),
    percent: isPercent ? rawNum : null,
    weight: !isPercent ? rawNum : null,
    unit: match[7] ? (match[7] === '%' ? null : match[7] === 'lbs' ? 'lb' : match[7]) : null,
    askWeight: Boolean(match[8]),
    rpe: match[9] !== undefined ? parseFloat(match[9]) : null,
    isRpeLogged: Boolean(match[10]),
    restSeconds: match[11] ? parseInt(match[11], 10) : null,
    label: match[12] ? match[12].trim() : null,
  };
}

/** `3x8 100kg, 1x8+ 100kg @9` -> two groups. */
export function parseSetGroups(section) {
  if (!section) return [];
  const groups = [];
  for (const chunk of String(section).split(',')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const group = parseSetGroup(trimmed);
    if (group) {
      groups.push(group);
    }
  }
  return groups;
}

/** Expands `3x8 100kg` into three individual sets. */
export function expandSetGroups(groups) {
  const sets = [];
  for (const group of groups) {
    for (let i = 0; i < group.count; i++) {
      sets.push({
        reps: group.reps,
        maxReps: group.maxReps,
        repsLeft: group.repsLeft,
        isAmrap: group.isAmrap,
        percent: group.percent ?? null,
        weight: group.weight,
        unit: group.unit,
        askWeight: group.askWeight,
        rpe: group.rpe,
        isRpeLogged: group.isRpeLogged,
        restSeconds: group.restSeconds,
        label: group.label,
      });
    }
  }
  return sets;
}

function parseExerciseLine(line) {
  const parts = splitOnSlash(line);
  if (parts.length === 0) return null;

  const nameAndEquipment = parts[0];
  const commaIndex = nameAndEquipment.indexOf(',');
  const name = (commaIndex === -1 ? nameAndEquipment : nameAndEquipment.slice(0, commaIndex)).trim();
  const equipment = commaIndex === -1 ? null : nameAndEquipment.slice(commaIndex + 1).trim() || null;
  if (!name) return null;

  const exercise = {
    name,
    equipment,
    // Custom exercises may carry a comma in their own name ("Romanian Deadlift,
    // Barebell"), in which case the split above is wrong. The raw label is kept
    // so equipment lookups can try it verbatim.
    fullName: nameAndEquipment.trim(),
    completedGroups: [],
    warmupGroups: [],
    targetGroups: [],
  };

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (/^warmup\s*:/i.test(part)) {
      exercise.warmupGroups = parseSetGroups(part.replace(/^warmup\s*:/i, ''));
    } else if (/^target\s*:/i.test(part)) {
      exercise.targetGroups = parseSetGroups(part.replace(/^target\s*:/i, ''));
    } else {
      exercise.completedGroups = exercise.completedGroups.concat(parseSetGroups(part));
    }
  }

  return exercise;
}

function parseHeader(headerLine) {
  const parts = splitOnSlash(headerLine.replace(/exercises\s*:\s*\{\s*$/i, '').trim());
  const header = {
    date: null,
    programName: null,
    dayName: null,
    week: null,
    dayInWeek: null,
    durationSeconds: null,
  };

  for (const part of parts) {
    const keyed = part.match(/^([A-Za-z]+)\s*:\s*(.*)$/);
    if (!keyed) {
      if (header.date === null) {
        header.date = part.trim();
      }
      continue;
    }

    const key = keyed[1].toLowerCase();
    const value = keyed[2].trim().replace(/^"(.*)"$/, '$1');

    if (key === 'program') header.programName = value;
    else if (key === 'dayname') header.dayName = value;
    else if (key === 'week') header.week = parseInt(value, 10) || null;
    else if (key === 'dayinweek') header.dayInWeek = parseInt(value, 10) || null;
    else if (key === 'duration') header.durationSeconds = parseInt(value, 10) || null;
  }

  return header;
}

/**
 * Parses one Liftohistory record.
 * Returns null when the text carries no `exercises: {` block at all.
 */
export function parseLiftohistoryRecord(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;

  const lines = text.split('\n');
  let headerLine = null;
  let bodyStart = -1;

  for (let i = 0; i < lines.length; i++) {
    if (/exercises\s*:\s*\{/i.test(lines[i])) {
      headerLine = lines[i];
      bodyStart = i + 1;
      break;
    }
  }

  if (headerLine === null) return null;

  const record = parseHeader(headerLine);
  record.notes = [];
  record.exercises = [];

  // A `//` line before the header is the workout's own note.
  record.workoutNote =
    lines
      .slice(0, bodyStart - 1)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('//'))
      .map((line) => line.replace(/^\/\/\s*/, ''))
      .join('\n') || null;

  // Inside the block, a `//` line belongs to the exercise it precedes. Notes
  // with no exercise after them stay on the record.
  let pendingNotes = [];

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '}' || line === '') continue;
    if (line.startsWith('//')) {
      const note = line.replace(/^\/\/\s*/, '');
      pendingNotes.push(note);
      record.notes.push(note);
      continue;
    }
    const exercise = parseExerciseLine(line);
    if (exercise) {
      exercise.note = pendingNotes.length > 0 ? pendingNotes.join('\n') : null;
      record.exercises.push(exercise);
    }
    pendingNotes = [];
  }

  return record;
}

/**
 * Gathers the notes past workouts carry for each exercise, most recent first.
 *
 * These are the comments written during a session in the Liftosaur app - "belt
 * too loose", "left shoulder complained" - and they are worth reading again the
 * next time the same exercise comes up.
 *
 * Records are read in the order given, which `GET /history` returns newest
 * first. Both the exercise name alone and the full `Name, Equipment` label are
 * keyed, since either spelling can reach this from a day plan.
 *
 * @param {Array<string>} recordTexts raw `records[].text` from GET /history
 * @param {{maxPerExercise?: number}} options
 * @returns {Map<string, Array<{date: string|null, note: string}>>} keyed by lowercased name
 */
export function collectExerciseNotes(recordTexts, { maxPerExercise = 3 } = {}) {
  const byName = new Map();

  const add = (key, entry) => {
    if (!key) return;
    const list = byName.get(key) || [];
    if (list.length >= maxPerExercise) return;
    // The same note repeated across sessions is read once.
    if (list.some((existing) => existing.note === entry.note)) return;
    list.push(entry);
    byName.set(key, list);
  };

  for (const text of recordTexts || []) {
    const record = parseLiftohistoryRecord(text);
    if (!record) continue;

    for (const exercise of record.exercises) {
      if (!exercise.note) continue;
      const entry = { date: record.date || null, note: exercise.note };
      add(normalizeNoteKey(exercise.name), entry);
      if (exercise.fullName && exercise.fullName !== exercise.name) {
        add(normalizeNoteKey(exercise.fullName), entry);
      }
    }
  }

  return byName;
}

function normalizeNoteKey(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function formatDateForHistory(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Overrides header fields of an already serialized record, leaving the
 * `exercises: { ... }` block byte-for-byte intact.
 *
 * The playground serializes a record with its own clock and without a duration,
 * because it has no notion of when the watch actually started or how long the
 * session ran. Those two facts are the watch's to state.
 */
export function rewriteRecordHeader(
  text,
  {
    date = null,
    durationSeconds = null,
    programName = null,
    dayName = null,
    week = null,
    dayInWeek = null,
  } = {}
) {
  if (typeof text !== 'string') return text;

  const lines = text.split('\n');
  const headerIndex = lines.findIndex((line) => /exercises\s*:\s*\{/i.test(line));
  if (headerIndex === -1) return text;

  const header = parseHeader(lines[headerIndex]);
  const parts = [];

  const resolvedDate =
    date instanceof Date || typeof date === 'number'
      ? formatDateForHistory(date)
      : typeof date === 'string'
        ? date
        : header.date;
  if (resolvedDate) parts.push(resolvedDate);

  const resolvedProgram = programName || header.programName;
  if (resolvedProgram) parts.push(`program: "${resolvedProgram}"`);

  const resolvedDayName = dayName || header.dayName;
  if (resolvedDayName) parts.push(`dayName: "${resolvedDayName}"`);

  const resolvedWeek = week !== null && week !== undefined ? week : header.week;
  if (resolvedWeek !== null && resolvedWeek !== undefined) parts.push(`week: ${resolvedWeek}`);

  const resolvedDayInWeek =
    dayInWeek !== null && dayInWeek !== undefined ? dayInWeek : header.dayInWeek;
  if (resolvedDayInWeek !== null && resolvedDayInWeek !== undefined) {
    parts.push(`dayInWeek: ${resolvedDayInWeek}`);
  }

  const resolvedDuration =
    durationSeconds !== null && durationSeconds !== undefined
      ? Math.max(0, Math.round(durationSeconds))
      : header.durationSeconds;
  if (resolvedDuration !== null && resolvedDuration !== undefined) {
    parts.push(`duration: ${resolvedDuration}s`);
  }

  parts.push('exercises: {');
  lines[headerIndex] = parts.join(' / ');
  return lines.join('\n');
}

