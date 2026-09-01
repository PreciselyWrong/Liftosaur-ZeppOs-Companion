# Workout Extension Research

Research refreshed: 1 September 2026.
Evidence vocabulary: `DOC_CONFIRMED`, `UNIT_TESTED`, `BLOCKED`, `UNKNOWN`.

## Official Sources

- [Introduction](https://docs.zepp.com/docs/guides/workout-extension/intro/): Workout Extension is a Zepp OS 3.5+ plug-in for the system Workout app. The documented device list includes T-Rex 3, Cheetah Pro, Cheetah Round, Cheetah Square, T-Rex Ultra, and Falcon.
- [Quick Start](https://docs.zepp.com/docs/guides/workout-extension/quick-start/): the extension is an independent application with an independent App ID. It requires API level 3.6, a single `data-widget`, `extType: "workout"`, and a `data-widget` manifest entry. Strength Training is sport subtype `52`.
- [getSportData](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-access/getSportData/): live workout metrics are read-only and require `data:user.hd.workout`.
- [Distribution](https://docs.zepp.com/docs/guides/workout-extension/distribute/): a distinct app registration is required. The extension cannot share the name or App ID of the standalone Mini Program.

## Confirmed Constraints

- **UI Constraints (`DOC_CONFIRMED`)**: A DataWidget has a single page without vertical/horizontal list scrolling, page-level gesture handlers, or physical button hooks. All user interaction relies on `widget.BUTTON.click_func`.
- **Lifecycle (`DOC_CONFIRMED`)**: A focused widget receives `onResume`; loss of focus triggers `onPause`. While paused, timers and UI callbacks do not run.
- **Sport Subtype (`DOC_CONFIRMED`)**: `subType: [52]` scopes the widget specifically to Strength Training.
- **Read-Only Sport Data (`DOC_CONFIRMED`)**: `getSportData` reads active duration and calorie metrics from a running workout. It provides no mechanism to start, pause, resume, or finish native workout recording.
- **Simulator Limits (`BLOCKED`)**: The Zepp OS simulator renders a DataWidget only in an isolated standalone preview context. Simulator images omit the native Workout system app entirely. Workout-context validation cannot be performed in the simulator and is `BLOCKED` on physical hardware.

## Product Decisions

- **Two-Stage Finish Split (`DOC_CONFIRMED` / `UNIT_TESTED`)**: The extension never attempts to terminate the native workout. It finalizes the Liftosaur Cloud session atomically (`POST /workout/finish`), clears local store, and instructs the user to stop the native workout in Zepp Workout UI.
- **Absolute Rest Timing (`UNIT_TESTED`)**: Rest timing is stored as absolute timestamps (`restStartedAt`, `restDuration`, `restEndsAt`). On `onResume`, the renderer recomputes remaining time and fires a resume alert if rest expired while unfocused.
- **Settings & Credential Isolation (`DOC_CONFIRMED`)**: The extension uses its own App ID, phone settings page, and Side Service instance. No credentials cross BLE or are shared in watch storage files.

## Open / Gated Items

- **Background Rest Alert Delivery (`UNKNOWN`)**: Whether haptic vibration can trigger while the DataWidget is paused/unfocused or display is asleep is unconfirmed. The on-resume alert check serves as the verified fallback.
- **Physical Hardware Execution (`BLOCKED`)**: Validation across documented watch models (T-Rex 3, Cheetah series, Falcon) requires executing the physical hardware test plan.
