# Risks

P0 risks block the release gate. Each risk carries an owner, a mitigation, and the gate that closes it.

## P0-1 - Zepp Native Workout Activity Integration

Direct sync communicates directly with Liftosaur Cloud via the Running a Workout API but does not create a native Zepp OS workout activity record on the watch.

- **Lifto Companion (Standalone)**: Tracks heart rate and workout state independently via `@zos/sensor`; does not create a native Zepp activity record (no third-party start-workout API exists). Status: MITIGATED by design.
- **Lifto Workout (Workout Extension)**: Runs embedded inside the native Zepp Workout app under Strength Training (`subType: [52]`), where Zepp owns native recording and metrics.
- Mitigation: Standalone app operates independently; Workout Extension delegates native recording to Zepp Workout while handling Liftosaur domain logic.
- Gate: Physical device testing on target hardware in real workout context.
- Status: OPEN / BLOCKED (simulator images omit the native Workout app).

## P0-2 - API Key Exposure

The Liftosaur API key (`lftsk_*`) grants full account access.

- Mitigation: Key is entered and stored strictly in phone-side Zepp `settingsStorage`; automated redaction of `Authorization`, `Bearer`, and `lftsk_*` in all log paths, enforced by automated tests. HTTP requests identify the client via a separate, non-secret installation ID (`X-Liftosaur-Device-Id`). Secrets never cross BLE or enter watch storage.
- Gate: Redaction unit tests pass and no secret appears in any diagnostic export.
- Status: MITIGATED / UNIT_TESTED.

## P0-3 - Write Deduplication and Repeat Safety

Network dropouts during set writes or workout completion must not create duplicate sets or corrupt history.

- Mitigation: Running a Workout API endpoints (`POST /workout/sets`, `POST /workout/finish`, `DELETE /workout/current`) are repeat-safe. Set writes carry stable server identifiers. Start, finish, and discard carry the workout start time. Retried requests return confirmed server state.
- Gate: Automated test suite validates idempotent batch set submission and finish retries.
- Status: MITIGATED / UNIT_TESTED.

## P0-4 - Remote Workout Conflicts & Concurrent Edits

The user may edit or complete sets in the official Liftosaur phone app while a watch session is active.

- Mitigation: Liftosaur Cloud is the authoritative source of truth. The watch drains its local write queue before adopting remote snapshots. If the remote workout is missing, discarded, or started at a different timestamp, the watch opens an explicit recovery prompt and never silently clears local data.
- Gate: Conflict scenario unit tests verify explicit recovery modal without data loss.
- Status: MITIGATED / UNIT_TESTED.

## P0-5 - Hardware and Multi-Device Compatibility

Supporting round and square smartwatches running Zepp OS 3.6+.

- **Evidence Separation**:
  - Companion responsive layout math (`shared/screen-layout.js`, `shared/watch-layout.js`) is UNIT_TESTED and EMULATOR_TESTED for round (Active 2) and square (Bip 6) geometries.
  - Workout Extension DataWidget click-only contracts and geometry are UNIT_TESTED; both generated target shapes compile.
  - Physical compatibility across 28 device models and real workout-context behavior in Zepp Strength Training are NOT proved by build or emulator.
- Mitigation: Dynamic layout computation adapting to device geometry; dedicated hardware test plan.
- Gate: Physical testing across target watch models.
- Status: OPEN / BLOCKED on hardware execution.

## P0-6 - In-Place Widget Update Performance

Full re-rendering on clock ticks drops timer seconds on physical watches.

- Mitigation: Elapsed time, heart rate, and rest timer widgets are registered as live widgets and updated in place via `setProperty(prop.MORE, ...)`.
- Gate: Unit contracts confirm in-place updates; physical tests must confirm smoothness and widget lifetime for Companion's 250 ms sampler and Workout's one-second lifecycle tick.
- Status: UNIT_TESTED / OPEN on physical performance.

## P0-7 - Workout Extension Background Rest Alert Delivery

Zepp OS pauses DataWidget execution (`onPause`) when the widget loses focus or the screen turns off. Background haptic vibration delivery is not documented or confirmed.

- Mitigation: Pure rest alert tracker (`shared/rest-alert.js`) uses absolute timestamp `restEndsAt`. While focused, foreground zero-crossing fires haptic vibration. On `onResume`, the widget checks if `restEndsAt` elapsed while unfocused and fires a one-shot resume alert.
- Gate: Physical hardware verification of background alert behavior.
- Status: MITIGATED (foreground/resume fallback) / OPEN (background delivery UNKNOWN).

## P0-8 - Independent Settings and Credential Isolation per App ID

Lifto Companion and Lifto Workout use distinct App IDs. No documented secure cross-app credential-sharing contract has been confirmed, so the products do not transfer credentials automatically.

- Mitigation: Explicit setup and connection error screens direct the user to enter the Liftosaur API key in the respective app's settings in the Zepp mobile app. Credentials are never shared across watch files or transmitted over BLE.
- Gate: Settings and connection error unit tests.
- Status: MITIGATED / UNIT_TESTED.

## P0-9 - Native Workout Finish Split

Finishing in Lifto Workout finalizes the Liftosaur Cloud session, but native Zepp activity recording continues until manually ended by the user in the system Workout app.

- Mitigation: Dedicated finish confirmation screen in Lifto Workout confirms Liftosaur Cloud synchronization and explicitly instructs the user to end the native workout in Zepp Workout UI.
- Gate: Physical-watch user-flow testing.
- Status: MITIGATED (UI flow) / OPEN (hardware UX validation).

## P1 - Timed Sets and Prompted Variables

The watch cannot run arbitrary interactive Liftoscript variable prompts or background timer countdowns for special timed sets.

- Mitigation: The watch detects sets requiring `promptedVars` or `setTimer` and directs the user to log that set in the official Liftosaur phone app. The watch then polls and adopts the completed set.
- Gate: Unit tests verify prompt triggers for timed sets and script variables.
- Status: MITIGATED.

## P1 - Offline Set Queue Blocking Finish

Finishing while set writes are still queued locally could cause missing sets or out-of-order execution on Cloud.

- Mitigation: The watch enforces that all queued sets must be confirmed by the server before `FINISH_WORKOUT` can be dispatched.
- Gate: Unit test verifies finish rejection when pending set count > 0.
- Status: MITIGATED / UNIT_TESTED.

## P1 - Session Loss on Crash or Restart

Crash or forced restart during active set, rest, or finish must not lose session data.

- Mitigation: Persist every state mutation (plan, journal, unacknowledged set queue, pause intervals, finish/discard intent) to durable watch storage before UI render.
- Gate: Restart during active set, rest, and finish recovery tests pass cleanly.
- Status: UNIT_TESTED.
