# Development Plan

This plan tracks the engineering roadmap and capability milestones without presuming unverified
Zepp OS capabilities, Liftosaur contracts, or commands.

## Execution Rules

- One active phase at a time; each milestone leaves the project executable and testable.
- TDD: write a failing test first, implement the minimum needed, then verify the test and integrated scenario.
- Every critical capability carries an explicit status: `CONFIRMED`, `TESTED`, `ASSUMED`, `UNKNOWN`, or `BLOCKED`.
- Systematically distinguish `DOC CONFIRMED`, `EMULATOR TESTED`, and `REAL DEVICE TESTED`.
- Secrets never leave the phone, and no test or log may expose or record the API key.
- Use ASCII hyphens only throughout documentation.

---

## Completed Foundations (Phases 0 - 8)

- [x] **Phase 0: Architecture Spike** -> protocol envelopes, error boundaries, network states, and risk registers.
- [x] **Phase 1: Local Session & Persistence** -> append-only journal, state machine, crash recovery, and local session store.
- [x] **Phase 2: Liftosaur Read-Only Integration** -> settings app for API key entry, redacted logging, program outlines, and catalog loading.
- [x] **Phase 3: Dynamic Workout & Prescriptions** -> plate math (`Weight_calculatePlates`), warmup rounding, superset sequencing, and AMRAP support.
- [x] **Phase 4: Reliable History Write-Back** -> Liftohistory generation and deduplicated history write-back.
- [x] **Phase 5: Progression & Conflict Handling** -> optimistic concurrency versioning and progression execution.
- [x] **Phase 6: Rest Alerts & Background Behavior** -> absolute-time countdown, haptic vibration, and overtime counter.
- [x] **Phase 7: Simulator Hardening & Packaging** -> 28 round and square watch layouts verified in Zeus preview bundles.
- [x] **Phase 8: Release Quality Gates & Audit** -> automated release audit, sanitized fixtures, and zero credential leaks.

---

## Phase 9 - Liftosaur Running a Workout API Direct Synchronization

Goal: Direct synchronization with Liftosaur Cloud as the authoritative source of truth for active workouts.

### Protocol v3 & Transport

- [x] Define Protocol v3 envelope and message types in `shared/protocol.js` -> verify: Protocol v2 rejected, v3 validated.
- [x] Implement stateless `WorkoutService` and message dispatch in `app-side/router.js` -> verify: clean routing without cached state.
- [x] Implement stable, anonymous device installation identity in `app-side/client-identity.js` -> verify: random identifier created once in `settingsStorage` and sent as `X-Liftosaur-Device-Id`.

### Running a Workout API Client

- [x] Implement `GET /workout/next` -> verify: previews scheduled upcoming workout or explicit program/week/day selection.
- [x] Implement `POST /workout/start` -> verify: creates shared active workout with real start timestamp and client identity headers.
- [x] Implement `GET /workout/current` -> verify: reads active session for cross-device continuation with official phone app.
- [x] Implement `POST /workout/sets` -> verify: drains queued completed sets with repeat-safety.
- [x] Implement `POST /workout/finish` -> verify: atomically records history, progression, 1RM changes, and advances `nextDay`.
- [x] Implement `DELETE /workout/current` -> verify: explicitly discards active Cloud session.
- [x] Implement `GET /settings` -> verify: fetches user default units and rest timer intervals.

### Watch Runtime & Queue Draining

- [x] Map server `data.workout` to watch day plan via `shared/workout-api-plan.js` -> verify: warmups, plates, rest timers, and supersets parsed accurately.
- [x] Persist local state before network dispatch -> verify: plan, journal, unacknowledged write queue, pause intervals, and finish intent saved locally.
- [x] Drain set write queue chronologically via `POST /workout/sets` -> verify: server snapshot adopted once queue is empty.
- [x] Throttle `GET /workout/current` polling to minimum 15-second intervals -> verify: safe polling without request spam.
- [x] Enforce finish guard on pending set queue -> verify: finish blocked until all queued sets are confirmed synced.
- [x] Explicit conflict recovery -> verify: missing remote workout or start-time mismatch opens recovery modal without deleting local data.
- [x] Timed sets and prompted variables fallback -> verify: user prompted to log on phone app, watch adopts completed set.

---

## Phase 10 - Hardware Validation & Store Release

Gate: Physical device testing on Amazfit Active 2 and supported round/square hardware.

- [ ] Sideload preview `.zab` on physical watch hardware.
- [ ] Validate touch responsiveness, live HR sensor accuracy, and display wake lock.
- [ ] Validate BLE background behavior during extended rest timers.
- [ ] Evaluate native Zepp OS workout activity integration on real hardware.
- [ ] Complete store submission checklist.
