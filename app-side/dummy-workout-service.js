function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function formatWeight(value, unit) {
  return Number.isFinite(value) && unit ? `${value}${unit}` : null;
}

function mapSet(set, entryId, kind, index, planUnit) {
  const unit = set.unit || planUnit;
  const targetReps = Number.isFinite(set.targetReps) ? set.targetReps : null;
  const maxReps = Number.isFinite(set.targetRepsMax) ? set.targetRepsMax : targetReps;

  return {
    setId: `${entryId}-${kind}-${index + 1}`,
    index,
    isWarmup: kind === 'warmup',
    minReps: targetReps,
    reps: maxReps,
    weight: formatWeight(set.targetWeight, unit),
    rpe: set.targetRpe ?? null,
    logRpe: set.targetRpe !== null && set.targetRpe !== undefined,
    askWeight: Boolean(set.askWeight),
    isAmrap: Boolean(set.isAmrap),
    timer: set.restSeconds ?? null,
    plates: set.plates ?? null,
    completed: null,
  };
}

function planToWorkout(plan, { startTime = null } = {}) {
  return {
    programId: plan.programId,
    programName: plan.programName,
    dayName: plan.dayName,
    dayData: {
      week: plan.week,
      dayInWeek: plan.dayInWeek,
    },
    startTime,
    entries: plan.exercises.map((exercise, exerciseIndex) => {
      const entryId = `demo-entry-${exercise.id || exerciseIndex + 1}`;
      return {
        entryId,
        exerciseId: exercise.id || `demo-exercise-${exerciseIndex + 1}`,
        name: exercise.name,
        equipment: exercise.equipment ?? null,
        superset: exercise.supersetGroup ?? exercise.supersetTag ?? null,
        notes: exercise.notes ?? null,
        description: exercise.description ?? null,
        warmupSets: exercise.warmupSets.map((set, index) =>
          mapSet(set, entryId, 'warmup', index, plan.unit)
        ),
        sets: exercise.sets.map((set, index) =>
          mapSet(set, entryId, 'work', index, plan.unit)
        ),
      };
    }),
  };
}

function nextSelection(outline) {
  const days = (outline.weeks || []).flatMap((week) =>
    (week.days || []).map((day) => ({ week: week.number, dayInWeek: day.number }))
  );
  if (days.length === 0) return { week: 1, dayInWeek: 1 };

  const last = outline.lastWorkout;
  const lastIndex = days.findIndex(
    (day) => day.week === last?.week && day.dayInWeek === last?.dayInWeek
  );
  return days[lastIndex >= 0 && lastIndex + 1 < days.length ? lastIndex + 1 : 0];
}

export function createDummyWorkoutService({ catalogService, now = Date.now, getLocalSettings = null } = {}) {
  if (!catalogService) throw new Error('Dummy Workout service requires a catalog service');

  let currentWorkout = null;

  async function buildWorkout(selection = {}) {
    const programs = await catalogService.listPrograms();
    const selectedProgram = programs.find((program) => program.id === selection.programId)
      || programs.find((program) => program.isCurrent)
      || programs[0];
    if (!selectedProgram) return null;

    const outline = await catalogService.getProgramOutline(selectedProgram.id);
    const coordinates = Number.isFinite(selection.week) && Number.isFinite(selection.dayInWeek)
      ? { week: selection.week, dayInWeek: selection.dayInWeek }
      : nextSelection(outline);
    const plan = await catalogService.getDayPlan(
      selectedProgram.id,
      coordinates.week,
      coordinates.dayInWeek
    );

    return planToWorkout({
      ...plan,
      programId: selectedProgram.id,
      programName: selectedProgram.name,
    });
  }

  return {
    mode: 'DEMO',

    listPrograms: () => catalogService.listPrograms(),
    getProgramOutline: (programId) => catalogService.getProgramOutline(programId),

    async getNextWorkout(selection) {
      return { workout: clone(await buildWorkout(selection || {})) };
    },

    async getCurrentWorkout() {
      return { workout: clone(currentWorkout) };
    },

    async startWorkout(payload = {}) {
      const workout = await buildWorkout(payload);
      currentWorkout = workout
        ? { ...workout, startTime: Number.isFinite(payload.startTime) ? payload.startTime : now() }
        : null;
      return { workout: clone(currentWorkout) };
    },

    async syncWorkoutSets(sets) {
      if (currentWorkout) {
        const completedBySet = new Map(sets.map((set) => [set.setId, set.completed]));
        for (const entry of currentWorkout.entries) {
          for (const set of [...entry.warmupSets, ...entry.sets]) {
            if (completedBySet.has(set.setId)) {
              set.completed = clone(completedBySet.get(set.setId));
            }
          }
        }
      }
      return { workout: clone(currentWorkout) };
    },

    async finishWorkout() {
      currentWorkout = null;
      return { status: 'SAVED', mode: 'DEMO' };
    },

    async discardWorkout() {
      currentWorkout = null;
      return { deleted: true, mode: 'DEMO' };
    },

    async getSettings() {
      const local = typeof getLocalSettings === 'function' ? getLocalSettings() : null;
      return {
        units: 'kg',
        timers: { warmup: 60, workout: 120, superset: 90 },
        screenOnDuration: local?.screenOnDuration ?? 120,
      };
    },
  };
}
