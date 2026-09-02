# Workout Extension Integration TODO

## Metadata

- Branch: `feat/workout-extension`
- Base commit: `190a1749f32196b6f4360a307fc8f6eb34c2a87d`
- Current commit: `dbf210f`
- Started: 1 September 2026
- Last updated: 2 September 2026
- Current phase: 15 - Active 2 integration refinement
- Overall status: Active 2 loads the extension; refined lifecycle behaviour awaits physical retesting

## Status legend

- [ ] Not started
- [~] In progress
- [x] Completed
- [!] Blocked
- [?] Unknown or research required

## Non-negotiable invariants

- Keep the standalone application installable and its existing tests passing.
- Keep Liftosaur credentials in the Side Service and never send them to the watch.
- Persist a critical local session transition before rendering or scheduling its sync.
- Share domain logic rather than copying the standalone renderer or state machine.
- Use only documented Zepp APIs for required behaviour.
- Do not claim simulator evidence as real-device evidence.

## Baseline

| Check | Command | Result | Evidence |
| --- | --- | --- | --- |
| Main synchronization | `git fetch origin main`, `git pull --ff-only origin main` | passed | `main` already matched `origin/main` at `190a174` |
| Working tree | `git status --short` | passed | clean before branch creation |
| Existing tests | `npm test` | passed | 413 passing tests, 0 failures, 1 September 2026 |
| Companion build | `zeus build` | passed | Zeus 1.9.3 produced the standalone build on 1 September 2026 |
| Workout build | generate with synthetic App ID, then `zeus build` | passed | Separate round and square extension targets compiled on 1 September 2026 |

## Decision gates

| ID | Question | Status | Evidence | Decision | Consequence |
| --- | --- | --- | --- | --- | --- |
| EXT-001 | Can an extension target Strength Training? | completed | Official Quick Start lists `52` as Strength Training | Use `subType: [52]` | Extension is scoped to Strength Training |
| EXT-002 | Can a standalone app and extension share one package or App ID? | completed | Official Quick Start requires an independent app and appId | Create a second package target | Settings and credentials stay package-local |
| EXT-003 | Can the extension end native Zepp recording? | completed | Official APIs expose read-only sport data | Do not implement a native stop command | Tell the user to finish in Zepp Workout |
| EXT-004 | Can an extension be validated in workout context in the simulator? | blocked | Simulator images do not include the Workout app | Maintain a real-device plan | Hardware validation stays open |
| EXT-005 | Can current credentials be reused by a second App ID? | unknown | No safe shared-storage contract confirmed | Use dedicated extension settings | No credential transfer over BLE or watch storage |

## Feature parity matrix

| Feature | Standalone baseline | Extension target | Status | Tests | Notes |
| --- | --- | --- | --- | --- | --- |
| Demo mode | available | preserve | UNIT_TESTED | dummy Workout service tests | Dedicated local Workout adapter, with no Cloud writes |
| Cloud workout resume | available | preserve | UNIT_TESTED | direct sync & widget tests | Cloud remains authoritative |
| Set logging | available | preserve | UNIT_TESTED | workout session & widget tests | Shared controller only |
| Weight, reps and RPE | available | preserve | UNIT_TESTED | workout session & widget tests | Click-only interaction |
| Warmups and supersets | available | preserve | UNIT_TESTED | plan, session & widget tests | View model adapts layout only |
| Notes and overview | available | preserve | UNIT_TESTED | renderer contract & widget tests | Click-only interaction |
| Rest and overtime | available | preserve | UNIT_TESTED | session & rest alert tests | Native and manual pauses compose without losing time |
| Offline recovery | available | preserve | UNIT_TESTED | storage & widget tests | Separate extension storage namespace |
| Native Zepp activity | unavailable | add through extension context | blocked | real-device plan | Owned only by Zepp Workout |
| Native data | unavailable | read duration and calories | UNIT_TESTED | adapter & spike tests | Live duration drives pause reconciliation |

## Phase 0 - Audit

- [x] Read project instructions, TODO, manifest and implementation evidence.
- [x] Synchronize `main`, create `feat/workout-extension`, and record the clean baseline.
- [x] Run the baseline suite: 374 passing tests.

## Phase 1 - Capability research

- [x] Refresh official Workout Extension evidence and record packaging, lifecycle and sport subtype facts.
- [x] Record the unknown durable rest-alert capability and implement the documented lifecycle fallback.
- [?] Confirm App ID storage isolation; dedicated extension settings remain the safety strategy.

## Phase 2 - Minimal Workout Extension spike

