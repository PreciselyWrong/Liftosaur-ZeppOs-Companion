/**
 * Robust Liftoscript and Workout Parser.
 * Pure platform-independent module.
 */

export function parseLiftoscriptWorkout(input = {}, requestedDayIndex = 0) {
  let id = 'workout-' + Date.now();
  let programName = 'Workout';
  let routineName = 'Liftosaur Routine';
  let rawText = '';
  let currentDayIdx = requestedDayIndex;

  if (typeof input === 'string') {
    rawText = input;
  } else if (typeof input === 'object' && input !== null) {
    id = input.id || input.programId || id;
    programName = input.name || input.workoutName || programName;
    routineName = input.routineName || input.routine || routineName;

    if (typeof input.text === 'string') {
      rawText = input.text;
    } else if (input.program && typeof input.program.text === 'string') {
      rawText = input.program.text;
      programName = input.program.name || programName;
    } else if (input.data && typeof input.data.text === 'string') {
      rawText = input.data.text;
      programName = input.data.name || programName;
    } else if (Array.isArray(input.days) && input.days.length > 0) {
      const dayIdx = input.currentDayIndex || 0;
      const day = input.days[dayIdx] || input.days[0];
      rawText = day.text || day.source || '';
      programName = day.name || programName;
    } else if (typeof input.source === 'string') {
      rawText = input.source;
    } else if (typeof input.script === 'string') {
      rawText = input.script;
    }
  }

  // Extract all days from Liftoscript text
  const days = extractDaysFromLiftoscript(rawText, programName);
  const totalDays = days.length > 0 ? days.length : 1;
  const safeDayIndex = Math.max(0, Math.min(requestedDayIndex, totalDays - 1));
  const activeDay = days[safeDayIndex] || {
    name: programName,
    exercises: [],
  };

  return {
    id,
    name: activeDay.name || programName,
    routineName,
    exercises: activeDay.exercises,
    availableDays: days.map((d) => d.name),
    currentDayIndex: safeDayIndex,
    totalDays,
  };
}

function extractDaysFromLiftoscript(rawText, defaultName) {
  const days = [];

  // Match day("Name") { ... } or day { ... }
  const dayBlockRegex = /day(?:\s*\(\s*["']?([^"')]+)["']?\s*\))?\s*\{([^}]*)\}/gi;
  let match;
  let foundAnyDay = false;

  while ((match = dayBlockRegex.exec(rawText)) !== null) {
    foundAnyDay = true;
    const dayTitle = (match[1] || `Day ${days.length + 1}`).trim();
    const dayBody = match[2] || '';
    const exercises = parseExercisesFromBody(dayBody);
    if (exercises.length > 0) {
      days.push({
        name: dayTitle,
        exercises,
      });
    }
  }

  // Fallback: If no day() blocks found, parse whole text as a single day
  if (!foundAnyDay || days.length === 0) {
    const exercises = parseExercisesFromBody(rawText);
    days.push({
      name: defaultName || 'Workout Day',
      exercises: exercises.length > 0 ? exercises : [getDefaultFallbackExercise()],
    });
  }

  return days;
}

function parseExercisesFromBody(bodyText) {
  const lines = bodyText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));

  const exercises = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Filter out Liftoscript code statements
    if (isScriptCodeLine(line)) {
      continue;
    }

    const parsedEx = parseExerciseLine(line, i);
    if (parsedEx) {
      exercises.push(parsedEx);
    }
  }

  return exercises;
}

function isScriptCodeLine(line) {
  const codeKeywords = [
    'state.',
    'let ',
    'var ',
    'const ',
    'function',
    'return',
    'if (',
    'if(',
    'else',
    'finish_workout',
    'set_state',
    'change_weight',
    'change_reps',
    'complete_set',
    'timer =',
    'reps =',
    'weight =',
    '{',
    '}',
    ';',
  ];

  const lower = line.toLowerCase();
  for (const kw of codeKeywords) {
    if (lower.startsWith(kw) || lower === kw) {
      return true;
    }
  }

  // An exercise line must contain a slash or set indicators like @ or x
  if (!line.includes('/') && !line.includes('@') && !line.match(/[0-9]+\s*x\s*[0-9]+/i)) {
    return true;
  }

  return false;
}

