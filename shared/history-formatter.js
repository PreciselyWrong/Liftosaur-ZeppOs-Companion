/**
 * Formats workout session data into the official Liftoscript History Record format.
 * Spec: https://www.liftosaur.com/doc/api
 */

export function formatWorkoutHistoryToLiftoscript(history = {}) {
  const dateIso = history.completedAt
    ? new Date(history.completedAt).toISOString()
    : new Date().toISOString();

  const programName = history.routineName || history.programName || 'Workout';
  const dayName = history.workoutName || history.dayName || 'Day 1';
  const durationSec = Math.max(1, Math.round(history.elapsedSeconds || 60));

  const completedSets = Array.isArray(history.completedSets) ? history.completedSets : [];

  // Group completed sets by exercise name
  const exerciseMap = new Map();

  for (const set of completedSets) {
    const exName = set.exerciseName || set.name || `Exercise ${(set.exerciseIndex || 0) + 1}`;
    if (!exerciseMap.has(exName)) {
      exerciseMap.set(exName, []);
    }
    exerciseMap.get(exName).push(set);
  }

  const exerciseLines = [];

  for (const [name, sets] of exerciseMap.entries()) {
    // Format sets: e.g. "3x5 100kg" or "1x5 100kg, 1x5 105kg"
    const totalCount = sets.length;
    const avgWeight = sets[0]?.weight ?? 0;
    const allSameWeight = sets.every((s) => s.weight === avgWeight);
    const avgReps = sets[0]?.reps ?? 5;
    const allSameReps = sets.every((s) => s.reps === avgReps);

    let setsSummary = '';
    if (allSameWeight && allSameReps) {
      setsSummary = `${totalCount}x${avgReps} ${avgWeight}kg`;
    } else {
      setsSummary = sets.map((s) => `1x${s.reps || 5} ${s.weight || 0}kg`).join(', ');
    }

    exerciseLines.push(`  ${name} / ${setsSummary}`);
  }

  const body = exerciseLines.length > 0 ? exerciseLines.join('\n') : '  Workout / 1x1 0kg';

  return `${dateIso} / program: "${programName}" / dayName: "${dayName}" / duration: ${durationSec}s / exercises: {\n${body}\n}`;
}
