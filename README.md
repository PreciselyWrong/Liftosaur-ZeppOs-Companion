# Liftosaur for Zepp OS

Standalone [Liftosaur](https://www.liftosaur.com) workout tracking client for Amazfit smartwatches running Zepp OS (target: Amazfit Active 2 and compatible round watches).

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Zepp OS](https://img.shields.io/badge/Zepp%20OS-3.6%2B-purple.svg)
![Tests](https://img.shields.io/badge/tests-48%20passing-brightgreen.svg)

---

## Features

- **Apple Watch UI Parity**: Clean, circular-optimized workout interface with official Liftosaur color palette and typography.
- **Interleaved Supersets**: Automatic alternating progression between superset pairs (`A1 -> A2 -> A1 -> A2`).
- **Live Heart Rate**: Real-time sensor integration via `@zos/sensor` HeartRate.
- **Rest Timer & Overtime**: Live countdown with haptic vibration at zero, negative overtime counter, and target exercise badge.
- **Display Wake Lock**: Keeps the screen active and responsive during active workouts (`@zos/display`).
- **Offline Durability & Journaling**: Append-only local session store (`SESSION_STORAGE`). Zero data loss on disconnect or restart.
- **Dynamic Cloud Sync & Playground**: Asynchronous non-blocking BLE synchronization with Liftosaur Cloud via Side Service.
- **Conflict & Idempotency Protection**: Safe history submission with duplicate suppression and program conflict detection.
- **Mobile Settings App**: Configure your personal Liftosaur API Key (`lftsk_...`) directly from the Zepp mobile app.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                      Amazfit Watch                      │
│                                                         │
│  page/common/index.js (UI / Touch / Gestures)          │
│       │                                                 │
│       ▼                                                 │
│  shared/workout-session.js (Pure State Machine)         │
│       │                                                 │
│       ▼                                                 │
│  shared/session-storage.js (Local Journal Persistence)  │
└───────────────────────────┬─────────────────────────────┘
                            │ BLE / ZML Protocol v1
┌───────────────────────────▼─────────────────────────────┐
│                    Mobile Side Service                  │
│                                                         │
│  app-side/router.js (Message Dispatch & Idempotency)    │
│  app-side/liftosaur-api-client.js (HTTPS Client)        │
│  setting/index.js (Mobile Settings UI for API Key)      │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTPS / REST
┌───────────────────────────▼─────────────────────────────┐
│                    Liftosaur Cloud                      │
│             https://www.liftosaur.com/api               │
└─────────────────────────────────────────────────────────┘
```

---

## Development & Testing

### Requirements
- Node.js 20+
- [Zeus CLI](https://docs.zepp.com/docs/guides/tools/zeus-cli/) `npm install -g @zeppos/zeus-cli`

### Running Unit Tests
```bash
npm test
```

### Running on Simulator or Real Device
```bash
# Preview on emulator
zeus dev -t "Amazfit Active 2 (Round)"

# Generate QR code for real device testing
zeus preview -t "Amazfit Active 2 (Round)"
```

---

## License

MIT
