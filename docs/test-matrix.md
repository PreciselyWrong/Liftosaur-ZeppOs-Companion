# Test Matrix

Evidence is never promoted between levels. `UNIT_TESTED` means an automated contract,
`SIMULATOR_TESTED` means reproduced in the Zepp simulator, and `REAL_DEVICE_TESTED`
means reproduced on a named watch and firmware. Workout Extension hardware cases live in
[workout-extension-hardware-test-plan.md](workout-extension-hardware-test-plan.md).

| Scenario | Product | Evidence | Remaining proof |
| --- | --- | --- | --- |
| Standalone package builds with Zeus | Companion | UNIT_TESTED build contract; local build passed | none for packaging |
| Round and square layout rules | Companion | UNIT_TESTED; existing simulator evidence | named physical models |
| Live heart rate and wake lock | Companion | DOC_CONFIRMED; existing simulator evidence | named physical models |
| Extension manifest and two target shapes | Workout | DOC_CONFIRMED; UNIT_TESTED; local builds passed | install with registered App ID |
| DataWidget inside Strength Training | Workout | DOC_CONFIRMED | BLOCKED on physical watch |
| Native duration and calories | Workout | DOC_CONFIRMED; parser UNIT_TESTED | BLOCKED on physical watch |
| Native workout history | Workout | DOC_CONFIRMED ownership by Zepp | BLOCKED on physical watch |
| Protocol envelope and message routing | Both | UNIT_TESTED | physical BLE round-trip |
| Phone-only API key and redaction | Both | UNIT_TESTED | release secret scan |
| Program, next workout, and explicit day selection | Both | UNIT_TESTED | physical BLE and Cloud run |
| Current workout continuation | Both | UNIT_TESTED | physical cross-app run |
| Persist before render and ordered queue drain | Both | UNIT_TESTED | offline physical run |
| Stale snapshot and start-time conflict guards | Both | UNIT_TESTED | physical concurrent edit |
| Active-set, rest, and finish recovery | Both | UNIT_TESTED | physical crash/restart |
| Warmups, supersets, AMRAP, weight, reps, and RPE | Both | UNIT_TESTED | physical interaction |
| Absolute rest, overtime, pause, and adjustment | Both | UNIT_TESTED | physical lifecycle |
| Rest vibration while focused | Workout | UNIT_TESTED | physical haptic behavior |
| Rest vibration while unfocused | Workout | UNKNOWN | BLOCKED on physical watch |
| Liftosaur finish drains sets before clearing local data | Both | UNIT_TESTED | physical Cloud run |
| Native Zepp finish remains a separate user action | Workout | DOC_CONFIRMED; UNIT_TESTED prompt | physical user flow |
| Companion temporary preview QR workflow | Companion | UNIT_TESTED parser; published preview exists | refresh after expiry |
| Workout temporary preview QR workflow | Workout | UNIT_TESTED orchestration | BLOCKED on registered App ID and hardware |
