# Liftosaur REST API

Contract register for the public Liftosaur Cloud API. Liftosaur is external and immutable:
only documented public interfaces are used.

Source: [Liftosaur REST API documentation](https://www.liftosaur.com/doc/api) ("Running a Workout"
and related sections) and verified against live accounts.

## Access & Client Identity

| Item | Value | Status |
| --- | --- | --- |
| Base URL | `https://www.liftosaur.com/api/v1` | CONFIRMED |
| Auth | `Authorization: Bearer <key>` | CONFIRMED |
| Key format | `lftsk_...` | CONFIRMED |
| Requirement | Premium subscription | CONFIRMED |
| Response envelope | `{ "data": { ... } }` | CONFIRMED |
| Device ID Header | `X-Liftosaur-Device-Id: <uuid>` | CONFIRMED (required on workout writes) |
| Client Header | `X-Liftosaur-Client: <name/version>` | CONFIRMED (required on workout writes) |
| Error structure | `{ "error": { "code": "...", "message": "..." } }` | CONFIRMED |
| Error codes | 400, 401, 403, 404, 409, 422 | CONFIRMED |

The API key is stored only on the phone in Zepp `settingsStorage` and never reaches the watch
or diagnostic logs. A stable installation ID (`liftosaurDeviceId`) is generated once in phone
settings storage and transmitted in `X-Liftosaur-Device-Id` alongside `X-Liftosaur-Client`.

---

## Running a Workout API (Protocol v3 / Primary Cloud Contract)

Liftosaur Cloud is the shared source of truth for active workouts. The Running a Workout API
manages the full workout lifecycle with atomic progression updates and cross-device continuity.

### Endpoints

