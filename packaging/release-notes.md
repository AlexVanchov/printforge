**PrintForge** — easy 3D design for 3D printing, built with [Solemn](https://github.com/AlexVanchov/solemn).

## Download

| System | File |
|---|---|
| **macOS 12+** (Apple Silicon & Intel) | `PrintForge-__VERSION__-macOS.dmg` (or the `.zip`) |
| **Linux** x86_64 | `PrintForge-__VERSION__-linux-x86_64.tar.gz` |

### macOS
1. Open the `.dmg` and drag **PrintForge** into **Applications**.
2. First launch: PrintForge is not from the App Store, so macOS asks once.
   - macOS 15 and newer: double-click the app, click **Done**, then open **System Settings → Privacy & Security** and click **Open Anyway**.
   - macOS 14 and older: right-click the app → **Open** → **Open**.
   - Or in Terminal: `xattr -dr com.apple.quarantine /Applications/PrintForge.app`

### Linux
Needs WebKitGTK (`sudo apt install libwebkit2gtk-4.1-0` on Ubuntu/Debian). Unpack and run `./printforge`, or `./printforge --serve` and open http://localhost:8765 in a browser.

## Verified for this release
Built by CI from this exact tag; the macOS app was launched and passed its self-test on Apple Silicon and on Intel (Rosetta), and the end-to-end UI suite passed in WebKit (Safari's engine) and Chromium.
