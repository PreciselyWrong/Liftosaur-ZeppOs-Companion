# Device <-> Side Service Protocol

Version **3**. Implemented by [`shared/protocol.js`](../shared/protocol.js).

Version 3 adds the shared running-workout lifecycle. Version 2 is an intentionally rejected legacy
protocol: the two versions disagree about workout lifecycle ownership and data contracts.

## Envelope

```json
{
  "protocolVersion": 3,
  "messageId": "m3k9x1-a7b2c9d",
  "type": "GET_WORKOUT_NEXT",
  "sessionId": null,
  "replyToId": null,
  "payload": {}
}
```

Every response carries `replyToId` set to the request's `messageId`.

## Messages

| Request | Payload | Response | Payload | Purpose |
| --- | --- | --- | --- | --- |
| `PING` | anything | `PONG` | `{ serverTime, echo }` | Link heartbeat and time check |
| `GET_SETTINGS` | - | `SETTINGS_DATA` | `{ units, timers: { warmup, workout, superset } }` | Retrieve user default units and rest timers |
| `LIST_PROGRAMS` | - | `PROGRAMS_DATA` | `{ programs: [{ id, name, isCurrent }], serviceMode }` | List user programs from catalog |
| `GET_PROGRAM_OUTLINE` | `{ programId }` | `PROGRAM_OUTLINE_DATA` | `{ programId, programName, programVersion, totalWeeks, totalDays, weeks[], lastWorkout }` | Header-based program outline |
| `GET_WORKOUT_NEXT` | `{ week?, dayInWeek?, programId? }` | `WORKOUT_NEXT_DATA` | `{ workout }` | Preview next scheduled or selected day workout |
| `GET_WORKOUT_CURRENT` | - | `WORKOUT_CURRENT_DATA` | `{ workout }` | Poll or resume active running workout |
| `START_WORKOUT` | `{ programId?, week?, dayInWeek?, startTime }` | `START_WORKOUT_DATA` | `{ workout }` | Start active workout on Cloud with watch's real start time |
| `SYNC_WORKOUT_SETS` | `{ sets: [{ entryId, setId, completed, append? }] }` | `SYNC_WORKOUT_SETS_RESULT` | `{ workout }` | Drain a batch of locally completed sets in order |
| `FINISH_WORKOUT` | `{ startTime, endTime, intervals?, notes? }` | `FINISH_WORKOUT_RESULT` | `{ workout }` | Atomically finish workout, apply progression, update 1RM and `nextDay` |
| `DISCARD_WORKOUT` | `{ startTime }` | `DISCARD_WORKOUT_RESULT` | `{ deleted: true }` | Explicitly discard active Cloud session |
| `GET_DAY_PLAN` (legacy) | `{ programId, week, day }` | `DAY_PLAN_DATA` | `{ ... }` | Legacy playground day plan probe (demo mode only) |
| `ABANDON_WORKOUT` (legacy) | `{ dayName, startedAt, abandonedAt }` | `ABANDON_WORKOUT_RESPONSE` | `{ abandoned: true }` | Local session discard (demo mode only) |

---

## Direct Synchronization Semantics

### Workout Discovery & Launch

On launch in Cloud mode, the watch requests `GET_SETTINGS`, then `GET_WORKOUT_CURRENT`:
- If `GET_WORKOUT_CURRENT` returns an active workout (`workout !== null`), the watch opens that shared session immediately.
- Otherwise, the watch requests `GET_WORKOUT_NEXT`. It returns the official scheduled workout, displayed directly on the home screen without requiring history inference.
- If the user selects a custom program, week, or day, `GET_WORKOUT_NEXT` is called with `{ programId, week, dayInWeek }` to preview that specific day.

### Workout Start

`START_WORKOUT` sends the watch's real timestamp as `startTime`. The Cloud creates the shared
active workout, returning the initial server snapshot.

### Set Synchronization

1. Completing a set persists the event to local storage immediately and queues the set write.
2. `SYNC_WORKOUT_SETS` submits queued sets in order via `POST /workout/sets`.
3. Set writes are repeat-safe: retrying a set write does not create duplicate entries.
4. When `SYNC_WORKOUT_SETS_RESULT` returns, the server response contains updated state including results of any exercise update scripts (`hasUpdateScript`).
5. The watch adopts the server snapshot only when all local queued sets have been acknowledged.

### Polling Interval Guard

The watch polls `GET_WORKOUT_CURRENT` during active workouts to support cross-device continuation
(e.g., set logged on phone app). Polling is throttled to no faster than once every 15 seconds.
Server snapshots received via polling are adopted only when the local write queue is empty.

### Finalisation & Discard

- `FINISH_WORKOUT` sends `startTime`, `endTime`, and preserved pause `intervals`. The server atomically commits history, updates progression, recalculates 1RM, and advances the phone `nextDay` pointer.
- A non-empty set queue blocks `FINISH_WORKOUT` until all sets are confirmed synced.
- `DISCARD_WORKOUT` is issued only after explicit user confirmation, deleting the remote active workout via `DELETE /workout/current`.

---

## Errors

Any request may respond with `ERROR` carrying `{ code, message }`.

| Code | Meaning |
| --- | --- |
| `INVALID_ENVELOPE` | Unsupported protocol version, missing messageId, unknown type, or malformed payload |
| `UNSUPPORTED_TYPE` | Valid envelope, unhandled message type |
| `NOT_CONFIGURED` | No Liftosaur API key configured in phone settings |
| `API_FAILED` | Upstream Liftosaur API error (maps HTTP 400, 401, 403, 404, 409, 422) |

---

## Ordering and Durability

The invariant order is: **persist locally -> render UI -> sync across BLE / HTTP.**

A user tap never blocks on BLE or HTTP. All active workout state (plan, journal, unacknowledged set
queue, pause intervals, finish/discard intent) is written to durable watch storage before network
transmission. If the watch crashes or reboots, local state is fully recovered and pending operations
are safely resumed or retried.
