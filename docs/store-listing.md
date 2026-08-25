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
| Version | 0.3.1, code 22 |
| Category | Health and fitness |
| Privacy policy URL | published `docs/privacy-policy.md` (raw or Pages URL of the public repository) |
| Support | issue tracker of the public repository |

The name deliberately avoids leading with the "Liftosaur" trademark. Liftosaur is named in
the description as the service the application connects to, which is descriptive use, and
the non-affiliation disclaimer is repeated in the listing.

## Short description (en-US)

Track your Liftosaur workouts from your wrist, set by set, with automatic rest timers.

## Full description (en-US)

Lifto Companion is an unofficial, open-source client for Liftosaur, the workout tracking
service. Pick your program, week and day on the watch, log every set as you do it, and let
Liftosaur compute the progression exactly as it would in its own app.

- Your program, your weeks, your days, read live from your Liftosaur account.
- One tap per set, with the prescribed reps and weight on screen.
- Automatic rest timer with a vibration when it ends, including your own default timers for
  standard sets, warmups and supersets.
- Live heart rate during the session.
- Crash proof: the session is written to the watch after every set, so an interrupted
  workout resumes on the same set.
- The finished workout is written straight back to your Liftosaur history, with the
  progression computed by Liftosaur itself.

Try it without an account: with no API key the application runs in demo mode on a sample
program, so you can see exactly how it works before subscribing to anything.

Normal use requires a Liftosaur account with an active Premium subscription and an API key,
which you paste once into the settings page in the Zepp app. The key stays on your phone: it
is never sent to the watch and never written to a log.

This application is independent and is not affiliated with, maintained by, or endorsed by
Liftosaur or its author.

## Language

The beta interface and store listing are available in English only.

## Assets

| Asset | State |
| --- | --- |
| Icon (`icon.png`, round and square variants) | present in `assets/common.r` and `assets/square.s` |
| Store screenshots | **TODO**, capture from a real Amazfit Active 2 and an Amazfit Bip 6 |

Screenshots to capture, in this order, because they tell the story a reviewer needs:

1. Program picker
2. Week and day picker
3. Active set screen with the prescription visible
4. Rest timer running
5. Session finished with the summary

The console imposes its own dimensions and count per screen shape. Read the form before
capturing, `docs/screenshots/` holds the working copies.

## Notes for the reviewer

Paste this into the review notes field. It needs no credentials.

> **No account is needed to review this application.**
>
> It is a client for the third party service Liftosaur (https://www.liftosaur.com), but an
> installation with no API key runs in **demo mode**: it serves a built-in sample program
> and lets you run a complete workout, so the whole application can be reviewed without
> signing up for anything.
>
> To review: install, open the application on the watch, and use it. No setup at all. The
> settings page in the Zepp app shows "Status: Demo mode" to confirm it. Nothing is sent to
> any server in this mode, and nothing is saved to any account.
>
> A real Liftosaur account with an active Premium subscription is required only for the
> normal use of the application, because the public Liftosaur API is a Premium feature.
> This is stated in the description.
>
> Privacy: the API key, when a user enters one, is stored only in the phone side settings
> storage and is sent only to https://www.liftosaur.com as an Authorization header. It is
> never transmitted to the watch. Heart rate is displayed on the watch during a session and
> is never transmitted anywhere. Full details: <privacy policy URL>.

## Demo mode

Implemented by [`app-side/dummy-program-service.js`](../app-side/dummy-program-service.js)
and selected in [`app-side/index.js`](../app-side/index.js). It engages when the stored API
key is empty, or is literally `dummy` or `demo`. It serves three sample programs, a full
day plan and a fake finish response, and performs no HTTP request at all.

This is what a reviewer, and any tester without a Premium subscription, sees. It is also
what the store screenshots are captured from, so no personal workout data ends up in the
listing.

Before submitting, run one full demo session end to end on a real watch: pick a program,
pick a week and a day, complete every set, finish. The reviewer's first run must not be the
first run ever.

## Submission checklist

- [ ] Demo mode run end to end on a real watch, no key stored
- [ ] Privacy policy published at a public URL
- [ ] Screenshots captured for every targeted screen shape
- [x] Descriptions written for every declared locale
- [ ] `version.code` higher than the last submitted version
- [ ] `npm test` green
- [ ] `/public-release-audit` passed, no credentials in the repository
- [ ] `zeus build` run, the `.zab` in `dist/` matches the declared version
