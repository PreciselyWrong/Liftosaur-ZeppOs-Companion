# Test Matrix

Three distinct evidence levels. A row validated in the emulator is never promoted to
real-device evidence.

- `DOC` — official documentation only.
- `EMU` — reproduced in the Zepp OS Simulator.
- `REAL` — reproduced on a physical watch.

Legend: ✅ verified · ❌ failed · ⬜ not run · ⛔ cannot be validated at this level.

## Platform and packaging

| Scenario | DOC | EMU | REAL |
| --- | --- | --- | --- |
| `WORKOUT_EXTENSION` template exists in Zeus CLI | ✅ | ✅ | ⛔ |
| Minimal project scaffolded from `Empty` template | ✅ | ✅ | ⛔ |
| `app.json` invariants guarded by `npm test` | ✅ | ✅ | ⛔ |
| Minimal project builds and previews | ⬜ | ⬜ | ⬜ |
| Extension visible in Strength Training only | ⬜ | ⬜ | ⬜ |
| Extension absent from other sports | ⬜ | ⬜ | ⬜ |
| Correct rendering on round screen | ⛔ | ⬜ | ⬜ |
| Correct rendering on square screen | ⛔ | ⬜ | ⬜ |

## Widget and lifecycle

| Scenario | DOC | EMU | REAL |
| --- | --- | --- | --- |
| `DataWidget` renders `Liftosaur` / `HR` / `READY` | ⬜ | ✅ | ⬜ |
| Mocked `SPORT_DATA` value displayed (`mock_data`) | ✅ | ✅ | ⛔ |
| Real HR from System Workout | ⛔ | ⛔ | ⬜ |
| One `CLICK` produces exactly one transition | ⬜ | ⬜ | ⬜ |
| Lifecycle sequence logged (`onInit`→`onDestroy`) | ✅ | ⬜ | ⬜ |
| Behaviour with screen off | ⛔ | ⛔ | ⬜ |
| Behaviour on wrist down | ⛔ | ⛔ | ⬜ |

## Protocol round-trip

| Scenario | DOC | EMU | REAL |
| --- | --- | --- | --- |
| `PING` → `PONG`, `messageId` echoed | ⬜ | ⬜ | ⬜ |
| Malformed message rejected explicitly | ⬜ | ⬜ | ⬜ |
| Duplicate `messageId` acknowledged, processed once | ⬜ | ⬜ | ⬜ |
| Link cut then restored yields explicit state | ⬜ | ⬜ | ⬜ |
| No secret present in any log line | ⬜ | ⬜ | ⬜ |

## Session durability

| Scenario | DOC | EMU | REAL |
| --- | --- | --- | --- |
| Restart during an active set recovers | ⬜ | ⬜ | ⬜ |
| Restart during rest recovers `restEndsAt` | ⬜ | ⬜ | ⬜ |
| Restart during finalisation recovers | ⬜ | ⬜ | ⬜ |
| Double tap yields one `COMPLETE_SET` | ⬜ | ⬜ | ⬜ |
| Finished-but-unsynced session offers `RETRY` | ⬜ | ⬜ | ⬜ |

## Cloud interaction

| Scenario | DOC | EMU | REAL |
| --- | --- | --- | --- |
| 400 / 401 / 403 / 404 / 422 mapped to structured errors | ⬜ | ⬜ | — |
| Timeout on `POST /history` → `UNKNOWN_COMMIT_STATE` | ⬜ | ⬜ | — |
| Verification read prevents duplicate history record | ⬜ | ⬜ | — |
| Changed remote program blocks progression write | ⬜ | ⬜ | — |
| `Authorization` / `Bearer` / `lftsk_*` redacted | ⬜ | ⬜ | — |

## Rest alert

| Scenario | DOC | EMU | REAL |
| --- | --- | --- | --- |
| Alert while extension focused | ⬜ | ⬜ | ⬜ |
| Alert while unfocused | ⛔ | ⛔ | ⬜ |
| Alert with screen off | ⛔ | ⛔ | ⬜ |
| Alert cancelled on early next set | ⬜ | ⬜ | ⬜ |
| Alert suppressed after workout end | ⬜ | ⬜ | ⬜ |
