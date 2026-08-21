# Zepp OS Capabilities

Evidence register for every Zepp OS capability this project depends on.

Status vocabulary: `CONFIRMED` (official doc), `TESTED` (emulator), `REAL DEVICE TESTED`,
`ASSUMED`, `UNKNOWN`, `BLOCKED`. Emulator results never promote to real-device results.

Research date: 2026-08-13.

## Environment inventory

| Item | Value | Status |
| --- | --- | --- |
| OS | Windows 11 Pro 10.0.26200 | TESTED |
| Node.js | v24.19.0 (`C:\Program Files\nodejs\node.exe`) | TESTED |
| npm | 11.17.0 | TESTED |
| pnpm / yarn | not installed | TESTED |
| Zeus CLI | v1.9.3 (zpm v3.4.2), installed globally | TESTED |
| Zepp OS Simulator | **not installed**, `zeus status` → disconnected | BLOCKED |
| Zeus login | **not logged in** (`zeus status` → no login) | BLOCKED |
| Zepp App Developer Mode | not verified | UNKNOWN |
| `TARGET_WATCH_MODEL` | UNKNOWN | UNKNOWN |

Consequence: the project can be generated and inspected, but no build, preview, or runtime
evidence can be produced until the simulator is installed and `zeus login` succeeds.

### Verified Zeus CLI commands

| Command | Result | Status |
| --- | --- | --- |
| `npm i @zeppos/zeus-cli -g` | zeus v1.9.3 installed | TESTED |
| `zeus --version` | node/npm/zeus/zpm versions | TESTED |
| `zeus status` | login and simulator connection state | TESTED |
| `zeus create <name>` | `WORKOUT_EXTENSION` + `Empty` template scaffolds a project | TESTED |
| `zeus login` | logged in | TESTED |
| `zeus dev` | prompts host/port/device, then **fails to connect** to the simulator | BLOCKED |
| `zeus preview` / `zeus build` | not run | UNKNOWN |
| `npm test` | 8 app.json invariant checks, all passing (`node --test`) | TESTED |

`zeus dev` offers these simulator devices: Amazfit Falcon, T-Rex Ultra, Cheetah Pro,
Cheetah Pro Kelvin Kiptum, Cheetah (Round), Active Edge, Balance (list truncated). Active
Edge and Balance are **not** in the documented Workout Extension device list - availability
in the simulator is not evidence of Workout Extension support.

**The `-t` target must match the emulator image that is actually downloaded.** `zeus dev`
offers every known device, including ones whose image was never fetched; selecting one of
those builds a package the running emulator cannot install, and nothing appears - with no
error. The downloaded images live in `~/.zepp/emulator_cache/<id>`, and `<id>` maps to an
entry in `%APPDATA%/simulator/config.json` → `finalDownloadList`.

Observed here: the only cached image was **Active 2 v1.1.0 (os 5.0, api 4.2)**, while the
default prompt selection built for Falcon (device sources 414/415). `zeus dev -t "Amazfit
Active 2 (Round)"` rebuilds for 8913155/8913159/10092803/10092807/10617091 and installs.
Unlike `zeus create`, the `-t` flag on `zeus dev` **is** honoured.

The deployed package can be inspected at
`%APPDATA%/simulator/apps/<project><appId>/device/app.json`. Note the build rewrites
`configVersion` from `v3` to `v2` and expands `targets.common` into a flat `platforms`
array.

`zeus dev` also **overwrites the project `.gitignore`** with its own template on every run,
dropping the secret patterns. Restore it with `git checkout -- .gitignore` after each run,
and re-check before any push.

`zeus create` and `zeus dev` are **interactive wizards and require a TTY**. The documented
`--appType` / `--APILevel` flags were ignored in v1.9.3; the prompts always appear.
Non-interactive scaffolding is therefore not reproducible from an agent shell.

## Evidence from the generated skeleton

