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
| `zeus login` | logged in (userID 7083308791) | TESTED |
| `zeus dev` | prompts host/port/device, then **fails to connect** to the simulator | BLOCKED |
| `zeus preview` / `zeus build` | not run | UNKNOWN |
| `npm test` | 8 app.json invariant checks, all passing (`node --test`) | TESTED |

`zeus dev` offers these simulator devices: Amazfit Falcon, T-Rex Ultra, Cheetah Pro,
Cheetah Pro Kelvin Kiptum, Cheetah (Round), Active Edge, Balance (list truncated). Active
Edge and Balance are **not** in the documented Workout Extension device list — availability
in the simulator is not evidence of Workout Extension support.

**The `-t` target must match the emulator image that is actually downloaded.** `zeus dev`
offers every known device, including ones whose image was never fetched; selecting one of
those builds a package the running emulator cannot install, and nothing appears — with no
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
| Widget window | `window.isPinned: 1` — `isPinned` exists and defaults to pinned | TESTED |
| Default subType | `subType: []` (all sports) | TESTED |
| Platform entry | `platforms: [{ "st": "r" }]`, `designWidth: 480` — `st` appears to be screen shape (`r` = round) | ASSUMED |
| i18n | Per-language widget `name` required for ~33 locales | TESTED |
| Widget entry | `DataWidget({ onInit, build, onDestroy })` — the template exposes only these three | TESTED |
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
  found in the app.json reference, the SPORT_DATA reference, or search. This is risk P0-1.
- The general [app.json reference](https://docs.zepp.com/docs/reference/app-json/) does
  **not** document the `data-widget` module at all — only Quick Start does. Treat the
  Quick Start snippet as the single source until contradicted.

## Data access

| Capability | Finding | Status | Source |
| --- | --- | --- | --- |
| `SPORT_DATA` widget | Real-time sport data display; `category` currently only `edit_widget_group_type.SPORTS`; `default_type` from `sport_data` (`@zos/ui`), includes `HR`, `DURATION_NET`, `CONSUME`, chart types | CONFIRMED | [SPORT_DATA](https://docs.zepp.com/docs/reference/device-app-api/newAPI/ui/widget/SPORT_DATA/) |
| `mock_data` | Emulator-only simulated data — the supported path for mock-first development | CONFIRMED | [SPORT_DATA](https://docs.zepp.com/docs/reference/device-app-api/newAPI/ui/widget/SPORT_DATA/) |
| `getSportData` | `@zos/app-access`, API_LEVEL 3.6, permission `data:user.hd.workout`, async callback with `{code, data}` where `data` is a JSON string | CONFIRMED | [getSportData](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-access/getSportData/) |
| `getSportData` types | `speed`, `avg_speed`, `pace`, `avg_pace`, `distance`, `duration`, `calories`, `cadence`, `avg_cadence`, `altitude`, `total_up_altitude`, `total_count`, `vertical_speed`, `downhill_count`, `total_downhill_distance` | CONFIRMED | [getSportData](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-access/getSportData/) |
| Heart rate via `getSportData` | **Not in the type list.** HR appears only as a `SPORT_DATA` widget field | UNKNOWN | — |

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
| `DataWidget` custom object properties are **not** accessible via `this` inside arrow-function callbacks — `this` is the module scope, not the DataWidget object. Mutable state must live in **module-level closure variables**. | TESTED |
| The widget renders on Active 2, a device absent from the documented six-device list | TESTED |
| The simulator renders a `data-widget` **outside** any workout | TESTED |
| A `TEXT` widget has **no** `addEventListener`: calling it throws and aborts `build()` | TESTED |
| A `FILL_RECT` **never receives** `event.CLICK_UP` — a rectangle cannot be a tap target | TESTED |
| `widget.BUTTON` with `click_func` **does** fire | TESTED |
| `setProperty(prop.MORE, …)` on a `FILL_RECT` **does** repaint it | TESTED |
| `setProperty` on a `TEXT` widget **never refreshes it** — neither `prop.TEXT`, nor `prop.MORE` with only `{text}`, nor `prop.MORE` with the full geometry | TESTED |
| ASCII hyphen/dash (`-`) is **invisible** in the Zepp OS font renderer — confirmed by bisect: `'--'` rendered as empty, `'?'` and `'N/A'` rendered correctly | TESTED |


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
incremented correctly on each tap. `prop.VISIBLE` had already been ruled out (aborts `build()`
if set before the widget is fully initialised).

Consequence for phase 1: **all dynamic text must be rendered via delete + recreate**. Keep
the widget reference in a module-level closure variable, never on `this`.

A runtime error inside `build()` aborts the rest of it **silently** — the widgets already
created stay on screen, so a half-built widget looks deliberate. Any unexplained missing
element should be read as a crash, not a layout mistake.

The tap did nothing. The probe listener added on the status text threw at runtime, which
aborted `build()` after the widgets were already drawn — so the screen looked correct while
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

## Open questions (blocking)

1. Numeric `subType` for Strength Training, and whether the extension can be scoped to it.
2. Whether the extension can be restricted to Strength Training only, or must accept `[]`.
3. Local storage API, quota, and durability guarantees on the device.
4. Where the Side Service can store the Liftosaur API key, and its security properties.
5. Whether the extension runs while the watch screen is off, and rest-alert delivery.
6. `onDestroy` timing guarantees and whether writes can complete inside it.
7. Device ↔ Side Service messaging API names and payload size limits.

## Sources

- [Workout Extension — Intro](https://docs.zepp.com/docs/guides/workout-extension/intro/)
- [Workout Extension — Quick Start](https://docs.zepp.com/docs/guides/workout-extension/quick-start/)
- [Workout Extension — Distribute](https://docs.zepp.com/docs/guides/workout-extension/distribute/)
- [SPORT_DATA widget](https://docs.zepp.com/docs/reference/device-app-api/newAPI/ui/widget/SPORT_DATA/)
- [getSportData](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-access/getSportData/)
- [app.json reference](https://docs.zepp.com/docs/reference/app-json/)
