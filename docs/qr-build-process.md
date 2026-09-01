# Publishing test build QR codes

How the QR codes in the [README](../README.md) and the [tester guide](tester-guide.md)
are produced. Companion's unified preview package covers its 28 documented round and
square Zepp OS 3.6+ devices. Workout requests the same build matrix without claiming
hardware compatibility before physical-watch validation.

`zeus preview` uploads the build to Zepp's servers and returns a public install
link. Anyone holding the code can install the application, so treat running this
as publishing.

## 1. Build and rasterise the QR code

Run the preview target orchestrator for the desired target:

```bash
# Lifto Companion (default output: docs/test-build-qr.png)
npm run preview:companion

# Lifto Workout (requires dedicated App ID; default output: build/workout-extension-preview-qr.png)
ZEPP_WORKOUT_EXTENSION_APP_ID=<app-id> npm run preview:workout
```

This workflow:
1. For Companion, runs the QR builder in the repository root.
2. For Workout, validates the dedicated App ID, generates `build/workout-extension`, and runs the QR builder inside that directory.
3. Runs `zeus preview -s -t "<all 28 devices>"` to build and upload a single package.
4. Parses the Unicode half block terminal output back into a QR module matrix.
5. Validates the symbol structure (size, finder patterns, timing tracks, dark module).
6. Rasterises the symbol to the target PNG output path.
7. Prints the expiry date reported by the server.

Both QR codes expire after about 7 days. The Workout preview requires a real dedicated App ID registered in the Zepp Developer Console.

## 2. Update the documentation

- [README.md](../README.md): the image `docs/test-build-qr.png`, the 28 supported models, and the expiry in UTC and local time.
- [tester-guide.md](tester-guide.md): the same expiry and model overview.
- [CHANGELOG.md](../CHANGELOG.md): one line with the new expiry.

## 3. Scan the code before pushing

The structural checks prove the matrix is a well formed QR symbol. They do not
prove it carries the right URL. Scan the PNG with a phone once, then push.

## Notes

- Both preview QR codes expire after about **7 days**. There is no way to extend them, so codes are regenerated rather than refreshed.
- Generating the Lifto Workout preview requires a real dedicated App ID via `ZEPP_WORKOUT_EXTENSION_APP_ID`.
- `zeus dev` overwrites `.gitignore` with its own template, dropping the secret
  patterns. After any zeus run, check `git diff .gitignore`.
