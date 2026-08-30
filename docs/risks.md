# Risks

P0 risks block the release gate. Each risk carries an owner, a mitigation, and the gate that
closes it.

## P0-1 - Zepp Native Workout Activity Integration

Direct sync communicates directly with Liftosaur Cloud via the Running a Workout API but does
not create a native Zepp OS workout activity record on the watch.

- Mitigation: Standalone app tracks HR and workout state independently; native workout extension integration remains separately gated by physical device verification.
- Gate: Real device testing on target hardware.
- Status: OPEN (gated on physical device testing).

## P0-2 - API Key Exposure

The API key (`lftsk_*`) grants full Liftosaur account access.

- Mitigation: Key confined strictly to phone-side Zepp `settingsStorage`; automated redaction of `Authorization`, `Bearer`, and `lftsk_*` in every log path, enforced by automated tests. HTTP requests identify the client via a separate, non-secret installation ID (`X-Liftosaur-Device-Id`).
- Gate: Redaction tests pass and no secret appears in any diagnostic export.
- Status: MITIGATED / VERIFIED.

## P0-3 - Write Deduplication and Repeat Safety

Network dropouts during set writes or workout completion must not create duplicate sets or corrupt history.

- Mitigation: Running a Workout API endpoints (`POST /workout/sets`, `POST /workout/finish`, `DELETE /workout/current`) are repeat-safe. Set writes carry stable server identifiers. Start, finish, and discard carry the workout start time. Retried requests return confirmed server state.
- Gate: Automated test suite validates idempotent batch set submission and finish retries.
- Status: MITIGATED / VERIFIED.

## P0-4 - Remote Workout Conflicts & Concurrent Edits

The user may edit or complete sets in the official Liftosaur phone app while a watch session is active.

- Mitigation: Liftosaur Cloud is the authoritative source of truth. The watch drains its local write queue before adopting remote snapshots. If the remote workout is missing, discarded, or started at a different timestamp, the watch opens an explicit recovery prompt and never silently clears local data.
- Gate: Conflict scenario unit tests verify explicit recovery modal without data loss.
- Status: MITIGATED / VERIFIED.

## P0-5 - Hardware and Screen Compatibility

Support across 28 round and square smartwatch models running Zepp OS 3.6+.

- Mitigation: Dynamic layout computation (`shared/watch-layout.js`, `shared/screen-layout.js`) adapting to device geometry; automated layout property tests.
- Gate: Tested against round and square screen invariants in simulator and physical builds.
- Status: VERIFIED in emulator.

## P0-6 - In-Place Widget Update Performance

Full re-rendering on clock ticks drops timer seconds on physical watches.

- Mitigation: Elapsed time, heart rate, and rest timer widgets are registered as live widgets and updated in place via `setProperty(prop.MORE, ...)`.
- Gate: 250 ms tick sampler updates only on second boundaries without widget leaks.
- Status: VERIFIED.
## P1 - Timed Sets and Prompted Variables

The watch cannot run arbitrary interactive Liftoscript variable prompts or background timer countdowns for special timed sets.

- Mitigation: The watch detects sets requiring `promptedVars` or `setTimer` and directs the user to log that set in the official Liftosaur phone app. The watch then polls and adopts the completed set.
- Gate: Unit tests verify prompt triggers for timed sets and script variables.
- Status: MITIGATED.

## P1 - Offline Set Queue Blocking Finish

Finishing while set writes are still queued locally could cause missing sets or out-of-order execution on Cloud.

- Mitigation: The watch enforces that all queued sets must be confirmed by the server before `FINISH_WORKOUT` can be dispatched.
- Gate: Unit test verifies finish rejection when pending set count > 0.
- Status: MITIGATED / VERIFIED.

## P1 - Session Loss on Crash or Restart

- Mitigation: Persist every state mutation (plan, journal, unacknowledged set queue, pause intervals, finish/discard intent) to durable watch storage before UI render.
- Gate: Restart during active set, rest, and finish recovery tests pass cleanly.
- Status: VERIFIED.
