# Workout Extension Hardware Test Plan

Physical-watch test matrix for Lifto Workout in Strength Training and Free Training.
Target devices must be on Zepp's documented Workout Extension support list (e.g. Amazfit T-Rex 3, Cheetah Pro, Cheetah Round, Cheetah Square, T-Rex Ultra, Falcon) running Zepp OS 3.6+.

An Amazfit Active 2 running firmware 7.23.0.1 and API level 400 has loaded the extension in Strength Training. Free Training support and the 0.5.5 integration changes still require physical validation through [the Active 2 checklist](active-2-workout-integration-test.md); this observation does not claim compatibility for other firmware builds.

Every test row records:
- `Model`: specific watch model name
- `Firmware`: watch firmware build string
- `OS`: Zepp OS version (e.g. 3.6, 4.0, 5.0)
- `App version`: Lifto Workout semantic version (e.g. 0.3.3)
- `Commit`: git commit hash under test
- `Date`: execution date (YYYY-MM-DD)
- `Result`: `pending` or `BLOCKED` (never `pass` until physically validated and evidenced)
- `Evidence`: log URI, photo, or telemetry artifact reference
- `Notes`: hardware-specific observations or anomalies

---

## Practical Test Matrix

| Test | Model | Firmware | OS | App version | Commit | Date | Result | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Install and add extension | - | - | - | - | - | - | BLOCKED | - | Install the preview; add Lifto from each workout's Data Page settings in Strength Training and Free Training |
| Native workout start | - | - | - | - | - | - | BLOCKED | - | Start each supported workout type; verify DataWidget initializes and renders its first screen |
| Current / selected workout | - | - | - | - | - | - | BLOCKED | - | Test scheduled next-day preview, explicit program/week/day picker, and active Cloud workout resumption |
| Weight, reps, and RPE | - | - | - | - | - | - | BLOCKED | - | Verify an unweighted required set starts at zero and syncs; adjust other values with the click-only steppers |
| Notes display | - | - | - | - | - | - | BLOCKED | - | Open exercise notes modal; verify markdown stripped formatting, pagination, and dismiss |
| Warmups handling | - | - | - | - | - | - | BLOCKED | - | Verify warmup set badges, calculated plate loadouts, and progression to work sets |
| AMRAP sets handling | - | - | - | - | - | - | BLOCKED | - | Log rep counts above/below target on AMRAP sets; verify correct server progression |
| Supersets navigation | - | - | - | - | - | - | BLOCKED | - | Verify paired exercise indicators, color coding, and alternating set transitions |
| Rest and overtime timer | - | - | - | - | - | - | BLOCKED | - | Verify absolute countdown to zero, haptic vibration at zero, overtime increment, and pause/resume |
| Leave widget during rest and return | - | - | - | - | - | - | BLOCKED | - | Switch to native workout screens during rest; return to Lifto and verify remaining time or resume alert |
| Screen off during active set and rest | - | - | - | - | - | - | BLOCKED | - | Allow screen to sleep during active set and rest; wake display and verify state integrity |
| Background rest alert delivery | - | - | - | - | - | - | BLOCKED | - | Test whether haptic vibration triggers while screen is asleep/unfocused, or fires upon resume |
| Offline logging, reconnect, and queue drain | - | - | - | - | - | - | BLOCKED | - | Log sets in flight mode; reconnect phone; verify ordered queue drain via POST /workout/sets |
| Crash recovery during active set, rest, finish | - | - | - | - | - | - | BLOCKED | - | Force kill / reboot watch during active set, rest, and finish; verify restore() from extension storage |
| Conflict cases | - | - | - | - | - | - | BLOCKED | - | Change exercises quickly while sets sync, then test a real phone-side divergence; only the divergence should show conflict |
| Both finish orders | - | - | - | - | - | - | BLOCKED | - | Test Order A: Finish Lifto then finish Zepp; Test Order B: Finish Zepp then finish Lifto |
| Both histories and progression | - | - | - | - | - | - | BLOCKED | - | Verify Liftosaur Cloud history, 1RM, progression, and nextDay advance; verify Zepp native workout record |
| Native duration and HR | - | - | - | - | - | - | BLOCKED | - | Verify native duration drives pause detection and the top-right widget displays native BPM |
| Round and square geometry | - | - | - | - | - | - | BLOCKED | - | Verify layout, text truncation, and touch targets on round (e.g. T-Rex 3) and square (e.g. Cheetah Square) |
| Battery consumption | - | - | - | - | - | - | BLOCKED | - | Measure battery percentage drop during a 45-60 minute native workout |

---

## Hardware Test Protocol

1. **Prerequisites**:
   - Registered dedicated Workout Extension App ID in Zepp Developer Console.
   - Preview package built with `ZEPP_WORKOUT_EXTENSION_APP_ID=<app-id> npm run preview:workout`.
   - Physical watch paired with Zepp app in Developer Mode.
   - Liftosaur API key configured in Lifto Workout phone settings.
2. **Execution Rules**:
   - Capture console logs via Zeus CLI or Zepp Developer tools where available.
   - Redact all API keys and bearer tokens from captured logs before archiving.
   - Never mark a test as `pass` from simulator or unit test results.
   - A passing test applies strictly to the recorded Model + Firmware + OS combination.
