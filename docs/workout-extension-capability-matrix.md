# Workout Extension Capability Matrix

| Capability | Required API | Proof | Fallback |
| --- | --- | --- | --- |
| Strength Training placement | `data-widget.runtime.ability`, `subType: [52]` | DOC_CONFIRMED | no widget outside Strength Training |
| Click interaction | `widget.BUTTON.click_func` | DOC_CONFIRMED | no gesture or physical button dependency |
| Workout lifecycle | `onInit`, `build`, `onResume`, `onPause`, `onDestroy` | DOC_CONFIRMED | recompute state after resume |
| Native duration and calories | `getSportData`, `data:user.hd.workout` | DOC_CONFIRMED | hide unavailable metrics |
| Native workout recording | system Workout app | DOC_CONFIRMED | do not control it |
| Cloud sync | Side Service and protocol v3 | UNIT_TESTED | durable local queue |
| Rest while unfocused | no durable public mechanism confirmed | UNKNOWN | absolute timer plus on-resume warning |
| Extension App ID | Developer Console | DOC_CONFIRMED | development environment variable |
| Real workout context | supported physical watch | BLOCKED | hardware test plan |
