# Lifto for Zepp OS

Unofficial [Liftosaur](https://www.liftosaur.com) clients for round and square Amazfit watches running Zepp OS 3.6 or later.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Zepp OS](https://img.shields.io/badge/Zepp%20OS-3.6%2B-purple.svg)
[![CI](https://github.com/PreciselyWrong/Liftosaur-ZeppOs-Companion/actions/workflows/ci.yml/badge.svg)](https://github.com/PreciselyWrong/Liftosaur-ZeppOs-Companion/actions/workflows/ci.yml)

## Install the current beta

**[Open GitHub Releases and scan the install QR codes](https://github.com/PreciselyWrong/Liftosaur-ZeppOs-Companion/releases)**

**Version:** Lifto Companion 0.5.12 beta.

**Workout version:** Lifto Workout 0.5.12 beta.

Developer Mode must be enabled in the Zepp mobile app. Demo mode needs no Liftosaur account; Cloud synchronization requires an account and API key.

For phone-only installation steps, supported preview targets, and troubleshooting, see the [Tester Guide](docs/tester-guide.md).

## Two apps, one workout

- **Lifto Companion** is the standalone watch app. It provides program browsing, direct Cloud workouts, recovery tools, gestures, and live heart rate.
- **Lifto Workout** runs inside native Zepp Strength Training and Free Training activities. Native activity recording and metrics remain visible while Lifto handles the session through click-only screens.

The two apps are complementary and can be installed together. Liftosaur Cloud is their shared workout handoff, and credentials remain in each app's phone Side Service.

## Collaborators

Lifto for Zepp OS is built together with [u/silent_jacob](https://www.reddit.com/user/silent_jacob/), lead tester and main contributor.

## Features

- Direct Liftosaur Cloud synchronization with official next-workout preview and explicit program, week, and day selection.
- Cross-device continuation of workouts started or changed on the watch or in the official Liftosaur app.
- Durable local plan, journal, write queue, pause intervals, and finish intent for exact recovery after interruption.
- Ordered, repeat-safe set recording and finish synchronization without replacing unacknowledged local work.
- Warmups, supersets, rep ranges, RPE, account rest defaults, and calculated plate combinations.
- Rest countdown, haptic alert at zero, overtime, adjustment, and pause/resume.
- Timed and unilateral holds with Get Ready, side transitions, pause, overtime, and durable duration recording.
- Separate Info pages for recent sessions, exercise notes, and program instructions.
- Optional exercise images in workout lists, Info, and Prepare.
- Configurable workout progress bar, plate breakdown and rest Info button in phone settings.
- Live heart rate from Companion or native activity BPM in Lifto Workout.
- Phone-only API key storage; credentials are never sent to or stored on the watch.

Timed holds work on the watch. Prompted variables, missing required input, and separate unilateral AMRAP repetitions still require the phone. See [Timed Sets](docs/timed-sets.md).

## Lifto Workout setup and evidence

Installing Lifto Workout does not automatically add its data page to a workout. Device paths differ:

- **Amazfit Active 2**, firmware 7.23.0.1: **Workout > Strength Training > Settings > More > Data Page > Add Page > Lifto**. Loading in Strength Training is confirmed at API level 400.
- **Amazfit Active 3 Premium**, Zepp OS 6, firmware 6.3.13.5: **Workout Settings > Data page > scroll to bottom > Add page > App/Workout Data > tick Lifto**. Installation is TESTED by a tester, not a full compatibility certification.

Free Training is included in 0.5.7, but its physical runtime behavior remains UNKNOWN. After Lifto saves the session, swipe left to right to open native Workout controls and finish the Zepp activity.

Preview packages cover the 28 Zepp OS 3.6+ targets listed in the [Tester Guide](docs/tester-guide.md). Inclusion in a preview package is not a compatibility claim. Zepp currently documents Workout Extension support for T-Rex 3, Cheetah Pro, Cheetah Round, Cheetah Square, T-Rex Ultra, and Falcon; other devices need explicit model and firmware evidence. See Zepp's [Workout Extension documentation](https://docs.zepp.com/docs/guides/workout-extension/intro/).

- [Manual Setup Actions](docs/workout-extension-manual-actions.md)
- [Hardware Test Plan](docs/workout-extension-hardware-test-plan.md)

## How it works

```text
Watch UI + durable journal -> ZML/BLE -> phone Side Service -> HTTPS -> Liftosaur Cloud
```

Liftosaur Cloud owns programs, prescriptions, active workout state, progression, and history. The watch never executes Liftoscript. Critical watch actions persist locally before the UI updates, then synchronize asynchronously through the phone. All HTTP calls pass through `app-side/liftosaur-api-client.js`.

## Current limits

- Companion workouts do not create a native Zepp activity; use Lifto Workout when native activity recording is required.
- Workout Extension callbacks pause when Lifto loses focus. An expired rest alerts when Lifto resumes; background alert delivery is not confirmed.
- Dynamic exercise images and timed-set lifecycle behavior still require physical-watch validation.
- Legacy Playground replay remains only for recovery of old local snapshots.

## Development

Requirements: Node.js, npm, and the latest [Zeus CLI](https://docs.zepp.com/docs/guides/tools/zeus-cli/).

```powershell
npm ci
npm test

# Inspect or start development
.\dev.ps1 -Plan
.\dev.ps1
.\dev.ps1 -Product workout

# Build packages
npm run build:companion
$env:ZEPP_WORKOUT_EXTENSION_APP_ID = '1125789'
npm run build:workout
npm run build:all

# Remove generated output while preserving audit evidence
npm run clean
```

CI runs `npm ci`, `npm test`, and synthetic Workout Extension generation on Node.js 24.

## Documentation

- [User guide](docs/user-guide.md)
- [User wiki](https://github.com/PreciselyWrong/Liftosaur-ZeppOs-Companion/wiki)

- [Tester Guide](docs/tester-guide.md)
- [Timed Sets](docs/timed-sets.md)
- [Synchronization Status and Set Corrections](docs/set-corrections.md)
- [Privacy Policy](docs/privacy-policy.md)
- [Workout Extension Manual Actions](docs/workout-extension-manual-actions.md)
- [Workout Extension Hardware Test Plan](docs/workout-extension-hardware-test-plan.md)

## Disclaimer

This project is independent and is not affiliated with, maintained by, or endorsed by Anton Astashov ([@astashov](https://github.com/astashov)) or the official [Liftosaur](https://github.com/astashov/liftosaur) project. Liftosaur is a registered trademark of its respective owner.

## License

MIT. The application icon is original artwork created for this project and is distributed under the same license.
