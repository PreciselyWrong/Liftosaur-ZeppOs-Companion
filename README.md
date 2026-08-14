# Liftosaur for Zepp OS

Standalone [Liftosaur](https://www.liftosaur.com) workout tracking client for Amazfit smartwatches running Zepp OS (target: Amazfit Active 2 and compatible round watches).

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Zepp OS](https://img.shields.io/badge/Zepp%20OS-3.6%2B-purple.svg)
![Tests](https://img.shields.io/badge/tests-133%20passing-brightgreen.svg)

---

## The API decides, the watch asks

Every workout fact comes from Liftosaur Cloud. The watch runs no Liftoscript, guesses no
next day and filters no exercise by name. You pick a program, a week and a day; the
[Playground endpoint](https://www.liftosaur.com/doc/api) returns the exercises, sets, reps,
weights, RPE targets and rest timers; and when you finish, the same endpoint computes the
progression that gets written back.

That makes the watch and the Liftosaur app interchangeable: a session logged on the watch
appears in the app with its progression applied, and a program edited in the app is what
the watch offers next.

## Features

- **Explicit selection**: program, week and day are chosen by you, from lists the API returns. Your most recent workout is shown so you can see where you left off.
- **Real prescriptions**: exercises, sets, rep ranges, AMRAP markers, weights, RPE targets and rest timers all come from the Playground, in your program's unit.
- **Faithful write-back**: the session is replayed to Liftosaur as playground commands, so the saved record is exactly what you did and the progression is computed by Liftosaur.
- **Never overwrites a remote edit**: the program text is fingerprinted when the plan is built and re-checked before writing. If the program changed meanwhile, the workout is still saved and the progression is skipped.
- **Live heart rate** via `@zos/sensor`, with zone colouring.
- **Rest timer & overtime**: absolute-time countdown with haptic vibration at zero and a negative overtime counter.
- **Display wake lock** during active workouts (`@zos/display`).
- **Offline durability**: append-only local session journal; a lost `POST /history` response is resolved by searching before any retry.
- **Mobile settings app**: your Liftosaur API key (`lftsk_...`) is entered in the Zepp app and never leaves the phone.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                      Amazfit Watch                      │
│                                                         │
│  page/common/index.js      program / week / day pickers │
│       │                    then the workout screens     │
│       ▼                                                 │
│  shared/workout-session.js pure state machine + journal │
│       │                                                 │
│       ▼                                                 │
│  shared/session-storage.js local journal persistence    │
└───────────────────────────┬─────────────────────────────┘
                            │ BLE / ZML protocol v2
┌───────────────────────────▼─────────────────────────────┐
│                    Mobile Side Service                  │
│                                                         │
│  app-side/router.js             message dispatch        │
│  app-side/program-service.js    the only orchestrator   │
│  app-side/liftosaur-api-client.js  the only HTTP client │
│  setting/index.js               API key entry           │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTPS / REST
┌───────────────────────────▼─────────────────────────────┐
│                    Liftosaur Cloud                      │
│  /programs  /playground  /history   source of truth     │
└─────────────────────────────────────────────────────────┘
```

Shared, platform-independent modules:

| Module | Responsibility |
| --- | --- |
| `shared/liftohistory.js` | Read and write the documented Liftohistory text format |
| `shared/liftoscript-outline.js` | Read only the `#` week and `##` day headers of a program |
| `shared/day-plan.js` | Turn `target:` sections into a plan, and a journal into playground commands |
| `shared/workout-session.js` | The session state machine |
| `shared/protocol.js` | The device ↔ phone message envelope |

### Known limits

Warmup sets and superset grouping are absent from the Playground response — confirmed by
test. They are not absent from the API: both are named fields in the Liftoscript source
that `GET /programs/:id` returns. Reading them back is planned; resolving a percentage
warmup (`1x8 40%`) additionally needs Liftosaur's loadable-weight rounding. Until then the
watch shows working sets in program order, and you can run exercises in any order from the
overview list. See [docs/liftosaur-api.md](docs/liftosaur-api.md).

---

## Development & Testing

### Requirements
- Node.js 20+
- [Zeus CLI](https://docs.zepp.com/docs/guides/tools/zeus-cli/) `npm install -g @zeppos/zeus-cli`

### Running Unit Tests
```bash
npm test
```

### Running on Simulator or Real Device
```bash
# Preview on emulator
zeus dev -t "Amazfit Active 2 (Round)"

# Generate QR code for real device testing
zeus preview -t "Amazfit Active 2 (Round)"
```

---

## License

MIT
