# Device smoke checklist: Lifto Workout on a physical watch

A ten-minute pass on a real Amazfit Active 2 before a release, or after a change to saving, sync,
images or the page lifecycle. The simulator does not reproduce memory pressure, Bluetooth timing or
the native Workout lifecycle, so these checks need the watch. Each step names what you should see and
the log line or screen that proves it. Record the firmware, the app build and the result of each step.

## Setup (about 2 minutes)

1. Build the development project: `pwsh ./dev.ps1 -Product workout -Plan` prints the commands; the
   prepared project lands in `build/dev/workout/workout-extension`.
2. If a bridge is already running, stop it first (`exit` in its console, or close its terminal).
   A running bridge keeps serving the directory it started in, so a regenerated development
   directory is not picked up until the bridge is restarted.
3. On the phone, open **Zepp > Profile > Settings > Developer Mode** and open the
   **Zepp Developer Mode Bridge** screen. Keep the phone unlocked on that screen for the whole
   session: when the phone locks or leaves it, the bridge connection drops.
4. In a terminal inside the prepared directory, run `zeus bridge`, then in its console:
   - `connect` and pick the phone and watch;
   - `install` to push the build to the watch;
   - leave the console open: watch `console.log` lines appear there as they happen;
   - `screenshot` captures the watch screen when a step asks for a screen as proof.
5. In the phone settings of Lifto Workout, enable **Record watch diagnostics** and
   **Exercise images**, and choose a program day with at least two exercises that have pictures.

## Checks (about 8 minutes)

| # | Action | Expected observation | Proof |
| --- | --- | --- | --- |
| 1 | Start a Strength Training workout and swipe to the Lifto data page; time it from the tap that opens the page. | The loading screen, then Home; a restored session appears at once, without waiting for the phone. Note the seconds to Home and compare with the previous release. | Log `[lifto-ext] data-widget onInit`, then `[lifto-ext] data-widget build`; a screenshot of Home. |
| 2 | Leave the watch idle on Home or Prepare for 30 s. | Pictures for the day load in the background, one at a time, and the screen does not redraw for each one. | Repeated `[lifto] exercise image memory request free=...` followed by `[lifto] exercise image state ready preload`. |
| 3 | Complete a set while pictures are still loading. | The set is saved at once; no new picture request starts until the set sync reply has arrived. | The `[lifto] exercise image memory request` lines pause after the tap and resume after the sync; in the health summary (step 9), `0 overlapping a set sync`. |
| 4 | With **Plate breakdown** on, open the last set and change its weight. | The plates line under the weight updates to the new weight right away. | A screenshot of the set screen showing the edited weight and its plates. |
| 5 | Disable Bluetooth on the phone mid-set, complete the set, wait 20 s, then re-enable Bluetooth. | The watch keeps the set and shows `Sync pending`; after reconnection the warning clears without another tap. | Screenshots before and after reconnection; the set appears in Liftosaur. |
| 6 | Complete a set and immediately force-close the Workout app (from the watch's recent apps, where the firmware offers it) before the screen settles; reopen the data page. | The session resumes on the same exercise with the set kept; nothing is lost or duplicated. | Log `[lifto-ext] data-widget onInit` without a `[session-store] write failed` line; the set count on screen. |
| 7 | Use the native Workout pause, wait 10 s, then resume. | The data page pauses and resumes with the native workout; the rest timer and workout clock continue from the right time. | Logs `[lifto-ext] data-widget onPause` and `[lifto-ext] data-widget onResume`; a screenshot after resume. |
| 8 | Finish one workout, then start another and discard it. | The finished workout reaches Liftosaur; the discarded one does not, and the watch returns to Home both times. | The Liftosaur history; screenshots of Home after each. |
| 9 | Reopen the phone settings and copy **Recent watch steps**. | The report ends with **Health summary**. Step 6 shows as `Previous run ended without a clean exit`; every other close as `closed normally`. Slow saves and redraws show as their worst durations. | The copied text, attached to the release notes or the issue. |

## When a check fails

- Copy **Recent watch steps** before reopening the app again: each launch rolls the health summary
  forward by one run.
- Keep the bridge console output from the failing step, and the screenshot.
- Open an issue with the watch model, firmware, app build, the failing step number and the copied
  report. Never paste the API key.
