## What

- Lifto Companion is an unofficial Liftosaur Cloud client for Amazfit watches on Zepp OS 3.6+.
- The shipped products are a standalone Mini Program and a separately packaged Workout Extension for Strength Training and Free Training with shared domain logic.
- The watch owns the session UI and durable local journal. The phone Side Service owns authenticated HTTPS calls. Session loss or corruption is the highest-severity failure.
- The confirmed standalone target is Amazfit Active 2. Workout Extension support requires separate model and firmware evidence.
- Everything committed to this repository is English and uses ASCII hyphens only, including agent files, UI, logs and release notes.

## Commands

- Install: `npm ci`.
- Test: `npm test`.
- Clean generated output: `npm run clean`. It preserves local audit and review evidence under `build/`.
- Development plan: `.\dev.ps1 -Plan`. Live development: `.\dev.ps1` for Companion or `.\dev.ps1 -Product workout` for the generated extension; each checks Zeus then runs `zeus dev -t "Amazfit Active 2 (Round)"`.
- Build: `npm run build:companion`, `npm run build:workout` (with `ZEPP_WORKOUT_EXTENSION_APP_ID=1125789`), or `npm run build:all`.
- Release work: use `.agents/skills/lifto-release/SKILL.md`. It owns planning, audit, QR generation, GitHub release creation or refresh, and verification.
- GitHub Releases are the only public release history. Versions below `1.0.0` are pre-releases; GitHub generates their notes from merged pull requests. Do not add `CHANGELOG.md` or `.github/release.yml`.
- Pull requests: exactly one commit and one subject per PR; split independent changes into separate branches and PRs.

## Work tracking

