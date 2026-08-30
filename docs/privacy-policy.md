# Privacy Policy - Lifto Companion

Last updated: 30 August 2026.

Lifto Companion is an unofficial, open-source client for the public Liftosaur Cloud API,
running on Amazfit smartwatches with Zepp OS. This policy describes all data handled
by the application.

## Who runs this application

Lifto Companion has no dedicated server, no backend, and no analytics service. There is no
intermediary operator collecting your data: the application runs entirely on your watch and phone,
communicating directly with Liftosaur's official servers.

## What the application handles

| Data | Where it is stored | Where it is sent | Why |
| --- | --- | --- | --- |
| Your Liftosaur API key (`lftsk_...`) | Zepp app settings storage on your phone only | `https://www.liftosaur.com` only, as an `Authorization` header | Authenticates your Liftosaur account |
| Client Installation ID (`X-Liftosaur-Device-Id`) | Zepp app settings storage on your phone only | `https://www.liftosaur.com` only, as an `X-Liftosaur-Device-Id` header | Anonymous random identifier created once to coordinate multi-device active workout synchronization |
| Your programs, workouts and active session | Read from Liftosaur Cloud; active session cached in watch local storage | Synced directly to your own Liftosaur Cloud account | Delivers workout tracking and applies progression |
| Heart rate during a session | Watch memory only, during the session | Nowhere | Displayed live on the workout screen |
| Rest timer preferences | Read from Liftosaur Cloud | Nowhere else | Used when a workout set does not specify its own timer |

## What the application never does

- The API key is never transmitted to the watch, never sent over the Bluetooth link, and never written to any log or diagnostic export. It stays strictly inside the phone Side Service.
- Heart rate is never transmitted anywhere. It is not written to your Liftosaur history, not stored between sessions, and not shared with any third party.
- No data is sent to any server other than `https://www.liftosaur.com`.
- No advertising, tracking, third-party analytics, or remote crash reporters are included.

## Third party

Your workout data is stored in your Liftosaur account, and its handling is governed by
Liftosaur's privacy policy at <https://www.liftosaur.com>. This application is independent
and is not affiliated with, maintained by, or endorsed by Liftosaur or its author.

## Deleting your data

Open the settings page of the application in the Zepp app and tap "Disconnect / Clear Key".
This removes the API key and device installation ID from your phone. Uninstalling the application
removes any active session still cached on the watch. Workouts already synced to your Liftosaur
account are managed and deleted from Liftosaur directly.

## Permissions the application requests

| Permission | Used for |
| --- | --- |
| `data:user.hd.heart_rate` | Showing your live heart rate during a workout |
| `device:os.local_storage` | Keeping the active workout on the watch so an app restart or crash does not lose state |
| `data:os.device.info` | Reading screen dimensions to adapt the layout for round and square watches |

## Children

The application is not directed at children under 13 and collects no information from them.

## Changes

Any change to this policy is published in this file in the public repository, with an updated date.

## Contact

Open an issue in the project repository.
