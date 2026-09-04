# Changelog

## [0.4.6] - 4 September 2026

### Fixed
- Sets now sync using the started workout in both watch apps, including sets completed before the phone reconnects.
- Startup synchronization preserves local sets, edits and rest timers.

### Added
- Active 3 Premium setup instructions and a dedicated hardware test checklist.

## [0.4.5] - 3 September 2026

### Fixed
- Phone changes now appear reliably after background synchronization in both watch apps.
- Phone changes made during rest now reach the watch within two minutes.

## [0.4.4] - 3 September 2026

### Added
- Workout Overview now has a Sync button for checking phone changes on demand.

### Changed
- Lifto Workout now checks for phone changes when starting the next set, with a two-minute safety check while lifting instead of downloading the workout every minute.
- Failed background checks now wait one, two and then five minutes before trying again.

## [0.4.3] - 3 September 2026

### Changed
- Lifto Workout now checks the shared phone workout once per minute instead of every 15 seconds, while still refreshing after actions and when returning to Lifto.

### Fixed
- Lost phone requests now return control after 20 seconds instead of leaving loading or discard screens spinning forever.
- Discarding a missing phone workout now clears the local conflict immediately.
- AMRAP and logged RPE targets now keep their `+` marker on active and rest screens.
- The plate loading supplied by Liftosaur now appears below the target weight.
- Opening Prepare during rest now starts the set automatically when the timer reaches zero.
- Weight, rep and RPE changes made in Prepare now survive a simultaneous phone refresh.

## [0.4.2] - 3 September 2026

### Fixed
- Rest completion now uses the watch's stronger reminder vibration, making it easier to notice between sets.

## [0.4.1] - 2 September 2026

### Changed
- Rest times for standard sets, warmups, and supersets now follow Liftosaur account settings in both apps.
- The local screen-on choice now behaves the same in Lifto Companion and Lifto Workout.
- Fresh install QR codes now cover both apps and the complete 28-target preview matrix until 9 September 2026.

### Fixed
- Plate loading recommendations now display directly from Liftosaur Cloud running workout data when gym equipment definitions are absent.
- Rest alert vibration in Lifto Workout now safely handles scalar and object sensor mode configurations across Zepp OS firmware variants.

## [0.4.0] - 1 September 2026

### Added
- Lifto Workout can now be built separately for Zepp Strength Training, with program selection, set adjustments, notes, rest, recovery, conflicts, and Liftosaur finish guidance in one tap-only view.
- Native Zepp duration and calories appear when the Workout app provides them.
- Lifto Workout can keep its screen visible for 60, 120, 240 seconds, or throughout the workout.
- Separate build and temporary preview commands now cover Lifto Companion and Lifto Workout.

### Changed
- Both products now use one durable workout engine for offline sets, phone changes, crash recovery, and repeat-safe finishing.
- Pull requests now check 454 workout, security, layout, package, and preview contracts without requiring private credentials.
- Public documentation now focuses on installation, testing, privacy, and store submission.
- Active 2 setup now gives the exact watch path for adding Lifto to Strength Training.

### Fixed
- Lifto Workout now opens its sample workouts without requiring a Liftosaur API key.
- Lifto Workout keeps its Menu button fully visible on round screens.
- Lifto Workout leaves clear space between its main action and the clock.
- Pausing the native Zepp workout now also pauses Lifto workout and rest time.
- Native duration and calories now keep updating while Lifto stays visible.
- Offline sets now retry automatically after returning to Lifto or reconnecting the phone.

### Known limitations
- Lifto Workout still needs a registered Zepp App ID and physical-watch validation before a public test QR can be offered.
- Rest alerts fire while Lifto is visible and once on return; delivery while another Workout page is visible remains unconfirmed.

## [0.3.3] - 1 September 2026

### Fixed
- Starting with an exercise in the middle now continues forward after synchronization instead of jumping back to the beginning.

### Changed
- A fresh test build now covers all supported round and square watches until 8 September 2026 at 15:10 UTC.

## [0.3.2] - 30 August 2026

### Added
- Start a workout on the watch and continue it in Liftosaur, or start on the phone and continue on the watch.
- Sets completed on either device now appear on the other during the same workout.
- Offline sets wait safely on the watch and synchronize after the phone reconnects.

