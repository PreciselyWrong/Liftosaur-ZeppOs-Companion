/**
 * API-authoritative program service.
 *
 * Every workout fact the watch displays or writes back originates here, and
 * every one of them comes from Liftosaur Cloud:
 *
 *   - the program list           GET  /programs
 *   - the program source         GET  /programs/:id
 *   - the week and day list      read from the program's `#` / `##` headers,
 *                                then verified against the server's own echo
 *   - the day's prescription     POST /playground   (`target:` sections)
 *   - the progression            POST /playground   (`finish_workout()`)
 *   - the workout record         POST /history
 *
 * The service never decides which day comes next. It reports what the API
 * holds; the user chooses on the watch.
 */

import { parseProgramOutline, findOutlineDay, parseProgramDayExercises } from '../shared/liftoscript-outline.js';
import {
  buildDayPlan,
  buildProbeCommands,
  exerciseCountFromProbeError,
  buildWorkoutCommands,
  applyProgramMetadata,
} from '../shared/day-plan.js';
import { parseLiftohistoryRecord, rewriteRecordHeader } from '../shared/liftohistory.js';

const PROBE_CEILING = 32;
const PROBE_MAX_ATTEMPTS = 4;

export class ProgramServiceError extends Error {
  constructor(code, message, { status = 0 } = {}) {
    super(message);
    this.name = 'ProgramServiceError';
    this.code = code;
    this.status = status;
  }
}

