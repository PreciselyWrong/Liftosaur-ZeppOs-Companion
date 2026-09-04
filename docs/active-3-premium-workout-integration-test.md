# Active 3 Premium Workout Integration Test

Use this checklist for physical hardware testing on Amazfit Active 3 Premium.

## Device baseline

- Model: Amazfit Active 3 Premium
- OS: Zepp OS 6
- Firmware: 6.3.13.5
- Zepp workout: Strength Training
- Installation: TESTED (tester report); synchronization and lifecycle retest pending
- Lifto Companion: App ID 1123411
- Lifto Workout: App ID 1125789

Record the tested commit, build, and date before starting:

- Commit:
- Lifto Companion version/build:
- Lifto Workout version/build:
- Date:

### Tester report notes

The report was described as one day old when shared on 4 September 2026. The exact test date and installed Lifto versions were not supplied.

- Both Lifto Companion and Lifto Workout ran on the watch.
- Installation path: Workout Settings > Data page > scroll to bottom > Add page > App/Workout Data > tick Lifto.
- Symptoms reported: frequent "Sync needs attention" warnings after tapping Done; tapping Retry advanced only the watch view, while the phone caught up at finish.
- The supplied screenshot shows "Sync conflict", "Use phone workout" and "Retry sync". It does not identify the underlying error. The proposed cause still needs confirmation on this device.
- Program scale: 21 weeks, 5 days/week, 6-7 exercises/day (no private program file supplied).

---

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

## 6. Startup and first-set phone sync

Repeat sections 6-9 separately with Lifto Companion and Lifto Workout. Use a new workout for each app and record both app versions.

- [ ] Choose an explicit program, week and day on the watch, then tap Start.
- [ ] Confirm the matching workout appears on the phone without tapping Retry sync.
- [ ] Complete the first set, including a warmup if present.
- [ ] Confirm the phone shows that completed set before finishing the workout. Record the delay.
- [ ] Complete another set with changed weight or reps and confirm the same values appear on the phone.
- [ ] Confirm no Sync conflict or Sync needs attention warning appears with a working connection.

## 7. Multiple offline sets before server start

- [ ] Load the day preview while connected, then disconnect Bluetooth before tapping Start.
- [ ] Start locally and complete at least two sets, including a warmup if available.
- [ ] Change weight or reps before completing one set and note the values.
- [ ] Restart Lifto while still offline and confirm the completed sets and current rest state remain.
- [ ] Reconnect the phone and return to Lifto.
- [ ] Confirm the phone receives the workout and every queued set before Finish, without duplicates.
- [ ] Confirm local edits, exercise selection and rest time survive the reconnection.

## 8. Synchronization recovery and retry

- [ ] Start a separate workout online and confirm it appears on the phone.
- [ ] Disconnect Bluetooth, complete a set and confirm the watch keeps it while synchronization is pending.
- [ ] Reconnect and return to Lifto. Confirm the warning clears and the set appears on the phone.
- [ ] If Retry sync is available, tap it and verify the phone receives the set exactly once.
- [ ] If Sync conflict appears, record the screenshot, app version, last action and any available error code.
- [ ] Finish and confirm history has the expected sets, weights and reps, without duplicates.

## 9. Large-program handling (Lifto Companion & Workout Extension)

- [ ] Load a large program structure (e.g., 21 weeks, 5 days/week, 6-7 exercises/day).
- [ ] In Lifto Companion: verify catalog navigation across weeks and days without crashes or long freezes.
- [ ] In Lifto Companion: verify day preview rendering and workout initialization.
- [ ] In Lifto Workout Extension: verify data page loads and displays all 6-7 exercises correctly.
- [ ] Verify exercise switching across all 6-7 exercises during an active workout.
- [ ] Confirm the entire workout completes without crashes or long freezes.

## 10. Recovery and finish order

- [ ] Restart the watch during an active set and confirm the exact session resumes.
- [ ] Restart during rest and confirm the remaining time is coherent.
- [ ] Finish Lifto first, then finish Zepp; confirm both histories are saved.
- [ ] In a separate workout, finish Zepp first; confirm Lifto offers recovery without losing sets.

---

## Result

| Area | Pass | Notes or evidence |
| --- | --- | --- |
| Display duration |  |  |
| Active-set pause |  |  |
| Rest pause |  |  |
| Native metrics |  |  |
| Rest alert |  |  |
| Startup and first-set phone sync |  |  |
| Multiple offline sets before server start |  |  |
| Synchronization recovery and retry |  |  |
| Large-program handling |  |  |
| Recovery and finish order |  |  |
