# Workout Extension Architecture

```text
DataWidget renderer
  -> extension lifecycle adapter
  -> shared session controller and workout session
  -> versioned extension storage
  -> protocol v3
  -> extension Side Service
  -> Liftosaur Cloud

System Workout owns recording and history
  -> getSportData adapter
  -> native metric view model
```

The standalone page and the extension renderer have distinct lifecycle and interaction adapters. They share `workout-controller.js` for local workout state, persistence, Cloud synchronization, polling, conflict handling, finish and discard, plus the session model and protocol. The extension must not import the standalone renderer.

The extension uses a separate App ID, settings namespace and Side Service installation. Its API key remains on the paired phone. It never passes through watch storage, a protocol payload or a handoff record. The authoritative shared running workout is loaded from Liftosaur Cloud.

The DataWidget renders loading, program/week/day selection, ready, active set, rest, overview, notes, finish and explicit recovery states inside one click-only page. It uses the separate `liftosaur.extension.session.v2` storage key and never imports the standalone renderer.

Every set is persisted before rendering and queued before asynchronous sync. Rest uses the controller's absolute end time; a display tick is not authoritative. Zepp pauses the extension when it loses focus, so the unit-tested fallback checks the absolute deadline on resume and alerts once. Durable background vibration remains `UNKNOWN`. Finish only clears local data after Liftosaur confirms completion. Native Zepp finish remains a user action.
