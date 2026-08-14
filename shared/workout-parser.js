export function parseLiftoscriptWorkout(input = {}) {
  let id = 'workout-' + Date.now();
  let name = 'Workout';
  let routineName = 'Liftosaur Routine';
  let text = '';

  if (typeof input === 'string') {
    text = input;
  } else if (typeof input === 'object' && input !== null) {
    id = input.id || input.programId || id;
    name = input.name || input.workoutName || name;
    routineName = input.routineName || input.routine || routineName;

    if (typeof input.text === 'string') {
      text = input.text;
    } else if (input.program && typeof input.program.text === 'string') {
      text = input.program.text;
      name = input.program.name || name;
    } else if (input.data && typeof input.data.text === 'string') {
      text = input.data.text;
      name = input.data.name || name;
    } else if (Array.isArray(input.days) && input.days.length > 0) {
      const dayIdx = input.currentDayIndex || 0;
      const day = input.days[dayIdx] || input.days[0];
      text = day.text || day.source || '';
      name = day.name || name;
    } else if (typeof input.source === 'string') {
      text = input.source;
    } else if (typeof input.script === 'string') {
      text = input.script;
    }
  }

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));


  const exercises = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsedEx = parseExerciseLine(line, i);
    if (parsedEx) {
      exercises.push(parsedEx);
    }
  }

  return {
    id,
    name,
    routineName,
    exercises,
  };
}

function parseExerciseLine(line, index) {
  // Check for superset prefix: e.g. [SUPERSET A1] or [A1]
  let supersetGroup = null;
  let supersetTag = null;
  let cleanLine = line;

  const supersetMatch = cleanLine.match(/^\[(?:SUPERSET\s+)?([A-Za-z0-9]+)\]\s*(.*)$/i);
  if (supersetMatch) {
    const fullTag = supersetMatch[1].toUpperCase();
    supersetGroup = fullTag.charAt(0); // e.g. 'A' from 'A1'
    supersetTag = `SUPERSET ${fullTag}`;
    cleanLine = supersetMatch[2];
  }

  const parts = cleanLine.split('/').map((p) => p.trim());
  if (parts.length === 0 || !parts[0]) return null;

  const name = parts[0];
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

  // Parse weight: e.g. "@ 60kg" or "@ 45lb"
  let weight = 0;
  const weightMatch = setsPart.match(/@\s*([0-9.]+)\s*(kg|lb)?/i);
  if (weightMatch) {
    weight = parseFloat(weightMatch[1]);
  }

  // Parse sets scheme: e.g. "3x5", "2x5, 1x5+", "5x3+"
  const sets = [];
  const setDefs = setsPart.split('@')[0].split(',').map((s) => s.trim());

  for (const setDef of setDefs) {
    // Match "3x5" or "1x5+" or "5"
    const match = setDef.match(/(?:([0-9]+)\s*x\s*)?([0-9]+)(\+)?/i);
    if (match) {
      const count = match[1] ? parseInt(match[1], 10) : 1;
      const reps = parseInt(match[2], 10);
      const isAmrap = Boolean(match[3]);

      for (let s = 0; s < count; s++) {
        sets.push({
          targetReps: reps,
          targetWeight: weight,
          targetRpe: defaultRpe,
          restSeconds,
          isAmrap,
        });
      }
    }
  }

  if (sets.length === 0) {
    sets.push({
      targetReps: 10,
      targetWeight: weight,
      targetRpe: defaultRpe,
      restSeconds,
      isAmrap: false,
    });
  }

  return {
    id: `ex-${index}-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    name,
    supersetGroup,
    supersetTag,
    sets,
  };
}

function parseRestSeconds(restStr) {
  const mMatch = restStr.match(/([0-9.]+)\s*m/i);
  if (mMatch) {
    return Math.round(parseFloat(mMatch[1]) * 60);
  }
  const sMatch = restStr.match(/([0-9.]+)\s*s/i);
  if (sMatch) {
    return Math.round(parseFloat(sMatch[1]));
  }
  const numMatch = restStr.match(/([0-9.]+)/);
  if (numMatch) {
    return Math.round(parseFloat(numMatch[1]));
  }
  return 90;
}
