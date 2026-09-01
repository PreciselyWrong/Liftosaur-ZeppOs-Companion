# Architecture

## Two-Product Architecture & Boundaries

Lifto is structured as two distinct, complementary packages sharing a platform-independent domain and protocol layer:

1. **Lifto Companion** (Standalone Mini Program)
   - App ID: `1123411` (`appType: "app"` in `app.json`)
   - Runtime: standalone watch application (`page/common/index.js`)
   - Features: program browsing, custom workout selection, direct Cloud sync, live heart-rate sensor via `@zos/sensor`, display wake lock via `@zos/display`, manual recovery tools
   - Local storage key: `liftosaur.session.v2`

2. **Lifto Workout** (Strength Training Workout Extension)
   - App ID: dedicated registered ID (`appType: "app"`, `extType: "workout"` generated via `shared/workout-extension-manifest.js`)
   - Runtime: embedded single-page DataWidget (`data-widget/common/index.js`) inside the native Zepp Workout application (`subType: [52]`)
   - Features: click-only session flow, live native duration and calorie readouts via `getSportData`, shared Cloud synchronization, absolute rest alerts with `onResume` fallback
   - Local storage key: `liftosaur.extension.session.v2`

---

## Components and Boundaries

| Component | Runs on | Owns | Never owns |
| --- | --- | --- | --- |
| Lifto Companion (`page/common/`) | Watch | Standalone UI, touch navigation, HR sensor via `@zos/sensor`, screen wake lock | Direct HTTP, raw secret keys, native Zepp workout recording |
| Lifto Workout (`data-widget/common/`) | Watch | Click-only DataWidget UI, embedded Strength Training flow, read-only `getSportData` display | Direct HTTP, raw secret keys, starting/stopping native Zepp workout |
| Shared Controller (`shared/workout-controller.js`) | Watch / Node | Local day plan, session state machine, durable journal, write queue, polling policy, conflict resolution, finish/discard orchestration | UI rendering, hardware sensor access, HTTP transport |
| Standalone Storage (`liftosaur.session.v2`) | Watch | Companion local session snapshot, journal, set queue, pause intervals | Extension session state, server-wide progression |
| Extension Storage (`liftosaur.extension.session.v2`) | Watch | Extension local session snapshot, journal, set queue, pause intervals | Companion session state, server-wide progression |
| Companion Side Service (`app-side/`) | Phone | Standalone API key, standalone installation ID (`X-Liftosaur-Device-Id`), HTTPS to Cloud | Extension settings, watch UI rendering |
| Extension Side Service (`app-side/`) | Phone | Extension API key, extension installation ID (`X-Liftosaur-Device-Id`), HTTPS to Cloud | Companion settings, watch UI rendering |
| Native Zepp Workout App | Watch | System workout session, native activity recording, sensor aggregation, native fitness history | Liftosaur Cloud session, Liftosaur progression scripts |
| Liftosaur Cloud | Remote | Authoritative active workout state, programs, history, exercise update scripts, progression, 1RM, `nextDay` pointer | Local watch UI / device state |

---

## Canonical Domain Layer (`shared/workout-controller.js`)

Both packages share one authoritative domain controller:

- **Day Plan Mapping**: `shared/workout-api-plan.js` maps official `data.workout` responses to local day plans.
- **Session State Machine**: `shared/workout-session.js` maintains the active state (`NO_PLAN`, `READY`, `ACTIVE_SET`, `REST`, `FINISHING`, `COMPLETED`, `CANCELLED`), set journal, and pause intervals.
- **Durable Persistence**: Every state transition persists to the target package's storage namespace before UI redraw.
- **Asynchronous Sync**: `POST /workout/start`, `POST /workout/sets`, `GET /workout/current`, `POST /workout/finish`, and `DELETE /workout/current` run in the background.
- **Adaptive Polling Policy**: `shared/workout-refresh-policy.js` enforces a 10-second action floor, 15-second passive checks, and exponential backoff (30s, 60s, 120s) on network failures.
- **Conflict Resolution**: If the remote session vanishes or reports a mismatched start time, the controller transitions to an explicit conflict state without deleting local data.

---