### Changed
- Rest times, warmups, supersets, weights and plate loading now follow the values already resolved by Liftosaur.
- Finishing on the watch now updates history, progression, 1RM changes and the next workout together.
- The phone settings page now leaves rest defaults in Liftosaur, where they apply to every device.
- Phone changes are checked after workout actions while repeated checks and connection failures stay rate limited.
- Public test data is now compact and fully synthetic.
- A fresh test build now covers all supported round and square watches until 7 September 2026 at 17:56 UTC.

### Fixed
- The app icon now appears perfectly round in the watch app list.
- Production watch packages build successfully again after the direct synchronization update.
- A failed set synchronization can no longer finish an incomplete workout or erase the local copy.
- Older server responses can no longer replace newer sets completed on the watch.
- A missing phone workout now opens a recovery choice instead of silently clearing the watch session.
- Paused time and the real offline start and finish times survive restarts and cross-device updates.
- Release security checks no longer mistake reviewed placeholders for real account keys.

## [0.3.1] - 25 August 2026

### Fixed
- Warmup sets defined with percentages now calculate and display their target weight even when gym equipment resolution falls back to default increments.
- The watch now keeps heart rate unavailable until the sensor reports a real measurement.
- All three prescriptions in the workout preview now remain fully visible.
- Fresh test-build QR codes can be generated again.
- The app no longer draws a wrong round layout when the watch cannot report its screen size.
- Warmup and superset rest times are now already filled in when Settings is opened for the first time.
- A completed workout now resumes its save after a watch restart instead of appearing dismissible and losing its only local copy.
- Retrying a save after a lost response or phone service restart no longer creates a duplicate history entry.
- The workout timer now stops on the final set and keeps the same duration after recovery.
- Values changed in Prepare now also update the upcoming set shown on the rest screen.
- Session data stays available in memory if watch storage fails during a workout.

### Added
- Exact barbell plates, cable stacks and fixed weights are shown when the current gym equipment can load the requested weight.

### Changed
- The public test QR code now installs the latest beta on all 28 supported round and square watches until 1 September 2026 at 10:02 UTC.
- The app now has its own orange dinosaur lifting a barbell and wearing a watch, independent from Liftosaur branding.
- Diagnostic logs no longer include workout names or completed-set counts.
- Exercise-name matching now has one shared normalization rule across plans, history and gym equipment.
- The workout preview now pages through three exercises at a time without leaving the screen.
- Superset exercises now carry their group colour in the workout preview.

## [0.3.0] - 20 August 2026

### Changed
- Simulator development now starts with one project command that checks Zeus and targets the Amazfit Active 2.
- Demo mode is now unmistakable: the phone explains that no account is connected and nothing reaches Liftosaur, while a permanent `DEMO` label stays visible on the watch.
- Every watch screen now uses one readable type scale, fewer rows and stronger contrast. Exercise lists, workout previews, set controls, rest details and sync results stay clear at real watch size.
- The phone settings page now uses readable labels and controls, and the beta interface ships in English only.
- Sets without an RPE target now use two larger controls for weight and reps. The RPE control appears only when the current set asks for it.
- Version history now correctly identifies every build as pre-release software. Versions remain below 1.0.0 until physical-watch validation clears the real release gate.
- The application is now called **Lifto Companion**, and its vendor is the author of this project rather than Liftosaur. The previous name and vendor claimed an affiliation that does not exist, which is both inaccurate and a likely rejection at store review. Liftosaur is still named in the description as the service the application connects to.
- Fresh unified test build QR code covering all 28 Zepp OS 3.6+ round and square models, valid until 22 August 2026 at 06:46 UTC. The README and the tester guide carry the single code, and the tester guide states that the API key step is optional, since demo mode covers a tester with no Premium subscription.
- The settings page no longer reports "Not connected" when no API key is stored. That state is demo mode, not a failure: it now says so, explains that nothing is saved, and points at the key field.
- README now links the changelog and the tester guide, and documents the 7 day validity of a `zeus preview` QR code.
- Changelog, agent context and TODO are now written in English.

