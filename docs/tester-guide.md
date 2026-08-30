# Installing Lifto Companion on your watch: tester guide

This guide is for people who want to test the application. No technical skill is
required, and **you do not need a computer**: everything happens on your phone.

Allow about five minutes.

## Before you start

You need:

- A supported Amazfit watch running Zepp OS 3.6 or later (28 models supported):
  - **Round**: Active 2 (Round), Active 2 NFC (Round), Active 3 Premium, Active Edge, Active Max, Balance, Balance 2, Balance 2 XT, Balance 3, Balance 3 Ti, Balance Ultra, Cheetah (Round), Cheetah 2 Pro, Cheetah 2 Ultra, Cheetah Pro, Cheetah Pro Kelvin Kiptum, Falcon, T-Rex 3, T-Rex 3 Pro (44mm), T-Rex 3 Pro (48mm), T-Rex Ultra, T-Rex Ultra 2.
  - **Square**: Active, Active 2 (Square), Active 2 NFC (Square), Bip 6, Bip Max, Cheetah (Square).
- The **Zepp** app installed and signed in to your account with your watch paired.
- The QR code below.

## The QR code

<p align="center">
  <img src="test-build-qr.png" width="220" alt="Test build QR code" />
</p>

This code expires on **2026-09-01 at 10:02 UTC** (12:02 Central European Summer Time).

## Step 1: enable Developer Mode

Developer Mode is a standard Zepp feature for sideloading preview applications.

1. Open the **Zepp** app on your phone.
2. Tap **Profile** at the bottom right.
3. Tap **Settings** > **About**.
4. Tap the **Zepp** icon or version number **7 times** in a row until a message confirms Developer Mode is enabled.
5. Go back to **Profile** and tap your paired watch under **My Devices**.
6. Scroll down: **Developer Mode** is now visible.

Official documentation: [docs.zepp.com/docs/guides/tools/zepp-app](https://docs.zepp.com/docs/guides/tools/zepp-app/).

## Step 2: scan the QR code

1. Make sure your watch is **connected** to the Zepp app (shows as connected on the home screen).
2. In the Zepp app, go to **Profile** > your watch > **Developer Mode**.
3. Tap **+** at the top right, then choose **Scan**.
4. Scan the QR code above.

The application downloads to your phone and transfers to the watch over Bluetooth. Allow up to a minute.

## Step 3: settings and Liftosaur account (optional)

**You can skip this step.** With no API key, Lifto Companion runs in **demo mode** on sample workouts: every screen, timer, note, and transition works, and nothing is saved to any cloud account. You do not need a Liftosaur subscription to test the watch interface.

To sync with your own Liftosaur account, you need a Liftosaur Premium subscription (the cloud API is a Premium feature). Configure it **right after installing**:

### Get your API key

1. Open [liftosaur.com](https://www.liftosaur.com) or the Liftosaur mobile app.
2. Go to **Settings** > **API Keys**.
3. Copy your personal API key (starts with `lftsk_`).

### Enter it in the Zepp app

1. In the Zepp app, go to **Profile** > your watch > **Developer Mode**.
2. Open the **Mini Program** tab.
3. Next to **Lifto Companion**, tap **Settings**.
4. Paste your key into the API Key box.
5. Optional: customize your default rest timers for standard sets, supersets, and warmups.

The settings save automatically on your phone.

### How Direct Sync works

Once configured, the watch connects directly to Liftosaur Cloud:
- **Live Sync**: Workouts start on Liftosaur Cloud. Completed sets are synced in real time.
- **Cross-device Continuity**: You can view or continue the same workout on your watch or in the official Liftosaur phone app.
- **Automatic Progression**: Finishing on the watch automatically updates your history, progression rules, 1RM records, and advances to the next scheduled day.
- **Special Sets**: For timed sets (countdown timer) or custom prompted variables, the watch prompts you to log that set on the phone app; the watch then automatically adopts the result.

## Step 4: start the application

On your watch, press the side button to open the app list: **Lifto Companion** is ready to launch.

## Things to know

- **The QR code expires after 7 days** (on 2026-08-31 at 10:39 UTC for this build). This is a server limit imposed by Zepp. When it expires, visit the repository [README](../README.md) for a fresh code.
- **A new version means a new QR code.** Scanning a newer code automatically updates the app over the previous version without losing settings.
- **To uninstall**: long press the Lifto Companion icon in the watch app list and tap delete, or remove it from the Zepp app under Developer Mode.

## Troubleshooting

| Symptom | Likely cause & fix |
|---|---|
| Cannot find Developer Mode | Redo step 1 by tapping the version 7 times in Profile > Settings > About. |
| "Download failed" | The QR code expired after 7 days, check the README for a fresh code. |
| Install hangs or fails | The watch lost Bluetooth connection. Reconnect the watch in the Zepp app and retry. |
| App does not appear on watch | The watch model is not running Zepp OS 3.6 or later. |
| Watch says cannot reach account | Check that the API key starts with `lftsk_` and was entered under Settings in Developer Mode. |

## Reporting a problem

Please include:

- The **exact model** of your watch and its Zepp OS version.
- What you were doing when the issue occurred.
- A photo of the screen if something is displayed incorrectly.
