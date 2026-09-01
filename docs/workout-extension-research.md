# Workout Extension Research

Research refreshed: 1 September 2026.

## Official sources

- [Introduction](https://docs.zepp.com/docs/guides/workout-extension/intro/): Workout Extension is a Zepp OS 3.5 plug-in for the system Workout app. The documented device list is T-Rex 3, Cheetah Pro, Cheetah Round, Cheetah Square, T-Rex Ultra and Falcon.
- [Quick Start](https://docs.zepp.com/docs/guides/workout-extension/quick-start/): the extension is an independent application with an independent App ID. It requires API level 3.6, a single `data-widget`, `extType: "workout"`, and a `data-widget` manifest entry. Strength Training is sport subtype `52`.
- [getSportData](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-access/getSportData/): live workout metrics are read-only and require `data:user.hd.workout`.
- [Distribution](https://docs.zepp.com/docs/guides/workout-extension/distribute/): a distinct app registration is required. The extension cannot have the same name as the standalone Mini Program.

## Confirmed constraints

- A widget has one page, no scrolling, gesture monitoring or physical button response. Interactive controls use click events.
- A focused widget receives `onResume`; loss of focus receives `onPause`. While paused, callbacks and timers do not run.
- `subType: [52]` scopes the widget to Strength Training.
- The simulator shows an extension as a normal app. It does not prove workout-context behaviour.
- The public live-data API reads an already-running workout. It does not start, pause, resume or finish one.

## Product decisions

- The extension will never try to end the native workout. It saves Liftosaur and directs the user to Zepp controls.
- Rest time stays absolute. On resume, the renderer computes the remaining time from `restEndsAt`.
- The extension uses its own settings and Side Service. No credential is copied to the watch or between App IDs.

## Open questions

- Confirm the official alarm or App Service mechanism that can alert during widget pause. Until then, use an on-resume and foreground visual fallback.
- Validate widget focus, background rest alert and native metrics on a documented physical watch.
