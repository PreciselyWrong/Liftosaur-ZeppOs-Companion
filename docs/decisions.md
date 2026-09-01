# Architecture Decision Records

Each ADR carries status, context, decision, alternatives, consequences, and evidence.
Status is one of `PROPOSED`, `ACCEPTED`, `BLOCKED`, `SUPERSEDED`.

## ADR-001 - Liftosaur Cloud stays the authoritative source of truth

**Status:** ACCEPTED

**Context.** Liftoscript evaluation, progression, 1RM updates, and next-day schedule are authoritative in Liftosaur. Reimplementing them on the watch would fork behavior and drift.

**Decision.** The watch never evaluates Liftoscript or calculates progression locally. The official Running a Workout API (`/workout/*`) is the sole authority for active workout state, set updates, and finalization.

**Alternatives.** Local Liftoscript interpreter - rejected: drift risk, AGPL exposure, watch runtime constraints.

**Consequences.** Full offline program evaluation is impossible; the local journal must carry the active session until the phone Side Service is reachable.

**Evidence.** [liftosaur-api.md](liftosaur-api.md), `shared/workout-api-plan.js`, `shared/workout-controller.js`.

## ADR-002 - The Side Service is the only gateway to the Cloud

**Status:** ACCEPTED

**Context.** The Liftosaur API key (`lftsk_*`) grants full account access. Storing or transmitting credentials on the watch creates unnecessary security risk.

**Decision.** The API key is entered and stored exclusively in phone `settingsStorage`. All HTTPS requests go through `LiftosaurApiClient` in the mobile Side Service. No secret is sent across BLE or stored on the watch. Requests identify the client using a stable, non-secret installation ID (`X-Liftosaur-Device-Id`).

**Alternatives.** Key on the watch - rejected outright. Third-party proxy - rejected: out of scope, adds an external operator.

**Consequences.** Every Cloud interaction requires phone reachability; the protocol must carry request/response pairs explicitly.

**Evidence.** [risks.md](risks.md) P0-2, `app-side/liftosaur-api-client.js`, `setting/index.js`.

## ADR-003 - Persist locally before render, sync asynchronously

**Status:** ACCEPTED

**Context.** Watch app crashes, restarts, disconnections, and delayed responses must never lose a logged set or corrupt session state.

**Decision.** Every critical event (plan, completed sets, journal, pause intervals, finish/discard intent) is appended to durable watch storage before the UI updates. Cloud synchronization runs asynchronously and never blocks user interaction.

**Alternatives.** Write-through to Cloud on each set - rejected: latency, no offline path.

**Consequences.** Replay logic, offline queue draining, and explicit conflict recovery (`RESUME` / `DISCARD` / `RETRY`) are mandatory.

**Evidence.** `shared/workout-controller.js`, `shared/session-storage.js`, `tests/workout-controller.test.js`.

## ADR-004 - Absolute-time rest timers

**Status:** ACCEPTED

**Context.** Watch lifecycle transitions (`onPause`, screen off, backgrounding) suspend tick counters and timer callbacks.

**Decision.** Rest is stored as absolute timestamps: `restStartedAt`, `restDuration`, `restEndsAt`. Remaining countdown and overtime values are always derived from the current clock.

**Alternatives.** Relative tick counters - rejected: freeze on pause or screen sleep.

**Consequences.** Timer ticks are purely for UI repaints; clock adjustments must be handled gracefully.

**Evidence.** `shared/workout-session.js`, `shared/rest-alert.js`, `tests/rest-alert.test.js`.

## ADR-005 - Target watch hardware validation

**Status:** BLOCKED

**Context.** Workout Extension runs as a plug-in for the Zepp OS system Workout app. Simulator images do not include the system Workout app, so real workout-context behavior cannot be proven in the emulator.

**Decision.** Defer hardware compatibility claims for Workout Extension devices until physical-watch testing passes on designated models and firmware versions.

**Alternatives.** Inferring device compatibility from API level or build output - rejected: misleading.

**Consequences.** Release gate for physical distribution remains blocked on hardware validation.

**Evidence.** [zepp-capabilities.md](zepp-capabilities.md), [workout-extension-hardware-test-plan.md](workout-extension-hardware-test-plan.md), [risks.md](risks.md) P0-5.

## ADR-006 - Licensing boundary with Liftosaur

**Status:** ACCEPTED

**Context.** Liftosaur is licensed under AGPL-3.0. This repository is intended to be a permissive, independent open-source client.

**Decision.** No Liftosaur source code is copied or scraped. This project is licensed under the MIT License, and the root `LICENSE` file is established. Original application assets are distributed under the same MIT license.

**Alternatives.** AGPL-3.0 relicensing - rejected: unnecessary restrictive license for an independent client.

**Consequences.** Clean boundary maintained between independent client code and upstream service.

**Evidence.** `LICENSE`, `package.json`, `README.md`.

## ADR-007 - Long-term two-product architecture

**Status:** ACCEPTED

**Context.** Zepp OS distinguishes standalone Mini Programs (`appType: "app"`) from Workout Extensions (`extType: "workout"`). Standalone applications offer rich navigation, standalone sensor management, and independent launch, while Workout Extensions embed directly inside the native Zepp Workout app during exercise.

