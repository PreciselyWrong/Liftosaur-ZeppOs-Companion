# Timed sets

Lifto runs timed exercises on the watch. The phone Side Service sends completed durations to Liftosaur after local persistence.

## Controls

- Start set (or Start left) opens the local Get Ready countdown, then starts the effort clock.
- During rest, Start set arms the next timed set and shows Armed. The existing rest finishes before effort begins.
- Pause freezes the current countdown or effort. Resume continues it. Native Workout pause also freezes it without clearing a manual pause.
- Start now skips Get Ready.
- Stop records the actual held seconds. For unilateral sets, the left result stays on the watch while the right side is performed. Both durations are sent together after the right side ends.
- Reaching the effort target alerts once and continues counting overtime until Stop.

Get Ready is a local setting in the Zepp settings page: Off, 3, 5 or 10 seconds, with 5 seconds as the default. A zero-rest prescription disables preparation between sides. Preparation uses the final seconds of an armed rest rather than extending that rest.

## API boundary

The documented workout contract supplies `setTimer`, `timer` and `isUnilateral`. Completed bilateral duration uses `completed.setTimer`; unilateral duration uses `completed.setTimerLeft` for left and `completed.setTimer` for right. Required repetitions, weight and RPE still apply.

The public documentation does not specify the timer `+` flag, Liftoscript `auto`, or the account Get Ready preference. Lifto therefore requires Stop to record an effort and does not infer program-controlled automatic circuits. A running clock is local to this watch, not a live cross-device clock. Prompted program variables and separate unilateral AMRAP repetitions still require the phone.

Source: https://www.liftosaur.com/doc/api and https://www.reddit.com/r/liftosaur/comments/1wbueeh/timebased_exercises_countdown_and_unilateral/

## Recovery

Critical transitions are journaled with absolute timestamps. Screen repaint intervals do not measure time. A completed left side survives a restart without being sent as an incomplete server set. A suspended preparation does not create a chain of unperformed exercises.

Automated tests and builds do not establish background vibration delivery or native Workout lifecycle behavior on physical hardware.
