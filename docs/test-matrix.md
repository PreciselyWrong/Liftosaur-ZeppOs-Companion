# Test Matrix

Three distinct evidence levels. A row validated in the emulator is never promoted to
real-device evidence.

- `DOC` - official documentation only.
- `EMU` - reproduced in the Zepp OS Simulator or automated unit test suite.
- `REAL` - reproduced on a physical watch.

Legend: [x] verified | [!] failed | [ ] not run | [-] cannot be validated at this level.

## Platform and Packaging

| Scenario | DOC | EMU | REAL |
| --- | --- | --- | --- |
| Standalone mini-program template builds via Zeus CLI | [x] | [x] | [x] |
| `app.json` invariants guarded by `npm test` | [x] | [x] | [-] |
| Round screen layout rendered correctly (e.g., Active 2 Round) | [x] | [x] | [ ] |
| Square screen layout rendered correctly (e.g., Active 2 Square) | [x] | [x] | [ ] |
| Live HR display via `@zos/sensor` | [x] | [x] | [ ] |
| Screen wake lock via `@zos/display` during workout | [x] | [x] | [ ] |
| Zepp native workout activity creation | [-] | [-] | [ ] |

## Protocol v3 Round-Trip

| Scenario | DOC | EMU | REAL |
| --- | --- | --- | --- |
| `PING` -> `PONG`, `messageId` echoed | [x] | [x] | [ ] |
| Malformed or wrong protocol version envelope rejected explicitly | [x] | [x] | [-] |
| `GET_SETTINGS` returns default units and timers | [x] | [x] | [ ] |
| `GET_WORKOUT_NEXT` previews scheduled or selected day workout | [x] | [x] | [ ] |
| `START_WORKOUT` starts cloud workout with watch start timestamp | [x] | [x] | [ ] |
| `SYNC_WORKOUT_SETS` drains batch of queued sets | [x] | [x] | [ ] |
| `FINISH_WORKOUT` commits history, progression, and `nextDay` | [x] | [x] | [ ] |
| `DISCARD_WORKOUT` removes active Cloud session | [x] | [x] | [ ] |
| Client identity headers (`X-Liftosaur-Device-Id`, `X-Liftosaur-Client`) present on writes | [x] | [x] | [-] |
| API key redacted from all logs and error messages | [x] | [x] | [-] |

## Running Workout Synchronization & Durability

| Scenario | DOC | EMU | REAL |
| --- | --- | --- | --- |
| Completed set persisted to watch storage before BLE/HTTP dispatch | [x] | [x] | [ ] |
| Batch set write responses adopt server update scripts | [x] | [x] | [ ] |
| Server snapshot deferred until local set queue is empty | [x] | [x] | [ ] |
| `GET_WORKOUT_CURRENT` polling throttled to minimum 15 seconds | [x] | [x] | [ ] |
| Pause intervals preserved and sent with `POST /workout/finish` | [x] | [x] | [ ] |
| Restart during active set recovers plan, journal, and queue | [x] | [x] | [ ] |
| Restart during rest recovers absolute `restEndsAt` | [x] | [x] | [ ] |
| Unsynced sets block finish until queue is cleared | [x] | [x] | [ ] |
| Missing remote workout opens recovery modal without deleting local data | [x] | [x] | [ ] |
| Timed sets and prompted variables prompt user to log on phone app | [x] | [x] | [ ] |

## Rest Timer & Alerts

| Scenario | DOC | EMU | REAL |
| --- | --- | --- | --- |
| Absolute-time countdown stays accurate across screen sleeps | [x] | [x] | [ ] |
| Haptic vibration alert triggered at rest zero | [x] | [x] | [ ] |
| Overtime counter tracks negative elapsed seconds | [x] | [x] | [ ] |
| Rest timer cancelled immediately on starting next set | [x] | [x] | [ ] |
