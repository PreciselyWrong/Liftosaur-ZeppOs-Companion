# Synchronization status and set corrections

During an active workout, tap the clock and recording status at the bottom of either watch app.

## Recording status

- **On watch**: the workout is recorded locally and Cloud start has not been confirmed, or direct sync is unavailable.
- **N pending**: N distinct sets have writes waiting for confirmation. Several corrections to the same set count as one pending set.
- **Synced**: all queued set writes have been acknowledged by Liftosaur.
- **Conflict** or **Recovery**: open the status for an explanation and resolve the workout on the phone. Local work is retained.

The status does not increase polling frequency. A pending correction prevents finishing until the required writes are acknowledged.

## Correct the last set

1. Open the recording status and choose **Edit last set**.
2. Adjust the completed weight or repetitions.
3. Choose **Save**, or **Cancel** to leave the recorded result unchanged.

Editing does not pause or restart rest, change the next prepared exercise, or add a completed set. Other recorded values, including RPE and timed durations, are retained.

A failed save keeps the draft visible with an explanation. If the target changed, cancel and reopen the editor to read the latest values. Saving an unchanged draft does not send another set write.

Corrections apply to the latest identifiable completed set in an active direct workout. Finished workouts, unsupported unilateral repetitions, missing required values and an unknown completion order require the phone. This is not a workout-history editor.

## Synchronization boundary

The [official Liftosaur API](https://www.liftosaur.com/doc/api) addresses completed sets by their set ID. Repeating a write is safe, and a changed completion updates that set. The API applies the last received write; it does not offer revision-based conditional updates.

Lifto detects known changes while a draft is open and preserves local corrections through retries. A simultaneous phone edit that the watch has not received cannot be detected atomically. Avoid editing the same set on both devices at once.

Automated tests cover synchronization, recovery and mocked watch interactions. Physical-watch rendering remains a separate validation step.
