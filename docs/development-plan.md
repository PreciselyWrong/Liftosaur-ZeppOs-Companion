# Development Plan

This plan breaks down the project roadmap without presuming any unverified Zepp capability, Liftosaur contract, or command.

## Execution Rules

- One active phase at a time; each milestone leaves the project executable and testable.
- TDD: write a failing test first, implement the minimum needed, then verify the test and integrated scenario.
- Every critical capability carries an explicit status: `CONFIRMED`, `TESTED`, `ASSUMED`, `UNKNOWN`, or `BLOCKED`.
- Systematically distinguish `DOC CONFIRMED`, `EMULATOR TESTED`, and `REAL DEVICE TESTED`.
- `TARGET_WATCH_MODEL = UNKNOWN` prohibits asserting hardware compatibility without verification.
- Mock mode is default. Any real Liftosaur Cloud mutation requires explicit user authorization and a controlled scenario.
- Secrets never leave the phone, and no test or log may expose or record the API key.

## Starting Development

### 0. Environment Inventory

- [x] Record installed OS, Node.js, package manager, Zeus CLI, and Zepp OS Simulator → verify: versions and paths recorded in `docs/zepp-capabilities.md`.
- [x] Verify official creation, development, test, build, and logging commands → verify: only executed commands enter documentation.
- [x] Verify Developer Mode, Device Preview, and log access for Device App / Side Service → verify: test message visible on available channels.
- [x] Inventory repository and local changes before generation → verify: no user files overwritten.

### 1. Establish Documentary Evidence

- [x] Research current official Zepp documentation for Workout Extension, Standalone App, Strength Training, lifecycle, sensor data, permissions, `app.json`, UI, and messaging → verify: conclusions referenced with date and status in `docs/zepp-capabilities.md`.
- [x] Research official Zepp Health examples for Standalone App and Side Service patterns → verify: example version and differences documented.
- [x] Research official Liftosaur REST API and Liftoscript documentation for authentication, programs, history, Playground, `finish_workout()`, and error formats → verify: contracts recorded in `docs/liftosaur-api.md`.
- [x] Consult Liftosaur open-source code solely to clarify undocumented behavior → verify: provenance and license noted, no AGPL code transplanted.

### 2. Create Documentation Foundation

- [x] Create `architecture.md`, `zepp-capabilities.md`, `liftosaur-api.md`, `risks.md`, `decisions.md`, `test-matrix.md`, and `protocol.md` in `docs/` → verify: each file contains purpose, evidence, and open questions.
- [x] Define boundaries across Device App / Side Service / Liftosaur Cloud → verify: single authoritative owner per data point.
- [x] Initialize ADRs without accepting unproven decisions → verify: each ADR contains status, context, decision, alternatives, consequences, and evidence.
- [x] Maintain test matrix for emulator and real watch → verify: hardware requirements validated on physical device.

### 3. Generate Skeleton

- [x] Scaffold standalone mini-program structure compatible with Zepp OS 3.6+ → verify: project builds and launches in simulator.
- [x] Add automated test suite → verify: `npm test` runs with `node:test` and passes all invariants.

### 4. Prove Watch Core UI & State Machine

- [x] Write state machine and rendering tests for session lifecycle → verify: tests fail before implementation.
- [x] Implement workout screens: program/week/day picker, active workout, rest timer, summary → verify: clear UI rendering.
- [x] Connect heart rate sensor via `@zos/sensor` → verify: live readings and zone colors without side effects.
- [x] Handle touch interactions deterministically → verify: each tap triggers exactly one state transition.

### 5. Prove Phone Round-Trip

- [x] Define v2 protocol envelope with `protocolVersion`, `messageId`, `type`, `sessionId`, and `payload` → verify: fixtures for valid, invalid, duplicate, and out-of-order envelopes.
- [x] Create Side Service with message router → verify: clean initialization and redacted logging.
- [x] Send Device → Side Service → Device round-trip messages → verify: matching `messageId`, single acknowledgment, UI updates.
- [x] Test disconnected link and reconnect handling → verify: explicit connection state without silent duplication.

