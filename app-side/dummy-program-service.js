/**
 * Dummy Program Service for screenshots, testing, and UI preview.
 *
 * Provides realistic Liftosaur data with complete workouts, warmups,
 * superset groups, and clean progression so every screen can be screenshotted.
 */

function demoDetails(exerciseNotes, latestNote, latestDate = '2026-08-18') {
  return {
    exerciseNotes,
    historyNotes: `Past sessions\n• ${latestDate}: ${latestNote}`,
  };
}

const DEMO_ROW_IMAGE_URL = 'https://www.liftosaur.com/externalimages/exercises/ogimages/dumbbell-bent-over-one-arm-row.png';

const DEMO_LOADING_EQUIPMENT = {
  barbell: {
    id: 'barbell',
    bar: { kg: '20kg', lb: '45lb' },
    multiplier: 2,
    isFixed: false,
    plates: [
      { weight: '20kg', num: 4 },
      { weight: '15kg', num: 2 },
      { weight: '10kg', num: 2 },
      { weight: '5kg', num: 2 },
      { weight: '2.5kg', num: 2 },
      { weight: '1.25kg', num: 2 },
    ],
    fixed: [],
  },
  cable: {
    id: 'cable',
    bar: { kg: '5kg', lb: '10lb' },
    multiplier: 1,
    isFixed: false,
    plates: [
      { weight: '20kg', num: 2 },
      { weight: '10kg', num: 2 },
      { weight: '5kg', num: 4 },
      { weight: '2.5kg', num: 2 },
    ],
    fixed: [],
  },
  dumbbell: {
    id: 'dumbbell',
    bar: { kg: '0kg', lb: '0lb' },
    multiplier: 1,
    isFixed: true,
    plates: [],
    fixed: ['5kg', '10kg', '15kg', '20kg', '22.5kg', '25kg', '26kg', '30kg'],
  },
};

function addLoadingEquipment(plan) {
  return {
    ...plan,
    exercises: plan.exercises.map((exercise) => ({
      ...exercise,
      loadingEquipment: DEMO_LOADING_EQUIPMENT[exercise.equipment] || null,
    })),
  };
}

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
      dayInWeek: 1,
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
          ...demoDetails(
            'Keep your whole foot planted, brace before descending, and drive straight up.',
            'Depth felt consistent. Keep the same stance next time.',
          ),
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
          ...demoDetails(
            'Set your shoulder blades, keep your feet planted, and touch the lower chest.',
            'Bench at rack height 6. Left shoulder felt good.',
          ),
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
          ...demoDetails(
            'Pull your elbows toward your ribs without leaning back or shrugging.',
            'Use the medium neutral handle again.',
          ),
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
          ...demoDetails(
            'Keep your elbows fixed and separate the rope at full extension.',
            'Cable station 2 felt smoother.',
          ),
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
          ...demoDetails(
            'Curl your pelvis toward your ribs and avoid swinging between repetitions.',
            'Pause briefly at the top.',
          ),
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
          ...demoDetails(
            'Brace your trunk, keep the bar close, and finish with your head through.',
            'Grip one finger narrower. Bar path was cleaner.',
          ),
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
          ...demoDetails(
            'Brace before pulling, keep the bar against your legs, and push the floor away.',
            'Use the flat platform. Mixed grip was secure.',
          ),
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
          imageUrl: DEMO_ROW_IMAGE_URL,
          ...demoDetails(
            'Keep your torso still and pull the dumbbell toward your hip.',
            'Use the adjustable bench at setting 3.',
          ),
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

  samplePlans['1-2'].exercises.push(...[
    { id: 'timed-side-plank', name: 'Side Plank', isUnilateral: true },
    { id: 'timed-plank', name: 'Plank', isUnilateral: false },
  ].map((exercise, index) => ({
    id: exercise.id,
    name: exercise.name,
    index: index + 4,
    ...demoDetails(
      'Keep your hips level and breathe steadily throughout the hold.',
      'Held both sets for 30 seconds.',
      '2026-09-10',
    ),
    equipment: null,
    supersetGroup: null,
    supersetTag: null,
    warmupSets: [],
    sets: [1, 2].map((setIndex) => ({
      index: setIndex,
      targetReps: 1,
      targetWeight: 0,
      unit: 'kg',
      setTimer: 30,
      isUnilateral: exercise.isUnilateral,
      restSeconds: 60,
      isAmrap: false,
      askWeight: false,
    })),
  })));

  return {
    mode: 'DEMO',

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
        return addLoadingEquipment(samplePlans[key]);
      }
      // Return a default plan for other days
      return addLoadingEquipment({
        ...samplePlans['1-1'],
        week,
        dayInWeek: day,
        dayName: `Week ${week} / Day ${day}`,
      });
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
