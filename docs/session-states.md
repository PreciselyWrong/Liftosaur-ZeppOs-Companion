# Session, Finalisation and Network States

Specification only — Phase 0 defines these states without implementing them. Phase 1
implements the session states; finalisation lands in Phase 4.

## Session states

| State | Meaning | Leaves via |
| --- | --- | --- |
| `IDLE` | No session. The extension shows an entry point only. | `START` |
| `LOADING` | Fetching the current program and the upcoming workout. | `LOADED`, `LOAD_FAILED` |
| `READY` | Workout known, no set started. | `START_SET`, `ABANDON` |
| `ACTIVE_SET` | A set is in progress; weight, reps and RPE are editable. | `COMPLETE_SET`, `ABANDON` |
| `REST` | Rest running, bounded by `restEndsAt`. | `START_SET`, `SKIP_REST`, `FINISH` |
| `FINISHING` | No sets left, or the user chose to finish. Local finalisation. | `FINALISED` |
| `SYNCING` | Local session sealed; cloud commit in progress. | `SYNCED`, `SYNC_FAILED`, `UNKNOWN_COMMIT_STATE` |
| `DONE` | Committed and reconciled. Session may be archived. | — |
| `NEEDS_ATTENTION` | Sealed locally but not committed; user action required. | `RETRY`, `DISCARD` |

```
IDLE → LOADING → READY → ACTIVE_SET ⇄ REST
                                  ↓
                             FINISHING → SYNCING → DONE
                                             ↓
                                      NEEDS_ATTENTION → (RETRY → SYNCING | DISCARD → IDLE)
```

### Invalid transitions

These are rejected and logged, never coerced into something plausible:

- `COMPLETE_SET` while in `REST` — the set is already closed.
- `START_SET` while in `SYNCING`, `DONE`, or `NEEDS_ATTENTION` — the session is sealed.
- Any edit of weight, reps or RPE outside `ACTIVE_SET`.
- A second `COMPLETE_SET` carrying the same set identity (double tap, risk P1).
- `LOADING` → `ACTIVE_SET` without a `READY` in between.

### Recovery on start

On launch, the journal is replayed and the resulting state decides the prompt:

| Replayed state | Prompt |
| --- | --- |
| `ACTIVE_SET`, `REST`, `READY` | `RESUME` or `DISCARD` |
| `FINISHING`, `SYNCING`, `NEEDS_ATTENTION` | `RETRY` or `DISCARD` — never auto-deleted |
| `DONE` | Archive silently, start fresh |

`REST` is restored from `restEndsAt`, so an expired rest resurfaces as already overdue
rather than restarting a fresh countdown.

## Finalisation states

Finalisation is a non-atomic transaction across two independent cloud writes. Each step is
persisted before it is attempted, so a crash never loses the knowledge that it was tried.

| Step | Call | On ambiguity |
| --- | --- | --- |
| 1 — history | `POST /history` | `UNKNOWN_COMMIT_STATE`: search `GET /history` for the expected record before any retry |
| 2 — progression | `PUT /programs/current` | Compare the base program hash first; on mismatch raise `PROGRAM_CONFLICT` |

| State | Meaning |
| --- | --- |
| `LOCAL_SEALED` | Journal closed; nothing sent yet |
| `HISTORY_PENDING` | Request sent, no confirmed response |
| `HISTORY_COMMITTED` | Record id known |
| `UNKNOWN_COMMIT_STATE` | Response lost; commit may or may not have happened |
| `PROGRAM_PENDING` | Progression write in flight |
| `PROGRAM_COMMITTED` | Progression written |
| `PROGRAM_CONFLICT` | Remote program changed since session start; three versions kept |
| `RECONCILED` | Both steps verified |

Step 2 is never attempted while step 1 is unresolved. A finished session is never deleted
automatically, in any of these states.

## Network states

| State | Definition | Behaviour |
| --- | --- | --- |
| `ONLINE` | Side Service reachable, last call succeeded | Normal sync |
| `DEGRADED` | Side Service reachable, calls failing or timing out | Queue and retry with backoff; the UI says sync is behind |
| `OFFLINE` | No Side Service link | Fully local session; no retry attempts |

Transitions are driven by observed outcomes, not by a connectivity flag: a reachable phone
with failing HTTP is `DEGRADED`, not `ONLINE`. The watch remains fully usable in all three
states — only synchronisation degrades, never the ability to log a set.
