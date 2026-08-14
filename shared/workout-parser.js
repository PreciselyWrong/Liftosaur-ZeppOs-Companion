/**
 * Robust Liftoscript and Workout Parser.
 * Handles single-day, multi-day, multi-week programs, Markdown headings,
 * Playground responses, and skips calibration sessions.
 */

export function parseLiftoscriptWorkout(input = {}, requestedDayIndex = null) {
  let id = 'workout-' + Date.now();
  let programName = 'Workout';
  let routineName = 'Liftosaur Routine';
  let rawText = '';
  let programState = {};

  if (typeof input === 'string') {
    rawText = input;
  } else if (typeof input === 'object' && input !== null) {
    id = input.id || input.programId || id;
    programName = input.name || input.workoutName || programName;
    routineName = input.routineName || input.routine || routineName;
    programState = input.state || {};

    if (typeof input.text === 'string') {
      rawText = input.text;
    } else if (input.data && typeof input.data.text === 'string') {
      rawText = input.data.text;
      programName = input.data.name || programName;
      programState = input.data.state || programState;
    } else if (input.program && typeof input.program.text === 'string') {
      rawText = input.program.text;
      programName = input.program.name || programName;
      programState = input.program.state || programState;
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

  // 1. Check if rawText is in Playground / History format: "... / exercises: { ... }"
  const playgroundWorkout = extractPlaygroundWorkout(rawText, programName);
  if (playgroundWorkout) {
    return {
      id,
      name: playgroundWorkout.name,
      routineName,
      exercises: playgroundWorkout.exercises,
      availableDays: [playgroundWorkout.name],
      currentDayIndex: 0,
      totalDays: 1,
    };
  }

  // 2. Extract all available days (including nested week(...) blocks and markdown headings)
  const allDays = extractDaysFromLiftoscript(rawText, programName);

  // 3. Filter out calibration / setup days if other normal workout days exist
  const regularDays = allDays.filter((d) => !isCalibrationDay(d.name));
  const days = regularDays.length > 0 ? regularDays : allDays;
  const totalDays = days.length > 0 ? days.length : 1;

  // 4. Resolve active next workout day index
  let activeIndex = 0;
  if (requestedDayIndex !== null && requestedDayIndex !== undefined) {
    activeIndex = requestedDayIndex;
  } else {
    activeIndex = resolveNextDayIndex(days, programState, rawText);
  }

  const safeDayIndex = Math.max(0, Math.min(activeIndex, totalDays - 1));
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

function isCalibrationDay(name) {
  const lower = name.toLowerCase();
  return (
    lower.includes('calib') ||
    lower.includes('calibration') ||
    lower.startsWith('setup') ||
    lower.includes('1rm test')
  );
}

function extractPlaygroundWorkout(rawText, defaultName) {
  const exercisesMatch = rawText.match(/exercises:\s*\{([\s\S]*?)\}/i);
  if (!exercisesMatch) return null;

  let dayName = defaultName;
  const dayMatch = rawText.match(/dayName:\s*["']([^"']+)["']/i);
  if (dayMatch) {
    dayName = dayMatch[1];
  } else {
    const progMatch = rawText.match(/program:\s*["']([^"']+)["']/i);
    if (progMatch) dayName = progMatch[1];
  }

  const exercises = parseExercisesFromBody(exercisesMatch[1]);
  if (exercises.length === 0) return null;

  return {
    name: dayName,
    exercises,
  };
}

function resolveNextDayIndex(days, state, rawText) {
  if (days.length <= 1) return 0;

  // 1. Check state object properties
  const stateDay = state?.day ?? state?.currentDay ?? state?.nextDay ?? state?.dayIndex;
  if (stateDay !== undefined && stateDay !== null) {
    if (typeof stateDay === 'number') {
      const target0 = stateDay > 0 && stateDay <= days.length ? stateDay - 1 : stateDay;
      if (target0 >= 0 && target0 < days.length) return target0;
    } else if (typeof stateDay === 'string') {
      const idx = days.findIndex((d) => d.name.toLowerCase().includes(stateDay.toLowerCase()));
      if (idx !== -1) return idx;
    }
  }

  // 2. Check state.week
  const stateWeek = state?.week ?? state?.currentWeek;
  if (stateWeek !== undefined && stateWeek !== null) {
    const weekPattern = new RegExp(`(?:week|w)\\s*${stateWeek}`, 'i');
    const firstMatchingWeekIdx = days.findIndex((d) => weekPattern.test(d.name));
    if (firstMatchingWeekIdx !== -1) {
      if (typeof stateDay === 'number') {
        const offset = Math.max(0, stateDay - 1);
        if (firstMatchingWeekIdx + offset < days.length) {
          return firstMatchingWeekIdx + offset;
        }
      }
      return firstMatchingWeekIdx;
    }
  }

  // 3. Inline state assignments: state.day = X or state.currentDay = X
  const inlineDayMatch = rawText.match(/state\.(?:currentDay|nextDay|day|dayIndex)\s*=\s*([0-9]+)/i);
  if (inlineDayMatch) {
    const val = parseInt(inlineDayMatch[1], 10);
    const target0 = val > 0 && val <= days.length ? val - 1 : val;
    if (target0 >= 0 && target0 < days.length) return target0;
  }

  return 0;
}

function extractDaysFromLiftoscript(rawText, defaultName) {
  const days = [];

  // 1. Check for Markdown headings: # Week X and ## Day Y
  const markdownDays = extractDaysFromMarkdown(rawText);
  if (markdownDays.length > 0) {
    return markdownDays;
  }

  // 2. Check for week("Week 1") { ... } outer blocks
  const weekBlockRegex = /week(?:\s*\(\s*["']?([^"')]+)["']?\s*\))?\s*\{([\s\S]*?)\n\s*\}/gi;
  let weekMatch;
  let foundAnyWeek = false;

  while ((weekMatch = weekBlockRegex.exec(rawText)) !== null) {
    foundAnyWeek = true;
    const weekTitle = (weekMatch[1] || 'Week').trim();
    const weekBody = weekMatch[2] || '';

    const dayRegex = /day(?:\s*\(\s*["']?([^"')]+)["']?\s*\))?\s*\{([^}]*)\}/gi;
    let dayMatch;
    let dayCount = 0;

    while ((dayMatch = dayRegex.exec(weekBody)) !== null) {
      dayCount++;
      const daySubTitle = (dayMatch[1] || `Day ${dayCount}`).trim();
      const exercises = parseExercisesFromBody(dayMatch[2]);
      if (exercises.length > 0) {
        days.push({
          name: `${weekTitle} - ${daySubTitle}`,
          exercises,
        });
      }
    }
  }

  // 3. Match standard top-level day("...") { ... } blocks
  if (!foundAnyWeek || days.length === 0) {
    const dayBlockRegex = /day(?:\s*\(\s*["']?([^"')]+)["']?\s*\))?\s*\{([^}]*)\}/gi;
    let match;

    while ((match = dayBlockRegex.exec(rawText)) !== null) {
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
  }

  // 4. Fallback: Parse whole text as a single day
  if (days.length === 0) {
    const exercises = parseExercisesFromBody(rawText);
    days.push({
      name: defaultName || 'Workout Day',
      exercises: exercises.length > 0 ? exercises : [getDefaultFallbackExercise()],
    });
  }

  return days;
}

function extractDaysFromMarkdown(rawText) {
  const lines = rawText.split('\n');
  const days = [];
  let currentWeek = '';
  let currentDay = null;
  let currentBodyLines = [];

  function flushDay() {
    if (currentDay && currentBodyLines.length > 0) {
      const exercises = parseExercisesFromBody(currentBodyLines.join('\n'));
      if (exercises.length > 0) {
        const fullDayName = currentWeek ? `${currentWeek} - ${currentDay}` : currentDay;
        days.push({
          name: fullDayName,
          exercises,
        });
      }
    }
    currentBodyLines = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Check for # Week X
    const weekHeading = line.match(/^#\s+(Week\s+[0-9A-Za-z]+.*)$/i);
    if (weekHeading) {
      flushDay();
      currentWeek = weekHeading[1].trim();
      currentDay = null;
      continue;
    }

    // Check for ## Day Y or # Day Y (ignore # Routine)
    const dayHeading = line.match(/^#{1,2}\s+((?:Day|Workout|Calibration|Calib)\b.*)$/i);
    if (dayHeading) {
      flushDay();
      currentDay = dayHeading[1].trim();
      continue;
    }


    if (currentDay) {
      currentBodyLines.push(line);
    }
  }

  flushDay();
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

  if (lower.startsWith('calib ') || lower.startsWith('calibration ')) {
    return true;
  }

  if (!line.includes('/') && !line.includes('@') && !line.match(/[0-9]+\s*x\s*[0-9]+/i)) {
    return true;
  }

  return false;
}

function parseExerciseLine(line, index) {
  let supersetGroup = null;
  let supersetTag = null;
  let cleanLine = line;

  const supersetMatch = cleanLine.match(/^\[(?:SUPERSET\s+)?([A-Za-z0-9]+)\]\s*(.*)$/i);
  if (supersetMatch) {
    const fullTag = supersetMatch[1].toUpperCase();
    supersetGroup = fullTag.charAt(0);
    supersetTag = `SUPERSET ${fullTag}`;
    cleanLine = supersetMatch[2];
  }

  const parts = cleanLine.split('/').map((p) => p.trim());
  if (parts.length === 0 || !parts[0]) return null;

  const rawName = parts[0].replace(/^["'(]+|["');]+$/g, '').trim();
  if (rawName.length === 0 || rawName === 'day' || rawName === 'week' || rawName === 'calib') return null;

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
    } else if (part.startsWith('target:')) {
      // Support playground / target: 3x5 100kg 180s
      const restMatch = part.match(/([0-9]+)s/i);
      if (restMatch) restSeconds = parseInt(restMatch[1], 10);
    }
  }

  let weight = 0;
  // Match "@ 60kg", "@ 60", "3x5 100kg", "135lb"
  const weightMatch = setsPart.match(/@\s*([0-9.]+)/i) || setsPart.match(/\s+([0-9.]+)\s*(?:kg|lb)\b/i);
  if (weightMatch) {
    weight = parseFloat(weightMatch[1]) || 0;
  }

  const sets = [];
  const setsPartClean = setsPart.split('@')[0].replace(/\s+[0-9.]+\s*(?:kg|lb)\b/i, '').trim();
  const setDefs = setsPartClean.split(',').map((s) => s.trim());


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