- GitHub Issues and [Lifto Companion Tracker](https://github.com/users/PreciselyWrong/projects/1) are the only backlog; do not create or restore `TODO.md`. Use exactly one primary label: `bug`, `enhancement`, or `idea`.
- Agents own the lifecycle: search before creating, add the issue to Project #1, set `In Progress` when work starts, and keep its status current.
- Keep issues outcome-focused and implementation detail in the pull request. After verification, link the pull request, close the issue, and confirm `Done`; close abandoned work as not planned with one factual reason.

## Map

- `page/common/`, `data-widget/common/` - standalone and Workout Extension watch UIs; `shared/screen-layout.js`, `shared/watch-layout.js` own layout.
- `shared/workout-session.js` - pure session state machine and event journal.
- `shared/workout-controller.js` - shared local workout state, persistence, Cloud synchronization, polling, conflicts and terminal writes.
- `shared/workout-api-plan.js`, `shared/day-plan.js` - authoritative API response to plan and legacy replay mappings.
- `shared/session-storage.js`, `shared/workout-refresh-policy.js`, `shared/rest-alert.js` - recovery, queue state, refresh timing and alerts.
- `shared/workout-extension-nav.js`, `shared/workout-extension-metrics.js`, `shared/workout-extension-manifest.js` - extension navigation, metrics and package contract.
- `app-side/`, `setting/` - phone protocol, the only HTTP client, Cloud enrichment, stable identity and API key settings; secrets never belong on the watch.
- `tests/`, `tools/` - Node contracts plus build, preview, generation and cleanup commands.
- `docs/` - tester installation, Workout hardware validation, privacy and store guidance.

## Decisions

- Liftosaur Cloud is authoritative for programs, prescriptions, active workout state and progression. The watch does not execute Liftoscript.
- Users choose a program, 1-based week and 1-based day within that week. History may highlight but never select.
- The Side Service is the only Cloud gateway. Critical watch events persist before rendering and sync asynchronously.
- Plan and journal persist together. A remote snapshot is adopted only after local writes are acknowledged; same-workout adoption preserves local set edits and pause timing, and late polls cannot reopen a finished session.
- Startup binds the live set IDs to the validated preview structure and local journal before draining queued sets.
- Set and finish writes are repeat-safe. Pending sets block finish and preserve the local session.
- Rest state uses absolute `restStartedAt`, `restDuration` and `restEndsAt`; display intervals only repaint.
- Timed sets journal preparation, effort, pauses and partial left-side results. Both unilateral durations are sent together; target expiry alerts but never completes a set automatically.
- Get Ready is a local Off/3/5/10-second preference. Explicit arming preserves existing rest and uses its final seconds; undocumented Liftoscript auto and timer modifiers are not inferred.
- Exercise images use API imageUrl only and appear in Info when opted in through phone settings. ZML onReceivedFile owns reception. Phone storage has 32 immutable image slots; hardware display validation remains pending.
- Current-workout reads use a 10-second action floor, two-minute passive checks and 60/120/300-second failure backoff.
- Standalone (`1123411`) and Workout Extension (`1125789`) are separate public packages and App IDs sharing domain modules, not renderers or credentials.
- Capability evidence stays labelled `CONFIRMED`, `TESTED`, `ASSUMED`, `UNKNOWN` or `BLOCKED`; simulator evidence is never device evidence.

## Forbidden
- ⛔ Let fewer than 90% of user-visible elements and interactions match between Companion and Workout without a documented platform constraint - shared behavior and visual language are the default.
- ⛔ Use distorted QEMU screenshots to dismiss API 4.2 black screens - screenshots are not display evidence, and launch failures require isolation against a minimal Mini Program.
- ⛔ Create `codex/*` branches or leave merged PR branches behind - use a change-specific prefix such as `fix/`, `feat/`, `docs/` or `chore/`, then delete both local and remote branches after confirming the merge.
- ⛔ Restore `TODO.md` as a backlog - GitHub Issues and Project #1 are the single source of truth.
- ⛔ Treat "Workout Display" feedback as watch UI feedback, let settings controls share a row or rely on newline characters for layout - it names the phone Settings App section and uses full-width controls plus separate text elements unless the user says otherwise.
- ⛔ Reserve image space when Exercise images is Off - full-width text must return; source images only from Workout API imageUrl, never description Markdown.
- Do not describe optional exercise images or timed sets as new in 0.5.0 - they already shipped in 0.4.9.
- ⛔ Do not take desktop control for simulator checks - the user wants to perform visual checks personally; launch through the terminal and ask what they see.
- Never add rows to the small workout screen for secondary details - reuse existing summary rows and paginate notes.
- ⛔ Keep Prepare beside Start set after the rest timer expires - replace both with one full-width Start set button on the timer screen.
- ⛔ Prefix plate labels with "PER SIDE" or "LOAD" - show only the plate breakdown and unit to keep it readable.
- ⛔ Replace the prepared superset exercise when rest ends - retain its entry and set identity across same-workout updates while it remains unfinished.
- ⛔ Hide exercise Info when notes and description are empty - keep the button visible and explain unavailable details.
- ⛔ Flatten exercise descriptions, this-session notes and recent-session comments into one Info paragraph - load each source through synchronization and show its own subtitle and readable body.
- ⛔ Show a duration/calorie ticker or replace visible native BPM when only its heart glyph scrolls - keep native workout BPM and fix the icon independently.
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
- ⛔ Make only the rest countdown pausable - the purple elapsed workout timer opens the durable global Pause/Resume modal in both apps.
- ⛔ Save or call device, UI, storage, transport or file APIs from Workout `onDestroy` - it is inert cleanup; `onPause` owns safe cleanup and the local journal remains recoverable.
- ⛔ Start a second heart-rate sensor in the standalone app - it already owns `@zos/sensor` HeartRate.
- ⛔ Delete unsynced sessions automatically - offer resume, retry or explicit discard.
- ⛔ Add fast polling, continuous services or unsupported extension gestures - use event-driven click-only extension UI.
- ⛔ Start a second `zeus dev` watcher - concurrent watchers race to refresh one simulator.
- ⛔ Push without `/public-release-audit` - the public repository must remain free of secrets and personal data.
- ⛔ Publish 1.0.0 before physical-watch validation clears the release gate - every `0.x` version is beta.
- ⛔ Commit expiring preview QR codes or expiry dates - `publish.ps1` records both assets and their exact validity timestamps in the matching GitHub release.
- ⛔ Preserve stale QR validity timestamps when refreshing release assets - replace only the marked QR metadata block because every generated code has its own expiry.
- ⛔ Publish this correction as v0.5.1 - that tag already points to the prior release; this release is v0.5.2.
- ⛔ Put preview QR images back in README.md - expiring QR codes belong only to the matching GitHub release.
- ⛔ Generate a public Workout preview with a synthetic App ID - only App ID `1125789` maps to the registered Lifto Workout Extension application.
- ⛔ Infer a tested build, exact test date or root cause from report age or a generic sync screenshot - capture the build and error evidence separately.
- ⛔ Create new checklists or ask community testers to complete them for routine fixes - keep feedback requests brief and limited to normal use.

## Traps
- Stale workout after a local set -> an old poll returned during a write -> keep the signature guard and adopt only after acknowledgement.
- Side Service forgets state -> Zepp destroys it between requests -> carry durable identity and session data from the watch.
- Live record lacks targets -> Playground serializes only completed exercises -> preserve the known prescription in the plan.
- Warmup load is wrong -> loadable plates are not a fixed step -> use `Weight_calculatePlates` semantics and validate against history.
- Timer skips after pause or screen-off -> callbacks pause with lifecycle -> recompute from `restEndsAt`.
- Visible buttons are inert -> callback was deferred or deleted itself -> run native callbacks, retain modal controls and redraw once.
- Finish duplicates legacy history after timeout -> commit result was ambiguous -> search for the expected record before retry.
- Workout Extension is absent from simulator Workout -> simulator images omit the system app -> validate in Developer Mode on hardware.
- Simulator image download reports `downloadFile is not supported in simulator` -> the Side Service cannot create an image file there -> validate dynamic images on hardware.
- Phone connection fails after a Zeus simulator refresh -> Side Service can remain unstarted with phone port 0 -> reopen the app's Side Service before retrying; this is a simulator startup failure, not an account error.
- `zeus dev` replaces `.gitignore` -> Zeus writes its template -> restore the repository file and recheck secret exclusions before push.

## State

- Version 0.5.2 beta: both apps run timed and unilateral sets and optional exercise images in the ready list, workout overview, Info and Prepare. Lifto Workout targets Strength Training and Free Training with App ID 1125789. Timed native lifecycle, alerts and image display require physical validation.
- Active 3 Premium, Zepp OS 6, firmware 6.3.13.5: installation TESTED by a tester; normal use of 0.4.6 and 0.4.8 exposed rapid-input and missing-weight edge cases addressed in 0.4.9.
