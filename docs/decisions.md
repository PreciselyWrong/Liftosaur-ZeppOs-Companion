# Architecture Decision Records

Each ADR carries status, context, decision, alternatives, consequences, and evidence.
Status is one of `PROPOSED`, `ACCEPTED`, `BLOCKED`, `SUPERSEDED`.

## ADR-001 - Liftosaur Cloud stays the source of truth

**Status:** ACCEPTED

**Context.** Liftoscript evaluation and progression are non-trivial and live in Liftosaur.
Reimplementing them would fork behaviour and drift.

**Decision.** The watch never evaluates Liftoscript. `POST /playground` computes upcoming
sets and progression. This project is an integration, not a reimplementation.

**Alternatives.** Local Liftoscript interpreter - rejected: drift risk, AGPL exposure,
watch runtime constraints.

**Consequences.** Full offline programme evaluation is impossible; the local journal must
carry the session until the phone is reachable.

**Evidence.** [liftosaur-api.md](liftosaur-api.md) - Playground endpoint and commands.

## ADR-002 - The Side Service is the only gateway to the cloud

**Status:** ACCEPTED

**Context.** The API key grants full account access, including deletes. The watch is the
least trustworthy and least observable place to hold it.

**Decision.** The key is entered and stored on the phone. All HTTPS goes through
`LiftosaurApiClient` in the Side Service. Nothing secret crosses BLE.

**Alternatives.** Key on the watch - rejected outright. Third-party proxy - rejected: out
of scope, adds an operator.

**Consequences.** Every cloud action depends on phone reachability; the protocol must carry
every request/response pair explicitly.

**Evidence.** [risks.md](risks.md) P0-2.

## ADR-003 - Persist before render, sync afterwards

**Status:** ACCEPTED

**Context.** Crashes, disconnections, and ambiguous responses must never lose a set.

**Decision.** Every critical event is appended to a durable local journal before the UI
updates. Synchronisation is asynchronous and never blocks a gesture.

**Alternatives.** Write-through to cloud on each set - rejected: unusable latency, no
offline path.

**Consequences.** Replay logic and a recovery flow (`RESUME` / `DISCARD` / `RETRY`) are
mandatory, not optional polish.

## ADR-004 - Absolute-time rest timers

**Status:** ACCEPTED

**Context.** Widget lifecycle (`onPause`, screen off) can suspend tick counters.

**Decision.** Rest is stored as `restStartedAt`, `restDuration`, `restEndsAt`. Remaining
time is always derived from the current clock.

**Consequences.** Clock changes must be considered; ticks are display-only.

## ADR-005 - Target watch model

**Status:** BLOCKED

**Context.** Workout Extension requires Zepp OS 3.5 / API_LEVEL 3.6 and is documented for
six Amazfit models. No target device has been designated.

**Decision.** Deferred. No compatibility claim is made until a model, firmware, and screen
geometry are recorded.

**Evidence.** [zepp-capabilities.md](zepp-capabilities.md), [risks.md](risks.md) P0-5.

## ADR-006 - Licensing boundary with Liftosaur

**Status:** PROPOSED

**Context.** Liftosaur is AGPL-3.0. This repository is intended to be public.

**Decision.** No Liftosaur source is copied. Its code may be read only to understand
undocumented behaviour, with provenance noted and no transplantation. A licence for this
repository must be chosen before the first public push.

**Consequences.** Open item on the release gate - the repository currently has no LICENSE
file.
