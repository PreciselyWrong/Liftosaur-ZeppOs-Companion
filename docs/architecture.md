# Architecture

## Components and boundaries

| Component | Runs on | Owns | Never owns |
| --- | --- | --- | --- |
| Standalone app (mini program) | Watch | The Liftosaur UI, its touch state machine and the HR sensor via `@zos/sensor` | Liftoscript evaluation, network |
| Device App storage | Watch | Durable local event journal, current session state | API key, HTTP |
| Side Service | Phone | API key, HTTPS to Liftosaur, retries, conflict detection | UI, session truth, workout content |
| Liftosaur Cloud | Remote | Programs, weeks and days, prescriptions, history, Liftoscript evaluation, progression | Anything local |

Single-ownership rule: each datum has exactly one owner. The app is the sole owner of the
heart-rate sensor and never starts a second one.

## Who decides what

The watch decides nothing about the content of a workout. It asks, the API answers:

| Question | Answered by |
| --- | --- |
| Which programs exist? | `GET /programs` |
| Which weeks and days does a program have? | The program's `#` / `##` headers, verified against the playground's `week` / `dayInWeek` echo |
| Which day am I doing? | **The user**, by tapping it |
| Which exercises, sets, reps, weights, RPE, rest? | `POST /playground`, `target:` sections |
| What does this session change in my program? | `POST /playground` with `finish_workout()` |
| Where is the workout stored? | `POST /history` |

There is no local Liftoscript evaluation, no next-day heuristic and no name-based filtering
of days or exercises. [`shared/liftoscript-outline.js`](../../shared/liftoscript-outline.js)
reads two grammar tokens — `# week` and `## day` — and nothing else.

## Selection flow

The launch path fetches the active program's outline immediately, so the home screen can
offer its next day behind a single button. The full picker sits one tap away.

```
LIST_PROGRAMS ──▶ GET_PROGRAM_OUTLINE (active program) ──▶ home: start next day
        │                                                        │
        └──▶ user taps a program ──────────────────────────────┐ │
        ▼                                                      ▼ │
GET_PROGRAM_OUTLINE ──▶ user taps a week ──▶ user taps a day ◀───┘
        ▼
GET_DAY_PLAN  (probe: playground reports the exercise count, then its targets)
        ▼
READY → ACTIVE_SET → REST → … → FINISHED
        ▼
FINISH_WORKOUT  (playground replay + finish_workout, then POST /history, then PUT /programs)
```

Each picker features one entry — the active program, the week of the most recent
`GET /history` record, the day after the one it names — large and first, with the rest of
the list one page below. [`shared/selection.js`](../../shared/selection.js) computes those
indices from account data only. A featured entry is still a button: it suggests, it never
selects. When the history points nowhere the list is shown flat.

## Rendering the clock

A full re-render tears down and rebuilds every widget, which takes long enough on the watch
that a once-a-second redraw drops ticks — the countdown then jumps two seconds at a time.
The elapsed, heart-rate and rest-timer texts are therefore registered as live widgets and
patched in place with `setProperty(prop.MORE, …)`, re-sending their complete property set
so geometry is not lost. The tick samples every 250 ms and writes only when the displayed
second changes; a state change still triggers a full render, and a refused in-place update
falls back to one.

## Data flow

```
Watch UI  ──tap──▶  event journal (persist first)
        │                  │
        │                  ▼
        │            UI update
        ▼
Device ↔ Side Service protocol v2 (BLE/ZML)
        ▼
Side Service ──HTTPS──▶ Liftosaur Cloud (LiftosaurApiClient)
```

The ordering is fixed: **persist, then render, then sync.** A gesture is never allowed to
wait on BLE or HTTP.

## Session model

The session is an append-only event journal. Replaying the journal reconstructs the session
exactly. Completed sets are determined by the journal alone; at finish time the journal is
translated into playground commands (`change_weight`, `change_reps`, `complete_set`,
`change_rpe`) and Liftosaur computes the record and the progression from them.

State machine: `NO_PLAN → READY → ACTIVE_SET → REST → ACTIVE_SET → … → FINISHED`.
Invalid transitions are rejected, not coerced. A set with no prescribed rest timer skips
`REST` entirely rather than inventing a default.

