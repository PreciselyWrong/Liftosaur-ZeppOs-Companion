# Session, Finalisation and Network States

Specification of the runtime state machine and direct synchronization lifecycle under Protocol v3.

## Session States

| State | Meaning | Leaves via |
| --- | --- | --- |
| `IDLE` | No active session loaded. Entry point or program picker. | `LOAD_WORKOUT` |
| `LOADING` | Fetching settings, current workout, and next workout from Cloud. | `WORKOUT_LOADED`, `LOAD_FAILED` |
| `READY` | Workout plan loaded; ready to start. | `START_WORKOUT`, `DISCARD` |
| `ACTIVE_SET` | A set is in progress; weight, reps, and RPE are editable. | `COMPLETE_SET`, `DISCARD`, `FINISH` |
| `REST` | Rest timer running, bounded by absolute `restEndsAt`. | `START_SET`, `SKIP_REST`, `FINISH` |
| `FINISHING` | All sets completed or user chose to finish; compiling pause intervals. | `FINISH_CONFIRMED` |
| `SYNCING` | Local write queue draining (`POST /workout/sets`) or atomic finish in flight (`POST /workout/finish`). | `SYNC_CONFIRMED`, `SYNC_FAILED` |
| `DONE` | Workout committed to Cloud, history saved, progression applied, nextDay updated. | Session reset to `IDLE` |
| `NEEDS_ATTENTION` | Synchronization error, remote mismatch, or missing remote session; user action required. | `RETRY`, `DISCARD` |

```text
IDLE ──▶ LOADING ──▶ READY ──▶ ACTIVE_SET ⇄ REST
                         │          │
                         │          ▼
                         │     FINISHING ──▶ SYNCING ──▶ DONE
                         │                      │
                         └──────────────────────┴──▶ NEEDS_ATTENTION ──▶ (RETRY | DISCARD)
```

### Invalid Transitions

These transitions are rejected at the state machine level and never coerced:
- `COMPLETE_SET` while in `REST` (set is already completed).
- `START_SET` while in `SYNCING`, `DONE`, or `NEEDS_ATTENTION` without resolving active state.
- Editing weight, reps, or RPE outside of `ACTIVE_SET`.
- Duplicate `COMPLETE_SET` with identical set identifiers (debounced at event layer).
- `FINISH` while local set writes remain unacknowledged in the write queue.

### Recovery on Launch

On launch, the local storage journal and sync state are inspected:

| Restored State | Behavior |
| --- | --- |
| `ACTIVE_SET`, `REST`, `READY` | Restore exact active set, elapsed timer, and queued sets; prompt `RESUME` or `DISCARD`. |
| `FINISHING`, `SYNCING`, `NEEDS_ATTENTION` | Resume queue drain or retry `FINISH_WORKOUT` / `DISCARD_WORKOUT`. Never auto-deleted. |
| `DONE` | Clear local session storage and load next scheduled workout. |

`REST` is restored using absolute `restEndsAt`: an expired timer resurfaces as overdue rather than restarting a fresh countdown.

---

## Finalisation and Discard States

Under the Running a Workout API, finalisation is an atomic Cloud operation:

| Operation | Cloud Endpoint | Behavior |
| --- | --- | --- |
| Set Write | `POST /workout/sets` | Repeat-safe batch drain of locally completed sets. Response returns updated workout with script execution results. |
| Finish | `POST /workout/finish` | Atomic commit: records history, computes progression, updates 1RM, advances `nextDay`, and clears active Cloud session. |
| Discard | `DELETE /workout/current` | Discards the active Cloud workout. Executed only after explicit user confirmation. |

If network connectivity drops during finalisation, the session is kept locally with `finishRequestedAt` set, and retries the atomic finish call upon reconnection.

---

## Network and Synchronization States

| State | Definition | Runtime Behavior |
| --- | --- | --- |
| `ONLINE` | Side Service reachable, last API call succeeded. | Immediate queue draining and periodic 15-second current-workout polling. |
| `DEGRADED` | Side Service reachable, API calls failing or timing out. | Sets accumulate in local queue; UI indicates pending sync; auto-retried. |
| `OFFLINE` | No BLE or network link available. | Fully local operation; sets queued in watch storage; no network spam. |

Transitions are driven by observed network outcomes. The watch remains 100% operational in all three states: logging sets, running timers, and editing weights never block on network connectivity.
