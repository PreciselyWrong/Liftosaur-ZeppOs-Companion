/**
 * Authoritative Liftoscript and Workout Parser.
 * Handles:
 * - Liftoscript DSL (`day("...") { ... }`, `week("...") { ... }`, `jour(...) { ... }`)
 * - Markdown Headings (`# Week 1`, `## Day 1`, `# Semaine 1`, `## Jour 1`, `# Push`, `### Legs`)
 * - Plain-text Headings without hashes (`Week 1`, `Day 1`, `Jour 1`, `Semaine 1`, `Workout A`, `Push`, `Pull`, `Legs`)
 * - Multi-set continuation lines (`1x5 (state.tm * 0.75)`, `Amrap 1x5 100kg`)
 * - Bare unslashed exercise names (`Bench Press`, `Squat, Barbell 3x5 100kg`)
 * - Official Liftosaur Playground & History JSON responses
 * - Week ranges (`Exercise[1-4]`)
 */

export function parseLiftoscriptWorkout(input = {}, requestedDayIndex = null, historyRecords = []) {
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
  const playgroundWorkout = extractPlaygroundWorkout(rawText, programName, routineName);
  if (playgroundWorkout) {
    return {
      id,
      name: playgroundWorkout.name,
      routineName: playgroundWorkout.routineName,
      exercises: playgroundWorkout.exercises,
      availableDays: [playgroundWorkout.name],
      currentDayIndex: 0,
      totalDays: 1,
    };
  }

  // 2. Extract full program structure (weeks & days)
  const session = resolveNextProgramSession({
    programText: rawText,
    programName,
    routineName,
    programState,
    historyRecords,
    requestedDayIndex,
  });

  return {
    id,
    name: session.fullName || session.dayName || programName,
    fullName: session.fullName,
    dayName: session.dayName,
    routineName,
    exercises: session.exercises,
    availableDays: session.availableDays,
    currentDayIndex: session.dayIndex,
    totalDays: session.totalDays,
    week: session.week,
    dayInWeek: session.dayInWeek,
  };
}

export function resolveNextProgramSession({
  programText = '',
  programName = 'Workout',
  routineName = 'Liftosaur Routine',
  programState = {},
  historyRecords = [],
  requestedDayIndex = null,
} = {}) {
  const structure = extractProgramStructure(programText, programName);
  const allDays = structure.flatDays;

  // Filter out calibration/setup/readme days if regular days exist
  const regularDays = allDays.filter((d) => !isCalibrationDay(d.name) && !isCalibrationDay(d.fullName));
  const days = regularDays.length > 0 ? regularDays : allDays;
  const totalDays = Math.max(1, days.length);

  let targetIndex = 0;

  if (requestedDayIndex !== null && requestedDayIndex !== undefined && Number.isFinite(requestedDayIndex)) {
    targetIndex = Math.max(0, Math.min(requestedDayIndex, totalDays - 1));
  } else {
    // Determine next workout from history records
    const historyIndex = findNextDayIndexFromHistory(days, historyRecords, programName);
    if (historyIndex !== null && historyIndex !== undefined) {
      targetIndex = historyIndex;
    } else {
      targetIndex = resolveNextDayIndexFromState(days, programState, programText);
    }
  }

  const safeIndex = Math.max(0, Math.min(targetIndex, totalDays - 1));
  const activeDay = days[safeIndex] || {
    name: programName,
    fullName: programName,
    weekNumber: 1,
    dayNumber: 1,
    exercises: [getDefaultFallbackExercise(programName)],
  };

  const finalExercises = activeDay.exercises && activeDay.exercises.length > 0
    ? activeDay.exercises
    : [getDefaultFallbackExercise(activeDay.name || programName)];

  return {
    dayIndex: safeIndex,
    name: activeDay.fullName || activeDay.name || programName,
    dayName: activeDay.name || programName,
    fullName: activeDay.fullName || activeDay.name || programName,
    week: activeDay.weekNumber || 1,
    dayInWeek: activeDay.dayNumber || 1,
    exercises: finalExercises,
    totalDays,
    availableDays: days.map((d) => d.fullName || d.name),
  };
}

