# Risks

P0 risks block the phase gate. Each risk carries an owner, a mitigation, and the gate that
closes it.

## P0-1 - Strength Training subType code is unknown

The `runtime.ability[].subType` array takes numeric sport codes, but no public enumeration
of those codes was found. If Strength Training cannot be targeted, the extension appears in
the wrong sports or in all of them.

- Mitigation: probe the Zepp OS Simulator and official samples; fall back to `[]` plus a
  runtime guard only if scoping proves impossible.
- Gate: extension visible in Strength Training and nowhere else, on a real device.
- Status: OPEN, BLOCKED on toolchain install.

## P0-2 - API key exposure

The key (`lftsk_*`) grants full account access, including deletes.

- Mitigation: key confined to the Side Service; redaction of `Authorization`, `Bearer`, and
  `lftsk_*` in every log path, enforced by a test.
- Gate: redaction test passes and no key appears in any diagnostic export.
- Status: OPEN.

## P0-3 - Ambiguous POST /history

`POST /history` is not idempotent and has no idempotency key. A timeout may mean the record
was created.

- Mitigation: on ambiguity, enter `UNKNOWN_COMMIT_STATE`; query `GET /history` for the
  expected record before any retry.
- Gate: fault-injection test - response dropped after server-side success produces exactly
  one history record.
- Status: OPEN.

## P0-4 - Program conflict on progression write-back

`PUT /programs/current` has no documented version or ETag. A program edited elsewhere during
the session would be silently overwritten.

- Mitigation: hash the base program text at session start; compare before writing; on
  mismatch, surface an explicit conflict and keep base, remote, and local versions.
- Gate: conflict scenario test never overwrites a changed remote program.
- Status: OPEN.

## P0-5 - Unknown target hardware

`TARGET_WATCH_MODEL = UNKNOWN`. Screen shape, resolution, firmware, and Workout Extension
availability are all unverified. The documented device list covers six Amazfit models only.

- Mitigation: no compatibility claim from `API_LEVEL` alone; maintain the device matrix in
  [test-matrix.md](test-matrix.md).
- Gate: one real device confirmed and recorded.
- Status: OPEN.

## P0-6 - No text widget can be updated in place

`setProperty` never refreshes a `TEXT` widget in a `data-widget`, and a `FILL_RECT` receives
no taps. Phase 1 needs live weight, reps, RPE and a rest countdown, so the whole screen
composition depends on finding a working update mechanism.

- Mitigation: probe `deleteWidget` + `createWidget`, and pre-created texts toggled with
  `prop.VISIBLE`. Whichever works becomes a documented UI primitive, used everywhere.
- Gate: a value visibly changes on tap in the simulator, and the rest countdown updates
  once per second without leaking widgets.
- Status: OPEN, being probed.

## P1 - Session loss on crash or restart

- Mitigation: persist every critical event before rendering; replay on start; offer
  `RESUME` / `DISCARD`.
- Gate: restart during set, rest, and finalisation all recover without loss.

## P1 - Rest alert outside focus

Whether the extension can alert when unfocused or with the screen off is unproven.

- Mitigation: dedicated spike in `rest-alert-spike.md` before any promise to the user.
- Gate: real-device evidence, not emulator.

## P1 - Double tap producing two business events

- Mitigation: debounce `COMPLETE_SET` at the event layer, not the UI layer.
- Gate: two rapid taps yield exactly one journal event.

## P2 - Playground output shape for warmups and supersets

- Mitigation: targeted fixtures before parser work; never assume indices.
