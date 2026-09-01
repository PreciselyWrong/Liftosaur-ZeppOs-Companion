# Workout Extension Capability Matrix

Evidence vocabulary: `DOC_CONFIRMED`, `UNIT_TESTED`, `BLOCKED`, `UNKNOWN`.

| Capability | Required API | Proof | Fallback |
| --- | --- | --- | --- |
| Strength Training placement | `data-widget.runtime.ability`, `subType: [52]` | DOC_CONFIRMED | no widget outside Strength Training |
| Click interaction | `widget.BUTTON.click_func` | DOC_CONFIRMED | no gesture or physical button dependency |
| Workout lifecycle | `onInit`, `build`, `onResume`, `onPause`, `onDestroy` | DOC_CONFIRMED | recompute state after resume |
| Native duration and calories | `getSportData`, `data:user.hd.workout` | DOC_CONFIRMED | hide unavailable metrics |
| Native workout recording | system Workout app | DOC_CONFIRMED | do not control it |
| Native workout start/stop | no public control API | DOC_CONFIRMED | user manually finishes in Zepp Workout |
| Cloud sync and recovery | Side Service, protocol v3 and shared controller | UNIT_TESTED | durable local queue and explicit conflict UI |
| Click-only workout screens | `widget.BUTTON.click_func` and shared controller | UNIT_TESTED | phone-required prompt for unsupported set inputs |
| Rest while focused | absolute controller deadline and `Vibrator` | UNIT_TESTED | visual overtime state |
| Rest while unfocused | no durable public background timer confirmed | UNKNOWN | absolute timer plus one alert on resume |
| Dedicated extension App ID | Zepp Developer Console | DOC_CONFIRMED | development environment variable |
| Extension storage namespace | `LocalStorage` (`liftosaur.extension.session.v2`) | UNIT_TESTED | in-memory fallback adapter |
| Separate phone settings | `settingsStorage` per App ID | DOC_CONFIRMED | manual setup in Zepp app |
| Real workout context | supported physical watch | BLOCKED | hardware test plan |
