# Installing Lifto Companion on your watch: tester guide

This guide is for people who want to test the application. No technical skill is
required, and **you do not need a computer**: everything happens on your phone.

Allow about five minutes.

## Before you start

You need:

- An Amazfit watch running Zepp OS 3.6 or later, already paired with your phone.
  The builds are produced for **Amazfit Active 2 (Round)** and **Amazfit Bip 6**;
  those are the two models known to work. Another watch of the same screen shape
  may well accept the build, and reporting whether it did is useful.

- The **Zepp** app installed and signed in to your account.
- The QR code that was sent to you.

> **There are two QR codes, one per screen shape.** The round build does not
> install on a square watch and the square build does not install on a round
> one, so make sure you were sent the one matching your watch. Both are in the
> [README](../README.md), which always carries the current pair.

## The QR codes

| Screen shape | Built for | Code |
|---|---|---|
| Round | Amazfit Active 2 (Round) | [test-build-qr-round.png](test-build-qr-round.png) |
| Square | Amazfit Bip 6 | [test-build-qr-square.png](test-build-qr-square.png) |

Both expire on **2026-08-22 at 06:31 UTC** (08:31 Central European Summer Time).

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

## Step 3: enter your Liftosaur API key (optional)

**You can skip this step.** With no key the application runs in demo mode on a
sample program: every screen works and a whole workout can be played through,
nothing is saved anywhere. That is enough to test the interface, and it needs no
Liftosaur subscription.

Do the rest of this step only to use your own account. It needs a Liftosaur
Premium subscription, because the API the application talks to is a Premium
feature. Do it **right after the install**, before opening the application on
the watch.

First get the key:

1. Open [liftosaur.com](https://www.liftosaur.com) or the Liftosaur app.
2. Go to **Settings** > **API Keys**.
3. Copy your personal API key. It starts with `lftsk_`.

Then enter it:

1. In the Zepp app, go back to **Device** > **General** > **Developer Mode**.
2. Open the **Mini Program** tab.
3. Next to Lifto Companion, tap **Settings**.
4. Tap the API key box and paste your key.

The page confirms once the key is saved.

## Step 4: start the application

On the watch, open the application list: **Lifto Companion** is there.

## Things to know

**The QR codes expire after 7 days**, on 2026-08-22 at 06:31 UTC for the current
pair. This is not a failure: past that delay the link stops working and you need
to ask for a new one. A QR code works for everybody, as many times as needed
while it is valid.

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
| The application does not appear on the watch | Wrong QR code for your screen shape, or unsupported model |
| The screen is cropped or misaligned | Unsupported model, report it with the exact model name |
| The watch says it cannot reach your account | The API key is missing or wrong, redo step 3 |

## Reporting a problem

Please include:

- The **exact model** of your watch and its Zepp OS version.
- What you were doing when the problem happened.
- A photo of the screen if something is displayed incorrectly.
