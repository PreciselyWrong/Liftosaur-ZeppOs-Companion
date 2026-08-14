# Rest Alert Spike

Goal: decide whether a rest-timer alert can be delivered reliably, **before** promising it to
the user. Nothing here is implemented yet; this document defines what must be observed.

The Workout Extension is a plug-in inside the system Workout app. It is not guaranteed to
be focused, foreground, or even running when `restEndsAt` is reached. Every scenario below
must therefore be answered with real-device evidence - the emulator cannot settle any of
the screen-off or wrist-down cases.

## Scenarios to observe

| # | Scenario | Question | Emulator | Real device |
| --- | --- | --- | --- | --- |
| 1 | Extension focused, screen on | Does the alert fire at `restEndsAt`? | ⬜ | ⬜ |
| 2 | Extension unfocused, another Workout page shown | Does the widget still run, and can it alert? | ⛔ | ⬜ |
| 3 | Screen off, wrist down | Does code run at all? Is the alert queued or lost? | ⛔ | ⬜ |
| 4 | Screen off, then raised after `restEndsAt` | Late alert, or silent miss? | ⛔ | ⬜ |
| 5 | User starts the next set early | Is the pending alert cancelled? | ⬜ | ⬜ |
| 6 | Workout ended during rest | Is the alert suppressed? | ⬜ | ⬜ |
| 7 | System Workout auto-paused | Does the extension observe the pause? | ⛔ | ⬜ |
| 8 | Alert while phone is disconnected | Watch-local, or does it need the phone? | ⬜ | ⬜ |

## Unknowns that gate the design

1. Whether a Workout Extension keeps executing when unfocused. `onPause` exists, but
   whether timers survive it is undocumented.
2. Whether any vibration/haptic API is reachable from a `data-widget` context, and under
   which permission.
3. Whether a scheduled alarm or timer API exists that survives screen-off, or whether the
   only option is polling while focused - which the project forbids.
4. Whether the system Workout itself already vibrates on its own events, and whether a
   second source would be confusing or suppressed.

## Fallback ladder

If the scenarios fail, degrade explicitly rather than silently:

1. **Full** - alert fires at `restEndsAt` regardless of focus or screen state.
2. **Focused only** - alert fires only while the extension is visible; the UI states this
   plainly instead of implying a background alert.
3. **Visual catch-up** - no alert; on resume, the screen shows rest elapsed and overdue
   time, derived from `restEndsAt`.
4. **None** - the feature is dropped from V1 and recorded as such.

Level 3 must work in every case, because it depends only on absolute-time arithmetic
(ADR-004) and not on any background capability.

## Exit criteria

The spike closes when each scenario has a real-device result and the fallback level is
chosen and recorded as an ADR. Until then, no user-facing text may promise a rest alert.