## Native Zepp Ownership & Read-Only Metrics

In Workout Extension mode, the native Zepp Workout application is the sole owner of workout activity recording:

- Lifto Workout requests permission `data:user.hd.workout`.
- The DataWidget reads live duration and calories via `getSportData({ type: 'duration' | 'calories' })`.
- Metrics are defensively parsed via `shared/workout-extension-metrics.js`.
- Lifto Workout **never** starts, pauses, resumes, or stops native Zepp recording; no public API exists for third-party widgets to control the system Workout app.

---

## Phone Settings & Security Boundary

- Each package has its own App ID and separate phone settings page (`setting/index.js`).
- The Liftosaur API key (`lftsk_*`) is entered and stored in phone `settingsStorage` for each respective app.
- Secrets are never transmitted across BLE, stored in watch `LocalStorage`, or shared via watch files.
- Each Side Service installation generates a stable, random installation ID stored in phone `settingsStorage` (`liftosaurDeviceId`) and attaches it as `X-Liftosaur-Device-Id`.

---

## Cloud-First Continuity

Liftosaur Cloud is the universal handoff mechanism between devices:

```text
       Liftosaur Mobile App (Official)
                     ^
                     | HTTPS (/workout/*)
                     v
               Liftosaur Cloud
                     ^
                     | HTTPS (/workout/*)
                     v
           Mobile Side Service (v3)
                     ^
                     | BLE / ZML Protocol v3
                     v
       +-------------+---------------+
       |                             |
Lifto Companion               Lifto Workout
(Standalone App)           (Workout Extension)
```

- Starting a workout in Lifto Companion, Lifto Workout, or the official Liftosaur phone app registers on Cloud via `POST /workout/start`.
- Either watch app queries `GET /workout/current` on launch to resume an active workout seamlessly.
- No local watch-to-watch IPC or credential exchange is required.

In the legacy v1 REST flow (now retained only for legacy snapshot recovery), a history-based suggestion was independent of the official phone app day pointer because raw REST writes did not advance it. Under the Running a Workout API (Protocol v3), `GET /workout/next` provides the official scheduled workout directly, and `POST /workout/finish` advances the official phone pointer automatically.

---

## Two-Stage Workout Finish Split

Finishing a session in Lifto Workout involves two separate operations:

1. **Liftosaur Cloud Finalization**:
   - `finishWorkoutRemote()` in `shared/workout-controller.js` drains any remaining queued sets.
   - `POST /workout/finish` sends start time, end time, and preserved pause intervals.
   - Liftosaur Cloud atomically saves history, progression, 1RM updates, advances the phone `nextDay` pointer, and clears the active Cloud workout.
   - Local extension storage (`liftosaur.extension.session.v2`) is cleared.

2. **Native Zepp Workout Completion**:
   - Lifto Workout displays an explicit finish confirmation screen prompting the user to end the native workout.
   - The user finishes and saves the native activity using the Zepp Workout system controls.

---

## Rest Alerts & Lifecycle Fallback

- Rest timing uses absolute timestamps (`restStartedAt`, `restDuration`, `restEndsAt`).
- While the DataWidget is focused, `shared/rest-alert.js` tracks zero-crossing and triggers haptic vibration via `Vibrator`.
- When the DataWidget loses focus or the screen turns off, Zepp OS pauses widget execution (`onPause`).
- On `onResume`, the widget checks whether `restEndsAt` passed while unfocused and immediately fires a single resume alert.
- Background vibration delivery while the DataWidget is unfocused remains `UNKNOWN` and cannot be claimed without physical hardware verification.

---

## Evidence Limits

- **Unit Tested**: Domain controller, session state machine, protocol encoding, REST payload mapping, refresh policies, metric parsers, rest alert logic, and build/preview generators are validated by 448 Node.js tests.
- **Emulator Evidence**: Companion layouts have existing round and square simulator evidence. The generated Workout DataWidget can be previewed outside workout context, which does not validate this full renderer inside the native Workout app.
- **Hardware Gated**: Simulator images omit the native Workout app; real workout-context behavior, background rest alerts, and multi-device compatibility remain unproven until executed against the physical-watch test plan.
