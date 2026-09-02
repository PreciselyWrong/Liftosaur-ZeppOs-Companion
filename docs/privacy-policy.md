# Privacy Policy - Lifto Companion and Lifto Workout

Last updated: 1 September 2026.

Lifto Companion and Lifto Workout are unofficial, open-source clients for the public
Liftosaur Cloud API on Amazfit smartwatches with Zepp OS. Companion is a standalone app.
Workout is a separate extension inside the native Zepp Workout app. This policy describes
the data handled by both products.

## Who runs this application

These applications have no dedicated server, no backend, and no analytics service. There is no
intermediary operator collecting your data: the application runs entirely on your watch and phone,
communicating directly with Liftosaur's official servers.

## What the application handles

| Data | Where it is stored | Where it is sent | Why |
| --- | --- | --- | --- |
| Your Liftosaur API key (`lftsk_...`) | Each installed product's Zepp settings storage on your phone only | `https://www.liftosaur.com` only, as an `Authorization` header | Authenticates your Liftosaur account |
| Client Installation ID (`X-Liftosaur-Device-Id`) | Each installed product's Zepp settings storage on your phone only | `https://www.liftosaur.com` only, as an `X-Liftosaur-Device-Id` header | Anonymous random identifier created once to coordinate active workout synchronization |
| Your programs, workouts and active session | Read from Liftosaur Cloud; active session cached in that product's watch local storage | Synced directly to your own Liftosaur Cloud account | Delivers workout tracking and applies progression |
| Heart rate in Lifto Companion | Watch memory only, during the session | Nowhere | Displayed live on the standalone workout screen |
| Native duration and calories in Lifto Workout | Read live from the active Zepp workout; watch memory only | Nowhere by Lifto Workout | Displayed in the Workout Extension |
| Rest timer preferences | Read from Liftosaur Cloud | Nowhere else | Used when a workout set does not specify its own timer |

## What the application never does

- The API key is never transmitted to the watch, never sent over the Bluetooth link, and never written to any log or diagnostic export. It stays strictly inside the phone Side Service.
- Companion heart rate and Workout's native duration and calories are never sent to Liftosaur, logged, or stored between Lifto sessions.
- No data is sent to any server other than `https://www.liftosaur.com`.
- No advertising, tracking, third-party analytics, or remote crash reporters are included.

## Third party

Your workout data is stored in your Liftosaur account, and its handling is governed by
Liftosaur's privacy policy at <https://www.liftosaur.com>. This application is independent
and is not affiliated with, maintained by, or endorsed by Liftosaur or its author.

## Deleting your data

Open the settings page of each installed Lifto product in the Zepp app and tap
"Disconnect / Clear Key". This removes that product's API key and installation ID from your
phone. Uninstalling a product removes its active session cached on the watch. Workouts already
synced to your Liftosaur account are managed and deleted from Liftosaur directly. Native Zepp
workout history is managed separately through Zepp's own controls and privacy terms.

## Permissions the application requests

| Permission | Used for |
| --- | --- |
| `data:user.hd.heart_rate` | Showing your live heart rate during a workout |
| `data:user.hd.workout` | Reading active native duration and calories in Lifto Workout |
| `device:os.local_storage` | Keeping the active workout on the watch so an app restart or crash does not lose state |
| `data:os.device.info` | Reading screen dimensions to adapt the layout for round and square watches |

## Children

The application is not directed at children under 13 and collects no information from them.

## Changes

Any change to this policy is published in this file in the public repository, with an updated date.

## Contact

Open an issue in the project repository.