**Decision.** Maintain two complementary product packages sharing domain logic:
1. Lifto Companion: standalone Mini Program (`appId: 1123411`) with full navigation, program browsing, sensor HR, and wake lock.
2. Lifto Workout: Strength Training Workout Extension (`extType: "workout"`, dedicated App ID) with click-only DataWidget UI embedded in native Zepp Workout.

**Alternatives.** Single hybrid package - rejected: unsupported by Zepp OS architecture.

**Consequences.** Separate build targets, separate App IDs, separate manifests, and separate phone settings pages.

**Evidence.** `app.json`, `shared/workout-extension-manifest.js`, `tools/build-targets.js`.

## ADR-008 - Shared canonical workout controller

**Status:** ACCEPTED

**Context.** Duplicating session state machines, queue management, polling, and Cloud synchronization between Companion and Workout Extension would cause behavioral drift and maintenance overhead.

**Decision.** `shared/workout-controller.js` is the single canonical controller and domain layer for both products. It owns local plan mapping, workout session state machine, persistence, Cloud synchronization (`POST /workout/start`, `POST /workout/sets`, `GET /workout/current`, `POST /workout/finish`, `DELETE /workout/current`), adaptive polling, and conflict handling. Renderers adapt presentation only and never contain business logic.

**Alternatives.** Independent controllers per UI package - rejected: code duplication and drift.

**Consequences.** The controller remains 100% platform-independent and fully unit-tested in Node.js.

**Evidence.** `shared/workout-controller.js`, `tests/workout-controller.test.js`.

## ADR-009 - Independent phone settings and credentials per App ID

**Status:** ACCEPTED

**Context.** A documented secure credential-sharing contract between two App IDs has not been confirmed. Treating package storage as private avoids making credential security depend on an unverified platform behavior.

**Decision.** Each package uses its own phone settings page and Side Service installation. Users configure their Liftosaur API key separately for Lifto Companion and Lifto Workout. Credentials are never transferred over BLE or written to shared watch files.

**Alternatives.** Shared credential file on watch storage - rejected: violates security boundary and risks unredacted leakage.

**Consequences.** Users must enter their API key in both app settings if they use both products.

**Evidence.** `setting/index.js`, `app-side/client-identity.js`, `docs/risks.md` P0-2.

## ADR-010 - Zepp ownership of native activity recording and metrics

**Status:** ACCEPTED

**Context.** During Workout Extension operation, the system Workout app owns native exercise recording, GPS, heart rate, calories, and active duration.

**Decision.** Lifto Workout treats native activity metrics as read-only via `getSportData` (`data:user.hd.workout`). Lifto does not attempt to create, control, pause, or terminate native Zepp workout recording.

**Alternatives.** Attempting native workout control via undocumented APIs - rejected: unstable and unsupported.

**Consequences.** Clear separation of ownership: Zepp tracks physical activity; Lifto tracks Liftosaur resistance training prescriptions and progression.

**Evidence.** `shared/workout-extension-metrics.js`, `data-widget/common/index.js`, [zepp-capabilities.md](zepp-capabilities.md).

## ADR-011 - User-controlled native workout finish split

**Status:** ACCEPTED

**Context.** Zepp OS provides no public API for a DataWidget to terminate or commit the system Workout recording.

**Decision.** Implement a two-stage finish workflow: Lifto Workout finalizes the Liftosaur Cloud session atomically (`POST /workout/finish`), clears local extension storage, and prompts the user with an explicit screen to stop and save the native workout in the Zepp Workout app.

**Alternatives.** Relying on private system stop hooks - rejected: unsupported and fragile.

**Consequences.** Finishing a workout requires two discrete user actions (finish in Lifto, then finish in Zepp); UI clearly guides the user.

**Evidence.** `data-widget/common/index.js`, `docs/workout-extension-architecture.md`.

## ADR-012 - Foreground and on-resume rest alert fallback

**Status:** ACCEPTED

**Context.** Zepp OS pauses DataWidgets (`onPause`) when unfocused or when the screen turns off. No durable background timer or alarm API is confirmed for DataWidgets in Zepp OS 3.6+.

**Decision.** Implement rest alert tracking (`shared/rest-alert.js`) with foreground zero-crossing vibration plus an `onResume` expiry check that vibrates immediately if rest elapsed while unfocused. Background delivery while unfocused is classified as UNKNOWN pending physical hardware tests.

**Alternatives.** Assuming background alarms work without hardware proof - rejected: violates factual evidence rule.

**Consequences.** Guaranteed alert on return to widget; no unverified background delivery claims.

**Evidence.** `shared/rest-alert.js`, `tests/rest-alert.test.js`, `docs/workout-extension-capability-matrix.md`.

## ADR-013 - Exclusion of undocumented Zepp APIs from required behavior

**Status:** ACCEPTED

**Context.** Using undocumented or private Zepp OS APIs creates severe stability risks across firmware updates.

**Decision.** Only officially documented Zepp OS 3.6+ APIs are used for required application behavior. Undocumented hooks are strictly excluded from core requirements.

**Alternatives.** Relying on reverse-engineered private APIs - rejected: breaks without notice on firmware updates.

**Consequences.** Required behavior has a documented support contract; firmware-specific experiments cannot silently become release dependencies.

**Evidence.** `AGENTS.md`, `shared/workout-extension-manifest.js`.