The `WORKOUT_EXTENSION` / `Empty` template produces `app.js`, `app.json`,
`assets/common.r/icon.png`, `data-widget/common/index.js`, `global.d.ts`, `jsconfig.json`,
`package.json`. Findings not present in the public documentation:

| Finding | Value | Status |
| --- | --- | --- |
| App declaration | `app.appType: "app"` **plus** `app.extType: "workout"` | TESTED |
| Config version | `configVersion: "v3"` | TESTED |
| API version | `compatible`, `target`, `minVersion` all `"3.6"` | TESTED |
| Widget window | `window.isPinned: 1` - `isPinned` exists and defaults to pinned | TESTED |
| Default subType | `subType: []` (all sports) | TESTED |
| Platform entry | `platforms: [{ "st": "r" }]`, `designWidth: 480` - `st` appears to be screen shape (`r` = round) | ASSUMED |
| i18n | Per-language widget `name` required for ~33 locales | TESTED |
| Widget entry | `DataWidget({ onInit, build, onDestroy })` - the template exposes only these three | TESTED |
| appId | Template ships `26440`, a placeholder; a real appId must be issued by the developer console | ASSUMED |

`@zeppos/device-types` types `hmUI.sport_type` as a bare `number` with no enumeration, so
the typings do **not** resolve the Strength Training code either. Risk P0-1 stands.

## Workout Extension

