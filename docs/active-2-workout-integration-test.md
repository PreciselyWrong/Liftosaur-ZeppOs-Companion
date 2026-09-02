# Active 2 Workout Integration Test

Use this checklist after installing the new Lifto Workout preview.

## Device baseline

- Model: Amazfit Active 2
- Firmware: 7.23.0.1
- API level: 400
- Zepp workout: Strength Training
- Lifto Workout version: 0.4.0 beta

Record the tested commit and date before starting:

- Commit:
- Date:

## 1. Display duration

Repeat the test for `60 seconds`, `120 seconds`, `240 seconds`, and `Always` in Zepp app > Lifto Workout > Settings.

- [ ] Open the Lifto page inside Strength Training.
- [ ] Keep the wrist still without touching the screen.
- [ ] Confirm Lifto remains visible for the selected duration.
- [ ] For a finite duration, confirm the display may sleep after that duration.
- [ ] For `Always`, confirm the display remains visible for at least 10 minutes.
- [ ] Leave the Lifto page and confirm normal Workout screen-off behaviour returns.
- [ ] Return to Lifto and confirm the selected duration is applied again.

## 2. Native pause during an active set

- [ ] Start a Liftosaur workout and note the Lifto elapsed time.
- [ ] Pause the native Zepp workout for at least 30 seconds.
- [ ] Return to Lifto and confirm its elapsed time excluded the pause.
- [ ] Resume the native workout and confirm the Lifto timer advances again.
- [ ] Finish the workout and confirm Liftosaur history excludes the paused interval.

## 3. Native pause during rest

- [ ] Complete a set and let the rest timer run for 10 seconds.
- [ ] Pause the native Zepp workout for at least 30 seconds.
- [ ] Return to Lifto and confirm the rest timer did not lose those 30 seconds.
- [ ] Confirm the control reads `Zepp paused` while the native workout is paused.
- [ ] Resume Zepp and confirm the rest countdown continues.
- [ ] Manually pause rest, pause and resume Zepp, then confirm rest remains manually paused.

## 4. Native metrics

- [ ] Keep Lifto visible for two minutes.
- [ ] Confirm native duration updates continuously instead of remaining frozen.
- [ ] Confirm calories update during the workout.
- [ ] Pause Zepp and confirm native duration stops.
- [ ] Resume Zepp and confirm native duration restarts.

## 5. Rest alert

- [ ] With Lifto visible, confirm one vibration when rest reaches zero.
- [ ] With `Always`, confirm the alert still fires after more than two minutes without touching the watch.
- [ ] With a finite display duration, let the screen sleep before zero.
- [ ] Wake and return to Lifto after zero; confirm one catch-up vibration, not repeated vibrations.
- [ ] Leave Lifto for another Workout page and repeat the catch-up test.

Zepp suspends Workout Extension callbacks outside the focused page. Exact background vibration while Lifto is hidden remains a platform capability test; the required fallback is one alert when Lifto resumes.

## 6. Interrupted synchronization

- [ ] Enable airplane mode, complete one set, and confirm `Sync pending` appears.
- [ ] Leave the Lifto page, disable airplane mode, and return.
- [ ] Confirm the pending warning clears without completing another set.
- [ ] Confirm Liftosaur receives the set exactly once.
- [ ] Repeat with two offline sets and confirm their order is preserved.

## 7. Recovery and finish order

- [ ] Restart the watch during an active set and confirm the exact session resumes.
- [ ] Restart during rest and confirm the remaining time is coherent.
- [ ] Finish Lifto first, then finish Zepp; confirm both histories are saved.
- [ ] In a separate workout, finish Zepp first; confirm Lifto offers recovery without losing sets.

## Result

| Area | Pass | Notes or evidence |
| --- | --- | --- |
| Display duration |  |  |
| Active-set pause |  |  |
| Rest pause |  |  |
| Native metrics |  |  |
| Rest alert |  |  |
| Synchronization retry |  |  |
| Recovery and finish |  |  |
