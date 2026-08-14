# Installing Liftosaur on your watch: tester guide

This guide is for people who want to test the application. No technical skill is
required, and **you do not need a computer**: everything happens on your phone.

Allow about five minutes.

## Before you start

You need:

- One of the supported Amazfit watches, already paired with your phone:

  - Active 2
  - Active Max
  - Balance 2
  - Balance 2 XT
  - Cheetah 2 Ultra
  - T-Rex 3 Pro (44mm)
  - T-Rex 3 Pro (48mm)

- The **Zepp** app installed and signed in to your account.
- The QR code that was sent to you.

> **Any watch not in that list is unsupported today**, including Bip 6 and every
> other rectangular screen model, and including older round models that predate
> Zepp OS 3.6. There is no point trying: the install will fail or the display
> will be unusable.

## Step 1: enable Developer Mode

Developer Mode is a hidden setting in the Zepp app. Its only purpose here is to
allow installing an application that does not come from the official store.

Follow the official instructions from Zepp:
[docs.zepp.com/docs/guides/tools/zepp-app](https://docs.zepp.com/docs/guides/tools/zepp-app/).

Once it is enabled, Developer Mode appears under **Device** > **General**.

## Step 2: scan the QR code

1. Make sure your watch is **connected** to the Zepp app. It must show as
   connected on the home screen, not as offline.
2. In the Zepp app, go to **Device** > **General** > **Developer Mode**.
3. Tap **+** at the top right, then choose **Scan**.
4. Scan the QR code.

The install starts and transfers to the watch. Depending on the connection,
allow up to a minute.

## Step 3: enter your Liftosaur API key

Do this **right after the install**, before opening the application on the
watch. Without the key the application cannot reach your account.

First get the key:

1. Open [liftosaur.com](https://www.liftosaur.com) or the Liftosaur app.
2. Go to **Settings** > **API Keys**.
3. Copy your personal API key. It starts with `lftsk_`.

Then enter it:

1. In the Zepp app, go back to **Device** > **General** > **Developer Mode**.
2. Open the **Mini Program** tab.
3. Next to Liftosaur, tap **Settings**.
4. Tap the API key box and paste your key.

The page confirms once the key is saved.

## Step 4: start the application

On the watch, open the application list: **Liftosaur** is there.

## Things to know

**The QR code expires after 7 days.** This is not a failure: past that delay the
link stops working and you need to ask for a new one. The same QR code works for
everybody and on every supported model, as many times as needed while it is
valid.

**A new version means a new QR code.** Just scan the new one; the application
updates over the previous install.

**To uninstall**, long press the application icon on the watch, or remove it
from the installed applications list in the Zepp app.

## If it does not work

| Symptom | Likely cause |
|---|---|
| Scanning does nothing | Developer Mode is not enabled, redo step 1 |
| "Download failed" | The QR code expired after 7 days, ask for a new one |
| The install hangs | The watch is disconnected, check Bluetooth and retry |
| The application does not appear on the watch | Unsupported model (rectangular screen) |
| The screen is cropped or misaligned | Unsupported model, report it with the exact model name |
| The watch says it cannot reach your account | The API key is missing or wrong, redo step 3 |

## Reporting a problem

Please include:

- The **exact model** of your watch and its Zepp OS version.
- What you were doing when the problem happened.
- A photo of the screen if something is displayed incorrectly.
