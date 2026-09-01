# Workout Extension Integration TODO

## Metadata

- Branch: `feat/workout-extension`
- Base commit: `190a1749f32196b6f4360a307fc8f6eb34c2a87d`
- Current commit: `190a1749f32196b6f4360a307fc8f6eb34c2a87d`
- Started: 1 September 2026
- Last updated: 1 September 2026
- Current phase: 0 - audit and capability research
- Overall status: in progress

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
| Existing tests | `npm test` | passed | 374 passing tests, 0 failures, 1 September 2026 |
| Build | Zeus build | not run | requires Developer Mode and a supported device context |

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
| Demo mode | available | preserve | not started | existing settings tests | Dedicated extension settings |
| Cloud workout resume | available | preserve | not started | direct sync tests | Cloud remains authoritative |
| Set logging | available | preserve | not started | workout session tests | Shared controller only |
| Weight, reps and RPE | available | preserve | not started | workout session tests | Click-only interaction |
| Warmups and supersets | available | preserve | not started | plan and session tests | View model adapts layout only |
| Notes and overview | available | preserve | not started | renderer contract | Click-only interaction |
| Rest and overtime | available | preserve | not started | session tests | Absolute timestamps |
| Offline recovery | available | preserve | not started | storage tests | Separate extension storage namespace |
| Native Zepp activity | unavailable | add through extension context | blocked | real-device plan | Owned only by Zepp Workout |
| Native data | unavailable | read duration and calories | not started | adapter tests | `getSportData` only |

## Phase 0 - Audit

- [x] Read project instructions, TODO, manifest, architecture, risks, decisions and capability evidence.
- [x] Synchronize `main`, create `feat/workout-extension`, and record the clean baseline.
- [x] Run the baseline suite: 374 passing tests.

## Phase 1 - Capability research

- [~] Refresh official Workout Extension evidence and record packaging, lifecycle and sport subtype facts.
- [ ] Confirm durable rest-alert APIs and their documented fallback.
- [ ] Confirm App ID storage isolation and settings strategy.

## Phase 2 - Minimal Workout Extension spike

- [ ] Add a separate extension manifest generator with configurable App ID.
- [ ] Add a click-only DataWidget entry point and lifecycle adapter.
- [ ] Add manifest and lifecycle characterization tests.

## Phase 3 - Shared controller extraction

- [ ] Extract renderer-independent session orchestration from the standalone page.
- [ ] Keep standalone behaviour covered and unchanged.

## Phase 4 - Dual-target build system

- [ ] Build standalone and extension outputs separately with no secrets.

## Phase 5 - Full extension renderer

- [ ] Implement all session screens through a constrained click-only renderer.

## Phase 6 - Rest alerts and background behavior

- [ ] Add a documented durable alert adapter or explicit foreground fallback.

## Phase 7 - Native workout data integration

- [ ] Add a defensive `getSportData` adapter for duration and calories.

## Phase 8 - Handoff and cross-package continuity

- [ ] Load the authoritative Cloud workout from the extension without credential transfer.

## Phase 9 - Finish, discard and recovery

- [ ] Preserve current finish and recovery invariants in the extension.

## Phase 10 - Automated validation

- [ ] Add unit, integration and dual-manifest tests.
- [ ] Add CI validation if absent.

## Phase 11 - Simulator and hardware validation

- [!] Validate extension in a real Strength Training workout on a supported watch.

## Phase 12 - Documentation and release

- [ ] Publish tester guide, capability matrix, architecture, risks and manual actions.

## Manual external actions

- Create a dedicated Workout Extension application in Zepp Developer Console and provide its numeric App ID through an environment variable.
- Test the preview package on a documented Workout Extension device in Developer Mode.

## Blockers

| ID | Blocker | Owner | Workaround | Remaining impact |
| --- | --- | --- | --- | --- |
| EXT-APP-ID | Dedicated App ID has not been supplied. | Maintainer | Build with an explicit development-only environment value. | Store-ready package cannot be produced. |
| EXT-HARDWARE | No supported physical watch is connected. | Maintainer | Unit tests and simulator-safe checks. | Workout-context proof remains blocked. |

## Commands verified

- `git fetch origin main`
- `git pull --ff-only origin main`
- `npm test` - 374 passing

## Change log

- 2026-09-01: Created the feature branch and recorded a clean, passing standalone baseline.
