# Lifto Companion for Zepp OS

Standalone, unofficial [Liftosaur](https://www.liftosaur.com) workout tracking client for Amazfit smartwatches running Zepp OS (target: Amazfit Active 2 and compatible round watches).

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Zepp OS](https://img.shields.io/badge/Zepp%20OS-3.6%2B-purple.svg)
![Tests](https://img.shields.io/badge/tests-184%20passing-brightgreen.svg)

<p align="center">
  <img src="docs/screenshots/workout-preview.png" width="19%" alt="Day Preview" />
  <img src="docs/screenshots/active-set.png" width="19%" alt="Active Set" />
  <img src="docs/screenshots/rest-timer.png" width="19%" alt="Rest Timer" />
  <img src="docs/screenshots/workout-overview.png" width="19%" alt="Workout Overview" />
  <img src="docs/screenshots/workout-summary.png" width="19%" alt="Workout Summary" />
</p>

---

## Try it now (test build)

**Scan the code that matches the shape of your watch screen.** They are two
different builds: the round one will not install on a square watch, and the
square one will not install on a round watch.

<table align="center">
  <tr>
    <th>Round screen</th>
    <th>Square screen</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/test-build-qr-round.png" width="220" alt="Round test build QR code" /></td>
    <td align="center"><img src="docs/test-build-qr-square.png" width="220" alt="Square test build QR code" /></td>
  </tr>
  <tr>
    <td align="center">built for <b>Amazfit Active 2 (Round)</b></td>
    <td align="center">built for <b>Amazfit Bip 6</b></td>
  </tr>
</table>

> ## ⚠️ Read this before scanning
>
> ### Both codes expire on 2026-08-22 at 06:07 UTC
>
> That is 08:07 Central European Summer Time. After that moment they stop
> working and return a download error.
>
> The deadline is not my choice: `zeus preview` uploads the build to Zepp's own
> servers, and Zepp keeps a preview for **7 days** before deleting it. There is
> no way to extend it. This README gets fresh codes when the current ones lapse,
> so come back to this page rather than reusing an old screenshot.
>
> ### Models
>
> Each code is built for one device family. **Amazfit Active 2 (Round)** and
> **Amazfit Bip 6** are the two models the builds were produced for and the only
> two I can vouch for. Other watches of the same screen shape and a recent
> enough Zepp OS may well accept the build; if yours does, or refuses to, say so
> in an issue with the exact model name and I will list it here.
>
> Watches that are simply too old for the Zepp OS API level this project targets
> will refuse to install whatever you scan. That is not a bug, so please do not
> report it as one.

**Version:** Lifto Companion 2.0.6

You also need a [Liftosaur](https://www.liftosaur.com) account with at least one
program, and Developer Mode enabled in the Zepp app. Full walkthrough, phone
only and no computer required: **[docs/tester-guide.md](docs/tester-guide.md)**.

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
- **Faithful write-back**: at finish, the session is replayed to Liftosaur as playground commands, so the saved record is exactly what you did. Progressions - including custom `progress:` scripts and `used: none` templates - are computed by Liftosaur, never re-implemented here.
- **Never overwrites a remote edit**: the program text is fingerprinted when the plan is built and re-checked before writing. If the program changed meanwhile, the workout is still saved and the progression is skipped.
- **Live heart rate** via `@zos/sensor`, with zone colouring.
- **Rest timer & overtime**: absolute-time countdown with haptic vibration at zero and a negative overtime counter.
- **Display wake lock** during active workouts (`@zos/display`).
- **Crash-proof sessions**: the plan and the journal are stored on the watch after every set, so an app killed mid-workout resumes on the same set. A lost `POST /history` response is resolved by searching before any retry.
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
| `shared/liftohistory.js` | Read the documented Liftohistory text format |
| `shared/liftoscript-outline.js` | Read only the `#` week and `##` day headers of a program |
| `shared/day-plan.js` | Turn `target:` sections into a plan, and a journal into playground commands |
| `shared/workout-session.js` | The session state machine |
| `shared/protocol.js` | The device ↔ phone message envelope |

### Known limits

Warmup sets and superset grouping are absent from the Playground response - confirmed by
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

The `zeus preview` QR code is hosted by Zepp and stays valid for 7 days, so it can be
shared with testers who do not have a computer. A single QR code covers every device
built into the bundle.

### Installing as a Tester

If you were sent a QR code and just want to run the app on your watch, follow
[docs/tester-guide.md](docs/tester-guide.md). It needs a phone only, no computer.

---

## Changelog

Release history is in [CHANGELOG.md](CHANGELOG.md).

---

## Disclaimer

This project is an independent open-source client and is not affiliated with, maintained by, or endorsed by Anton Astashov ([@astashov](https://github.com/astashov)) or the official [Liftosaur](https://github.com/astashov/liftosaur) project. Liftosaur is a registered trademark of its respective owner.

---

## License

MIT
