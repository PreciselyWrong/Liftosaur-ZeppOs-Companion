# Privacy Policy - Lifto Companion

Last updated: 15 August 2026.

Lifto Companion is an unofficial, open-source client for the public Liftosaur Cloud API,
running on Amazfit watches with Zepp OS. This policy describes every piece of data the
application handles.

## Who runs this application

Lifto Companion has no server, no backend and no analytics. There is no operator collecting
data: the application runs entirely on your watch and on your phone, and talks only to
Liftosaur's own servers.

## What the application handles

| Data | Where it is stored | Where it is sent | Why |
| --- | --- | --- | --- |
| Your Liftosaur API key (`lftsk_...`) | Zepp app settings storage on your phone only | `https://www.liftosaur.com` only, as an `Authorization` header | It is the only way to reach your Liftosaur account |
| Your programs, workouts and history | Read from Liftosaur; the session in progress is kept in watch local storage | Written back to your own Liftosaur account | This is the purpose of the application |
| Heart rate during a session | Watch memory only, for the duration of the session | Nowhere | Displayed live on the workout screen |
| Rest timer preferences | Zepp app settings storage on your phone | Nowhere | Used when a program leaves a timer blank |

## What the application never does

- The API key is never transmitted to the watch, never sent over the Bluetooth link, and
  never written to any log or diagnostic output. It stays on the phone, inside the Zepp
  Side Service, which is the only component that performs HTTPS requests.
- Heart rate is never transmitted anywhere. It is not written to your Liftosaur history,
  not stored between sessions, and not shared with any third party.
- No data is sent to any server other than `https://www.liftosaur.com`.
- No advertising, no tracking, no analytics, no crash reporting to a third party.

## Third party

Your workout data is stored in your Liftosaur account, and its handling is governed by
Liftosaur's own privacy policy at <https://www.liftosaur.com>. This application is not
affiliated with, maintained by, or endorsed by Liftosaur or its author.

## Deleting your data

Open the settings page of the application in the Zepp app and use "Disconnect / Clear Key".
This removes the API key from your phone. Uninstalling the application removes any session
still stored on the watch. Workouts already written to your Liftosaur account are deleted
from Liftosaur itself, not from here.

## Permissions the application requests

| Permission | Used for |
| --- | --- |
| `data:user.hd.heart_rate` | Showing your live heart rate during a workout |
| `device:os.local_storage` | Keeping the session on the watch so a crash or a restart cannot lose it |
| `data:os.device.info` | Reading the screen size so the layout fits round and square watches |

## Children

The application is not directed at children under 13 and collects nothing from them.

## Changes

Any change to this policy is published in this file, in the public repository, with an
updated date at the top.

## Contact

Open an issue in the project repository.
