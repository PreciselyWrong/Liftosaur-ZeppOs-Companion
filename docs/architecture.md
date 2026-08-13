# Architecture

## Components and boundaries

| Component | Runs on | Owns | Never owns |
| --- | --- | --- | --- |
| System Workout ("Strength Training") | Watch | Sport and health metrics, HR sensor, workout session lifecycle | Liftosaur session state |
| Workout Extension | Watch | The single-screen Liftosaur UI and its touch state machine | Sport metrics, network |
| Device App storage | Watch | Durable local event journal, current session state | API key, HTTP |
| Side Service | Phone | API key, HTTPS to Liftosaur, retries, reconciliation | UI, session truth |
| Liftosaur Cloud | Remote | Programs, history, Liftoscript evaluation, progression | Anything local |

Single-ownership rule: each datum has exactly one owner. HR and calories come from the
System Workout only — this project never starts a second workout or heart-rate sensor.

## Data flow

```
Strength Training (System Workout)
        │  SPORT_DATA / getSportData (read-only)
        ▼
Workout Extension  ──tap──▶  event journal (persist first)
        │                          │
        │                          ▼
        │                    UI update
        ▼
Device ↔ Side Service protocol v1 (BLE/ZML)
        ▼
Side Service ──HTTPS──▶ Liftosaur Cloud (LiftosaurApiClient)
```

The ordering is fixed: **persist, then render, then sync.** A gesture is never allowed to
wait on BLE or HTTP.

## Session model

The session is an append-only event journal. Replaying the journal reconstructs the session
exactly. Completed sets are determined by the journal alone; Playground recomputes only
future sets and, at finish time, the progression.

State machine: `READY → ACTIVE_SET → REST → ACTIVE_SET → … → FINISHING → SYNCING → DONE`.
Invalid transitions are rejected, not coerced.

Rest is absolute-time based: `restStartedAt`, `restDuration`, `restEndsAt`. Remaining time
is always derived from the clock, never from a tick counter, so pause, screen-off, and
lifecycle churn cannot skew it.

## Network states

- `ONLINE` — Side Service reachable and last call succeeded.
- `DEGRADED` — Side Service reachable, calls failing or timing out; queue and retry.
- `OFFLINE` — no Side Service link; session continues fully locally.

The watch is usable in all three. Only synchronisation degrades.

## Finalisation

Finishing is a non-atomic, persisted transaction with distinct steps: post history,
then write program progression. Either step can end in `UNKNOWN_COMMIT_STATE`, which
triggers a verification read before any retry. A finished-but-unsynced session is kept and
offered as `RETRY`; it is never deleted automatically.

## Key handling

The Liftosaur API key is entered in the phone Settings App and stays in the Side Service.
It is never sent over BLE, never stored on the watch, and is redacted from every log.

## Status

Design only. No component is implemented. Every watch-side assumption depends on the
open questions in [zepp-capabilities.md](zepp-capabilities.md).
