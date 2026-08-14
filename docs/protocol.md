# Device ↔ Side Service protocol

Version **2**. Implemented by [`shared/protocol.js`](../../shared/protocol.js).

A version 1 envelope is rejected, not coerced: the two versions disagree about who chooses
the workout, so silently accepting an old message would reintroduce the guessing that
version 2 exists to remove.

## Envelope

```json
{
  "protocolVersion": 2,
  "messageId": "m3k9x1-a7b2c9d",
  "type": "GET_DAY_PLAN",
  "sessionId": null,
  "replyToId": null,
  "payload": {}
}
```

Every response carries `replyToId` set to the request's `messageId`.

## Messages

| Request | Payload | Response | Payload |
| --- | --- | --- | --- |
| `PING` | anything | `PONG` | `{serverTime, echo}` |
| `LIST_PROGRAMS` | — | `PROGRAMS_DATA` | `{programs: [{id, name, isCurrent}]}` |
| `GET_PROGRAM_OUTLINE` | `{programId}` | `PROGRAM_OUTLINE_DATA` | `{programId, programName, programVersion, totalWeeks, totalDays, weeks[], lastWorkout}` |
| `GET_DAY_PLAN` | `{programId, week, day}` | `DAY_PLAN_DATA` | `{programId, programName, programVersion, week, dayInWeek, dayName, unit, exercises[], outlineNameMatches}` |
| `SYNC_PROGRESS` | `{programId, week, day, startedAt, durationSeconds, completedSets[]}` | `SYNC_PROGRESS_RESULT` | `{synced, historyId, created, reason?}` |
| `FINISH_WORKOUT` | `{programId, programVersion, week, day, completedSets[], startedAt, durationSeconds}` | `FINISH_WORKOUT_RESULT` | `{status, historyId, alreadyExisted, programUpdated}` |
| `ABANDON_WORKOUT` | `{dayName, startedAt, abandonedAt}` | `ABANDON_WORKOUT_RESPONSE` | `{abandoned: true, discarded}` |

`SYNC_PROGRESS` is sent after every completed set. `startedAt` identifies the session, so
the Side Service knows whether to create the history record or update the one it already
made. Writes are coalesced on the watch: a set completed while a write is in flight marks
the state dirty and one further write follows. `synced: false` with a `reason` of `NO_PLAN`
or `NOTHING_DONE` is a normal answer, not an error — the finish still writes everything.

`ABANDON_WORKOUT` deletes the live record, so a discarded session leaves nothing behind.

`week` and `day` are 1-based, `day` being the day within its week. `completedSets` entries
are `{exerciseIndex, setIndex, weight, reps, rpe, unit}` with 1-based indices matching the
day plan, in the order the user performed them.

## Errors

Any request may answer with `ERROR` carrying `{code, message}`.

| Code | Meaning |
| --- | --- |
| `INVALID_ENVELOPE` | Wrong protocol version, missing id, unknown type, or a missing required field |
| `UNSUPPORTED_TYPE` | Known envelope, unhandled message type |
| `NOT_CONFIGURED` | No Liftosaur API key on the phone |
| `NO_API_KEY`, `NETWORK`, `BAD_JSON` | Raised by the API client |
| `DAY_NOT_IN_PROGRAM` | The requested week and day are not in the program |
| `DAY_MISMATCH` | The playground answered about a different day than the one requested |
| `PLAN_UNREADABLE` | The playground returned no readable record |
| `PROGRAM_UNAVAILABLE` | The program carries no source text |
| `API_FAILED` | Anything else the API reported |

A `DAY_MISMATCH` is reported rather than displayed as a workout: a plausible wrong workout
is worse than a refusal.

## `FINISH_WORKOUT` statuses

| Status | History | Program | Meaning |
| --- | --- | --- | --- |
| `SAVED` | written | written when it changed | Normal path |
| `HISTORY_SAVED_PROGRAM_CONFLICT` | written | untouched | The program changed on Liftosaur during the workout; the remote edit wins and the progression is not written |
| `BASE_PROGRAM_UNAVAILABLE` | not written | untouched | The program text the plan was built from is gone, so the session cannot be replayed faithfully. The watch keeps the session and asks the user to pick the day again |

`FINISH_WORKOUT` is deduplicated by `startedAt` in the router, so a retried message returns
the first result instead of committing a second record.

## Ordering

Persist locally, render, then sync. A tap never waits on BLE or HTTP. The only blocking
calls are the three explicit selection steps, each of which shows its own loading state.
