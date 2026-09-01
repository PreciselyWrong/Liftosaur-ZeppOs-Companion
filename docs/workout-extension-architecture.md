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

The standalone page and the extension renderer have distinct lifecycle and interaction adapters. They share the session model, serialization, Cloud protocol and refresh policy. The extension must not import the standalone renderer.

The extension uses a separate App ID, settings namespace and Side Service installation. Its API key remains on the paired phone. It never passes through watch storage, a protocol payload or a handoff record. The authoritative shared running workout is loaded from Liftosaur Cloud.

Every set is persisted before rendering and queued before asynchronous sync. The session stores `restStartedAt`, `restDuration` and `restEndsAt`; a display tick is not authoritative. On focus return the adapter recomputes the timer and clears obsolete notifications. Finish only clears local data after Liftosaur confirms completion. Native Zepp finish remains a user action.