| Method | Path | Body / Query | Response | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/workout/next` | query: `programId?`, `week?`, `dayInWeek?` | `{ workout }` | Preview upcoming scheduled workout or explicit day selection |
| POST | `/workout/start` | body: `{ programId?, week?, dayInWeek?, startTime? }` | `{ workout }` | Create the shared active workout on Cloud with real start time |
| GET | `/workout/current` | - | `{ workout }` or `{ workout: null }` | Read active workout state; enables cross-device continuation |
| POST | `/workout/set` | body: `{ entryId, setId, completed, append? }` | `{ workout }` | Log a single completed set with authoritative server evaluation |
| POST | `/workout/sets` | body: `{ sets: [...] }` | `{ workout }` | Drain a batch of queued completed sets in order |
| POST | `/workout/finish` | body: `{ startTime, endTime, intervals?, notes? }` | `{ workout }` | Atomically finish workout, record history, apply progression, and advance `nextDay` |
| DELETE | `/workout/current` | body: `{ startTime }` | `{ deleted: true }` | Discard active workout on Cloud after explicit user confirmation |
| GET | `/settings` | - | `{ units, timers: { warmup, workout, superset } }` | Read user default units and default rest timer intervals |

### Set Structure and Prescriptions

`GET /workout/next` and `GET /workout/current` return a fully resolved `workout` object.
Each set in `entries[].sets` and `entries[].warmupSets` includes:

- `setId`: stable server identifier for the set.
- `weight`: formatted weight string (e.g., `"80kg"`, `"175lb"`).
- `plates`: pre-calculated loadable plate combinations matching the gym inventory.
- `reps`, `minReps`: prescribed reps or rep ranges.
- `rpe`, `logRpe`: target RPE and whether RPE logging is requested.
- `timer`, `restSeconds`: resolved rest timer duration using user preferences.
- `isWarmup`, `isAmrap`, `isUnilateral`, `askWeight`: exercise and set modifiers.
- `superset`: superset group identifier for pairing exercises.
- `hasUpdateScript`: indicates exercise update logic executes on completion.
- `completed`: object containing recorded `reps`, `weight`, `rpe`, `setTimer`, or `null` if uncompleted.

The watch renders these pre-resolved values directly without guessing missing values or recalculating plate math locally.

### Set Synchronization & Batch Draining

1. Completing a set immediately persists the event to the local watch journal and enqueues it.
2. `POST /workout/sets` drains queued sets in chronological order.
3. Writes are repeat-safe: re-submitting an already-logged set returns confirmed server state.
4. When all local pending writes are acknowledged, the watch adopts the authoritative server response, applying any dynamic changes from `hasUpdateScript` or phone-side edits.
5. While sets remain in the local queue, the watch preserves local unacknowledged edits and defers adopting full remote snapshots until the queue is empty.
6. A failed set queue blocks finishing until connectivity is restored or the user resolves it.

### Polling & Cross-Device Continuation

- Meaningful workout navigation requests `GET /workout/current`, while passive checks run every 15 seconds. All reads share a 10-second floor, repeated requests coalesce, and failures back off to 30, 60 and 120 seconds.
- Polling allows a user to start on watch and view on phone, or vice-versa.
- If the phone app modifies or completes a set, the watch adopts the full server state once its own local write queue is empty and no newer local set action raced the read.
- If polling returns an empty workout (`workout: null`) or a conflicting workout while the watch has active local state, the watch opens an explicit recovery prompt and never silently clears local data.

### Atomic Finalisation

`POST /workout/finish` requires `startTime`, `endTime`, and optional `intervals` (pause tracking):
- Atomically creates the history record in Liftosaur Cloud.
- Computes and applies program progression rules.
- Updates 1RM records.
- Advances the official phone app `nextDay` pointer.
- Cleans up the active running session in Cloud.

### Known API Limits

- **Timed sets (`setTimer`) & Prompted Variables (`promptedVars`)**: sets requiring interactive script variable prompts or live stopwatch countdowns ask the user to complete that set in the official Liftosaur phone app. The watch then polls and adopts the completed set.
- **Native workout activity**: direct sync does not create a Zepp native workout activity. Native workout integration remains separately gated by real-device testing.

---

## Legacy REST API (Historical Context & Fallbacks)

The legacy REST endpoints below represent the older v1 architecture. They are retained strictly
for one-time recovery of v1 local snapshots. Demo mode remains fully local.
They do NOT represent the normal Cloud architecture.

### Legacy Programs & History Endpoints

| Method | Path | Purpose in Legacy Flow |
| --- | --- | --- |
| GET | `/programs` | List programs |
| GET | `/programs/:id` | Read Liftoscript source text |
| PUT | `/programs/:id` | Write updated Liftoscript source |
| GET | `/history` | Query past workout history |
| POST | `/history` | Append a completed Liftohistory record |
| POST | `/playground` | Execute Liftoscript commands and compute progression text |
| POST | `/program-stats` | Get exercise stats for week 1 |
| GET | `/gyms`, `/gyms/:id/equipment`, `/exercise-data` | Gym equipment and plate inventory |

### Legacy Pointer & Replay Limitations

In the legacy raw REST API:
- `program.nextDay` was not exposed by the REST API: program responses omitted it, and program updates accepted only `text` and optional `name`. Consequently, legacy REST writes did not advance the official Liftosaur phone app selected day pointer.
- `POST /playground` required two-call probing to discover exercise counts and targets because empty playground runs returned no exercise blocks.
- `POST /history` was not idempotent and required searching history by timestamp on lost responses (`UNKNOWN_COMMIT_STATE`).

All normal Cloud operations over Protocol v3 use the official Running a Workout API (`/workout/*`) described above.

---

## Liftohistory Format (Diagnostic & Legacy Reference)

```text
2026-02-28T10:45:30Z / program: "5/3/1" / dayName: "Push Day" / week: 1 / dayInWeek: 5 / duration: 1235s / exercises: {
  Bench Press, Barbell / 3x8 185lb @7, 1x6 185lb @9 / warmup: 1x10 95lb / target: 3x8-12 185lb @8 90s
}
```

- Fields are separated by ` / `.
- Set notation: `<count>x<reps>[-<maxReps>][|<leftReps>][+] <weight><unit> [@<rpe>[+]] [<timer>s]`.
- Implemented by `shared/liftohistory.js`.

---

## Rules

- Every HTTP call goes through `LiftosaurApiClient`. No `fetch()` calls anywhere else.
- `Authorization`, `Bearer`, and `lftsk_*` are redacted from all logs and diagnostics.
- No endpoint, field or Liftoscript semantic is inferred: contracts follow official documentation and verified API responses.
- ASCII hyphens only throughout documentation.