export function extractProgramStructure(rawText = '', defaultName = 'Workout') {
  if (!rawText || !rawText.trim()) {
    const singleDay = {
      name: defaultName,
      fullName: defaultName,
      weekNumber: 1,
      dayNumber: 1,
      globalIndex: 0,
      exercises: [getDefaultFallbackExercise(defaultName)],
    };
    return {
      weeks: [{ weekNumber: 1, name: 'Week 1', days: [singleDay], hasExplicitWeekHeader: false }],
      flatDays: [singleDay],
    };
  }

  // 1. Try DSL format (day(...) { ... } or week(...) { ... })
  const isDslFormat = /\b(?:day|jour|workout|seance|séance)\b[^{]*\{/i.test(rawText) || /\b(?:week|semaine)\b[^{]*\{/i.test(rawText);
  if (isDslFormat) {
    const dslWeeks = parseDslStructure(rawText, defaultName);
    if (dslWeeks.flatDays.length > 0) {
      return dslWeeks;
    }
  }

  // 2. Parse Markdown or Line-based headings (with or without #)
  const lineStructure = parseLineStructure(rawText, defaultName);
  if (lineStructure.flatDays.length > 0) {
    return lineStructure;
  }

  // 3. Fallback: single day
  const fallbackExercises = parseExercisesFromBody(rawText);
  const singleDay = {
    name: defaultName,
    fullName: defaultName,
    weekNumber: 1,
    dayNumber: 1,
    globalIndex: 0,
    exercises: fallbackExercises.length > 0 ? fallbackExercises : [getDefaultFallbackExercise(defaultName)],
  };

  return {
    weeks: [{ weekNumber: 1, name: 'Week 1', days: [singleDay], hasExplicitWeekHeader: false }],
    flatDays: [singleDay],
  };
}

function parseLineStructure(rawText, defaultName = 'Workout') {
  const lines = rawText.split('\n');
  const rawWeeks = [];
  let currentWeek = null;
  let currentDay = null;
  let currentBodyLines = [];

  const recurringExercises = [];

  function flushDay() {
    if (currentDay && currentBodyLines.length > 0) {
      const rawLines = [...currentBodyLines];

      for (const line of rawLines) {
        const match = line.match(/^([^/]+?)\s*\[\s*(?:[0-9]+\s*,\s*)?([0-9]+)(?:\s*-\s*([0-9]+))?\s*\]/);
        if (match) {
          const fromWeek = parseInt(match[2], 10);
          const toWeek = match[3] ? parseInt(match[3], 10) : fromWeek;
          recurringExercises.push({
            line,
            dayTitle: currentDay.title,
            fromWeek,
            toWeek,
          });
        }
      }

      if (!currentWeek) {
        currentWeek = {
          weekNumber: 1,
          name: 'Week 1',
          days: [],
          hasExplicitWeekHeader: false,
        };
        rawWeeks.push(currentWeek);
      }

      currentWeek.days.push({
        title: currentDay.title,
        bodyLines: rawLines,
        dayNumber: currentWeek.days.length + 1,
      });
    }
    currentBodyLines = [];
  }

  function flushWeek() {
    flushDay();
    currentDay = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('```') || line.startsWith('---')) continue;

    // Check for Week / Semaine heading:
    // Requires a number, e.g. "Week 1", "# Week 1", "Semaine 2", "W1", "S2"
    // NEVER match words like "Squat", "Shoulder Press", "Seated Row", "Standing Calf"
    const weekHeading = line.match(/^(?:#{1,3}\s+)?(?:(?:Week|Semaine)\s*([0-9]+)|(?:W|S)\s*([0-9]+))\b(.*)$/i);
    const isBareWeek = weekHeading && (line.startsWith('#') || !line.includes('/') && !line.includes('x') && !line.includes(':'));

    if (isBareWeek) {
      flushWeek();
      const rawNum = parseInt(weekHeading[1] || weekHeading[2], 10);
      const weekNum = !isNaN(rawNum) && rawNum > 0 ? rawNum : rawWeeks.length + 1;
      const weekName = line.replace(/^#+\s*/, '').trim();
      currentWeek = {
        weekNumber: weekNum,
        name: weekName,
        days: [],
        hasExplicitWeekHeader: true,
      };
      rawWeeks.push(currentWeek);
      continue;
    }

    // Check for Day / Jour / Workout / Subheading:
    // "## Day 1", "# Day 1", "Day 1", "Jour 1", "## Jour 1", "### Push", "Push", "Pull", "Legs", "Workout A"
    const markdownHeading = line.match(/^#{1,4}\s+(.*)$/);
    const plainDayHeading = line.match(/^(?:Day|Jour|Workout|Session|Seance|Séance)\s*(?:[0-9]+|[A-Fa-f]\b).*$/i);
    const plainSplitHeading = line.match(/^(?:Push|Pull|Legs|Upper|Lower|Chest|Back|Arms|Shoulders|Full\s*Body|Poussée|Tirage|Jambes|Haut|Bas)\s*(?:Day|Jour|\b|$)/i);

    let isDay = false;
    let dayTitle = '';

    if (markdownHeading) {
      const headingText = markdownHeading[1].trim();
      const lowerHeading = headingText.toLowerCase();
      if (!lowerHeading.startsWith('routine') && !lowerHeading.startsWith('program') && !lowerHeading.startsWith('programme')) {
        isDay = true;
        dayTitle = headingText;
      }
    } else if (plainDayHeading && !line.includes('/') && !line.match(/[0-9]+\s*x\s*[0-9]+/i)) {
      isDay = true;
      dayTitle = plainDayHeading[0].trim();
    } else if (plainSplitHeading && !line.includes('/') && !line.match(/[0-9]+\s*x\s*[0-9]+/i) && line.length < 30) {
      isDay = true;
      dayTitle = line.trim();
    }

    if (isDay) {
      flushDay();
      currentDay = { title: dayTitle };
      continue;
    }

    if (currentDay) {
      currentBodyLines.push(line);
    } else if (!isScriptCodeLine(line)) {
      if (!currentDay) {
        currentDay = { title: currentWeek ? currentWeek.name : (defaultName || 'Day 1') };
      }
      currentBodyLines.push(line);
    }
  }

  flushWeek();

  // If a week had exercises without sub-days, attach them as a day
  for (const w of rawWeeks) {
    if (w.days.length === 0 && currentBodyLines.length > 0) {
      w.days.push({
        title: w.name,
        bodyLines: [...currentBodyLines],
        dayNumber: 1,
      });
    }
  }

  const weeks = [];
  const flatDays = [];

  for (const w of rawWeeks) {
    const weekObj = {
      weekNumber: w.weekNumber,
      name: w.name,
      hasExplicitWeekHeader: Boolean(w.hasExplicitWeekHeader),
      days: [],
    };

    for (const d of w.days) {
      const combinedLines = [...d.bodyLines];

      for (const rec of recurringExercises) {
        if (rec.dayTitle === d.title && w.weekNumber >= rec.fromWeek && w.weekNumber <= rec.toWeek) {
          if (!combinedLines.includes(rec.line)) {
            combinedLines.unshift(rec.line);
          }
        }
      }

      const exercises = parseExercisesFromBody(combinedLines.join('\n'), w.weekNumber);
      const isSingleDayDefault = rawWeeks.length === 1 && !w.hasExplicitWeekHeader;
      const fullName = isSingleDayDefault ? d.title : `${w.name} - ${d.title}`;

      const finalExercises = exercises.length > 0 ? exercises : [getDefaultFallbackExercise(d.title)];

      const dayObj = {
        name: d.title,
        fullName,
        weekNumber: w.weekNumber,
        dayNumber: d.dayNumber,
        globalIndex: flatDays.length,
        exercises: finalExercises,
      };

      weekObj.days.push(dayObj);
      flatDays.push(dayObj);
    }

    if (weekObj.days.length > 0) {
      weeks.push(weekObj);
    }
  }

  return { weeks, flatDays };
}

function parseDslStructure(rawText, defaultName = 'Workout') {
  const weeks = [];
  const flatDays = [];

  const weekBlocks = extractDslBlocks(rawText, ['week', 'semaine']);

  if (weekBlocks.length > 0) {
    weekBlocks.forEach((wBlock, wIdx) => {
      const weekTitle = wBlock.title || `Week ${wIdx + 1}`;
      const rawNum = parseInt(weekTitle.replace(/[^0-9]/g, ''), 10);
      const weekNumber = !isNaN(rawNum) && rawNum > 0 ? rawNum : wIdx + 1;

      const weekObj = {
        weekNumber,
        name: weekTitle,
        hasExplicitWeekHeader: true,
        days: [],
      };

      const dayBlocks = extractDslBlocks(wBlock.body, ['day', 'jour', 'workout', 'seance', 'séance']);
      dayBlocks.forEach((dBlock, dIdx) => {
        const dayTitle = dBlock.title || `Day ${dIdx + 1}`;
        const exercises = parseExercisesFromBody(dBlock.body, weekNumber);
        const dayNumber = dIdx + 1;
        const dayObj = {
          name: dayTitle,
          fullName: `${weekTitle} - ${dayTitle}`,
          weekNumber,
          dayNumber,
          globalIndex: flatDays.length,
          exercises: exercises.length > 0 ? exercises : [getDefaultFallbackExercise(dayTitle)],
        };
        weekObj.days.push(dayObj);
        flatDays.push(dayObj);
      });

      if (weekObj.days.length > 0) {
        weeks.push(weekObj);
      }
    });
  }

  if (flatDays.length === 0) {
    const dayBlocks = extractDslBlocks(rawText, ['day', 'jour', 'workout', 'seance', 'séance']);
    dayBlocks.forEach((dBlock, dIdx) => {
      const dayTitle = dBlock.title || `Day ${dIdx + 1}`;
      const exercises = parseExercisesFromBody(dBlock.body, 1);
      const dayNumber = dIdx + 1;
      const dayObj = {
        name: dayTitle,
        fullName: dayTitle,
        weekNumber: 1,
        dayNumber,
        globalIndex: flatDays.length,
        exercises: exercises.length > 0 ? exercises : [getDefaultFallbackExercise(dayTitle)],
      };
      flatDays.push(dayObj);
    });

    if (flatDays.length > 0) {
      weeks.push({
        weekNumber: 1,
        name: 'Week 1',
        hasExplicitWeekHeader: false,
        days: flatDays,
      });
    }
  }

  return { weeks, flatDays };
}

function extractDslBlocks(text, keywords) {
  const blocks = [];
  const kwList = Array.isArray(keywords) ? keywords.join('|') : keywords;
  const regex = new RegExp(`\\b(?:${kwList})(?:\\s*(?:\\(\\s*["']?([^"'\)]+)["']?\\s*\\)|["']([^"']+)["']))?\\s*\\{`, 'gi');
  let match;

  while ((match = regex.exec(text)) !== null) {
    const title = (match[1] || match[2] || '').trim();
    const startIndex = match.index + match[0].length;
    let depth = 1;
    let endIndex = startIndex;

    while (endIndex < text.length && depth > 0) {
      const char = text[endIndex];
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
      }
      endIndex++;
    }

    if (depth === 0) {
      const body = text.slice(startIndex, endIndex - 1);
      blocks.push({
        title,
        body,
        startIndex: match.index,
        endIndex,
      });
      regex.lastIndex = endIndex;
    }
  }

  return blocks;
}

function parseExercisesFromBody(bodyText, targetWeek = null) {
  const lines = bodyText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//') && !l.startsWith('```'));

  const exercises = [];
  let currentExercise = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isScriptCodeLine(line)) {
      continue;
    }

    // Check if line is a continuation set for the preceding exercise:
    // e.g. "1x5 100kg", "1x5 (state.tm * 0.75)", "Amrap 5x5 80kg", "3x10 50kg"
    const isContinuation = isSetContinuationLine(line);
    if (isContinuation && currentExercise) {
      const extraSets = parseSetsDefinition(line, currentExercise.sets[0]?.targetWeight || 0, 90, null);
      if (extraSets && extraSets.length > 0) {
        currentExercise.sets.push(...extraSets);
        continue;
      }
    }

    const parsedEx = parseExerciseLine(line, exercises.length, targetWeek);
    if (parsedEx) {
      currentExercise = parsedEx;
      exercises.push(parsedEx);
    }
  }

  return exercises;
}

function isSetContinuationLine(line) {
  const clean = line.trim();
  // Starts directly with "1x5", "3x8", "Amrap 1x5", "1x5+", "5x5", "12, 5, 5" without words before
  return Boolean(clean.match(/^(?:amrap\s+)?(?:[0-9]+\s*x\s*[0-9]+|[0-9]+\+|[0-9]+\s*(?:kg|lbs?)\b)/i));
}

function isScriptCodeLine(line) {
  const clean = line.trim();
  if (!clean) return true;

  if (clean.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/i)) {
    return true;
  }
  if (clean.startsWith('exercises:') || clean.startsWith('dayName:') || clean.startsWith('program:')) {
    return true;
  }

  const codePrefixes = [
    'state.',
    'let ',
    'var ',
    'const ',
    'function ',
    'function(',
    'return ',
    'return;',
    'if (',
    'if(',
    'else ',
    'else{',
    'while (',
    'while(',
    'for (',
    'for(',
    'finish_workout',
    'set_state',
    'change_weight',
    'change_reps',
    'complete_set',
    'timer =',
    'reps =',
    'weight =',
  ];

  const lower = clean.toLowerCase();
  for (const kw of codePrefixes) {
    if (lower.startsWith(kw)) {
      return true;
    }
  }

  if (lower.startsWith('calib ') || lower.startsWith('calibration ')) {
    return true;
  }

  if (clean === '{' || clean === '}' || clean === ';' || clean === '();') {
    return true;
  }

  return false;
}

function cleanExerciseName(raw) {
  let name = String(raw || '').trim();
  name = name.replace(/^(\*\*|__|\*|_|~)+|(\*\*|__|\*|_|~)+$/g, '').trim();
  name = name.replace(/^["'(]+|["');]+$/g, '').trim();
  name = name.replace(/^[-*•\d+.)\]\s]+/, '').trim();
  name = name.replace(/^(?:t\d+|tier\s*\d+|tag\s*\d+|main|accessory):\s*/i, '').trim();
  return name;
}

function parseExerciseLine(line, index, targetWeek = null) {
  let supersetGroup = null;
  let supersetTag = null;
  let cleanLine = line.trim();

  cleanLine = cleanLine.replace(/;\s*$/, '').replace(/\/\/.*$/, '').trim();
  if (!cleanLine) return null;

  // 1. Superset prefix: [SUPERSET A1] or [A] or (A1)
  const supersetMatch = cleanLine.match(/^[\[(](?:SUPERSET\s+)?([A-Za-z0-9]+)[\])]\s*(.*)$/i);
  if (supersetMatch) {
    const fullTag = supersetMatch[1].toUpperCase();
    supersetGroup = fullTag.charAt(0);
    supersetTag = `SUPERSET ${fullTag}`;
    cleanLine = supersetMatch[2].trim();
  }

  let parts = [];

  if (cleanLine.includes('/')) {
    parts = cleanLine.split('/').map((p) => p.trim());
  } else {
    const colonMatch = cleanLine.match(/^(.*?)\s*:\s*(.*)$/i);
    if (colonMatch && (colonMatch[2].includes('x') || colonMatch[2].match(/[0-9]+/))) {
      parts = [colonMatch[1], colonMatch[2]];
    } else {
      const spaceSetsMatch = cleanLine.match(/^(.*?)\s+([0-9]+\s*x\s*[0-9]+.*)$/i);
      if (spaceSetsMatch) {
        parts = [spaceSetsMatch[1], spaceSetsMatch[2]];
      } else {
        const spaceWeightMatch = cleanLine.match(/^(.*?)\s+(@?\s*[0-9.]+\s*(?:kg|lbs?))\s*$/i);
        if (spaceWeightMatch) {
          parts = [spaceWeightMatch[1], spaceWeightMatch[2]];
        } else {
          parts = [cleanLine];
        }
      }
    }
  }

  if (parts.length === 0 || !parts[0]) return null;

  let rawName = cleanExerciseName(parts[0]);
  if (!rawName || rawName.length === 0) return null;

  const lowerName = rawName.toLowerCase();
  if (lowerName === 'day' || lowerName === 'jour' || lowerName === 'week' || lowerName === 'semaine' || lowerName.startsWith('calib') || lowerName.startsWith('setup')) {
    return null;
  }

  // 2. Week range in exercise name: e.g. "Bench Press[1-4]" or "Squat[1, 1-4]" or "Squat[2]"
  const weekRangeMatch = rawName.match(/^(.*?)\s*\[\s*(?:[0-9]+\s*,\s*)?([0-9]+)(?:\s*-\s*([0-9]+))?\s*\]$/);
  if (weekRangeMatch) {
    rawName = weekRangeMatch[1].trim();
    const fromWeek = parseInt(weekRangeMatch[2], 10);
    const toWeek = weekRangeMatch[3] ? parseInt(weekRangeMatch[3], 10) : fromWeek;

    if (targetWeek !== null && targetWeek !== undefined) {
      if (targetWeek < fromWeek || targetWeek > toWeek) {
        return null;
      }
    }
  }

  rawName = cleanExerciseName(rawName);
  if (!rawName) return null;

  // 3. Scan all parts (1 to n) for sets, weight, rest, and rpe
  let setsDefPart = null;
  let explicitWeight = null;
  let restSeconds = 90;
  let defaultRpe = null;

  for (let p = 1; p < parts.length; p++) {
    const part = parts[p].trim();
    const lower = part.toLowerCase();

    if (lower.startsWith('progress:') || lower.startsWith('custom(') || lower.startsWith('state.') || lower.startsWith('reuse:')) {
      continue;
    }

    if (lower.startsWith('rpe') || lower.match(/^@\s*[0-9.]+\s*$/)) {
      const rpeMatch = part.match(/rpe\s*:?\s*([0-9.]+)/i) || part.match(/^@\s*([0-9.]+)/);
      if (rpeMatch) {
        defaultRpe = parseFloat(rpeMatch[1]);
      }
      continue;
    }

    if (lower.startsWith('rest') || lower.startsWith('timer') || lower.match(/^[0-9.]+\s*(?:s|sec|m|min)\b/i)) {
      restSeconds = parseRestSeconds(part);
      continue;
    }

    if (lower.startsWith('target:')) {
      const restMatch = part.match(/([0-9]+)s/i);
      if (restMatch) restSeconds = parseInt(restMatch[1], 10);
      continue;
    }

    if (lower.startsWith('warmup:')) {
      continue;
    }

    const isPureWeight = part.match(/^@?\s*([0-9.]+)\s*(?:kg|lbs?|kilograms?|pounds?|%)?$/i) || lower === 'bodyweight';
    if (isPureWeight && !part.match(/[0-9]+\s*x\s*[0-9]+/i)) {
      if (lower === 'bodyweight') {
        explicitWeight = 0;
      } else {
        const numMatch = part.match(/([0-9.]+)/);
        if (numMatch) explicitWeight = parseFloat(numMatch[1]);
      }
      continue;
    }

    if (part.match(/[0-9]+\s*x\s*[0-9]+/i) || part.match(/^[0-9]+\s*x/i) || part.match(/[0-9]+\+/) || part.match(/^[0-9]+(?:,\s*[0-9]+)+/)) {
      setsDefPart = part;
      const inlineWeight = part.match(/@\s*([0-9.]+)/i) || part.match(/\s+([0-9.]+)\s*(?:kg|lbs?)\b/i);
      if (inlineWeight) {
        explicitWeight = parseFloat(inlineWeight[1]);
      }
      continue;
    }
  }

  if (!setsDefPart && explicitWeight === null && parts.length > 1) {
    setsDefPart = parts[1];
  }

  const finalWeight = explicitWeight !== null ? explicitWeight : 0;
  const sets = parseSetsDefinition(setsDefPart, finalWeight, restSeconds, defaultRpe);

  return {
    id: `ex-${index}-${rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: rawName,
    supersetGroup,
    supersetTag,
    sets,
  };
}

function parseSetsDefinition(setsDefPart, defaultWeight, restSeconds, defaultRpe) {
  if (!setsDefPart) {
    return [
      {
        targetReps: 10,
        targetWeight: defaultWeight || 0,
        targetRpe: defaultRpe,
        restSeconds,
        isAmrap: false,
      },
      {
        targetReps: 10,
        targetWeight: defaultWeight || 0,
        targetRpe: defaultRpe,
        restSeconds,
        isAmrap: false,
      },
      {
        targetReps: 10,
        targetWeight: defaultWeight || 0,
        targetRpe: defaultRpe,
        restSeconds,
        isAmrap: false,
      },
    ];
  }

  const sets = [];
  const setDefs = setsDefPart.split(',').map((s) => s.trim());

  for (const setDef of setDefs) {
    let setWeight = defaultWeight;
    const itemWeightMatch = setDef.match(/@\s*([0-9.]+)/i) || setDef.match(/\s+([0-9.]+)\s*(?:kg|lbs?)\b/i);
    if (itemWeightMatch) {
      setWeight = parseFloat(itemWeightMatch[1]) || defaultWeight;
    }

    const cleanDef = setDef.split('@')[0].replace(/\s+[0-9.]+\s*(?:kg|lbs?)\b/i, '').trim();
    const match = cleanDef.match(/(?:([0-9]+)\s*x\s*)?([0-9]+(?:-[0-9]+)?|amrap)(\+)?/i);

    if (match) {
      const count = match[1] ? parseInt(match[1], 10) : 1;
      const isAmrapStr = match[2]?.toLowerCase() === 'amrap';
      const rawReps = match[2]?.split('-')[0];
      const reps = isAmrapStr ? 10 : parseInt(rawReps, 10) || 5;
      const isAmrap = Boolean(match[3]) || isAmrapStr;

      for (let s = 0; s < count; s++) {
        sets.push({
          targetReps: Math.max(1, reps),
          targetWeight: setWeight,
          targetRpe: defaultRpe,
          restSeconds: Math.max(0, restSeconds),
          isAmrap,
        });
      }
    } else {
      const directNum = parseInt(cleanDef, 10);
      if (!isNaN(directNum) && directNum > 0) {
        sets.push({
          targetReps: directNum,
          targetWeight: setWeight,
          targetRpe: defaultRpe,
          restSeconds: Math.max(0, restSeconds),
          isAmrap: false,
        });
      }
    }
  }

  if (sets.length === 0) {
    sets.push({
      targetReps: 10,
      targetWeight: defaultWeight || 0,
      targetRpe: defaultRpe,
      restSeconds,
      isAmrap: false,
    });
  }

  return sets;
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

function isCalibrationDay(name = '') {
  const lower = String(name).toLowerCase();
  return (
    lower.includes('calib') ||
    lower.includes('calibration') ||
    lower.startsWith('setup') ||
    lower.includes('1rm test') ||
    lower === 'readme'
  );
}

function extractPlaygroundWorkout(rawText, defaultName, defaultRoutine = 'Liftosaur Routine') {
  const exercisesMatch = rawText.match(/exercises:\s*\{([\s\S]*?)\}/i);
  if (!exercisesMatch) return null;

  let dayName = defaultName;
  let routineName = defaultRoutine;

  const progMatch = rawText.match(/program:\s*["']([^"']+)["']/i);
  if (progMatch) routineName = progMatch[1];

  const dayMatch = rawText.match(/dayName:\s*["']([^"']+)["']/i);
  if (dayMatch) {
    dayName = dayMatch[1];
  } else if (progMatch) {
    dayName = progMatch[1];
  }

  const exercises = parseExercisesFromBody(exercisesMatch[1]);
  if (exercises.length === 0) return null;

  return {
    name: dayName,
    routineName,
    exercises,
  };
}

function findNextDayIndexFromHistory(days, historyRecords, programName) {
  if (!Array.isArray(historyRecords) || historyRecords.length === 0 || days.length <= 1) {
    return null;
  }

  const normProg = programName.toLowerCase().trim();
  let latest = null;

  for (const rec of historyRecords) {
    const text = rec.text || rec.source || (typeof rec === 'string' ? rec : '');
    const progMatch = text.match(/program:\s*["']([^"']+)["']/i);
    const recProg = progMatch ? progMatch[1].toLowerCase().trim() : (rec.program ? String(rec.program).toLowerCase().trim() : '');

    if (!normProg || !recProg || normProg.includes(recProg) || recProg.includes(normProg)) {
      latest = text || rec;
      break;
    }
  }

  if (!latest && historyRecords[0]) {
    latest = historyRecords[0].text || historyRecords[0].source || historyRecords[0];
  }

  if (!latest) return null;

  const latestText = typeof latest === 'string' ? latest : (latest.text || JSON.stringify(latest));
  const weekMatch = latestText.match(/(?:week|semaine):\s*([0-9]+)/i);
  const dayInWeekMatch = latestText.match(/(?:dayInWeek|jour):\s*([0-9]+)/i) || latestText.match(/day:\s*([0-9]+)/i);
  const dayNameMatch = latestText.match(/dayName:\s*["']([^"']+)["']/i);

  const lastWeek = weekMatch ? parseInt(weekMatch[1], 10) : (latest.week || latest.semaine || 1);
  const lastDayInWeek = dayInWeekMatch ? parseInt(dayInWeekMatch[1], 10) : (latest.dayInWeek || latest.jour || latest.day || null);

  if (lastDayInWeek !== null) {
    const currentDayIdx = days.findIndex(
      (d) => d.weekNumber === lastWeek && d.dayNumber === lastDayInWeek
    );

    if (currentDayIdx !== -1) {
      return (currentDayIdx + 1) % days.length;
    }
  }

  if (dayNameMatch || latest.dayName) {
    const lastName = (dayNameMatch ? dayNameMatch[1] : latest.dayName).toLowerCase().trim();
    const idx = days.findIndex(
      (d) => d.name.toLowerCase().trim() === lastName || d.fullName.toLowerCase().includes(lastName) || lastName.includes(d.name.toLowerCase().trim())
    );
    if (idx !== -1) {
      return (idx + 1) % days.length;
    }
  }

  return null;
}

function resolveNextDayIndexFromState(days, state, rawText) {
  if (days.length <= 1) return 0;

  const stateDay = state?.day ?? state?.currentDay ?? state?.nextDay ?? state?.dayIndex ?? state?.jour;
  if (stateDay !== undefined && stateDay !== null) {
    if (typeof stateDay === 'number') {
      const target0 = stateDay > 0 && stateDay <= days.length ? stateDay - 1 : stateDay;
      if (target0 >= 0 && target0 < days.length) return target0;
    } else if (typeof stateDay === 'string') {
      const idx = days.findIndex((d) => d.name.toLowerCase().includes(stateDay.toLowerCase()));
      if (idx !== -1) return idx;
    }
  }

  const stateWeek = state?.week ?? state?.currentWeek ?? state?.semaine;
  if (stateWeek !== undefined && stateWeek !== null) {
    const weekPattern = new RegExp(`(?:week|semaine|w|s)\\s*${stateWeek}`, 'i');
    const firstMatchingWeekIdx = days.findIndex((d) => weekPattern.test(d.fullName || d.name));
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

  const inlineDayMatch = rawText.match(/state\.(?:currentDay|nextDay|day|dayIndex|jour)\s*=\s*([0-9]+)/i);
  if (inlineDayMatch) {
    const val = parseInt(inlineDayMatch[1], 10);
    const target0 = val > 0 && val <= days.length ? val - 1 : val;
    if (target0 >= 0 && target0 < days.length) return target0;
  }

  return 0;
}

function getDefaultFallbackExercise(name = 'Exercise') {
  return {
    id: 'ex-fallback-1',
    name: name && name !== 'Workout' ? name : 'Workout Exercise',
    supersetGroup: null,
    supersetTag: null,
    sets: [
      { targetReps: 10, targetWeight: 20, targetRpe: null, restSeconds: 60, isAmrap: false },
      { targetReps: 10, targetWeight: 20, targetRpe: null, restSeconds: 60, isAmrap: false },
      { targetReps: 10, targetWeight: 20, targetRpe: null, restSeconds: 60, isAmrap: false },
    ],
  };
}
