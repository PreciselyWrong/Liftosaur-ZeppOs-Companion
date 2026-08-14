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

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '}' || line === '') continue;
    if (line.startsWith('//')) {
      record.notes.push(line.replace(/^\/\/\s*/, ''));
      continue;
    }
    const exercise = parseExerciseLine(line);
    if (exercise) {
      record.exercises.push(exercise);
    }
  }

  return record;
}

export function formatDateForHistory(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const YYYY = d.getUTCFullYear();
  const MM = pad(d.getUTCMonth() + 1);
  const DD = pad(d.getUTCDate());
  const HH = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss} +00:00`;
}

/**
 * Overrides header fields of an already serialized record, leaving the
 * `exercises: { ... }` block byte-for-byte intact.
 *
 * The playground serializes a record with its own clock and without a duration,
 * because it has no notion of when the watch actually started or how long the
 * session ran. Those two facts are the watch's to state.
 */
export function rewriteRecordHeader(text, { date = null, durationSeconds = null } = {}) {
  if (typeof text !== 'string') return text;

  const lines = text.split('\n');
  const headerIndex = lines.findIndex((line) => /exercises\s*:\s*\{/i.test(line));
  if (headerIndex === -1) return text;

  const header = parseHeader(lines[headerIndex]);
  const parts = [];

  const resolvedDate = date instanceof Date || typeof date === 'number'
    ? formatDateForHistory(date)
    : (typeof date === 'string' ? date : header.date);
  if (resolvedDate) parts.push(resolvedDate);
  if (header.programName) parts.push(`program: "${header.programName}"`);
  if (header.dayName) parts.push(`dayName: "${header.dayName}"`);
  if (header.week !== null) parts.push(`week: ${header.week}`);
  if (header.dayInWeek !== null) parts.push(`dayInWeek: ${header.dayInWeek}`);

  const resolvedDuration = durationSeconds !== null && durationSeconds !== undefined
    ? Math.max(0, Math.round(durationSeconds))
    : header.durationSeconds;
  if (resolvedDuration !== null && resolvedDuration !== undefined) {
    parts.push(`duration: ${resolvedDuration}s`);
  }

  parts.push('exercises: {');
  lines[headerIndex] = parts.join(' / ');
  return lines.join('\n');
}

