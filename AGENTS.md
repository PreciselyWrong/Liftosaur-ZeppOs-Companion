# AGENTS.md

## What

- Lifto Companion is an unofficial Liftosaur Cloud client for Amazfit watches on Zepp OS 3.6+.
- The shipped target is a standalone Mini Program. `feat/workout-extension` is adding a separately packaged Strength Training Workout Extension with shared domain logic.
- The watch owns the session UI and durable local journal. The phone Side Service owns authenticated HTTPS calls. Session loss or corruption is the highest-severity failure.
- The confirmed standalone target is Amazfit Active 2. Workout Extension support requires separate model and firmware evidence.
- Everything committed to this repository is English and uses ASCII hyphens only, including agent files, UI, logs and release notes.

## Commands

- Install: `npm ci`.
- Test: `npm test` - verified on 2 September 2026 with 471 passing tests.
- Development plan: `.\dev.ps1 -Plan`. Live development: `.\dev.ps1`, which checks Zeus then runs `zeus dev -t "Amazfit Active 2 (Round)"`.
- Build: `npm run build:companion`, `npm run build:workout` (requires `ZEPP_WORKOUT_EXTENSION_APP_ID`), or `npm run build:all`.
- Release plan: `.\publish.ps1 -Plan`.
- Release from clean `main`: run `/public-release-audit`, then `.\publish.ps1 -Confirm -AuditedCommit <HEAD>`. The script tests, scans, builds, pushes and verifies `origin/main`.
- Preview QR: `node tools/build-preview.mjs docs/test-build-qr.png 10`.

## Map

- `page/common/` - standalone lifecycle, renderer, Cloud orchestration and recovery UI.
- `data-widget/common/` - Strength Training Workout Extension single-page DataWidget click-only UI.
- `shared/workout-session.js` - pure session state machine and event journal.
- `shared/workout-controller.js` - shared local workout state, persistence, Cloud synchronization, polling, conflicts and terminal writes.
- `shared/workout-api-plan.js`, `shared/day-plan.js` - authoritative API response to plan and legacy replay mappings.
- `shared/session-storage.js`, `shared/workout-refresh-policy.js` - crash recovery, queue state and refresh timing.
- `shared/screen-layout.js`, `shared/watch-layout.js` - the only screen-size and renderer layout rules.
- `shared/rest-alert.js` - rest alert state tracking, foreground zero-crossing, and resume expiry.
- `shared/workout-extension-nav.js`, `shared/workout-extension-metrics.js` - extension screen formatting and defensive native metric parsing.
- `shared/workout-extension-manifest.js` - separate extension manifest contract.
- `app-side/` - protocol routing, the only HTTP client, Cloud services and stable client identity.
- `setting/` - phone-side API key settings. Secrets never belong on the watch.
- `tests/` - Node contract, state, security, renderer and build tests.
- `docs/` - tester installation, Workout hardware validation, privacy and store guidance.

## Decisions

- Liftosaur Cloud is authoritative for programs, prescriptions, active workout state and progression. The watch does not execute Liftoscript.
- Users choose a program, 1-based week and 1-based day within that week. History may highlight but never select.
- The Side Service is the only Cloud gateway. Critical watch events persist before rendering and sync asynchronously.
- Plan and journal persist together. A remote snapshot is adopted only after local writes are acknowledged.
- Set and finish writes are repeat-safe. Pending sets block finish and preserve the local session.
- Rest state uses absolute `restStartedAt`, `restDuration` and `restEndsAt`; display intervals only repaint.
- Current-workout reads use a 10-second action floor, 15-second passive checks and 30/60/120-second failure backoff.
- Standalone and Workout Extension are separate packages and App IDs sharing domain modules, not renderers or credentials.
- Capability evidence stays labelled `CONFIRMED`, `TESTED`, `ASSUMED`, `UNKNOWN` or `BLOCKED`; simulator evidence is never device evidence.

## Forbidden

