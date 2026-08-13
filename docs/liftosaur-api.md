# Liftosaur REST API

Contract register for the public Liftosaur Cloud API. Liftosaur is immutable and external:
only documented public interfaces are used.

Source: [Liftosaur REST API documentation](https://www.liftosaur.com/doc/api). Research date: 2026-08-13.

## Access

| Item | Value | Status |
| --- | --- | --- |
| Base URL | `https://www.liftosaur.com/api/v1` | CONFIRMED |
| Auth | `Authorization: Bearer <key>` | CONFIRMED |
| Key format | `lftsk_…` | CONFIRMED |
| Requirement | Premium subscription | CONFIRMED |
| Rate limits | not documented | UNKNOWN |
| Idempotency keys | not documented — assume none | UNKNOWN |

The key lives on the phone, inside the Side Service, and must never reach the watch or a log.

## Endpoints used by this project

### Programs

| Method | Path | Body | Response | Errors |
| --- | --- | --- | --- | --- |
| GET | `/programs` | — | program list with id, name, active flag | 401, 403 |
| GET | `/programs/:id` or `/programs/current` | — | name, Liftoscript source text, active flag | 401, 403, 404 |
| PUT | `/programs/:id` or `/programs/current` | `{text?, name?}` | updated program | 401, 403, 404, 422 |

`GET /programs/current` is the entry point for a session. `PUT` is progression write-back
(phase 5) and is the conflict-prone call: there is no documented ETag or version field, so
the base program text must be hashed locally and compared before writing.

### History

| Method | Path | Body | Response | Errors |
| --- | --- | --- | --- | --- |
| GET | `/history` | query `limit`, `startDate`, `endDate`, `cursor` | records + pagination | 401, 403 |
| GET | `/history/:id` | — | one record | 401, 403, 404 |
| POST | `/history` | `{text}` in Liftoscript Workouts format | created record with id | 401, 403, 400, 422 |

`POST /history` is **not idempotent and has no idempotency key**. A lost response means
`UNKNOWN_COMMIT_STATE`: the client must search `GET /history` for the expected record
before any retry. See [risks.md](risks.md) P0-3.

### Playground

| Method | Path | Body | Response | Errors |
| --- | --- | --- | --- | --- |
| POST | `/playground` | `{programText, day?, week?, commands[]}` | workout text, and updated program text when `finish_workout()` ran | 401, 403, 422 |

Commands: `complete_set()`, `change_weight()`, `change_reps()`, `change_rpe()`,
`set_state_variable()`, `finish_workout()`.

Playground is the single source of truth for Liftoscript evaluation and progression. This
project never reimplements those calculations. The local event journal decides which sets
are done; Playground recomputes only future sets and the progression at finish time.

### Supporting endpoints (later phases)

- `POST /program-stats` — `{programText}` → days, set breakdown, muscle volume/frequency.
- `/gyms`, `/gyms/:gymId/equipment` — plate and bar configuration for weight rounding.
- `/exercise-data/:key` — `rm1`, `rounding`, `equipment`, unilateral flag.
- `/measurements` — out of scope for V1.

## Unknowns

1. Exact JSON shape of a program and a history record (only field names are documented).
2. Exact Liftoscript Workouts text format expected by `POST /history`.
3. How warmups and supersets appear in Playground output — must be probed with fixtures.
4. Whether `day`/`week` are required to select the correct upcoming session.
5. Error body shape for 4xx responses.
6. Rate limits, timeouts, and retry guidance.

All six must be captured as redacted fixtures before any client code is written.

## Rules

- Every HTTP call goes through `LiftosaurApiClient`. No `fetch()` anywhere else.
- Mock mode is the default. Real writes require explicit opt-in and a controlled scenario.
- `Authorization`, `Bearer`, and `lftsk_*` are redacted from all logs and diagnostics.
