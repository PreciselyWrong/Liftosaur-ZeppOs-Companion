# Device ↔ Side Service Protocol v1

Versioned message envelope between the Workout Extension / Device App on the watch and the
Side Service on the phone. The transport API is not yet verified — see
[zepp-capabilities.md](zepp-capabilities.md) open question 7.

## Envelope

```json
{
  "protocolVersion": 1,
  "messageId": "uuid-v4",
  "type": "PING",
  "sessionId": "uuid-v4 or null",
  "payload": {}
}
```

| Field | Rule |
| --- | --- |
| `protocolVersion` | Integer. A receiver rejects an unknown version explicitly; it never guesses. |
| `messageId` | Unique per message. An acknowledgement echoes it verbatim. |
| `type` | Enumerated below. Unknown types are rejected, not ignored. |
| `sessionId` | Present for every session-scoped message. |
| `payload` | Type-specific object. Never contains the API key. |

## Message types (v1 scope)

| Type | Direction | Purpose |
| --- | --- | --- |
| `PING` | Device → Side | Round-trip proof |
| `PONG` | Side → Device | Acknowledgement, echoes `messageId` |
| `ERROR` | either | Structured failure, redacted |

Later phases add program fetch, Playground replay, and history commit messages. They are
not defined until the round-trip is proven.

## Rules

- Every message is acknowledged exactly once. A duplicate `messageId` is acknowledged again
  but must not be processed twice.
- Out-of-order delivery is assumed possible; ordering is never inferred from arrival time.
- A dropped link produces an explicit state, never a silent retry that could duplicate work.
- No secret, token, or `Authorization` header value ever crosses this boundary.

## Required fixtures

1. Valid message.
2. Malformed message (missing `messageId`, unknown `type`, wrong `protocolVersion`).
3. Duplicate `messageId`.
4. Out-of-order pair.
5. Link cut mid-exchange, then restored.

## Status

Design only. No transport implementation exists.
