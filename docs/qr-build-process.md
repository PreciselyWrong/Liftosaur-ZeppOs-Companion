# Publishing a test build QR code

How the QR code in the [README](../README.md) and the [tester guide](tester-guide.md)
is produced. A single unified preview package covers all 28 supported round and square
Zepp OS 3.6+ devices.

`zeus preview` uploads the build to Zepp's servers and returns a public install
link. Anyone holding the code can install the application, so treat running this
as publishing.

## 1. Build and rasterise the QR code

Run the unified build preview tool:

```bash
node tools/build-preview.mjs docs/test-build-qr.png 10
```

This script:
1. Runs `zeus preview -s -t "<all 28 devices>"` to build and upload a single package.
2. Parses the Unicode half block terminal output back into a QR module matrix.
3. Validates the symbol structure (size, finder patterns, timing tracks, dark module).
4. Rasterises the symbol to `docs/test-build-qr.png`.
5. Prints the expiry date reported by the server.

## 2. Update the documentation

- [README.md](../README.md): the image `docs/test-build-qr.png`, the 28 supported models, and the expiry in UTC and local time.
- [tester-guide.md](tester-guide.md): the same expiry and model overview.
- [CHANGELOG.md](../CHANGELOG.md): one line with the new expiry.

## 3. Scan the code before pushing

The structural checks prove the matrix is a well formed QR symbol. They do not
prove it carries the right URL. Scan the PNG with a phone once, then push.

## Notes

- A preview lives **7 days**. There is no way to extend it, so the code is
  regenerated rather than refreshed.
- `zeus dev` overwrites `.gitignore` with its own template, dropping the secret
  patterns. After any zeus run, check `git diff .gitignore`.