function parseExerciseLine(line, index) {
  let supersetGroup = null;
  let supersetTag = null;
  let cleanLine = line;

  // Superset prefix: [SUPERSET A1] or [A1]
  const supersetMatch = cleanLine.match(/^\[(?:SUPERSET\s+)?([A-Za-z0-9]+)\]\s*(.*)$/i);
  if (supersetMatch) {
    const fullTag = supersetMatch[1].toUpperCase();
    supersetGroup = fullTag.charAt(0);
    supersetTag = `SUPERSET ${fullTag}`;
    cleanLine = supersetMatch[2];
  }

  const parts = cleanLine.split('/').map((p) => p.trim());
  if (parts.length === 0 || !parts[0]) return null;

  // Clean up exercise name (strip accidental quotes/parentheses)
  const rawName = parts[0].replace(/^["'(]+|["');]+$/g, '').trim();
  if (rawName.length === 0 || rawName === 'day' || rawName === 'week') return null;

  let setsPart = parts[1] || '3x10 @ 20kg';
  let restSeconds = 90;
  let defaultRpe = null;

  for (let p = 2; p < parts.length; p++) {
    const part = parts[p].toLowerCase();
    if (part.startsWith('rest')) {
      restSeconds = parseRestSeconds(part);
    } else if (part.startsWith('rpe')) {
      const rpeMatch = part.match(/rpe\s*:?\s*([0-9.]+)/i);
      if (rpeMatch) {
        defaultRpe = parseFloat(rpeMatch[1]);
      }
    }
  }

  let weight = 0;
  const weightMatch = setsPart.match(/@\s*([0-9.]+)\s*(kg|lb)?/i);
  if (weightMatch) {
    weight = parseFloat(weightMatch[1]) || 0;
  }

  const sets = [];
  const setDefs = setsPart.split('@')[0].split(',').map((s) => s.trim());

  for (const setDef of setDefs) {
    const match = setDef.match(/(?:([0-9]+)\s*x\s*)?([0-9]+)(\+)?/i);
    if (match) {
      const count = match[1] ? parseInt(match[1], 10) : 1;
      const reps = parseInt(match[2], 10) || 5;
      const isAmrap = Boolean(match[3]);

      for (let s = 0; s < count; s++) {
        sets.push({
          targetReps: Math.max(1, reps),
          targetWeight: weight,
          targetRpe: defaultRpe,
          restSeconds: Math.max(0, restSeconds),
          isAmrap,
        });
      }
    }
  }

  if (sets.length === 0) {
    sets.push({
      targetReps: 10,
      targetWeight: weight || 20,
      targetRpe: defaultRpe,
      restSeconds,
      isAmrap: false,
    });
  }

  return {
    id: `ex-${index}-${rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: rawName,
    supersetGroup,
    supersetTag,
    sets,
  };
}

function parseRestSeconds(restPart) {
  const minMatch = restPart.match(/([0-9.]+)\s*m(?:in)?/i);
  if (minMatch) {
    return Math.round(parseFloat(minMatch[1]) * 60);
  }
  const secMatch = restPart.match(/([0-9]+)\s*s(?:ec)?/i);
  if (secMatch) {
    return parseInt(secMatch[1], 10);
  }
  const numMatch = restPart.match(/([0-9]+)/);
  if (numMatch) {
    return parseInt(numMatch[1], 10);
  }
  return 90;
}

function getDefaultFallbackExercise() {
  return {
    id: 'ex-fallback-1',
    name: 'Workout Exercise',
    supersetGroup: null,
    supersetTag: null,
    sets: [
      { targetReps: 10, targetWeight: 20, targetRpe: null, restSeconds: 60, isAmrap: false },
      { targetReps: 10, targetWeight: 20, targetRpe: null, restSeconds: 60, isAmrap: false },
      { targetReps: 10, targetWeight: 20, targetRpe: null, restSeconds: 60, isAmrap: false },
    ],
  };
}
