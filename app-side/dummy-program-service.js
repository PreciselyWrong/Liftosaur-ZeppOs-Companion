/**
 * Dummy Program Service for screenshots, testing, and UI preview.
 *
 * Provides realistic Liftosaur data with complete workouts, warmups,
 * superset groups, and clean progression so every screen can be screenshotted.
 */

export function createDummyProgramService() {
  const programs = [
    {
      id: 'dummy-gzclp',
      name: 'GZCLP 4-Day Strength',
      isCurrent: true,
    },
    {
      id: 'dummy-ppl',
      name: 'Push Pull Legs (PPL)',
      isCurrent: false,
    },
    {
      id: 'dummy-ul',
      name: 'Upper / Lower Hypertrophy',
      isCurrent: false,
    },
  ];

  const outline = {
    programId: 'dummy-gzclp',
    programName: 'GZCLP 4-Day Strength',
    lastWorkout: {
      week: 1,
      day: 1,
      finishedAt: new Date(Date.now() - 86400000).toISOString(),
    },
    weeks: [
      {
        number: 1,
        name: 'Week 1',
        days: [
          { number: 1, name: 'Day 1 : Squat & Bench Press', fullName: 'Week 1 / Day 1 : Squat & Bench Press' },
          { number: 2, name: 'Day 2 : Overhead Press & Deadlift', fullName: 'Week 1 / Day 2 : Overhead Press & Deadlift' },
          { number: 3, name: 'Day 3 : Bench Press & Squat', fullName: 'Week 1 / Day 3 : Bench Press & Squat' },
          { number: 4, name: 'Day 4 : Deadlift & Overhead Press', fullName: 'Week 1 / Day 4 : Deadlift & Overhead Press' },
        ],
      },
      {
        number: 2,
        name: 'Week 2',
        days: [
          { number: 1, name: 'Day 1 : Squat & Bench Press', fullName: 'Week 2 / Day 1 : Squat & Bench Press' },
          { number: 2, name: 'Day 2 : Overhead Press & Deadlift', fullName: 'Week 2 / Day 2 : Overhead Press & Deadlift' },
          { number: 3, name: 'Day 3 : Bench Press & Squat', fullName: 'Week 2 / Day 3 : Bench Press & Squat' },
          { number: 4, name: 'Day 4 : Deadlift & Overhead Press', fullName: 'Week 2 / Day 4 : Deadlift & Overhead Press' },
        ],
      },
      {
        number: 3,
        name: 'Week 3',
        days: [
          { number: 1, name: 'Day 1 : Squat & Bench Press', fullName: 'Week 3 / Day 1 : Squat & Bench Press' },
          { number: 2, name: 'Day 2 : Overhead Press & Deadlift', fullName: 'Week 3 / Day 2 : Overhead Press & Deadlift' },
          { number: 3, name: 'Day 3 : Bench Press & Squat', fullName: 'Week 3 / Day 3 : Bench Press & Squat' },
          { number: 4, name: 'Day 4 : Deadlift & Overhead Press', fullName: 'Week 3 / Day 4 : Deadlift & Overhead Press' },
        ],
      },
    ],
  };

  const samplePlans = {
    '1-1': {
      programId: 'dummy-gzclp',
      programName: 'GZCLP 4-Day Strength',
      programVersion: 'dummyv1',
      week: 1,
      dayInWeek: 1,
      dayName: 'Week 1 / Day 1 : Squat & Bench Press',
      unit: 'kg',
      outlineNameMatches: true,
      exercises: [
        {
          index: 1,
          id: 'ex-1',
          name: 'Barbell Squat',
          equipment: 'barbell',
          supersetGroup: null,
          supersetTag: null,
          warmupSets: [
            { index: 1, targetReps: 5, targetWeight: 20, unit: 'kg', isWarmup: true },
            { index: 2, targetReps: 5, targetWeight: 40, unit: 'kg', isWarmup: true },
            { index: 3, targetReps: 3, targetWeight: 60, unit: 'kg', isWarmup: true },
          ],
          sets: [
            { index: 1, targetReps: 5, targetRepsMax: null, targetWeight: 80, targetRpe: 8, unit: 'kg', restSeconds: 180, isAmrap: false, askWeight: false },
            { index: 2, targetReps: 5, targetRepsMax: null, targetWeight: 80, targetRpe: 8, unit: 'kg', restSeconds: 180, isAmrap: false, askWeight: false },
            { index: 3, targetReps: 5, targetRepsMax: null, targetWeight: 80, targetRpe: 8.5, unit: 'kg', restSeconds: 180, isAmrap: false, askWeight: false },
            { index: 4, targetReps: 5, targetRepsMax: null, targetWeight: 80, targetRpe: 8.5, unit: 'kg', restSeconds: 180, isAmrap: false, askWeight: false },
            { index: 5, targetReps: 5, targetRepsMax: null, targetWeight: 80, targetRpe: 9, unit: 'kg', restSeconds: 180, isAmrap: true, askWeight: false },
          ],
        },
        {
          index: 2,
          id: 'ex-2',
          name: 'Bench Press',
          equipment: 'barbell',
          supersetGroup: null,
          supersetTag: null,
          warmupSets: [
            { index: 1, targetReps: 5, targetWeight: 20, unit: 'kg', isWarmup: true },
            { index: 2, targetReps: 5, targetWeight: 40, unit: 'kg', isWarmup: true },
          ],
          sets: [
            { index: 1, targetReps: 10, targetRepsMax: null, targetWeight: 60, targetRpe: 8, unit: 'kg', restSeconds: 120, isAmrap: false, askWeight: false },
            { index: 2, targetReps: 10, targetRepsMax: null, targetWeight: 60, targetRpe: 8, unit: 'kg', restSeconds: 120, isAmrap: false, askWeight: false },
            { index: 3, targetReps: 10, targetRepsMax: null, targetWeight: 60, targetRpe: 8.5, unit: 'kg', restSeconds: 120, isAmrap: false, askWeight: false },
          ],
        },
        {
          index: 3,
          id: 'ex-3',
          name: 'Lat Pulldown',
          equipment: 'cable',
          supersetGroup: 'A',
          supersetTag: 'A1',
          warmupSets: [],
          sets: [
            { index: 1, targetReps: 12, targetRepsMax: null, targetWeight: 45, targetRpe: 8, unit: 'kg', restSeconds: 60, isAmrap: false, askWeight: false },
            { index: 2, targetReps: 12, targetRepsMax: null, targetWeight: 45, targetRpe: 8, unit: 'kg', restSeconds: 60, isAmrap: false, askWeight: false },
            { index: 3, targetReps: 15, targetRepsMax: null, targetWeight: 45, targetRpe: 9, unit: 'kg', restSeconds: 60, isAmrap: true, askWeight: false },
          ],
        },
        {
          index: 4,
          id: 'ex-4',
          name: 'Triceps Rope Pushdown',
          equipment: 'cable',
          supersetGroup: 'A',
          supersetTag: 'A2',
          warmupSets: [],
          sets: [
            { index: 1, targetReps: 15, targetRepsMax: null, targetWeight: 25, targetRpe: 8, unit: 'kg', restSeconds: 90, isAmrap: false, askWeight: false },
            { index: 2, targetReps: 15, targetRepsMax: null, targetWeight: 25, targetRpe: 8.5, unit: 'kg', restSeconds: 90, isAmrap: false, askWeight: false },
            { index: 3, targetReps: 15, targetRepsMax: null, targetWeight: 25, targetRpe: 9, unit: 'kg', restSeconds: 90, isAmrap: false, askWeight: false },
          ],
        },
        {
          index: 5,
          id: 'ex-5',
          name: 'Hanging Leg Raise',
          equipment: null,
          supersetGroup: null,
          supersetTag: null,
          warmupSets: [],
          sets: [
            { index: 1, targetReps: 12, targetRepsMax: null, targetWeight: 0, targetRpe: null, unit: 'kg', restSeconds: 60, isAmrap: false, askWeight: false },
            { index: 2, targetReps: 12, targetRepsMax: null, targetWeight: 0, targetRpe: null, unit: 'kg', restSeconds: 60, isAmrap: false, askWeight: false },
            { index: 3, targetReps: 12, targetRepsMax: null, targetWeight: 0, targetRpe: null, unit: 'kg', restSeconds: 60, isAmrap: false, askWeight: false },
          ],
        },
      ],
    },
    '1-2': {
      programId: 'dummy-gzclp',
      programName: 'GZCLP 4-Day Strength',
      programVersion: 'dummyv1',
      week: 1,
      dayInWeek: 2,
      dayName: 'Week 1 / Day 2 : Overhead Press & Deadlift',
      unit: 'kg',
      outlineNameMatches: true,
      exercises: [
        {
          index: 1,
          id: 'ex-1',
          name: 'Overhead Press',
          equipment: 'barbell',
          supersetGroup: null,
          supersetTag: null,
          warmupSets: [
            { index: 1, targetReps: 5, targetWeight: 20, unit: 'kg', isWarmup: true },
            { index: 2, targetReps: 5, targetWeight: 30, unit: 'kg', isWarmup: true },
          ],
          sets: [
            { index: 1, targetReps: 5, targetRepsMax: null, targetWeight: 45, targetRpe: 8, unit: 'kg', restSeconds: 180, isAmrap: false, askWeight: false },
            { index: 2, targetReps: 5, targetRepsMax: null, targetWeight: 45, targetRpe: 8, unit: 'kg', restSeconds: 180, isAmrap: false, askWeight: false },
            { index: 3, targetReps: 5, targetRepsMax: null, targetWeight: 45, targetRpe: 8.5, unit: 'kg', restSeconds: 180, isAmrap: false, askWeight: false },
            { index: 4, targetReps: 5, targetRepsMax: null, targetWeight: 45, targetRpe: 8.5, unit: 'kg', restSeconds: 180, isAmrap: false, askWeight: false },
            { index: 5, targetReps: 5, targetRepsMax: null, targetWeight: 45, targetRpe: 9, unit: 'kg', restSeconds: 180, isAmrap: true, askWeight: false },
          ],
        },
        {
          index: 2,
          id: 'ex-2',
          name: 'Deadlift',
          equipment: 'barbell',
          supersetGroup: null,
          supersetTag: null,
          warmupSets: [
            { index: 1, targetReps: 5, targetWeight: 60, unit: 'kg', isWarmup: true },
            { index: 2, targetReps: 3, targetWeight: 80, unit: 'kg', isWarmup: true },
          ],
          sets: [
            { index: 1, targetReps: 10, targetRepsMax: null, targetWeight: 100, targetRpe: 8, unit: 'kg', restSeconds: 150, isAmrap: false, askWeight: false },
            { index: 2, targetReps: 10, targetRepsMax: null, targetWeight: 100, targetRpe: 8, unit: 'kg', restSeconds: 150, isAmrap: false, askWeight: false },
            { index: 3, targetReps: 10, targetRepsMax: null, targetWeight: 100, targetRpe: 8.5, unit: 'kg', restSeconds: 150, isAmrap: false, askWeight: false },
          ],
        },
        {
          index: 3,
          id: 'ex-3',
          name: 'Dumbbell Row',
          equipment: 'dumbbell',
          supersetGroup: null,
          supersetTag: null,
          warmupSets: [],
          sets: [
            { index: 1, targetReps: 12, targetRepsMax: null, targetWeight: 26, targetRpe: 8, unit: 'kg', restSeconds: 90, isAmrap: false, askWeight: false },
            { index: 2, targetReps: 12, targetRepsMax: null, targetWeight: 26, targetRpe: 8, unit: 'kg', restSeconds: 90, isAmrap: false, askWeight: false },
            { index: 3, targetReps: 15, targetRepsMax: null, targetWeight: 26, targetRpe: 9, unit: 'kg', restSeconds: 90, isAmrap: true, askWeight: false },
          ],
        },
      ],
    },
  };

  return {
    async listPrograms() {
      return programs;
    },

    async getProgramOutline(programId) {
      const match = programs.find((p) => p.id === programId) || programs[0];
      return {
        ...outline,
        programId: match.id,
        programName: match.name,
      };
    },

    async getDayPlan(programId, week, day) {
      const key = `${week}-${day}`;
      if (samplePlans[key]) {
        return samplePlans[key];
      }
      // Return a default plan for other days
      return {
        ...samplePlans['1-1'],
        week,
        dayInWeek: day,
        dayName: `Week ${week} / Day ${day}`,
      };
    },

    async finishWorkout(payload = {}) {
      return {
        status: 'SAVED',
        historyId: `dummy-history-${Date.now()}`,
        programUpdated: true,
        message: 'Saved to Liftosaur (Demo)',
      };
    },
  };
}
