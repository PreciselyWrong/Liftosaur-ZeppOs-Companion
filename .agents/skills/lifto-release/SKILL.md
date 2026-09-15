---
name: lifto-release
description: Publish or refresh Lifto Companion and Lifto Workout releases with verified Zepp preview QR assets. Use in this repository when asked to release, publish, renew expired QR codes, inspect release readiness, or explain the beta release workflow. Do not use for Zepp Store submission or ordinary development builds.
---

# Lifto Release

Treat `publish.ps1` as the only release executor. Do not reproduce its Git, build, QR, or GitHub mutations manually.

## Select the mode

- Readiness or dry run: run `.\publish.ps1 -Plan -NonInteractive`.
- New version: complete the release gate, then run the confirmed publication command.
- Expired QR codes for the current version: use the same confirmed publication command. The script refreshes both assets and their marked metadata block without changing the tag or generated change notes.
- Different code under an existing tag: stop and bump the version. Never move a published tag.

## Apply the release contract

- `package.json` owns the version. `app.json` must match it; generated Workout manifests derive from it.
- Every `0.x.y` version is beta and must be a GitHub pre-release. A `1.0.0` release is forbidden until the physical-watch gate in `AGENTS.md` is cleared.
- GitHub Releases are the public release history. Do not create or update `CHANGELOG.md`.
- Let GitHub generate notes from merged pull requests. Keep pull-request titles user-facing, English, ASCII-only, and specific enough to stand alone in release notes.
- Do not add `.github/release.yml` unless maintainers later need label-based categories or exclusions. It is not required to generate notes.
- Publish exactly `lifto-companion-qr.png` and `lifto-workout-qr.png`. Record each QR validity date and time in the release body as an ISO 8601 timestamp with UTC offset. Never commit expiring QR files or expiry dates.
- Use only the registered public App IDs already enforced by the project: Companion `1123411`, Workout `1125789`.

## Gate a publication

1. Read `AGENTS.md`, `package.json`, `app.json`, and the current Git state. Do not infer a version or validation result.
2. Require clean `main` at the exact intended commit with all work merged.
3. Run `.\publish.ps1 -Plan -NonInteractive` and inspect the version, pre-release status, checks, builds, assets, and destination.
4. Run `/public-release-audit` against the exact `HEAD`. Do not substitute a normal secret scan for this gate.
5. Verify GitHub CLI and Zeus CLI authentication. If either session is invalid, stop and state the exact login action needed.
6. Run `.\publish.ps1 -NonInteractive -Confirm -AuditedCommit <HEAD>`.

The confirmed command is expected to test, scan, build both products, generate both QR codes, push `main`, create or refresh `v<version>`, and read the result back from GitHub. Do not publish if any earlier step fails.

## Verify the outcome

Accept the release only when the script prints `PUBLISH_OK`. It must have verified:

- `origin/main` equals the audited commit;
- the remote tag points to that commit;
- the release is published with the correct beta/stable state;
- both QR assets exist and are non-empty;
- the installation block references both stable release-asset URLs and their exact validity date and time;
- a QR refresh replaced only the marked QR metadata block and preserved the generated change notes.

If the script creates a draft and then fails, report it precisely. Rerun only after fixing the cause; the script may repair a mutable draft. If GitHub marks a release immutable, bump the version instead of replacing its assets.

## Report concisely

Return the version, release URL, beta/stable state, both asset names, both validity timestamps, and the checks that passed. If blocked, give the failed gate and one concrete next action. Never claim publication from a successful build alone.
