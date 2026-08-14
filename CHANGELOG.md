# Changelog

## [Unreleased]

### Added
- Tester guide for installing the app from a QR code with a phone only, no computer required (`docs/tester-guide.md`).
- Public test build QR code in the README, with its supported models and its expiry date.

### Changed
- README now links the changelog and the tester guide, and documents the 7 day validity of a `zeus preview` QR code.
- Changelog, agent context and TODO are now written in English.

## [2.0.5] - 14 August 2026

### Fixed
- ISO formatting of the workout date, and more reliable transmission of the duration in your history.

## [2.0.4] - 14 August 2026

### Changed
- Warmup sets are now clearly marked with a distinct badge and label.
- Fixed the calculation and upload of the total workout duration to your online account.

## [2.0.3] - 14 August 2026

### Fixed
- Fixed saving the workout history to your online account.
- Pausing the rest timer now also pauses the overall workout timer.

## [2.0.2] - 14 August 2026

### Added
- Superset exercises show a badge and a distinct color per group so you can spot them faster.
- An info button to read an exercise's notes and comments right during a set or rest.

## [2.0.1] - 14 August 2026

### Added
- The rest timer shows the next exercise's name, set and target weight so you can prepare your equipment.
- Buttons to pause the timer, or add or remove 10 seconds depending on how you feel.
- A button to collapse the timer and show the next set's screen.
- Vibration reminders at 30 seconds, 60 seconds and 120 seconds past the rest time.

### Fixed
- Warmup sets now show their weight correctly and start their rest timer.

## [2.0.0] - 14 August 2026

Breaking rewrite. Liftosaur Cloud is now the only source of workout data. The watch reads
your program from the API and never interprets it on its own.

### Added
- The app opens on your active program with one big button that starts its next day. The
  button names the day it will start, and "Another day" opens the full choice.
- Pick your program, then your week, then your day - all three lists come from your
  Liftosaur account. Each list opens on the entry you most likely want, shown large and
  first: your active program, the week you are in, and the day after the one you last
  logged. Everything else is one page below. Nothing is chosen until you tap it.
- Exercises, sets, rep ranges, AMRAP sets, weights, RPE targets and rest timers are exactly
  the ones Liftosaur computes for that day, in your program's unit.
- Warmup sets and supersets: warmups are resolved to loadable weights against your gym's
  equipment, and superset exercises alternate working sets automatically during workouts.
- Finishing a workout writes the session to your Liftosaur history and applies your
  program's progression, so opening the phone app afterwards shows the same state.
- A workout is still saved when your program was edited elsewhere during the session; only
  the progression is skipped, and the watch says so.
- An interrupted workout is resumed exactly where it stopped - the session is now saved to
  the watch, not held in memory. Your workout is written to Liftosaur once, when you finish
  it, so nothing half-done ever lands in your history.

### Changed
- The watch no longer chooses the next day for you. You choose it.
- Weight steps follow your program's unit (2.5 kg or 5 lb).
- A set without a prescribed rest timer no longer invents one.

### Removed
- The local Liftoscript reader that guessed weeks, days, exercises and weights from program
  text, including the name-based rules that treated words starting with "S" as weeks and
  dropped days containing "calib". Nothing is inferred from a name any more.

### Fixed
- The rest countdown skipped a second at a time. It now updates the timer text in place
  instead of redrawing the whole screen every tick.
- Wrong exercises, wrong weights and wrong days on programs with multi-week structures,
  non-English day names, week ranges or reused templates.
- A day whose prescription could not be confirmed is now reported as an error instead of
  displayed as a plausible wrong workout.

## [1.0.0] - 14 August 2026

### Added
- Follow your Liftosaur workouts on your wrist with live heart rate.
- The screen stays on and responsive during a workout.
- A rest timer that vibrates when it is time to go again and counts overtime.
- Large touch targets for adjusting reps and weight.