- ⛔ Copy, fork or scrape Liftosaur code - its AGPL code is outside this MIT repository's license boundary.
- ⛔ Reimplement Liftoscript - Liftosaur and Playground own its calculations; only the documented plate-loading exception is local.
- ⛔ Infer programs, weeks, days or missing values from names - server identifiers and explicit nulls are authoritative.
- ⛔ Display a mismatched requested day - raise `DAY_MISMATCH` when numeric coordinates differ.
- ⛔ Add undocumented Zepp behaviour as a required dependency - use official evidence or a reproducible isolated experiment.
- ⛔ Claim compatibility from API level or simulator output - model, firmware, shape, sport mode and hardware evidence also matter.
- ⛔ Send API keys over BLE, store them on-watch or log them - credentials remain in phone settings and are redacted.
- ⛔ Call `fetch()` outside `app-side/liftosaur-api-client.js` - one client enforces auth, errors and redaction.
- ⛔ Wait for BLE or HTTP before reflecting a critical gesture - persist, render, then sync.
- ⛔ Retry an ambiguous non-idempotent legacy write blindly - verify the remote result first.
- ⛔ Replace unacknowledged local writes with a remote snapshot - drain or resolve the conflict explicitly.
- ⛔ Invent device dimensions or hardcode renderer sizes - `getDeviceInfo()` and `LAYOUT.fit()` own geometry.
- ⛔ Place top-row extension controls outside the visible round-screen chord - use the shared top-bar layout.
- ⛔ Crowd the extension clock against its primary action - preserve the shared minimum gap.
- ⛔ Remove the local screen-on duration option - Liftosaur does not expose this watch display preference through its API.
- ⛔ Direct Active 2 testers to a generic Motion Extensions menu - use Workout > Strength Training > Settings > More > Data Page > Add Page > Lifto.
- ⛔ Defer `BUTTON.click_func` or delete its active control - native callbacks and persistent modal controls avoid inert UI.
- ⛔ Use `onDestroy` as a save path - it is cleanup only.
- ⛔ Start a second heart-rate sensor in the standalone app - it already owns `@zos/sensor` HeartRate.
- ⛔ Delete unsynced sessions automatically - offer resume, retry or explicit discard.
- ⛔ Add fast polling, continuous services or unsupported extension gestures - use event-driven click-only extension UI.
- ⛔ Start a second `zeus dev` watcher - concurrent watchers race to refresh one simulator.
- ⛔ Push without `/public-release-audit` - the public repository must remain free of secrets and personal data.
- ⛔ Publish 1.0.0 while `releaseStage` is `beta` - physical-watch validation must clear the release gate.

## Traps

- Stale workout after a local set -> an old poll returned during a write -> keep the signature guard and adopt only after acknowledgement.
- Side Service forgets state -> Zepp destroys it between requests -> carry durable identity and session data from the watch.
- Live record lacks targets -> Playground serializes only completed exercises -> preserve the known prescription in the plan.
- Warmup load is wrong -> loadable plates are not a fixed step -> use `Weight_calculatePlates` semantics and validate against history.
- Timer skips after pause or screen-off -> callbacks pause with lifecycle -> recompute from `restEndsAt`.
- Visible buttons are inert -> callback was deferred or deleted itself -> run native callbacks, retain modal controls and redraw once.
- Finish duplicates legacy history after timeout -> commit result was ambiguous -> search for the expected record before retry.
- Workout Extension is absent from simulator Workout -> simulator images omit the system app -> validate in Developer Mode on hardware.
- `zeus dev` replaces `.gitignore` -> Zeus writes its template -> restore the repository file and recheck secret exclusions before push.

## State

- Version 0.4.0 beta: standalone and extension workout flows, durable offline set queues, conflict recovery, native pause reconciliation, configurable display hold, live native metrics, round and square layouts, and crash-safe finish retries are covered by 471 tests.
- Now: validate the refined Strength Training Workout Extension integration on Active 2 firmware 7.23.0.1 at API level 400.
- Next: confirm display duration, native pause, retry, rest alert and finish behaviour on additional physical watches; simulator images cannot prove native Workout integration.
