/**
 * Liftoscript outline reader.
 *
 * The Liftosaur REST API exposes a program only as Liftoscript source text and
 * offers no endpoint that enumerates its weeks and days. This module reads the
 * two structural tokens the Liftoscript grammar defines for that purpose and
 * nothing else:
 *
 *   `# <week name>`    starts a week
 *   `## <day name>`    starts a day inside the current week
 *
 * Lines opened by `//` or `///` are comments, and `{~ ... ~}` delimits embedded
 * script. Both are skipped so a `#` inside them is never mistaken for a header.
 *
 * Exercises, weights, set schemes, progressions and rest timers are NOT read
 * here. They come from `POST /api/v1/playground`, which is the only component
 * allowed to evaluate Liftoscript. The outline exists purely so the watch can
 * offer the user the same week and day list the Liftosaur app shows, and every
 * outline entry is verified against the server's own `week` / `dayInWeek` /
 * `dayName` echo before a workout starts.
 */

const WEEK_HEADER_RE = /^#(?!#)\s+(.+?)\s*$/;
const DAY_HEADER_RE = /^##(?!#)\s+(.+?)\s*$/;

/**
 * @param {string} programText Liftoscript source, verbatim from the API.
 * @returns {{weeks: Array<{number: number, name: string, days: Array<{number: number, name: string, fullName: string}>}>, totalWeeks: number, totalDays: number}}
 */
export function parseProgramOutline(programText) {
  const weeks = [];
  let currentWeek = null;
  let scriptDepth = 0;

  const lines = String(programText || '').split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Embedded script blocks may span many lines and contain anything.
    const opens = countOccurrences(line, '{~');
    const closes = countOccurrences(line, '~}');
    if (scriptDepth > 0) {
      scriptDepth = Math.max(0, scriptDepth + opens - closes);
      continue;
    }
    if (opens > closes) {
      scriptDepth = opens - closes;
      continue;
    }

    if (line === '' || line.startsWith('//')) continue;

    const dayMatch = line.match(DAY_HEADER_RE);
    if (dayMatch) {
      if (!currentWeek) {
        currentWeek = createWeek(weeks.length + 1, null);
        weeks.push(currentWeek);
      }
      const name = dayMatch[1];
      currentWeek.days.push({
        number: currentWeek.days.length + 1,
        name,
        fullName: currentWeek.name ? `${currentWeek.name} - ${name}` : name,
      });
      continue;
    }

    const weekMatch = line.match(WEEK_HEADER_RE);
    if (weekMatch) {
      currentWeek = createWeek(weeks.length + 1, weekMatch[1]);
      weeks.push(currentWeek);
    }
  }

  const populated = weeks.filter((week) => week.days.length > 0);

  return {
    weeks: populated,
    totalWeeks: populated.length,
    totalDays: populated.reduce((sum, week) => sum + week.days.length, 0),
  };
}

function createWeek(number, name) {
  return { number, name: name || null, days: [] };
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Looks up one day by its 1-based week and day-in-week numbers. */
export function findOutlineDay(outline, weekNumber, dayNumber) {
  const week = (outline?.weeks || []).find((w) => w.number === weekNumber);
  if (!week) return null;
  const day = week.days.find((d) => d.number === dayNumber);
  if (!day) return null;
  return { week, day };
}

function parseRange(spec) {
  const result = [];
  const parts = String(spec || '').split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        for (let i = start; i <= end; i++) result.push(i);
      }
    } else {
      const val = parseInt(trimmed, 10);
      if (Number.isFinite(val)) result.push(val);
    }
  }
  return result;
}

/**
 * Extracts exercise declarations for one day from the Liftoscript source text.
 * Reads `warmup:` and `superset:` tags. Exercise names have Liftoscript template
 * brackets (e.g. `[1,2-6]`) and label prefixes (e.g. `calibration: `) stripped.
 * Handles template week inheritance for days defined across week ranges.
 *
 * @param {string} programText Verbatim Liftoscript source.
 * @param {number} weekNumber  1-based week index.
 * @param {number} dayNumber   1-based day index within the week.
 * @returns {Array<{name: string, equipment: string|null, warmupText: string|null, supersetTag: string|null}>}
 */