## Phase 0 - Architecture Spike

Goal: Resolve blocking architectural questions before implementing complex domain logic.

- [x] Complete foundation steps → verify: standalone app and communication round-trip proven.
- [x] Define responsibilities and data flows in `docs/architecture.md` → verify: ownership, persistence, and network boundaries documented.
- [x] Evaluate local storage, secret handling, lifecycle, UI constraints, and background behavior → verify: risks and evidence levels assigned.
- [x] Define network states (`ONLINE`, `DEGRADED`, `OFFLINE`) → verify: transitions and user feedback documented.
- [x] Define session lifecycle and recovery states → verify: invalid transitions prevented and recovery paths identified.
- [x] Design rest alert spike in `docs/rest-alert-spike.md` → verify: active, background, screen-off, cancellation, and completion scenarios.
- [x] Document P0 risks: workout selection, secrets, ambiguous POST, program conflicts, hardware compatibility → verify: mitigations and gates in place.

Milestone exit: Foundation documentation complete, environment verified, minimal app runnable, round-trip proven.

## Phase 1 - Local Session & Persistence

Goal: Complete a full local workout (e.g., Bench Press 3x10 @ 60kg, rest 90s) with crash recovery.

### Model & State Machine

- [x] Write state transition tests: `READY → ACTIVE_SET → REST → ACTIVE_SET → FINISHED` → verify: invalid transitions rejected.
- [x] Maintain single representation for prescription, current state, and sync status → verify: zero state duplication.
- [x] Implement full screen state transitions without requiring unsupported gestures.

### Journal & Persistence

- [x] Write event ordering, sequencing, deduplication, serialization, and replay tests → verify: TDD workflow.
- [x] Implement `WorkoutSession` event log → verify: replay reconstructs exact session state.
- [x] Persist plan and journal before UI updates → verify: crash before render resumes cleanly.
- [x] Guard `COMPLETE_SET` against double taps → verify: idempotent event dispatching.

### UX & Rest Timer

- [x] Test weight, rep, and RPE adjustments with bounded ranges → verify: stable values, no floating-point artifacts.
- [x] Provide large touch targets and instant visual feedback → verify: usable with one hand.
- [x] Track `restStartedAt`, `restDuration`, and `restEndsAt` using absolute timestamps → verify: timer stays accurate across pause/resume.
- [x] Implement start, complete, rest, next, and finish workflows → verify: complete local mock session.

### Recovery

- [x] Test app kill during active set, rest, and finish → verify: clean `RESUME` / `DISCARD` prompt.
- [x] Test finished but uncommitted session recovery → verify: session retained with `RETRY` option.

Milestone exit: Complete local mock session, crash-proof journal storage, and validated recovery.

## Phase 2 - Liftosaur Read-Only Integration

Goal: Fetch and display real workout prescriptions without Cloud mutations.

### Secrets & Diagnostics

- [x] Verify automated redaction of `Authorization`, `Bearer`, and `lftsk_*` tokens → verify: zero secret leaks in logs and error messages.
- [x] Implement Settings App for API key entry → verify: key confined strictly to phone-side storage.

### API Client

- [x] Model verified Liftosaur REST API endpoints with sanitized fixtures → verify: official contracts respected.
- [x] Test error handling: 400, 401, 403, 404, 422, timeouts, network disconnects → verify: structured error codes.
- [x] Implement `LiftosaurApiClient` with central error handling → verify: all HTTP requests go through client.

### Parser & Program Selection

- [x] Parse program headers (`#` weeks, `##` days) deterministically → verify: outline extracts week and day indices without guessing.
- [x] Query Liftosaur Playground endpoint directly for authoritative day plan → verify: exercise count, sets, reps, weights, RPE, and timers loaded from server.
- [x] Present user-driven program, week, and day selection → verify: last logged workout highlighted for guidance without auto-starting.

