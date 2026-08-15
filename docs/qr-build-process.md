# Publishing a test build QR code

How the QR codes in the [README](../README.md) and the
[tester guide](tester-guide.md) are produced. Two codes are published, one per
screen shape, each covering every device of that shape.

`zeus preview` uploads the build to Zepp's servers and returns a public install
link. Anyone holding the code can install the application, so treat running this
as publishing.

## 1. Get the exact device names

The names come from the server, and `-t` matches them literally. Ask for a name
that cannot exist: the CLI answers with the full list of valid ones.

```bash
zeus preview -s -t "list-me"
```

It prints `Invalid device(s): list-me, must be one of [...]`, then falls back to
the interactive picker, which cannot be driven from a script - interrupt it. The
JSON array in the warning is the list to split into round and square.

Only devices compatible with the `apiVersion` declared in `app.json` appear.
Raising the minimum version silently shrinks the list, so refresh it whenever
that changes rather than reusing an older one.

## 2. Build one preview per screen shape

`-s` turns on multi device mode, and `-t` takes a comma separated list that
pre-fills the selection, which skips the interactive picker entirely
(`modules/build.js`, the `isMultiMode` branch). Every selected device ends up in
a single package, so one code serves the whole shape.

```bash
zeus preview -s -t "Amazfit Active 2 (Round),Amazfit Balance 2,..." | tee qr-round.txt
zeus preview -s -t "Amazfit Bip 6,Amazfit Active 2 (Square),..." | tee qr-square.txt
```

Capture the output to a file. The QR code exists only as terminal text, and step
3 reads that text back.

Two lines of the output matter:

- `Start building package, device sources: ...` - the device ids actually
  covered. Count them against the number of devices asked for.
- `This QR code will expire on <date>` - **printed in local time, with no
  timezone marker.** Convert it to UTC for the documentation, and state both.

## 3. Convert the terminal output to a PNG

Zeus renders the symbol with Unicode half blocks, one character per two vertical
modules. A screenshot of that loses the module grid to antialiasing, so the
characters are parsed back into a module matrix and rasterised exactly:

```bash
node tools/qr-ascii-to-png.mjs qr-round.txt docs/test-build-qr-round.png 10
node tools/qr-ascii-to-png.mjs qr-square.txt docs/test-build-qr-square.png 10
```

A drawn half block is a **light** module and an undrawn one is **dark**, which is
the opposite of the intuition. The finder patterns are what prove it.

The tool refuses to write a PNG unless the parsed symbol passes: a legal version
size, the three finder patterns module for module, both timing patterns
alternating, and the dark module. A truncated capture, a line wrapped by a narrow
terminal, or an inverted polarity fails those checks, so a broken code cannot
reach the documentation.

## 4. Update the documentation

- [README.md](../README.md): the two images, the shape each one is for, and the
  expiry in UTC and local time.
- [tester-guide.md](tester-guide.md): the same expiry, in the table and in the
  "Things to know" section.
- [CHANGELOG.md](../CHANGELOG.md): one line with the new expiry.

Claim only what the build output supports. The model list must come from the
devices passed to `-t` and confirmed by the `device sources` count, never from a
previous build's list.

## 5. Scan both codes before pushing

The structural checks prove the matrix is a well formed QR symbol. They do not
prove it carries the right URL. Scan each PNG with a phone once, then push.

## Notes

- A preview lives **7 days**. There is no way to extend it, so the codes are
  regenerated rather than refreshed, and every regeneration changes both images.
- Both codes must be regenerated together. Publishing a round code from one
  build and a square code from another means two different versions in the wild.
- `zeus dev` overwrites `.gitignore` with its own template, dropping the secret
  patterns. After any zeus run, check `git diff .gitignore`.
