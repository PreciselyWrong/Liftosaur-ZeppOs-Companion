## What

- Lifto is an unofficial Liftosaur Cloud client for Amazfit watches on Zepp OS 3.6+, shipped as standalone Companion and separate Workout Extension packages with shared domain logic.
- The watch owns session UI and the durable journal; the phone Side Service owns authenticated HTTPS. Session loss or corruption is the highest-severity failure.
- The confirmed standalone target is Amazfit Active 2. Workout Extension support requires model and firmware evidence.
- Everything committed here is English and uses ASCII hyphens only, including UI, logs, agent files, and release notes.

## Commands

- Install: `npm ci`. Test: `npm test`. Clean: `npm run clean` (preserves local audit evidence under `build/`).
- Plan development: `.\dev.ps1 -Plan`. Run Companion: `.\dev.ps1`. Run generated Workout: `.\dev.ps1 -Product workout`.
- Build: `npm run build:companion`, `npm run build:workout` with `ZEPP_WORKOUT_EXTENSION_APP_ID=1125789`, or `npm run build:all`.
- Release work follows `.agents/skills/lifto-release/SKILL.md`; it owns audits, previews, GitHub release creation or refresh, and verification.
- GitHub Releases are the only public history. Below `1.0.0` is pre-release; notes come from merged PRs. Never add `CHANGELOG.md` or `.github/release.yml`.
- Pull requests contain exactly one commit and one subject; split independent changes into separate branches and PRs.

## Work tracking

