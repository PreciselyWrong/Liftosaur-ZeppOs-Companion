# Workout Extension Manual Actions

This guide lists external actions that require human intervention in the Zepp Developer Console, on a mobile device, or on physical watch hardware.

---

## 1. Use the Registered App IDs

- **Lifto Companion**: `1123411`
- **Lifto Workout Extension**: `1125789`

Set the Workout App ID locally before its build or preview:
   ```bash
   export ZEPP_WORKOUT_EXTENSION_APP_ID=1125789
   ```
Or in PowerShell:
   ```powershell
   $env:ZEPP_WORKOUT_EXTENSION_APP_ID = "1125789"
   ```

> **Important**: A synthetic or mock App ID (such as `999999`) is valid only for offline compilation and CI invariant checks. Only a real App ID registered in the Zepp Developer Console can produce a server-accepted, installable preview package or a Store submission.

---

## 2. Build Packages and Generate Preview QR Codes

Run the build and preview orchestrators:

```bash
# Build standalone Companion package (Mini Program)
npm run build:companion

# Build Lifto Workout extension (requires real App ID)
ZEPP_WORKOUT_EXTENSION_APP_ID=1125789 npm run build:workout

# Build both product packages
ZEPP_WORKOUT_EXTENSION_APP_ID=1125789 npm run build:all

# Generate Lifto Companion preview QR (root project)
npm run preview:companion

# Generate Lifto Workout preview QR (requires real App ID)
ZEPP_WORKOUT_EXTENSION_APP_ID=1125789 npm run preview:workout
```

### Preview QR Expiry (~7 Days)

- Both `npm run preview:*` commands upload the generated `.zab` package to Zepp servers via `zeus preview`.
- The returned install QR code is valid for **about 7 days**.
- Zepp deletes preview packages after 7 days; there is no renewal mechanism. A fresh preview QR must be generated when expired.

---

## 3. Install on Physical Watch in Developer Mode

1. Enable Developer Mode in the Zepp mobile app:
   - Navigate to **Profile > Settings > About**.
   - Tap the Zepp icon or version 7 times until Developer Mode is unlocked.
2. In the Zepp mobile app, navigate to **Profile > your paired watch > Developer Mode**.
3. Scan the preview QR code generated in step 2.
4. Confirm installation of `Lifto Workout` to the connected watch.

---

## 4. Configure Extension Phone Settings

1. In the Zepp mobile app, go to **Profile > your paired watch > Developer Mode** (or App Management).
2. Select **Lifto Workout** and open **Settings**.
3. Enter your Liftosaur API key (`lftsk_*`).

> **Note**: Lifto Companion and Lifto Workout are distinct App IDs with independent `settingsStorage`. API keys do not transfer automatically and must be entered separately in each app's settings.

---

## 5. Enable Lifto under Strength Training on Watch

1. On the watch, launch the system **Workout** application.
2. Select **Strength Training**.
3. Open **Settings** > **More** > **Data Page** > **Add Page**.
4. Select **Lifto**.

---

## 6. Execute Physical Hardware Test Plan

1. Follow the test cases in [docs/workout-extension-hardware-test-plan.md](workout-extension-hardware-test-plan.md).
2. Record watch model, firmware version, Zepp OS version, commit hash, date, result (`pending` / `BLOCKED`), and telemetry.
3. Capture debug logs via Zeus CLI or Zepp Developer tools where accessible.
4. Redact all API keys, bearer tokens, and private data before saving log artifacts.

---

## 7. Store Submission (Release Gate)

Once hardware validation passes:
1. Generate the final release build (`npm run build:workout`).
2. In Zepp Developer Console, upload the `.zab` package from `build/workout-extension/dist/`.
3. Provide store listing metadata, screenshots, icon, and link to privacy policy ([docs/privacy-policy.md](privacy-policy.md)).
4. Submit for Zepp App Store review.
