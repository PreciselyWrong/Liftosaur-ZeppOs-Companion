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
