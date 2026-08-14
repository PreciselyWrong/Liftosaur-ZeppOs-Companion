# Changelog

## [2.0.0] — 14 August 2026

Breaking rewrite. Liftosaur Cloud is now the only source of workout data. The watch reads
your program from the API and never interprets it on its own.

### Added
- The app opens on your active program with one big button that starts its next day. The
  button names the day it will start, and "Another day" opens the full choice.
- Pick your program, then your week, then your day — all three lists come from your
  Liftosaur account. Each list opens on the entry you most likely want, shown large and
  first: your active program, the week you are in, and the day after the one you last
  logged. Everything else is one page below. Nothing is chosen until you tap it.
- Exercises, sets, rep ranges, AMRAP sets, weights, RPE targets and rest timers are exactly
  the ones Liftosaur computes for that day, in your program's unit.
- Finishing a workout writes the session to your Liftosaur history and applies your
  program's progression, so opening the phone app afterwards shows the same state.
- A workout is still saved when your program was edited elsewhere during the session; only
  the progression is skipped, and the watch says so.

### Changed
- The watch no longer chooses the next day for you. You choose it.
- Weight steps follow your program's unit (2.5 kg or 5 lb).
- A set without a prescribed rest timer no longer invents one.

- Your workout now appears in Liftosaur while you train: the first set you log creates the
  record and every set after it updates the same one. Discarding a session removes it.
- An interrupted workout is resumed exactly where it stopped, including the record it was
  writing — the session is now saved to the watch, not held in memory.

### Removed
- The local Liftoscript reader that guessed weeks, days, exercises and weights from program
  text, including the name-based rules that treated words starting with "S" as weeks and
  dropped days containing "calib". Nothing is inferred from a name any more.
- Superset alternation and warmup sets, for now: the Playground does not return them, so
  showing an invented version was worse than showing none. They are still recoverable from
  the program text and are planned.

### Fixed
- The rest countdown skipped a second at a time. It now updates the timer text in place
  instead of redrawing the whole screen every tick.
- Wrong exercises, wrong weights and wrong days on programs with multi-week structures,
  non-English day names, week ranges or reused templates.
- A day whose prescription could not be confirmed is now reported as an error instead of
  displayed as a plausible wrong workout.

## [1.0.0] — 14 August 2026

### Added
- Follow your Liftosaur workouts on your wrist with live heart rate.
- The screen stays on and responsive during a workout.
- A rest timer that vibrates when it is time to go again and counts overtime.
- Large touch targets for adjusting reps and weight.