- GitHub Issues and [Project #1](https://github.com/users/PreciselyWrong/projects/1) are the only backlog. Never create `TODO.md`; use exactly one primary label: `bug`, `enhancement`, or `idea`.
- Search before creating an issue, add it to Project #1, set `In Progress` when work starts, and keep its status current.
- Keep issues outcome-focused and implementation detail in the PR. After verification, link the PR and close as `Done`; close abandoned work as not planned with one factual reason.

## Map

- `page/common/`, `data-widget/common/` - Companion and Workout watch UIs; `shared/screen-layout.js` and `shared/watch-layout.js` own layout.
- `shared/workout-session.js`, `shared/workout-controller.js` - session state, journal, persistence, Cloud sync, polling, conflicts, and terminal writes.
- `shared/workout-api-plan.js`, `shared/day-plan.js` - authoritative API-to-plan and legacy replay mappings.
- `shared/session-storage.js`, `shared/workout-refresh-policy.js`, `shared/rest-alert.js` - recovery, queue state, refresh timing, and alerts.
- `shared/workout-extension-*` - extension navigation, metrics, and package contract.
- `app-side/`, `setting/` - phone protocol, sole HTTP client, Cloud enrichment, identity, API key settings; credentials never live on watch.
- `tests/`, `tools/`, `docs/` - Node contracts, build/preview tooling, tester guidance, privacy, and store documentation.

## Decisions

- Liftosaur Cloud owns programs, prescriptions, active workout state, and progression; the watch never executes Liftoscript.
- Users explicitly choose program, 1-based week, and 1-based day. History may highlight but never select.
- The Side Service is the only Cloud gateway. Persist critical gestures before rendering, then sync asynchronously.
- Plan and journal persist together. Bind live set IDs before draining writes. Adopt remote state only after local acknowledgement; preserve same-workout edits and pause timing; late polls cannot reopen finished sessions.
- Set and finish writes are repeat-safe. Pending sets block finish and preserve the session.
- Rest uses absolute `restStartedAt`, `restDuration`, and `restEndsAt`; display intervals only repaint.
- Timed sets journal preparation, effort, pauses, and partial left-side results. Send both unilateral durations together; expiry alerts but never auto-completes.
- Get Ready is a local Off/3/5/10-second preference that preserves rest; never infer undocumented Liftoscript auto or timer modifiers.
- Exercise images use API `imageUrl` only and require phone opt-in. Cache the 32 most recently used converted phone images across Side Service restarts, keep transfer paths immutable, and rebuild missing files; hardware display validation remains pending.
- Reads use a 10-second action floor, 2-minute passive checks, and 60/120/300-second failure backoff. Capability evidence is `CONFIRMED`, `TESTED`, `ASSUMED`, `UNKNOWN`, or `BLOCKED`; simulator evidence is never device evidence.

## Forbidden

- Do not copy, fork, or scrape Liftosaur code (AGPL boundary), or reimplement Liftoscript; only documented plate loading is local.
- Do not send API keys over BLE, store them on watch, log them, or call `fetch()` outside `app-side/liftosaur-api-client.js`.
- Do not wait for BLE or HTTP before showing a critical gesture, overwrite unacknowledged writes, blindly retry ambiguous legacy writes, or auto-delete unsynced sessions.
- Do not infer programs, coordinates, or missing values from names. Raise `DAY_MISMATCH` when requested numeric coordinates differ.
- Do not rely on undocumented Zepp behavior or claim compatibility from API level, simulator output, or distorted screenshots; isolate launch failures and record model, firmware, shape, sport mode, and build evidence.
- Do not attribute native watch reboots to images without reproduction; reports predating image support are not causal evidence.
- Keep at least 90% behavior and visual parity across Companion and Workout unless a platform constraint is documented.
- Do not hardcode renderer sizes, truncate exercise names or progress dots, or add rows for secondary details; use `getDeviceInfo()`, `LAYOUT.fit()`, horizontal scrolling, and paginated notes.
- Keep extension controls inside the round-screen chord and preserve the clock/action gap. After rest, show one full-width Start set while retaining the prepared superset entry and identity.
- Keep Info visible when empty; keep description, session notes, and recent comments separate. Images Off restores full-width text; source images only from API `imageUrl`.
- Keep native BPM, make the purple elapsed timer open durable global Pause/Resume in both apps, and show plate breakdown plus unit without PER SIDE or LOAD prefixes.
- In phone Workout Display settings, use full-width controls and separate text elements; do not share rows, use newlines for layout, or remove the local screen-on option.
- Workout `onDestroy` is inert cleanup: no device, UI, storage, transport, or file APIs. `onPause` owns safe cleanup; never start a second Companion heart-rate sensor.
- Do not add fast polling, continuous services, unsupported extension gestures, or a second `zeus dev` watcher.
- Do not take desktop control for simulator checks. Ask the user what they see. Active 2 extension setup is Workout > Strength Training > Settings > More > Data Page > Add Page > Lifto.
- Do not push without `/public-release-audit`, publish `1.0.0` before physical validation, move a published tag, or create release backlog issues.
- Do not commit preview QR assets or validity dates, restore QR images to README, preserve stale QR metadata, or generate public Workout previews with an App ID other than `1125789`.
- Do not invent tested builds, dates, or root causes from report age or generic screenshots, and do not burden community testers with routine checklists.

## Traps

- Stale workout after local set -> old poll returned during a write -> keep the signature guard and adopt only after acknowledgement.
- Side Service forgets state -> Zepp destroys it between requests -> carry durable identity and session data from watch.
- Live record lacks targets -> Playground serializes only completed exercises -> preserve the known prescription in the plan.
- Wrong warmup load -> plates are not a fixed step -> use `Weight_calculatePlates` semantics and validate against history.
- Timer skips after pause or screen-off -> callbacks pause with lifecycle -> recompute from `restEndsAt`.
- Visible buttons are inert -> callback was deferred or deleted itself -> run native callbacks, retain modal controls, and redraw once.
- Finish duplicates legacy history after timeout -> result was ambiguous -> search for the expected record before retry.
- Extension missing or image download unsupported in simulator -> simulator limitation -> validate in Developer Mode on hardware.
- Phone fails after Zeus refresh -> Side Service may have phone port 0 -> reopen it; if `zeus dev` replaced `.gitignore`, restore it and recheck secret exclusions.