- [x] Add a separate extension manifest generator with configurable App ID.
- [x] Add a click-only DataWidget with lifecycle logging, durable counter, absolute timer, native duration read and Side Service ping.
- [x] Add manifest, generator, state, sport-data and lifecycle characterization tests.
- [ ] Generate and install a real preview package; a dedicated App ID and compatible watch are required.

## Phase 3 - Shared controller extraction

- [x] Extract local plan, session, journal, persistence, restore and direct-sync metadata ownership.
- [x] Route Companion session actions through the shared controller and keep its build green.
- [x] Move Cloud start, queue draining, polling, adoption, conflict, finish and discard orchestration out of the standalone page.

## Phase 4 - Dual-target build system

- [x] Build standalone and extension outputs separately with no secrets.
- [x] Provide pure planning, process execution, and CLI entrypoint for companion, workout, and all targets.
- [x] Guard workout builds against missing or invalid App IDs before process invocation.

## Phase 5 - Full extension renderer

- [x] Implement all session screens through a constrained click-only renderer.

## Phase 6 - Rest alerts and background behavior

- [x] Add pure rest alert state tracker with foreground zero-crossing and onResume expiry detection.

## Phase 7 - Native workout data integration

- [x] Add defensive `getSportData` reads for duration and calories in DataWidget.

## Phase 8 - Handoff and cross-package continuity

- [x] Load the authoritative Cloud workout from the extension without credential transfer.

## Phase 9 - Finish, discard and recovery

- [x] Preserve current finish and recovery invariants in the extension with exact native Zepp finish prompt.

## Phase 10 - Automated validation

- [x] Add unit, integration and DataWidget contract tests (433 passing tests).
- [x] Add CI validation and dual-product preview orchestration.

## Phase 11 - Simulator and hardware validation

- [~] Active 2 firmware 7.23.0.1 at API level 400 loads the extension in Strength Training; refined integration checks remain pending.

## Phase 12 - Documentation and release

- [x] Complete the public Workout Extension setup and hardware test guides.
- [x] Draft release notes for the two-product beta.
- [ ] Publish the Workout tester guide and store assets after physical validation.

## Phase 15 - Active 2 integration refinement

- [x] Add 60, 120, 240 second and Always display duration choices with a 120 second default.
- [x] Reconcile native Workout pauses with Lifto elapsed and rest time without overriding manual rest pause.
- [x] Refresh native metrics while visible and retry durable pending set writes after focus or network loss.
- [x] Add the exact Active 2 integration retest checklist.
- [ ] Run the checklist on Active 2 firmware 7.23.0.1 at API level 400 and attach evidence.

## Manual external actions

- Create a dedicated Workout Extension application in Zepp Developer Console and provide its numeric App ID through an environment variable.
- Test the preview package on a documented Workout Extension device in Developer Mode.

## Blockers

| ID | Blocker | Owner | Workaround | Remaining impact |
| --- | --- | --- | --- | --- |
| EXT-APP-ID | Dedicated App ID has not been supplied. | Maintainer | Build with an explicit development-only environment value. | Store-ready package cannot be produced. |
| EXT-HARDWARE | Active 2 integration retest evidence is pending. | Maintainer | Use the exact Active 2 checklist. | Refined lifecycle behaviour is not yet physically confirmed. |

## Commands verified

- `git fetch origin main`
- `git pull --ff-only origin main`
- `npm test` - 471 passing
- `npm run build:companion`
- `ZEPP_WORKOUT_EXTENSION_APP_ID=<synthetic> npm run build:workout`
- `ZEPP_WORKOUT_EXTENSION_APP_ID=<synthetic> npm run build:all`
- `ZEPP_WORKOUT_EXTENSION_APP_ID=<synthetic> npm run generate:extension`
- `node --test tests/preview-targets.test.js` - preview orchestration only; no upload performed
- `zeus build` - Companion passed
- `zeus build` from generated Workout Extension - passed

## Change log

- 2026-09-01: Created the feature branch and recorded a clean, passing standalone baseline.
- 2026-09-01: Added and built the minimal separate Workout Extension spike without claiming simulator or hardware validation.
- 2026-09-01: Extracted shared local workout control and migrated Companion without changing its network or renderer behavior.
- 2026-09-01: Centralized direct Cloud synchronization and recovery in the shared workout controller.
- 2026-09-01: Added pure dual-target build system and package scripts for companion, workout, and all products.
- 2026-09-01: Implemented the click-only Lifto Workout DataWidget, rest alert resume fallback, separate session storage and recovery contracts (433 passing tests).
- 2026-09-01: Added unit-tested dual-preview orchestration and credential-free CI without uploading a preview.
- 2026-09-01: Completed the public Workout Extension setup and hardware test guides.
- 2026-09-02: Added configurable display hold, native pause reconciliation, live metrics, pending sync recovery and an Active 2 retest checklist.