### Added
- Session swipes now open and page the exercise overview, control the rest timer and switch between Rest and Prepare. Completing, finishing and discarding remain tap-only.
- The time of day, under the bottom button of every screen. The app keeps the screen on for the whole workout, which is exactly when the watch face is out of reach, so the clock sits on the one row no button uses: smallest type, dimmest colour, and your own 12h or 24h setting.
- English store listing copy with the non-affiliation disclaimer and Premium requirement.
- Privacy policy (`docs/privacy-policy.md`) covering the API key, the workout data, the heart rate and the three declared permissions.
- Zepp App Store submission file (`docs/store-listing.md`): listing copy, asset list, reviewer notes, and the demo mode path that removes any need for a test account.
- Default rest timer settings for standard sets, supersets and warmups in the phone settings page, automatically applied when a program omits explicit timers.
- Support for square watches such as the Amazfit Bip 6 (`st: "s"`, 390x450). The screens are drawn once, in the round design space, and a single layout adapter fits them to the real panel. Round watches keep the identity transform and render exactly as before. On square watches the system status bar carrying the app name is hidden and the layout additionally keeps clear of the band it occupies, since it sat on top of the title and the first row of buttons. Validated on the Amazfit Bip 6 emulator.
- The comments left on an exercise in past workouts (the `//` notes Liftosaur records in the history) are now shown under "Past sessions" in that exercise's notes, up to the three most recent. Exercises that had no notes at all now get the ℹ button as soon as a past comment exists.

### Fixed
- Pausing an overtime rest now freezes the counter instead of resetting it to zero.
- Exercise paging and Close remain visible and responsive after changing page, closing or reopening the details.
- The steppers on the "Prepare" screen now work. They were rendered during rest but every tap was ignored, and they showed the set that had just been logged rather than the one coming up. Prepare now targets the upcoming set - including the superset partner when the next set belongs to another exercise - and what is set there is what the set starts with.
- Warmup weights are now always loadable with the equipment you actually own. A warmup below the bar (15 kg asked on a 20 kg bar) came from a fallback that simply rounded the percentage to the nearest 2.5 kg whenever the gym's equipment could not be identified. That fallback is gone: the gym's bar and plates answer first, the exercise's own rounding step second, and if neither can, the percentage is shown rather than an unloadable number. Equipment identification also improved in two cases that caused most of these misses: custom exercises whose name contains a comma ("Romanian Deadlift, Barebell"), and exercises mapped to equipment in a single gym with no `default` entry.
- The app now declares the `data:os.device.info` permission. Without it the watch could not report its own screen size, which is what the square layout is built from.
- Tester guide for installing the app from a QR code with a phone only, no computer required (`docs/tester-guide.md`).
- Public test build QR code in the README, with its supported models and its expiry date.

## [0.2.5] - 14 August 2026

### Fixed
- ISO formatting of the workout date, and more reliable transmission of the duration in your history.

## [0.2.4] - 14 August 2026

### Changed
- Warmup sets are now clearly marked with a distinct badge and label.
- Fixed the calculation and upload of the total workout duration to your online account.

## [0.2.3] - 14 August 2026

### Fixed
- Fixed saving the workout history to your online account.
- Pausing the rest timer now also pauses the overall workout timer.

## [0.2.2] - 14 August 2026

### Added
- Superset exercises show a badge and a distinct color per group so you can spot them faster.
- An info button to read an exercise's notes and comments right during a set or rest.

## [0.2.1] - 14 August 2026

### Added
- The rest timer shows the next exercise's name, set and target weight so you can prepare your equipment.
- Buttons to pause the timer, or add or remove 10 seconds depending on how you feel.
- A button to collapse the timer and show the next set's screen.
- Vibration reminders at 30 seconds, 60 seconds and 120 seconds past the rest time.

### Fixed
- Warmup sets now show their weight correctly and start their rest timer.

## [0.2.0] - 14 August 2026

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
  program's progression.
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

## [0.1.0] - 14 August 2026

### Added
- Follow your Liftosaur workouts on your wrist with live heart rate.
- The screen stays on and responsive during a workout.
- A rest timer that vibrates when it is time to go again and counts overtime.
- Large touch targets for adjusting reps and weight.
