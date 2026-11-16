#!/usr/bin/env bash
# Build PrintForge.app (universal: Apple Silicon + Intel), a .zip and a .dmg.
#
# Requirements on the Mac: Xcode Command Line Tools (clang), Rust (rustup),
# Node.js 20+. Run from the repository root:   scripts/build-macos.sh
#
# Environment:
#   SOLEMN_DIR   use an existing Solemn checkout instead of cloning one
#   ARCHS        "arm64 x86_64" (default, universal) or a single arch
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
VERSION=$(node -p "require('./package.json').version")
SOLEMN_REPO=https://github.com/AlexVanchov/solemn.git
SOLEMN_COMMIT=fce332dd50e494eda80fa908fd9297a7d1e272bc
ARCHS=${ARCHS:-"arm64 x86_64"}
OUT=$ROOT/dist
WORK=$ROOT/build/macos
mkdir -p "$OUT" "$WORK"

echo "==> Solemn toolchain"
if [ -z "${SOLEMN_DIR:-}" ]; then
  SOLEMN_DIR=$WORK/solemn
  if [ ! -d "$SOLEMN_DIR/.git" ]; then git clone -q "$SOLEMN_REPO" "$SOLEMN_DIR"; fi
  git -C "$SOLEMN_DIR" fetch -q origin
  git -C "$SOLEMN_DIR" checkout -q -f "$SOLEMN_COMMIT"
fi
# standard macOS menu bar for the webview window (Cmd+Q/C/V/W/M)
if git -C "$SOLEMN_DIR" apply --check "$ROOT/patches/solemn-macos-menu.patch" 2>/dev/null; then
  git -C "$SOLEMN_DIR" apply "$ROOT/patches/solemn-macos-menu.patch"
fi
(cd "$SOLEMN_DIR" && cargo build --release -q)
SOLEMN=$SOLEMN_DIR/target/release/solemn

echo "==> C compiler wrapper ($ARCHS, macOS 12+)"
CCW=$WORK/cc-mac
{
  echo '#!/bin/sh'
  printf 'exec clang'
  for a in $ARCHS; do printf ' -arch %s' "$a"; done
  echo ' -mmacosx-version-min=12.0 "$@"'
} > "$CCW"
chmod +x "$CCW"

echo "==> Front end + Solemn build"
[ -d node_modules ] || npm ci --no-audit --no-fund
SOLEMN_CC=$CCW node tools/build.mjs --solemn "$SOLEMN" --out build/macos/PrintForge
lipo -info build/macos/PrintForge

echo "==> App bundle"
APP=$OUT/PrintForge.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp build/macos/PrintForge "$APP/Contents/MacOS/PrintForge"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$(date +%Y%m%d%H%M)/" packaging/macos/Info.plist > "$APP/Contents/Info.plist"
if [ ! -f packaging/macos/AppIcon.icns ]; then python3 packaging/make_icon.py packaging/macos; fi
cp packaging/macos/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
printf 'APPL????' > "$APP/Contents/PkgInfo"
plutil -lint "$APP/Contents/Info.plist"
# ad-hoc signature (required to run on Apple Silicon); no Apple ID needed
codesign --force --deep --sign - "$APP"
codesign --verify --verbose "$APP"

echo "==> Archives"
rm -f "$OUT/PrintForge-$VERSION-macOS.zip" "$OUT/PrintForge-$VERSION-macOS.dmg"
(cd "$OUT" && ditto -c -k --keepParent PrintForge.app "PrintForge-$VERSION-macOS.zip")
DMGDIR=$WORK/dmg
rm -rf "$DMGDIR" && mkdir -p "$DMGDIR"
cp -R "$APP" "$DMGDIR/"
ln -s /Applications "$DMGDIR/Applications"
cp packaging/macos/README-FIRST.txt "$DMGDIR/" 2>/dev/null || true
hdiutil create -quiet -volname "PrintForge" -srcfolder "$DMGDIR" -ov -format UDZO "$OUT/PrintForge-$VERSION-macOS.dmg"
ls -la "$OUT"
echo "Done: $OUT/PrintForge.app"
