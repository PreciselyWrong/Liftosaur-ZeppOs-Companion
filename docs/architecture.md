# Architecture

## Components and Boundaries

| Component | Runs on | Owns | Never owns |
| --- | --- | --- | --- |
| Standalone App (mini program) | Watch | Liftosaur UI, touch state machine, HR sensor via `@zos/sensor`, local journal and write queue | Direct HTTP, raw secret keys |
| Device App Storage | Watch | Durable local event journal, active session state, pending set queue, pause intervals, finish/discard intent | Server-wide progression state |
| Side Service | Phone | API key, stable installation identity (`X-Liftosaur-Device-Id`), HTTPS communication to Liftosaur Cloud | UI rendering, watch sensor state |
| Liftosaur Cloud | Remote | Shared active workout state, programs, history, exercise update scripts, progression, 1RM calculations, and `nextDay` pointer | Local UI / device state |

Single-ownership rule: each datum has exactly one authoritative owner. The app is the sole owner
of the watch heart-rate sensor. Liftosaur Cloud is the sole source of truth for active workout
prescriptions and progression.

---

## Who Decides What

The watch decides nothing about workout prescriptions or progressions. It asks, and Liftosaur Cloud answers:

| Question | Answered by |
| --- | --- |
| Which programs exist? | `GET /programs` (or cached outline) |
| Which workout is next? | `GET /workout/next` (official Cloud schedule) |
| Which day am I doing? | **The user**, by confirming the next day or selecting an explicit program/week/day |
| Which exercises, sets, reps, weights, RPE, rest, plates, warmups, supersets? | `GET /workout/next` or `GET /workout/current` (pre-resolved by Cloud) |
| What changes when a set completes? | `POST /workout/sets` (server executes update scripts and returns new state) |
| What does this session change in my program progression and history? | `POST /workout/finish` (atomic server-side progression, 1RM, and `nextDay` update) |

---

## Selection and Launch Flow

On startup in Cloud mode, the watch queries `GET_SETTINGS`, `GET_WORKOUT_CURRENT`, and `GET_WORKOUT_NEXT`:

```text
Launch
  │
  ├──▶ GET_WORKOUT_CURRENT (active workout exists?)
  │       │
  │       ├──▶ Yes ──▶ Open the shared workout (cross-device continuity)
  │       │
  │       └──▶ No ──▶ GET_WORKOUT_NEXT ──▶ Home screen shows scheduled next day
  │                                                │
  │                                                └──▶ Or open Program / Week / Day picker
  ▼                                                               │
START_WORKOUT (POST /workout/start) ◀─────────────────────────────┘
  ▼
READY ──▶ ACTIVE_SET ⇄ REST ──▶ FINISHING
  ▼
SYNC_WORKOUT_SETS (POST /workout/sets, repeat-safe queue drain)
  ▼
FINISH_WORKOUT (POST /workout/finish, atomic Cloud history + progression + pointer)
```

In the legacy v1 REST flow (now retained only for legacy snapshot recovery), a
history-based suggestion was independent of the official phone app day pointer because raw REST
writes did not advance it. Under the Running a Workout API (Protocol v3), `GET /workout/next`
provides the official scheduled workout directly, and `POST /workout/finish` advances the official
phone pointer automatically.

---

## Rendering the Clock and Metrics

A full re-render tears down and rebuilds widgets, which on physical hardware can drop seconds
during active countdowns. The elapsed time, heart rate, and rest timer widgets are registered
as live widgets and patched in place using `setProperty(prop.MORE, ...)`, re-sending geometry
safely. The timer samples every 250 ms and updates the display only when the displayed second
changes.

---

## Data Flow & Synchronization

```text
Watch UI  ──tap──▶  Local Journal & Set Queue (persist first)
        │                  │
        │                  ▼
        │            UI update (instant feedback)
        ▼
Device <-> Side Service Protocol v3 (BLE / ZML)
        ▼
Side Service ──HTTPS (with X-Liftosaur-Device-Id)──▶ Liftosaur Cloud (/workout/*)
```

The ordering is strictly: **persist locally -> render UI -> sync asynchronously.**

A user tap never blocks on BLE or HTTP.

---

## Active Workout Synchronization & Queuing

1. **Set Logging**: Completing a set immediately persists the record in the watch journal and queues the set write.
2. **Queue Draining**: `POST /workout/sets` drains queued sets in order.
3. **Repeat-Safe**: Set writes carry stable set identifiers. Start, finish, and discard carry the workout start time, making retries safe.
4. **Snapshot Adoption**: When the local set queue is empty, the watch adopts the authoritative server snapshot returned by `POST /workout/sets` or `GET /workout/current`. Dynamic script updates (`hasUpdateScript`) and phone-side edits are applied cleanly.
5. **Adaptive Refresh**: Meaningful workout navigation requests a current-workout refresh, while passive checks run every 15 seconds. A shared coordinator coalesces requests, enforces a 10-second global floor, and backs failures off to 30, 60 and 120 seconds. The watch adopts phone changes only when its local write queue is empty and no local set write started during the read.
6. **Conflict Handling**: If a remote workout is missing or reports a conflicting start time, the watch opens an explicit user recovery dialog and never silently deletes local session data.

---

## Finalisation

Finishing a workout is an atomic cloud transaction:
- `POST /workout/finish` sends the real `startTime`, `endTime`, and preserved pause `intervals`.
- Liftosaur Cloud atomically commits the history record, updates program progression, recalculates 1RM values, advances `nextDay`, and clears the active session.
- A non-empty local set queue blocks finish submission until all sets are confirmed synced.
- Discarding a workout (`DELETE /workout/current`) requires explicit user action.

---

## Durability and Crash Recovery

- **Watch Persistence**: Every state change (plan, completed sets, queued sync items, pause intervals, finish/discard intent) is persisted to watch storage before rendering.
- **App Restart**: If the watch app is killed or restarts mid-session, `restoreSession()` restores the exact active set, elapsed time, and unacknowledged sync queue.
- **Network Resilience**: The watch functions fully offline. Sets accumulate safely in the local queue and sync when connectivity returns.

---

## Known Limits & Notes

- **Timed Sets & Prompted Variables**: Sets with live timer countdowns (`setTimer`) or custom interactive script variables (`promptedVars`) ask the user to complete that set on the official Liftosaur phone app. The watch then polls and adopts the completed set.
- **Native Workout Activity**: Direct sync does not create a Zepp native workout activity. Native workout integration remains separately gated by real-device testing.
- **Legacy Replay & Fallbacks**: The old Playground replay and raw `/history` + `/programs` write flow remains only for one-time recovery of v1 local snapshots.

---

## Key Handling & Identity

- The Liftosaur API key (`lftsk_...`) is entered in the phone Settings App and remains strictly in phone storage. It is never sent over BLE or logged.
- The phone generates a random, stable installation ID stored in phone `settingsStorage` (`liftosaurDeviceId`). This identifier is sent in the `X-Liftosaur-Device-Id` HTTP header to coordinate running workout sync.

---

## Status

Implemented and unit-tested against recorded and live Running a Workout API contracts (Protocol v3).