| Capability | Finding | Status | Source |
| --- | --- | --- | --- |
| Concept | Plug-in that extends the system Workout app; independent app with its own appId | CONFIRMED | [intro](https://docs.zepp.com/docs/guides/workout-extension/intro/) |
| Minimum OS | Zepp OS 3.5 | CONFIRMED | [intro](https://docs.zepp.com/docs/guides/workout-extension/intro/) |
| Minimum API_LEVEL | 3.6 (`runtime.apiVersion.minVersion: "3.6"`) | CONFIRMED | [quick-start](https://docs.zepp.com/docs/guides/workout-extension/quick-start/) |
| Listed devices | Amazfit T-Rex 3, Cheetah Pro, Cheetah (Round), Cheetah Square, T-Rex Ultra, Falcon | CONFIRMED | [intro](https://docs.zepp.com/docs/guides/workout-extension/intro/) |
| Widgets per app | Maximum 1 | CONFIRMED | [quick-start](https://docs.zepp.com/docs/guides/workout-extension/quick-start/) |
| UI constraints | No scrolling, no gestures, no physical buttons; `CLICK` events only | CONFIRMED | [quick-start](https://docs.zepp.com/docs/guides/workout-extension/quick-start/) |
| Lifecycle | `onCreate`, `onInit`, `build`, `onResume`, `onPause`, `onDestroy` | CONFIRMED | [quick-start](https://docs.zepp.com/docs/guides/workout-extension/quick-start/) |
| Distribution | Separate appId, submitted and reviewed in the developer console | CONFIRMED | [distribute](https://docs.zepp.com/docs/guides/workout-extension/distribute/) |

### app.json shape (verbatim from Quick Start)

```json
"module": {
  "data-widget": {
    "widgets": [{
      "path": "pages/plugin1",
      "name": "plugin2",
      "icon": "icon2.png",
      "runtime": {
        "ability": [{ "type": 1, "subType": [1, 2, 3] }]
      }
    }]
  }
}
```

- `type`: only value `1` (Workout Extension). CONFIRMED.
- `subType`: array of sport codes; `[]` means all sports. CONFIRMED.
- **The numeric sport code for Strength Training is UNKNOWN.** No public enumeration was
  found in the app.json reference, the SPORT_DATA reference, `getSportData` reference, or
  search. A web search returned `52`, but this is unverifiable against official docs - treat
  as ASSUMED until confirmed by official source or emulator test. This is risk P0-1.
- The general [app.json reference](https://docs.zepp.com/docs/reference/app-json/) does
  **not** document the `data-widget` module at all - only Quick Start does. Treat the
  Quick Start snippet as the single source until contradicted.

## Data access

| Capability | Finding | Status | Source |
| --- | --- | --- | --- |
| `SPORT_DATA` widget | Real-time sport data display; `category` currently only `edit_widget_group_type.SPORTS`; `default_type` from `sport_data` (`@zos/ui`), includes `HR`, `DURATION_NET`, `CONSUME`, chart types | CONFIRMED | [SPORT_DATA](https://docs.zepp.com/docs/reference/device-app-api/newAPI/ui/widget/SPORT_DATA/) |
| `mock_data` | Emulator-only simulated data - the supported path for mock-first development | CONFIRMED | [SPORT_DATA](https://docs.zepp.com/docs/reference/device-app-api/newAPI/ui/widget/SPORT_DATA/) |
| `getSportData` | `@zos/app-access`, API_LEVEL 3.6, permission `data:user.hd.workout`, async callback with `{code, data}` where `data` is a JSON string | CONFIRMED | [getSportData](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-access/getSportData/) |
| `getSportData` types | `speed`, `avg_speed`, `pace`, `avg_pace`, `distance`, `duration`, `calories`, `cadence`, `avg_cadence`, `altitude`, `total_up_altitude`, `total_count`, `vertical_speed`, `downhill_count`, `total_downhill_distance` | CONFIRMED | [getSportData](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-access/getSportData/) |
| Heart rate via `getSportData` | **Not in the type list.** The `getSportData` API only accepts string keys (`speed`, `distance`, `duration`, etc.) - HR is absent. HR appears only as a `SPORT_DATA` widget field. Getting a numeric HR value in a data-widget requires a different approach (undocumented or not public). | CONFIRMED absent from getSportData |

## Confirmed by the phase 0 spike (EMULATOR TESTED)

Observed on the Active 2 (Round) simulator image: after `zeus dev` deployed, the widget
appeared on its own and rendered its title, a heart-rate value and its status line.

**No workout was started.** The simulator shows the widget directly, so this is a preview
context, not the system Workout app. Nothing here proves how the extension behaves as a
real data page.

| Finding | Status |
| --- | --- |
| `sport_data` and `edit_widget_group_type` are exported by `@zos/ui` | TESTED |
| `SPORT_DATA` renders `mock_data` in the simulator | TESTED |
| `DataWidget` custom object properties are **not** accessible via `this` inside arrow-function callbacks - `this` is the module scope, not the DataWidget object. Mutable state must live in **module-level closure variables**. | TESTED |
| The widget renders on Active 2, a device absent from the documented six-device list | TESTED |
| The simulator renders a `data-widget` **outside** any workout - in a direct preview context | TESTED |
| The Active 2 simulator image has **no Workout system app** - `Home` only shows Settings. | TESTED |
| T-Rex 3 simulator image (officially supported device) **also has no Workout system app** - same result as Active 2. The Workout app is absent from **all** simulator device images. This is a simulator limitation, not a device limitation. | TESTED |
| Workout-context testing (lifecycle in workout, HR from system, subType scoping) is **BLOCKED** in the simulator for all images. The only test path is the real device in Developer Mode. | TESTED |
| A `TEXT` widget has **no** `addEventListener`: calling it throws and aborts `build()` | TESTED |
| A `FILL_RECT` **never receives** `event.CLICK_UP` - a rectangle cannot be a tap target | TESTED |
| `widget.BUTTON` with `click_func` **does** fire | TESTED |
| `setProperty(prop.MORE, …)` on a `FILL_RECT` **does** repaint it | TESTED |
| `setProperty` on a `TEXT` widget **never refreshes it** - neither `prop.TEXT`, nor `prop.MORE` with only `{text}`, nor `prop.MORE` with the full geometry | TESTED |
| ASCII hyphen/dash (`-`) is **invisible** in the Zepp OS font renderer - confirmed by bisect: `'--'` rendered as empty, `'?'` and `'N/A'` rendered correctly | TESTED |


### UI constraints this imposes

Established by bisecting a minimal widget one variable at a time, after several
misdiagnoses. Each step was rebuilt and observed in the simulator:

1. Background `FILL_RECT` + static `TEXT` → renders.
2. `CLICK_UP` on the background + text update → no reaction.
3. `CLICK_UP` on the background + colour change only → no reaction ⇒ the rect gets no taps.
4. `BUTTON` + full-geometry text update → button fires, text does not change.

So **every tap target must be a `BUTTON`**, and **no text can be mutated in place**. This
lands squarely on phase 1, where weight, reps, RPE and the rest countdown all have to update
live.

**`deleteWidget` + `createWidget` works** (P0-6 resolved, 2026-08-14): deleting the old
`TEXT` widget and creating a fresh one in its place is confirmed by the emulator. The counter
incremented correctly on each tap. Calling `prop.VISIBLE` before a widget is fully initialised
aborts `build()`. Calling it later on a completed `BUTTON` is supported by the documented API.

Consequence for phase 1: **all dynamic text must be rendered via delete + recreate**. Keep
the widget reference in a module-level closure variable, never on `this`.

A runtime error inside `build()` aborts the rest of it **silently** - the widgets already
created stay on screen, so a half-built widget looks deliberate. Any unexplained missing
element should be read as a crash, not a layout mistake.

### Rebuilding after a button tap

Tested on the Active 2 simulator on 21 August 2026. A native `BUTTON.click_func` works and can
delete the outgoing widgets directly, as the official widget layout example also demonstrates.
Wrapping every callback in `setTimeout(..., 0)` made the rendered controls inert.

The official [`redraw()`](https://docs.zepp.com/docs/reference/device-app-api/newAPI/ui/redraw/)
documentation identifies a `deleteWidget()` boundary case and requires a manual redraw when
the view is not updated in time. The application commits the completed replacement tree:

1. The native `click_func` runs the application action synchronously.
2. `clearWidgets()` deletes the outgoing non-control widget tree.
3. `renderUI()` creates every replacement widget.
4. Page-lifetime modal controls are moved and toggled with `prop.MORE` and `prop.VISIBLE`.
5. One `redraw()` commits the completed view and interaction tree.

The modal previous, next and Close controls are deliberately excluded from `clearWidgets()`.
Deleting the button that is currently executing its own callback can leave the native control
inert. These controls are created once, hidden outside the modal and destroyed only in
`onDestroy()`.

Hit-area changes, `CLICK_DOWN` listeners, `setEnable(false)`, an extra modal Z layer and a
deferred callback did not address the fault and were removed.

Swipe navigation is separate from widget click dispatch. The standalone application can
register one page-level handler through
[`onGesture`](https://docs.zepp.com/docs/v2/reference/device-app-api/newAPI/interaction/onGesture/).
The exercise modal uses left and right to change page and down to close. During a session,
up opens the exercise overview and down closes it. The overview also pages left and right.
On the rest timer, left and right adjust by 10 seconds, up pauses or resumes, and down opens
Prepare. Up returns from Prepare to the timer. No swipe completes a set, finishes a workout
or discards data. This does not apply to the Workout Extension constraints documented above.

Only one `zeus dev` process may watch this project. Concurrent watchers all rebuild and
refresh the same simulator, which makes an interaction test race against repeated app
restarts. Diagnostic screenshots must be written outside the repository because Zeus also
treats a new screenshot inside the project as a source change.

The tap did nothing. The probe listener added on the status text threw at runtime, which
aborted `build()` after the widgets were already drawn - so the screen looked correct while
the widget was in fact broken. That listener is removed; only the background `FILL_RECT`
carries one. Whether taps work at all in the preview context is still unresolved.

### Driving the simulator

The simulator window must be focused; keyboard keys then act as physical buttons:
`Home` = app list / watchface (Mac `fn`+`←`), `End` = shortcut, `enter` = select,
`delete` = back, `↑`/`↓` = up/down, mouse wheel = digital crown.
Source: [simulator guide](https://docs.zepp.com/docs/guides/tools/simulator/).

Consequences: the simulator cannot yet answer whether the extension is scoped to a sport,
how it behaves as a data page, or whether taps work in a real workout. Those move to
"needs the system Workout app", and P0-1 stays open.

## Recording a native Zepp workout (research 2026-08-15)

Question: can the app record the session as a Zepp activity, so it lands in the watch
activity history with heart rate, calories and duration?

**No public API lets a mini program create, start or stop a workout recording.** Every
sport interface Zepp OS documents is read-only, and the only writer is the system Workout
application itself.

| Capability | Finding | Status | Source |
| --- | --- | --- | --- |
| `Workout` (`@zos/sensor`) | Read-only. `getStatus()` (VO2 max, training load, recovery), `getHistory()` (past records: `startTime`, `duration`), `getUserHrZoneSettings()` (4.2), `getWorkoutTrackNavInfo()` (4.2). API_LEVEL 3.0, permission `data:user.hd.workout`. **No start, stop or write method** | CONFIRMED | [Workout](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Workout/) |
| `getSportData` (`@zos/app-access`) | Reads live metrics of a workout **already running** (duration, calories, distance, cadence, and so on). Heart rate is absent from the type list. No start or stop | CONFIRMED | [getSportData](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-access/getSportData/) |
| `launchApp` (`@zos/router`) | `launchApp({ appId: SYSTEM_APP_SPORT, native: true })` opens the system Workout app. API_LEVEL 2.0, `native` from 3.0. `params` is documented as reaching `app.js onCreate`, but **no sport type parameter is documented for system apps** | CONFIRMED | [launchApp](https://docs.zepp.com/docs/reference/device-app-api/newAPI/router/launchApp/) |
| What happens to the caller | **Not documented.** Whether this app keeps running, is paused or is destroyed when the Workout app takes the foreground is unknown | UNKNOWN | - |
| Workout Extension | The only supported way to run **inside** a native workout: the system app owns the recording, the extension only draws a data page | CONFIRMED | [intro](https://docs.zepp.com/docs/guides/workout-extension/intro/) |
| `Time` (`@zos/sensor`) | `getFormatHour()`, `getMinutes()`, `getHours()`, `getHourFormat()` against `TIME_HOUR_FORMAT_12` / `TIME_HOUR_FORMAT_24`, `onPerMinute()`. API_LEVEL 2.1, no permission. Present in `@zeppos/device-types` under `declare module '@zos/sensor'` | CONFIRMED | [Time](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Time/) |

### The three possible paths

1. **Companion workout (the only one that fits this app today).** A button starts the
   system Workout app through `launchApp`, the user picks Strength Training, and the watch
   records the activity while Lifto Companion carries the session. The session already
   survives leaving and re-entering the app, so the round trip costs nothing structurally.
   Three things stay unknown and are real-device questions: whether the native workout keeps
   recording once it is in the background, whether this app can be reopened over it, and
   whether `new HeartRate()` still reports while the system owns the sensor - the project
   rule is that the app is the sole owner of the HR sensor.
2. **Workout Extension.** Native recording for free, but it is a second app with its own
   appId, capped at one widget, and its documented device list (T-Rex 3, Cheetah Pro,
   Cheetah Round, Cheetah Square, T-Rex Ultra, Falcon) excludes both the Active 2 and the
   Bip 6. The Strength Training `subType` code is still unknown (risk P0-1), and passing the
   day plan across two appIds is unsolved. Out of scope for V1.
3. **Nothing native.** Keep reading heart rate through `@zos/sensor` and describe the effort
   in the Liftosaur record only. Zero risk, and no Zepp activity is created.

## Local storage (CONFIRMED)

| Item | Value | Status |
| --- | --- | --- |
| Module | `import { LocalStorage } from '@zos/storage'` | CONFIRMED |
| Constructor | `new LocalStorage(storagePath?)` - defaults to the mini program's own storage file | CONFIRMED |
| Methods | `setItem(key, value)`, `getItem(key, defaultValue?)`, `removeItem(key)`, `clear()` | CONFIRMED |
| Required API_LEVEL | 3.0 (this project targets 3.6) | CONFIRMED |
| Permission | `device:os.local_storage` - must be listed in `app.json` | CONFIRMED |
| Durability | survives app restart; cleared on uninstall | CONFIRMED |
| Quota | not documented | UNKNOWN |

Source: [LocalStorage](https://docs.zepp.com/docs/reference/device-app-api/newAPI/storage/localStorage/).
Documented, not yet device-tested - the writes are wrapped so a failure degrades to an
in-memory store rather than breaking a session.

## Square screens (EMULATOR TESTED)

| Finding | Value | Status |
| --- | --- | --- |
| Bip 6 emulator image | `Bip 6 v1.1.0`, os 5.0, api 4.2, cached as `4ae8ec66a7e2d342faf040652f4f41ff` | TESTED |
| Bip 6 device sources | `9765120`, `9765121`, `10158337` | TESTED |
| Target selection | `zeus dev -t "Amazfit Bip 6"` builds the `square` target only; the round `common` target is not packaged | TESTED |
| Asset folder convention | `assets/<targetName>.<st>`, so `assets/square.s/icon.png` - the build resized it without complaint | TESTED |
| Panel geometry | 390x450, `st: "s"` | CONFIRMED |
| Status bar | Square devices draw a system status bar with the app name **over** the page, hiding the top of the layout. `hmUI.setStatusBarVisible(false)` is documented square-only | TESTED |
| Status bar removal | Calling it was **not enough on its own**: a widget was still covered on the emulator. The layout also reserves a top band (`TOP_INSET_RATIO`, 63 px on 390x450) | TESTED |
| `getDeviceInfo()` permission | Requires `data:os.device.info` in `app.json`. **Undeclared, it fails instead of returning a partial result**: `screenShape` came back `undefined` and the screen size was unknown | TESTED |
| Failure signature | With the permission missing and `px(480)` used as the size fallback, a 390 wide panel reports `390x390` - a plausible square canvas that reads as round, so the square layout silently never engaged | TESTED |
| `designWidth` | Kept at 480 for both targets, so `px()` maps the round design canvas onto the 390 width and `shared/screen-layout.js` does the rest | TESTED |

`zeus dev` overwrote `.gitignore` again on this run, as documented above. It was restored.

## Open questions (blocking)

1. Numeric `subType` for Strength Training, and whether the extension can be scoped to it.
2. Whether the extension can be restricted to Strength Training only, or must accept `[]`.
3. `LocalStorage` quota, and its write latency for a per-set save.
4. Where the Side Service can store the Liftosaur API key, and its security properties.
5. Whether the extension runs while the watch screen is off, and rest-alert delivery.
6. `onDestroy` timing guarantees and whether writes can complete inside it.
7. Device ↔ Side Service messaging API names and payload size limits.

## Sources

- [Workout Extension - Intro](https://docs.zepp.com/docs/guides/workout-extension/intro/)
- [Workout Extension - Quick Start](https://docs.zepp.com/docs/guides/workout-extension/quick-start/)
- [Workout Extension - Distribute](https://docs.zepp.com/docs/guides/workout-extension/distribute/)
- [SPORT_DATA widget](https://docs.zepp.com/docs/reference/device-app-api/newAPI/ui/widget/SPORT_DATA/)
- [getSportData](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-access/getSportData/)
- [app.json reference](https://docs.zepp.com/docs/reference/app-json/)