Milestone exit: Real workout prescriptions loaded from Liftosaur Cloud in read-only mode.

## Phase 3 - Dynamic Workout & Prescriptions

Goal: Support dynamic workout features (warmups, supersets, loadable weights).

- [x] Resolve warmup percentages against gym inventory and plate math (`Weight_calculatePlates`) → verify: exact loadable plate combinations.
- [x] Parse superset tags and alternate sets automatically across paired exercises → verify: correct sequencing in workout session.
- [x] Support AMRAP markers, rep ranges, custom units (kg/lb), and RPE targets → verify: faithful display of prescribed goals.
- [x] Handle offline operation gracefully → verify: local workout continues uninterrupted if phone disconnects.

Milestone exit: Accurate warmup rounding, superset sequencing, and complete prescription support.

## Phase 4 - Reliable History Write-Back

Goal: Submit workout history reliably without duplicate records.

- [x] Implement `POST /history` with authoritative Liftohistory format → verify: exact exercises, completed sets, reps, and weights recorded.
- [x] Search existing history before retrying on lost or ambiguous HTTP responses (`UNKNOWN_COMMIT_STATE`) → verify: zero duplicate history entries.
- [x] Retain uncommitted sessions locally until successful synchronization → verify: user data never lost.

Milestone exit: Controlled history records created with deduplication guarantees.

## Phase 5 - Progression & Conflict Handling

Goal: Apply Liftosaur progressions without overwriting concurrent remote changes.

- [x] Fingerprint baseline program text when day plan is loaded → verify: baseline version hash stored in session.
- [x] Replay session journal to Liftosaur Playground to compute `updatedProgramText` → verify: progression computed authoritatively by server.
- [x] Verify remote program version before writing progression → verify: if remote changed, history is saved and progression is safely skipped with notification.
- [x] Sequence operations: history record first, then program progression → verify: atomic ordering guarantees.

Milestone exit: History and progression synchronized safely with optimistic concurrency guards.

## Phase 6 - Rest Alerts & Background Behavior

Goal: Reliable rest timer alerts during workouts.

- [x] Rest countdown based on absolute system time (`restEndsAt`) → verify: timer accurate even after screen sleep.
- [x] Haptic vibration feedback at timer expiry (`@zos/sensor` / `@zos/router`) → verify: distinct vibration pattern.
- [x] Overtime tracking when rest interval is exceeded → verify: negative timer increments clearly displayed.

Milestone exit: Rest timer vibration alerts verified.

## Phase 7 - Real Hardware Hardening

Gate: Hardware verification on target Amazfit Active 2 smartwatch.

- [ ] Verify standalone mini-program installation and execution on physical device.
- [ ] Run full test matrix against hardware sensors and display.
- [ ] Validate BLE connectivity, reconnection, and background sleep/wake cycles.
- [ ] Verify battery efficiency and single-handed touch usability.

Milestone exit: Hardware validation matrix complete on physical watch.

## Phase 8 - Final Release Preparation

- [x] Code and documentation cleanup → verify: all tests pass, zero dead code or unredacted debug logging.
- [x] English-only interface and translation catalogs.
- [x] Public release audit (`/public-release-audit`) passed.
- [x] README and architecture documentation up to date.

## V1 Quality Gates

- [x] Authoritative workout selection from Liftosaur Cloud.
- [x] Fast weight, rep, and RPE editing with touch-friendly controls.
- [x] Instant local response during workouts without network dependency.
- [x] Accurate warmups, supersets, AMRAPs, and units.
- [x] Absolute-time rest countdown with vibration alert.
- [x] Crash-proof session persistence and recovery.
- [x] Safe history write-back with deduplication and conflict guards.
- [x] API key isolated on mobile side; zero leaks in logs or telemetry.
- [x] Complete automated test coverage (158 passing unit tests).