/** FNV-1a: a stable fingerprint of the program text used for conflict checks. */
export function programVersion(text) {
  let hash = 0x811c9dc5;
  const str = String(text || '');
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function createProgramService({ client, referenceData = null } = {}) {
  if (!client) {
    throw new Error('createProgramService requires a Liftosaur API client');
  }

  /** programId -> { id, name, text, version } */
  const programCache = new Map();

  async function loadProgram(programId, { force = false } = {}) {
    if (!force && programCache.has(programId)) {
      return programCache.get(programId);
    }
    const data = await client.getProgram(programId);
    if (!data || typeof data.text !== 'string') {
      throw new ProgramServiceError('PROGRAM_UNAVAILABLE', `Program ${programId} returned no source text`);
    }
    const entry = {
      id: data.id || programId,
      name: data.name || null,
      text: data.text,
      isCurrent: Boolean(data.isCurrent),
      version: programVersion(data.text),
    };
    programCache.set(programId, entry);
    if (data.id && data.id !== programId) {
      programCache.set(data.id, entry);
    }
    return entry;
  }

  /**
   * Runs the day once per candidate exercise count until the playground itself
   * reports the first index that does not exist. That error is the only
   * authoritative statement of how many exercises the day holds.
   */
  async function probeDayPlan(programText, week, day) {
    let ceiling = PROBE_CEILING;

    for (let attempt = 0; attempt < PROBE_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await client.runPlayground({
          programText,
          week,
          day,
          commands: buildProbeCommands(ceiling),
        });
        // No index was rejected, so the day may hold even more exercises. The
        // last attempt keeps what it got rather than probing forever.
        if (attempt === PROBE_MAX_ATTEMPTS - 1) {
          return response;
        }
        ceiling *= 2;
      } catch (err) {
        const count = exerciseCountFromProbeError(err?.apiMessage || err?.message);
        if (count === null) throw err;
        return client.runPlayground({
          programText,
          week,
          day,
          commands: count > 0 ? buildProbeCommands(count) : [],
        });
      }
    }

    throw new ProgramServiceError('PLAN_UNREADABLE', 'Could not determine the exercises of this day');
  }

  return {
    /** The user's programs, active one flagged. No program is auto-selected. */
    async listPrograms() {
      const programs = await client.listPrograms();
      return programs.map((program) => ({
        id: program.id,
        name: program.name,
        isCurrent: Boolean(program.isCurrent),
      }));
    },

    /**
     * The week and day list of one program, plus the most recent workout the
     * account holds for it. The last workout is shown as information only: it
     * tells the user where they left off, it does not pick anything.
     */
    async getProgramOutline(programId, { historyLimit = 20 } = {}) {
      const program = await loadProgram(programId, { force: true });
      const outline = parseProgramOutline(program.text);

      let lastWorkout = null;
      try {
        const history = await client.listHistory({ limit: historyLimit });
        for (const entry of history.records) {
          const record = parseLiftohistoryRecord(entry.text);
          if (!record) continue;
          if (program.name && record.programName && record.programName !== program.name) continue;
          lastWorkout = {
            id: entry.id,
            date: record.date,
            dayName: record.dayName,
            week: record.week,
            dayInWeek: record.dayInWeek,
          };
          break;
        }
      } catch (err) {
        lastWorkout = null;
      }

      return {
        programId: program.id,
        programName: program.name,
        programVersion: program.version,
        totalWeeks: outline.totalWeeks,
        totalDays: outline.totalDays,
        weeks: outline.weeks,
        lastWorkout,
      };
    },

    /**
     * The prescription for one week and day, straight from the playground.
     * The server's echoed week and dayInWeek must match what was asked, or the
     * request fails loudly rather than returning a plausible wrong workout.
     */
    async getDayPlan(programId, week, day) {
      const program = await loadProgram(programId);
      const outline = parseProgramOutline(program.text);
      const outlineEntry = findOutlineDay(outline, week, day);
      if (!outlineEntry) {
        throw new ProgramServiceError(
          'DAY_NOT_IN_PROGRAM',
          `Week ${week} day ${day} is not part of ${program.name || programId}`
        );
      }

      const response = await probeDayPlan(program.text, week, day);
      const plan = buildDayPlan(response?.workout);
      if (!plan) {
        throw new ProgramServiceError('PLAN_UNREADABLE', 'Playground returned no readable workout');
      }

      if (plan.week !== week || plan.dayInWeek !== day) {
        throw new ProgramServiceError(
          'DAY_MISMATCH',
          `Asked for week ${week} day ${day}, playground answered week ${plan.week} day ${plan.dayInWeek}`
        );
      }

      if (referenceData && !referenceData.isLoaded()) {
        try {
          await referenceData.load();
        } catch (err) {
          // Graceful degradation: warmups will show percent if reference data fails.
        }
      }

      const declaredExercises = parseProgramDayExercises(program.text, week, day);
      applyProgramMetadata(plan, declaredExercises, { referenceData });

      // Liftosaur prefixes the day with the week name only when the program has
      // more than one week, so both spellings count as a match. The numeric
      // week / dayInWeek check above is the one that actually gates the plan.
      const actualName = normalizeName(plan.dayName);
      const nameMatches =
        actualName === normalizeName(outlineEntry.day.fullName) ||
        actualName === normalizeName(outlineEntry.day.name);

      const result = {
        programId: program.id,
        programName: program.name || plan.programName,
        programVersion: program.version,
        week,
        dayInWeek: day,
        dayName: plan.dayName || outlineEntry.day.fullName,
        unit: plan.unit,
        exercises: plan.exercises,
        outlineNameMatches: nameMatches,
      };

      return result;
    },

    /**
     * Replays the session through the playground, writes the record it returns
     * to the history, then saves the progression the same run produced.
     *
     * History is written first because it is append-only and therefore always
     * safe. The program write is skipped when the remote source changed since
     * the plan was fetched, so a program edited elsewhere is never overwritten.
     */
    async finishWorkout({
      programId,
      programVersion: expectedVersion = null,
      week,
      day,
      completedSets = [],
      startedAt = null,
      durationSeconds = null,
    } = {}) {
      let program = await loadProgram(programId);

      // The record is produced by replaying the session against the exact
      // program text the plan was built from. If that text is gone - the Side
      // Service restarted and the program has since changed - replaying against
      // a different text could produce a record for the wrong exercises, so
      // nothing is written and the watch is told to re-plan.
      if (expectedVersion && expectedVersion !== program.version) {
        const fresh = await loadProgram(programId, { force: true });
        if (expectedVersion !== fresh.version) {
          return {
            status: 'BASE_PROGRAM_UNAVAILABLE',
            historyId: null,
            programUpdated: false,
            message: 'The program changed on Liftosaur since this workout was planned',
          };
        }
        program = fresh;
      }

      const commands = buildWorkoutCommands(completedSets, { finish: true });
      const response = await client.runPlayground({
        programText: program.text,
        week,
        day,
        commands,
      });

      if (!response?.workout) {
        throw new ProgramServiceError('FINISH_FAILED', 'Playground returned no workout record');
      }

      const recordText = rewriteRecordHeader(response.workout, {
        date: startedAt ? new Date(startedAt) : null,
        durationSeconds,
      });

      const created = await commitHistory(recordText, startedAt);

      let programUpdated = false;
      let conflict = false;

      if (response.updatedProgramText && response.updatedProgramText !== program.text) {
        const remote = await loadProgram(programId, { force: true });
        if (remote.version !== program.version) {
          conflict = true;
        } else {
          const saved = await client.updateProgram(program.id, {
            text: response.updatedProgramText,
          });
          const savedText = saved?.text || response.updatedProgramText;
          programCache.set(program.id, {
            ...program,
            text: savedText,
            version: programVersion(savedText),
          });
          programUpdated = true;
        }
      }

      return {
        status: conflict ? 'HISTORY_SAVED_PROGRAM_CONFLICT' : 'SAVED',
        historyId: created.id,
        alreadyExisted: created.alreadyExisted,
        programUpdated,
        recordText,
      };
    },

    /**
     * `POST /history` carries no idempotency key, so a lost response leaves the
     * commit state unknown. The record is searched for before any retry.
     */
    async commitHistory(recordText, startedAt = null) {
      return commitHistory(recordText, startedAt);
    },

    invalidateProgram(programId) {
      programCache.delete(programId);
    },
  };

  async function commitHistory(recordText, startedAt) {
    try {
      const created = await client.createHistoryRecord(recordText);
      return { id: created?.id ?? null, alreadyExisted: false };
    } catch (err) {
      const existing = await findExistingRecord(recordText, startedAt);
      if (existing) {
        return { id: existing.id, alreadyExisted: true };
      }
      throw err;
    }
  }

  async function findExistingRecord(recordText, startedAt) {
    const expected = parseLiftohistoryRecord(recordText);
    if (!expected) return null;

    let history;
    try {
      history = await client.listHistory({ limit: 10 });
    } catch (err) {
      return null;
    }

    const expectedTime = startedAt ? Math.floor(startedAt / 1000) : toEpochSeconds(expected.date);

    for (const entry of history.records) {
      const record = parseLiftohistoryRecord(entry.text);
      if (!record) continue;
      if (record.dayName !== expected.dayName) continue;
      const recordTime = toEpochSeconds(record.date);
      if (expectedTime === null || recordTime === null) continue;
      if (Math.abs(recordTime - expectedTime) <= 120) {
        return entry;
      }
    }

    return null;
  }
}

function normalizeName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toEpochSeconds(dateString) {
  if (!dateString) return null;
  const parsed = Date.parse(String(dateString).replace(' +00:00', 'Z').replace(' ', 'T'));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}
