#!/bin/bash
# Builds "Slide Desk <version>.dmg" — the disk image with the "drag Slide Desk to Applications" window.
# Must run on a Mac (uses macOS's own hdiutil and Finder). Output goes to the dist folder.
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
VER=$(grep -o "APP_VERSION = '[^']*'" "$SRC/server.js" | cut -d"'" -f2)
WORK="$(mktemp -d)"
STAGE="$WORK/stage"
mkdir -p "$STAGE/.background" "$SRC/dist"
OUT="$SRC/dist/Slide Desk $VER.dmg"

echo "Building Slide Desk $VER…"
bash "$SRC/tools/make-mac-app.sh" "$STAGE" >/dev/null
ln -s /Applications "$STAGE/Applications"

# window background (sharp on Retina screens when tiffutil is available)
if command -v tiffutil >/dev/null 2>&1; then
  tiffutil -cathidpicheck "$SRC/assets/dmg-background.png" "$SRC/assets/dmg-background@2x.png" -out "$STAGE/.background/background.tiff" >/dev/null 2>&1
  BG=background.tiff
else
  cp "$SRC/assets/dmg-background.png" "$STAGE/.background/background.png"; BG=background.png
fi

# make a writable image, lay out its window, then compress it
hdiutil create -volname "Slide Desk" -srcfolder "$STAGE" -fs HFS+ -format UDRW -ov "$WORK/rw.dmg" >/dev/null
ATTACH=$(hdiutil attach -readwrite -noverify -noautoopen "$WORK/rw.dmg")
DEV=$(echo "$ATTACH" | grep -E '^/dev/' | head -1 | awk '{print $1}')
MNT=$(echo "$ATTACH" | grep -E 'Apple_HFS' | awk -F'\t' '{print $NF}' | sed 's/^ *//')
DISK=$(basename "$MNT")

cp "$SRC/assets/AppIcon.icns" "$MNT/.VolumeIcon.icns"
command -v SetFile >/dev/null 2>&1 && SetFile -a C "$MNT" || true

osascript <<OSA || echo "  (Couldn't arrange the window — the disk image still works. Allow Terminal to control Finder to get the full layout.)"
tell application "Finder"
  tell disk "$DISK"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {200, 120, 860, 548}
    set opts to the icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to 128
    set text size of opts to 13
    set background picture of opts to file ".background:$BG"
    set position of item "Slide Desk.app" of container window to {165, 200}
    set position of item "Applications" of container window to {495, 200}
    update without registering applications
    delay 2
    close
  end tell
end tell
OSA

chmod -Rf go-w "$MNT" 2>/dev/null || true
sync
hdiutil detach "$DEV" -quiet || hdiutil detach "$DEV" -force -quiet
rm -f "$OUT"
hdiutil convert "$WORK/rw.dmg" -format UDZO -imagekey zlib-level=9 -o "$OUT" >/dev/null
rm -rf "$WORK"
echo "Done: $OUT"