export function parseProgramDayExercises(programText, weekNumber, dayNumber) {
  const lines = String(programText || '').split('\n');
  let currentWeek = 0;
  let currentDay = 0;
  let scriptDepth = 0;
  const allEntries = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const opens = countOccurrences(line, '{~');
    const closes = countOccurrences(line, '~}');
    if (scriptDepth > 0) {
      scriptDepth = Math.max(0, scriptDepth + opens - closes);
      continue;
    }
    if (opens > closes) {
      scriptDepth = opens - closes;
      continue;
    }

    if (line === '' || line.startsWith('//')) continue;

    const weekMatch = line.match(WEEK_HEADER_RE);
    if (weekMatch) {
      currentWeek += 1;
      currentDay = 0;
      continue;
    }

    const dayMatch = line.match(DAY_HEADER_RE);
    if (dayMatch) {
      if (currentWeek === 0) currentWeek = 1;
      currentDay += 1;
      continue;
    }

    if (currentDay > 0) {
      const cleanLine = line.replace(/\/\/.*$/, '').trim();
      if (!cleanLine) continue;

      // Skip template-only declarations (e.g. used: none / used: 0)
      if (/\bused\s*:\s*(none|0|false)\b/i.test(cleanLine)) {
        continue;
      }

      const parts = cleanLine
        .split(/\s*\/\s*/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (parts.length === 0) continue;

      let rawNameAndEquipment = parts[0];

      // Strip label prefix e.g. "calibration: " or "rfmar: "
      const colonMatch = rawNameAndEquipment.match(/^[a-zA-Z0-9_-]+\s*:\s*(.+)$/);
      if (colonMatch) {
        rawNameAndEquipment = colonMatch[1].trim();
      }

      // Check for template bracket e.g. "[1,2-6]" or "[2-6]"
      let itemIndex = null;
      let appliesToWeeks = [currentWeek];
      const bracketMatch = rawNameAndEquipment.match(/\[([^\]]*)\]/);
      if (bracketMatch) {
        const inside = bracketMatch[1].trim();
        const tokens = inside.split(',').map((t) => t.trim());
        if (tokens.length >= 2) {
          itemIndex = parseInt(tokens[0], 10);
          appliesToWeeks = parseRange(tokens[1]);
        } else if (tokens.length === 1) {
          if (tokens[0].includes('-')) {
            appliesToWeeks = parseRange(tokens[0]);
          } else {
            const num = parseInt(tokens[0], 10);
            if (Number.isFinite(num)) {
              itemIndex = num;
            }
          }
        }
      }

      const cleaned = rawNameAndEquipment.replace(/\[[^\]]*\]/g, '').trim();
      const commaIdx = cleaned.indexOf(',');
      const name = (commaIdx === -1 ? cleaned : cleaned.slice(0, commaIdx)).trim();
      const equipment = commaIdx === -1 ? null : cleaned.slice(commaIdx + 1).trim() || null;
      if (!name) continue;

      let warmupText = null;
      let supersetTag = null;

      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        const warmupMatch = part.match(/^warmup\s*:\s*(.*)$/i);
        if (warmupMatch) {
          warmupText = warmupMatch[1].trim();
          continue;
        }
        const supersetMatch = part.match(/^superset\s*:\s*(.*)$/i);
        if (supersetMatch) {
          supersetTag = supersetMatch[1].trim();
          continue;
        }
      }

      allEntries.push({
        week: currentWeek,
        day: currentDay,
        itemIndex: itemIndex ?? allEntries.length + 1,
        appliesToWeeks,
        name,
        equipment,
        warmupText,
        supersetTag,
      });
    }
  }

  // 1. Direct entries in target week and day:
  const directMatches = allEntries.filter(
    (e) => e.week === weekNumber && e.day === dayNumber
  );
  if (directMatches.length > 0) {
    return directMatches.map(({ name, equipment, warmupText, supersetTag }) => ({
      name,
      equipment,
      warmupText,
      supersetTag,
    }));
  }

  // 2. Template entries matching day and week range:
  const templateMatches = allEntries.filter(
    (e) => e.day === dayNumber && e.appliesToWeeks.includes(weekNumber)
  );

  return templateMatches
    .sort((a, b) => a.itemIndex - b.itemIndex)
    .map(({ name, equipment, warmupText, supersetTag }) => ({
      name,
      equipment,
      warmupText,
      supersetTag,
    }));
}
