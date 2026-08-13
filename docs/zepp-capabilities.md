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
| `zeus dev` / `zeus preview` / `zeus build` | not run — need simulator/login | UNKNOWN |

`zeus create` is an **interactive wizard and requires a TTY**. The documented
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
