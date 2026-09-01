# Zepp App Store submission

Everything the Zepp OS Developer Console asks for, prepared in one place. No credentials are
needed anywhere: the reviewer runs the application in demo mode, which is what an
installation with no API key does by default.

## Identity

| Field | Value |
| --- | --- |
| App ID | 1123411 |
| App name | Lifto Companion |
| Vendor | Sni3rs |
| Version | 0.3.3, code 24 |
| Category | Health and fitness |
| Privacy policy URL | published `docs/privacy-policy.md` (raw or Pages URL of the public repository) |
| Support | issue tracker of the public repository |

The name deliberately avoids leading with the "Liftosaur" trademark. Liftosaur is named in
the description as the service the application connects to, which is descriptive use, and
the non-affiliation disclaimer is repeated in the listing.

## Short description (en-US)

Track your Liftosaur workouts directly from your wrist, set by set, with live cloud sync and rest timers.

## Full description (en-US)

Lifto Companion is an unofficial, open-source client for Liftosaur, the workout tracking
service. Connect directly to Liftosaur Cloud with shared active-workout synchronization.

- Direct Cloud sync: preview your next scheduled workout or pick any program, week, and day.
- Seamless cross-device continuity: continue the same active session on watch or in the official Liftosaur phone app.
- Full prescriptions: warmups, calculated plate combinations, rep targets, weights, and supersets pre-resolved from your account.
- One tap per set, with live heart rate and Liftosaur rest timers with haptic vibration alerts.
- Crash-proof durability: the plan and journal are stored locally on the watch after every set, resuming seamlessly if interrupted.
- Atomic finish: finishing on the watch automatically updates your history, progression rules, 1RM records, and advances to the next workout day.

Try it without an account: with no API key the application runs in demo mode on sample
programs, so you can test the full interface before connecting an account.

Normal use requires a Liftosaur account with an active Premium subscription and an API key,
which you paste once into the settings page in the Zepp app. The key stays on your phone: it
is never sent to the watch and never written to a log.

This application is independent and is not affiliated with, maintained by, or endorsed by
Liftosaur or its author.

## Language

The interface and store listing are available in English only.

## Assets

| Asset | State |
| --- | --- |
| Icon (`icon.png`, round and square variants) | present in `assets/common.r` and `assets/square.s` |
| Store screenshots | **TODO**, capture from a real Amazfit Active 2 and an Amazfit Bip 6 |

Screenshots to capture:
1. Home screen / scheduled next workout preview
2. Program and week/day selection
3. Active set screen with prescription, plates, and heart rate
4. Rest timer countdown with overtime
5. Session summary and completion

## Notes for the reviewer

Paste this into the review notes field. It needs no credentials.

> **No account is needed to review this application.**
>
> It is a client for the third-party service Liftosaur (https://www.liftosaur.com), but an
> installation with no API key runs in **demo mode**: it serves built-in sample programs
> and lets you run a complete workout, so the whole application can be reviewed without
> signing up for anything.
>
> To review: install, open the application on the watch, and use it. No setup at all. The
> settings page in the Zepp app shows "Status: Demo mode" to confirm it. Nothing is sent to
> any server in this mode, and nothing is saved to any account.
>
> A real Liftosaur account with an active Premium subscription is required only for normal
> use, because the public Liftosaur API is a Premium feature.
>
> Privacy: the API key, when a user enters one, is stored only in phone settings storage and
> is sent only to https://www.liftosaur.com as an Authorization header. It is never transmitted
> to the watch. An anonymous installation ID is stored locally to coordinate cloud sync. Heart
> rate is displayed on the watch during a session and is never transmitted anywhere.

## Demo mode

Implemented by [`app-side/dummy-program-service.js`](../app-side/dummy-program-service.js)
and selected in [`app-side/index.js`](../app-side/index.js). It engages when the stored API
key is empty, or is literally `dummy` or `demo`. It serves sample programs, a full
day plan and a simulated finish response, performing no HTTP requests.

## Submission checklist

- [ ] Demo mode run end to end on a real watch, no key stored
- [ ] Privacy policy published at a public URL
- [ ] Screenshots captured for every targeted screen shape
- [x] Descriptions written for declared locale
- [ ] `version.code` higher than the last submitted version
- [ ] `npm test` green
- [ ] `/public-release-audit` passed, no credentials in the repository
- [ ] `zeus build` run, the `.zab` in `dist/` matches the declared version
