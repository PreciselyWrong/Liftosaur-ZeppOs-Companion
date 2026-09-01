/**
 * Pure extension view-state, formatting, and navigation helpers.
 *
 * Platform independent: runs under Node and Zepp OS DataWidget.
 */

export const EXTENSION_SCREENS = {
  LOADING: 'LOADING',
  CONNECTION: 'CONNECTION',
  SETUP: 'SETUP',
  EMPTY: 'EMPTY',
  HOME: 'HOME',
  PROGRAMS: 'PROGRAMS',
  WEEKS: 'WEEKS',
  DAYS: 'DAYS',
  SESSION: 'SESSION',
};

const SUPERSET_COLORS = [
  0xff8066, // Coral / Orange
  0x2bdc9b, // Mint / Green
  0xffd820, // Yellow
  0xa48bfa, // Purple light
  0x00d8ff, // Cyan
  0xff66cc, // Pink
];

export function supersetColor(tag) {
  if (!tag) return SUPERSET_COLORS[0];
  const charCode = typeof tag === 'string' ? tag.charCodeAt(0) : Number(tag);
  const index = Math.abs(charCode) % SUPERSET_COLORS.length;
  return SUPERSET_COLORS[index];
}

export function truncate(str, maxLen = 24) {
  if (!str || typeof str !== 'string') return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

export function formatSeconds(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return '0:00';
  const isNegative = totalSeconds < 0;
  const absSeconds = Math.abs(totalSeconds);
  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const seconds = absSeconds % 60;
  const secStr = String(seconds).padStart(2, '0');

  if (hours > 0) {
    const minStr = String(minutes).padStart(2, '0');
    return `${isNegative ? '-' : ''}${hours}:${minStr}:${secStr}`;
  }
  return `${isNegative ? '-' : ''}${minutes}:${secStr}`;
}

export function formatWeightValue(weight, unit = 'kg') {
  if (weight === null || weight === undefined || !Number.isFinite(weight)) {
    return '-';
  }
  const rounded = Math.round(weight * 100) / 100;
  return `${rounded}${unit || ''}`;
}

export function formatTargetRepsSummary(set) {
  if (!set) return '-';
  if (set.targetRepsMax !== null && set.targetRepsMax !== undefined && set.targetReps !== null) {
    return `${set.targetReps}-${set.targetRepsMax}`;
  }
  if (set.targetReps !== null && set.targetReps !== undefined) {
    return String(set.targetReps);
  }
  return '-';
}

export function formatNextTargetSummary(rest) {
  if (!rest) return '';
  const reps = rest.nextTargetRepsMax
    ? `${rest.nextTargetReps}-${rest.nextTargetRepsMax}`
    : (rest.nextTargetReps !== null && rest.nextTargetReps !== undefined ? String(rest.nextTargetReps) : '-');
  const weight = formatWeightValue(rest.nextTargetWeight, rest.nextUnit);
  return `${reps} x ${weight}`;
}

export function formatDots(dots = []) {
  if (!Array.isArray(dots) || dots.length === 0) return '';
  return dots
    .map((dot) => (dot === 'completed' ? 'x' : dot === 'active' ? '>' : '-'))
    .join(' ');
}

export function checkRequiredPhoneInput(set) {
  if (!set) return null;
  if (Array.isArray(set.promptedVars) && set.promptedVars.length > 0) {
    return 'Program variables must be entered on phone.';
  }
  if (set.setTimer !== null && set.setTimer !== undefined) {
    return 'Timed sets must be recorded on phone.';
  }
  if (set.isAmrap && !Number.isFinite(set.reps) && !Number.isFinite(set.targetReps)) {
    return 'AMRAP reps must be entered on phone.';
  }
  if (set.askWeight && !Number.isFinite(set.weight) && !Number.isFinite(set.targetWeight)) {
    return 'Weight input required on phone.';
  }
  return null;
}