Rest is absolute-time based: `restStartedAt`, `restDuration`, `restEndsAt`. Remaining time
is always derived from the clock, never from a tick counter, so pause, screen-off, and
lifecycle churn cannot skew it.

## Network states

- `ONLINE` — Side Service reachable and last call succeeded.
- `DEGRADED` — Side Service reachable, calls failing or timing out; queue and retry.
- `OFFLINE` — no Side Service link; session continues fully locally.

The watch is usable in all three. Only synchronisation degrades.

## Finalisation

Finishing is a non-atomic, persisted transaction with distinct steps: replay the session
through the playground, post the record it returns to the history, then write the program
progression the same run produced.

History goes first because it is append-only and therefore always safe. The program write
is skipped whenever the remote source changed since the plan was fetched, so a program
edited in the Liftosaur app during a workout is never overwritten. A lost `POST /history`
response ends in `UNKNOWN_COMMIT_STATE`, which triggers a verification read before any
retry. A finished-but-unsynced session is kept and offered as `RETRY`; it is never deleted
automatically.

## Live history sync

The workout is written to the history as it happens. The first completed set creates the
record, each set after it updates the same one, and the finish replaces its text with the
authoritative playground output — one session, one record. Discarding deletes it.

The live text states only what the user did: no `target:`, no warmups, no progression.
Those are the playground's to compute and they arrive with the final replacement, so an
intermediate write can never become authoritative.

Session durability rests on the same data: the plan and the journal are stored together via
`@zos/storage` on every critical event, along with the id of the live record. An app killed
mid-workout comes back to the same set, and keeps writing to the same history record.

The watch is the only durable holder of that state. The Side Service can be torn down
between two requests, so anything it would need to remember — which day is being trained,
which history record the session owns — travels in the message. Its caches are an
optimisation, never a requirement.

### A live record is a past workout, and cannot be otherwise

This was established the hard way, so it is written down plainly. In Liftosaur:

```ts
export function Progress_isCurrent(progress: IHistoryRecord | undefined): boolean {
  return progress?.id === 0;
}
```

An in-progress workout lives in `storage.progress` and is identified by `id === 0`.
`POST /api/v1/history` writes into `storage.history`, and the Liftohistory deserializer sets
`id: startTime` — a timestamp, never `0`. **A record created through the public API is
therefore a finished workout by construction.**

Omitting `duration:` only leaves `endTime` undefined, which changes how a duration is
displayed. It does not make the record current: `isCurrent` never looks at `endTime`.

The live record still earns its place — it puts the session on the server after every set,
so a destroyed watch loses nothing — but it must be understood as a past-dated record that
grows, not as an ongoing session. It carries its `target:` prescription from the day plan so
it reads like any other record rather than one with no target at all.

## Cross-device resume

A session finished anywhere is visible everywhere. Continuing a half-finished workout **on
another device** is not offered by the public API: the Liftosaur app and web page share
in-progress state through `storage.progress` in Liftosaur's own private sync, and the REST
API exposes no route to it.

Resuming therefore works on the watch itself — after a crash, a reboot, or the app being
killed — and not across devices.

## Known API limits

Warmup sets and superset grouping are absent from the **playground** output — verified, see
[liftosaur-api.md](liftosaur-api.md). They are not absent from the API: both are named
fields in the Liftoscript source that `GET /programs/:id` returns, and `warmup:` is part of
the Liftohistory grammar. Reading them back means parsing the day's block in the program
text, and resolving a percentage warmup additionally requires reproducing
`Weight_calculatePlates` from `GET /exercise-data` and `GET /gyms/:gymId/equipment`.

Until that lands, the watch shows working sets in program order. Exercises can be run in any
order from the overview list.

## Key handling

The Liftosaur API key is entered in the phone Settings App and stays in the Side Service.
It is never sent over BLE, never stored on the watch, and is redacted from every log.

## Status

Implemented and unit-tested against recorded API shapes. The API contract in
[liftosaur-api.md](liftosaur-api.md) is confirmed against a live account. Watch-side
assumptions still depend on the open questions in
[zepp-capabilities.md](zepp-capabilities.md).
