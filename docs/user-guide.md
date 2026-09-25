# Lifto user guide

Lifto is an unofficial Liftosaur client for Amazfit watches. The current release is 0.5.11 beta. Start in demo mode if you want to try the controls before connecting an account.

## Choose your app

| App | Open it from | What it records |
| --- | --- | --- |
| Lifto Companion | The watch app list | Your Liftosaur workout; no native Zepp activity |
| Lifto Workout | A data page inside a native Zepp workout | Your Liftosaur workout alongside the native Zepp activity |

You can install both. Configure each app separately in the Zepp phone app. Use one Lifto app to record a set; wait for synchronization before continuing the workout on another device.

## Install and connect

1. Open [GitHub Releases](https://github.com/PreciselyWrong/Liftosaur-ZeppOs-Companion/releases) and select the current beta. Each app has its own install QR and expiry time.
2. Enable [Developer Mode](https://docs.zepp.com/docs/guides/tools/zepp-app/) in the Zepp phone app. In Profile > Settings > About, tap the Zepp icon seven times. Return to your paired watch, open Developer Mode and use its scan action to install the app.
3. Open Companion from the watch app list. For Workout on Active 2, add Lifto at **Workout > Strength Training > Settings > More > Data Page > Add Page > Lifto**, then open that page during a native workout.
4. Try the sample workout without an API key, or connect your own Liftosaur account: copy an API key from Liftosaur Settings > API Keys, then paste it into the selected Lifto app's Settings in Zepp Developer Mode. Cloud access requires Liftosaur Premium. The key stays on the phone.

The [installation guide](https://github.com/PreciselyWrong/Liftosaur-ZeppOs-Companion/blob/main/docs/tester-guide.md) includes the Active 3 Premium data-page path and connection troubleshooting. If a QR has expired, return to Releases for a refreshed code.

## Complete your first workout

1. Choose the intended program, week and day. Confirm the preview before starting. If a workout is already active in Liftosaur, continue that workout instead of starting another.
2. On Prepare, check the exercise, weight, repetitions and RPE where requested. Open Info for notes. Start the set when ready.
3. Complete the set with the values you actually performed. Lifto records it on the watch first, then synchronizes through the phone.
4. Let rest run, adjust it when needed, or prepare the next exercise. With Auto prepare enabled, preparation opens during rest. Starting a repetition-based set remains an explicit action; reaching zero does not complete a set for you.
5. Repeat for the remaining sets. Finish in Lifto and wait for Cloud saving to complete. In Workout, also open the native Zepp workout controls and finish that activity so both histories are saved.

For timed exercises, **Stop** records the held duration; expiry alerts but does not complete the set. Unilateral exercises record left and right durations together after both sides. See [timed sets and recovery](https://github.com/PreciselyWrong/Liftosaur-ZeppOs-Companion/blob/main/docs/timed-sets.md).

## Customize the display

In the selected Lifto app's phone Settings, open **Workout display**:

- **Workout progress** adds a bar showing completed sets across the workout. It starts off.
- **Plate breakdown** starts on. Turn it off to give the weight/target more space while keeping its unit visible.
- **Rest Info button** starts on. Turn it off to hide Info on the detailed rest screen; Info elsewhere is retained.

Preferences are configured separately for Companion and Workout. Reopen the watch app while connected to receive the latest settings. These options do not change the workout prescription or rest deadline.

## Pause, correct and synchronize

- Tap the purple elapsed timer to open workout Pause/Resume. Workout also follows the native activity's pause state.
- The recording status distinguishes **On watch**, **N pending**, **Synced**, and a conflict or recovery state. Pending means the Cloud has not acknowledged all required writes yet.
- Open the recording status and choose **Edit last set** to correct the latest completed weight or repetitions. Save or cancel the edit. Rest and the next prepared set are preserved.
- Avoid editing the same set simultaneously on the watch and phone. See [recording status and correction limits](https://github.com/PreciselyWrong/Liftosaur-ZeppOs-Companion/blob/main/docs/set-corrections.md).

## If something goes wrong

| Symptom | Next action |
| --- | --- |
| Sets remain pending | Keep the local workout, reconnect the phone and reopen Lifto. Check the recording status before finishing. |
| Conflict or Recovery appears | Read the explanation and check the active workout on the phone. Do not discard unsynchronized watch work. |
| The watch or Lifto restarts | Reopen the same app and inspect its restored session. Check pending writes before starting a replacement workout. |
| An exercise image is missing | Keep training using the text. Check the image preference and phone connection; reopen Info to retry. |
| Workout does not alert while hidden | Return to Lifto. An expired rest has a catch-up alert; background alert delivery is not confirmed on every device. |
| The Workout page is missing | Follow the model-specific installation path. Installation package coverage does not prove native Workout support. |

For a recurring restart, enable **Record watch diagnostics** in the affected app's phone Settings and open that app once while connected. After a recurrence, reopen it and inspect **Watch diagnostics** in the phone settings. Share the report with the exact watch model, firmware, app build and the action that preceded the restart. Never share your API key. The [tester guide](https://github.com/PreciselyWrong/Liftosaur-ZeppOs-Companion/blob/main/docs/tester-guide.md#reporting-a-problem) explains the report's limits.

## Compatibility and current limits

- Active 2 firmware 7.23.0.1, API level 400: loading Workout in Strength Training is recorded. This is not a complete test result for the current beta.
- Active 3 Premium, Zepp OS 6, firmware 6.3.13.5: a tester reported successful Workout installation. Full lifecycle coverage remains pending.
- Free Training, background vibration, timed-set lifecycle, and other model/firmware combinations require their own physical tests. Simulator results are not hardware evidence.
- Reboots have been reported in both products. Lifecycle fixes and opt-in diagnostics are available, but a native reboot cause has not been established.
- Prompted program variables and separate unilateral AMRAP repetitions still require the phone.

The [hardware test plan](https://github.com/PreciselyWrong/Liftosaur-ZeppOs-Companion/blob/main/docs/workout-extension-hardware-test-plan.md) records the remaining validation scope.

## Video guides

Current-build recordings are still pending. The written steps above cover installation, a first workout, pause, correction and recovery. Future recordings will show the actual app and include captions or equivalent written steps; older demo screenshots are not presented as the current interface.

## Help and privacy

- [Report a problem or suggest an improvement](https://github.com/PreciselyWrong/Liftosaur-ZeppOs-Companion/issues)
- [Privacy policy](https://github.com/PreciselyWrong/Liftosaur-ZeppOs-Companion/blob/main/docs/privacy-policy.md)
- [Latest beta and install codes](https://github.com/PreciselyWrong/Liftosaur-ZeppOs-Companion/releases)

This guide is the source for the GitHub wiki Home page. Maintain the repository copy and refresh the wiki mirror when it changes.
