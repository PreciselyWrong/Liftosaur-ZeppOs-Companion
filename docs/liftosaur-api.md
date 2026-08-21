# Liftosaur REST API

Contract register for the public Liftosaur Cloud API. Liftosaur is immutable and external:
only documented public interfaces are used.

Source: [Liftosaur REST API documentation](https://www.liftosaur.com/doc/api) and the
public [astashov/liftosaur](https://github.com/astashov/liftosaur) sources
(`lambda/api/v1.ts`, `lambda/utils/apiv1.ts`, `src/playground/playground.ts`,
`src/liftohistory/liftohistorySerializer.ts`). Verified against a live account
on 2026-08-14.

## Access

| Item | Value | Status |
| --- | --- | --- |
| Base URL | `https://www.liftosaur.com/api/v1` | CONFIRMED |
| Auth | `Authorization: Bearer <key>` | CONFIRMED |
| Key format | `lftsk_…` | CONFIRMED |
| Requirement | Premium subscription | CONFIRMED |
| Response envelope | `{ "data": { … } }` | CONFIRMED |
| Error codes | 400, 401, 403, 404, 422 | CONFIRMED |
| Rate limits | not documented | UNKNOWN |
| Idempotency keys | none | CONFIRMED |

The key lives on the phone, inside the Side Service, and never reaches the watch or a log.

## Endpoints used by this project

### Programs

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/programs` | - | `{programs: [{id, name, isCurrent}]}` |
| GET | `/programs/:id` | - | `{id, name, text, isCurrent}` |
| PUT | `/programs/:id` | `{text?, name?}` | `{id, name, text, isCurrent}` |

`id` may be the literal `current` to address the active program. `text` is Liftoscript
source. There is no ETag and no version field, so the base text is fingerprinted locally
and compared before any write - see [risks.md](risks.md).

The official client also stores its current workout position in `program.nextDay`. That
field is not exposed by the REST API: program responses omit it, and program updates accept
only `text` and optional `name`. Updating a program's text therefore cannot advance the
official phone app's selected day.

### History

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/history` | query `limit` (max 200), `startDate`, `endDate`, `cursor` | `{records: [{id, text}], hasMore, nextCursor}` |
| GET | `/history/:id` | - | `{id, text}` |
| POST | `/history` | `{text}` in Liftohistory format | `{id, text}` |
| PUT | `/history/:id` | `{text}` | `{id, text}` |
| DELETE | `/history/:id` | - | `{deleted: true}` |

`POST /history` is **not idempotent and has no idempotency key**. A lost response means
`UNKNOWN_COMMIT_STATE`: `GET /history` is searched for a record with the same `dayName`
and the exact program, day and start time before any retry.

The API links a record carrying `program`, `week` and `dayInWeek` to the matching program
and resolves its numeric program day. It does not update `program.nextDay`. Consequently,
a workout finished through this API appears in Liftosaur history and can update program
progression, while the official phone app remains pointed at the completed day. There is no
safe client-side workaround through the documented API.

`PUT` is what makes a workout visible while it happens: the first completed set creates the
record, every set after it updates the same one, and the finish replaces its text with the
authoritative playground output. One session is always one record. `DELETE` removes it when
the user discards the session.

### Playground

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/playground` | `{programText, week?, day?, commands?}` | `{workout, updatedProgramText?}` |

- `week` is the 1-based week; `day` is the 1-based day **within that week**, not a global
  index. Server side this is `Program_getDayNumber(program, week, day)`.
- Commands: `complete_set(ex, set)`, `change_weight(ex, set, 82.5kg)`,
  `change_reps(ex, set, 8)`, `change_rpe(ex, set, 9)`, `change_set_time(ex, set, 30)`,
  `set_state_variable(ex, name, value)`, `finish_workout()`. Indices are 1-based and count
  working sets only.
- `updatedProgramText` is returned only when `finish_workout()` ran. It is a normalized
  rewrite of the whole program, so it usually differs textually even when the prescription
  did not change.
- Out-of-range indices abort the whole run with `Exercise N not found` or
  `Set N not found for exercise M`.

Playground is the single source of truth for Liftoscript evaluation and progression. This
project never reimplements those calculations.

#### `workout` is a record, not a prescription

`workout` is serialized by `LiftohistorySerializer_serialize`, which **skips every exercise
with no completed set**. A playground run with no commands therefore returns an empty
`exercises: {}` block, whatever the day contains.

The prescription is carried by the `target:` section, which is emitted per exercise once
that exercise has at least one completed set. Reading a day's prescription therefore takes
a two-call probe:

1. Run the day with `complete_set(i, 1)` for `i = 1..32`. The run aborts on the first index
   that does not exist, and the error names it: `Exercise 7 not found` means six exercises.
2. Run the day again with `complete_set(i, 1)` for `i = 1..6` and read the `target:` of each
   exercise.

The probe result is used for display only; it is thrown away and never submitted. The
ceiling doubles and the probe repeats if no index was rejected.

**Not obtainable this way:** warmup sets and superset grouping.

Verified on 2026-08-14 with a program declaring `warmup: 1x8 40kg, 1x5 60kg, 1x3 70kg` and
`superset: A`: after completing every working set, the playground answered
`Decline Bench Press / 3x8 80kg / target: 3x8 80kg @8 120s` - no `warmup:` line and no
superset marker. `complete_set(1, 1)` addresses the first *working* set, so no command can
complete a warmup, and `LiftohistorySerializer_serialize` writes no superset marker at all.

This is a limit of the **playground**, not of the API. Both prescriptions exist elsewhere:

- `warmup:` is part of the Liftohistory grammar and appears in `GET /history` records for
  workouts logged in the Liftosaur app, where the warmups were actually completed.
- Both `warmup:` and `superset:` are named fields on the exercise line of the Liftoscript
  source returned by `GET /programs/:id`.

Recovering them therefore means reading the day's block in the program text. Absolute
warmup weights (`1x8 40kg`) are exact. Percentages (`1x8 40%`) are not: resolving one needs
the working weight - which `target:` provides - **and** the loadable-weight rounding, which
is `Weight_calculatePlates`: a recursive search over the gym's plate inventory, using
`GET /exercise-data` (`rounding`) and `GET /gyms/:gymId/equipment` (`bar`, `multiplier`,
`plates`, `fixed`). It rounds to the nearest achievable load, not to a fixed step - a
simple increment rule does not reproduce it.

### Program stats

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/program-stats` | `{programText}` | `{days: [{name, approxMinutes, workingSets}], totalWeeklySets, muscleGroups[]}` |

`days` lists the days of **week 1 only**, so it cannot enumerate a multi-week program.
Week and day enumeration is read from the program's `#` and `##` headers instead, then
verified against the `week` / `dayInWeek` / `dayName` the playground echoes back.

### Reference data

Fetched once per Side Service lifetime by [`app-side/reference-data.js`](../../app-side/reference-data.js),
because it changes rarely and every warmup resolution needs it.

| Method | Path | Response |
| --- | --- | --- |
| GET | `/gyms` | `{currentGymId, gyms: [{id, name, isCurrent, equipmentCount}]}` |
| GET | `/gyms/:gymId/equipment` | `{gymId, equipment: [{id, name, isCustom, isDeleted, bar: {lb, kg}, multiplier, isFixed, plates: [{weight, num}], fixed: [], useBodyweightForBar?}]}` |
| GET | `/exercise-data` | `{exerciseData: [{key, exerciseName, rm1?, rounding?, equipment?, notes?, isUnilateral?}]}` |

`equipment` on an exercise is **keyed by gym id**, e.g. `{"gymId1": "barbell", "default": "barbell"}`,
so the current gym wins and `default` is the fallback. `rounding` appears only when the user
overrode it. Weights are strings carrying their unit (`"2.5kg"`, `"45lb"`), and `num` is the
total count on hand - with `multiplier: 2` a `num: 2` plate makes **one** pair.

### Loadable-weight rounding: it floors

`Weight_calculatePlates` is described in the source as nearest-neighbour. It is not, and the
account's own history proves it - a program declaring `warmup: 1x8 40%, 1x5 70%, 1x3 85%`
against an 87.5 kg working set was logged by Liftosaur as `35kg, 60kg, 72.5kg`:

| Target | Nearest achievable | Liftosaur wrote |
| --- | --- | --- |
| 74.375 (85% of 87.5, barbell) | 75 | **72.5** |
| 54 (60% of 90, cable) | 55 | **52.5** |

Both round **down**. The rule is: the largest load achievable at or below the target, given
the bar and the plates actually on hand. Implemented in
[`shared/weight-rounding.js`](../../shared/weight-rounding.js) and pinned by those two cases
in `tests/weight-rounding.test.js`. Warmup percentages are of the **first working set
weight**, not of `rm1`.

### Not exposed by any endpoint

- **Default warmups.** The Liftoscript reference states "default warmups auto-added unless
  overridden" - they are generated by the Liftosaur client and never stored, so an exercise
  with no explicit `warmup:` section has none to read back.
- **Default timers.** The `?` in `60s|?` falls back to a global user setting. There is no
  `/settings` route.
- **Built-in exercise → default equipment.** `Bench Press` alone means
  `Bench Press, Barbell`, but that table lives in the client. `GET /exercise-data` only
  covers exercises the user customized.

Each of these makes a resolution impossible rather than approximate, so the affected value
is reported as unresolved and shown as a percentage instead of a wrong weight.

### Not used in V1

`/measurements`, and the `POST`/`DELETE` program verbs.

## Liftohistory format

```text
2026-02-28T10:45:30Z / program: "5/3/1" / dayName: "Push Day" / week: 1 / dayInWeek: 5 / duration: 1235s / exercises: {
  // optional note
  Bench Press, Barbell / 3x8 185lb @7, 1x6 185lb @9 / warmup: 1x10 95lb / target: 3x8-12 185lb @8 90s
}
```

- Fields are separated by ` / `, so a slash inside a program name is safe.
- Set notation: `<count>x<reps>[-<maxReps>][|<leftReps>][+] <weight><unit> [@<rpe>[+]] [<timer>s]`.
  `+` after reps is AMRAP, `+` after RPE means the user logged it, `|` is unilateral,
  and the timer appears in `target:` only.
- Units are always explicit (`kg` or `lb`).

Implemented by [`shared/liftohistory.js`](../../shared/liftohistory.js).

## Rules

- Every HTTP call goes through `LiftosaurApiClient`. No `fetch()` anywhere else.
- `Authorization`, `Bearer`, and `lftsk_*` are redacted from all logs and diagnostics.
- No endpoint, field or Liftoscript semantic is inferred: it is read from the documentation
  or the public sources, and confirmed against a live call.
