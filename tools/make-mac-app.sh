#!/bin/bash
# Builds "Pro Remote.app" for Mac from this folder.
# Usage:  tools/make-mac-app.sh [output-folder]      (default: dist)
# The app carries its own copy of the remote; settings and saved reports go to
# ~/Library/Application Support/Pro Remote, so updating the app keeps them.
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$SRC/dist}"
APP="$OUT/Pro Remote.app"
VER=$(grep -o "APP_VERSION = '[^']*'" "$SRC/server.js" | cut -d"'" -f2)
rm -rf "$APP"
if command -v osacompile >/dev/null 2>&1; then
  # On a Mac: a tiny AppleScript app (Apple's own launcher, runs natively on Apple Silicon and Intel —
  # no Rosetta prompt) that opens the Terminal window running the remote
  osacompile -o "$APP" -e 'do shell script "open -a Terminal " & quoted form of (POSIX path of (path to me) & "Contents/Resources/launch.command")'
  cp "$SRC/assets/AppIcon.icns" "$APP/Contents/Resources/applet.icns"
  P="$APP/Contents/Info.plist"
  pb() { /usr/libexec/PlistBuddy -c "Set :$1 '$2'" "$P" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :$1 string '$2'" "$P"; }
  # newer macOS puts the default script icon in Assets.car, which would win over ours
  rm -f "$APP/Contents/Resources/Assets.car"; /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$P" 2>/dev/null || true
  pb CFBundleName "Pro Remote"; pb CFBundleDisplayName "Pro Remote"; pb CFBundleIdentifier "io.github.proremote"
  pb CFBundleShortVersionString "$VER"; pb CFBundleVersion "$VER"
  pb NSHumanReadableCopyright "Copyright (C) 2026 Gavin Peppers. GNU GPL v3. Not affiliated with Renewed Vision."
  mkdir -p "$APP/Contents/Resources/remote"
else
  # Not on a Mac: a script-based app. It works, but Apple Silicon Macs ask to install Rosetta the first time.
  # Build on a Mac (tools/Build Mac Installer.command) to avoid that.
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/remote"
  cp "$SRC/assets/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
  cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Pro Remote</string>
  <key>CFBundleDisplayName</key><string>Pro Remote</string>
  <key>CFBundleIdentifier</key><string>io.github.proremote</string>
  <key>CFBundleVersion</key><string>$VER</string>
  <key>CFBundleShortVersionString</key><string>$VER</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Pro Remote</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
  <key>LSArchitecturePriority</key><array><string>arm64</string><string>x86_64</string></array>
  <key>NSHumanReadableCopyright</key><string>Copyright (C) 2026 Gavin Peppers. GNU GPL v3. Not affiliated with Renewed Vision.</string>
</dict></plist>
PLIST
  cat > "$APP/Contents/MacOS/Pro Remote" <<'SH'
#!/bin/bash
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
open -a Terminal "$RES/launch.command"
SH
  chmod +x "$APP/Contents/MacOS/Pro Remote"
fi
cp -R "$SRC/server.js" "$SRC/public" "$SRC/report-settings.json" "$SRC/LICENSE.txt" "$SRC/COPYRIGHT.txt" "$APP/Contents/Resources/remote/"

cat > "$APP/Contents/Resources/launch.command" <<'SH'
#!/bin/bash
# Runs Pro Remote. Settings and reports: ~/Library/Application Support/Pro Remote
printf '\033]0;Pro Remote\007'
RES="$(cd "$(dirname "$0")" && pwd)"
DATA="$HOME/Library/Application Support/Pro Remote"
mkdir -p "$DATA"
export PRO_REMOTE_DATA="$DATA"
PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Pro Remote needs Node.js (free). Opening nodejs.org — install the LTS version, then open Pro Remote again."
  open "https://nodejs.org"
  read -p "  Press Enter to close..."; exit 1
fi
PORT=$(grep -o '"remotePort": *[0-9]*' "$DATA/config.json" 2>/dev/null | grep -o '[0-9]*$')
PORT=${PORT:-4316}
if curl -s -o /dev/null --max-time 1 "http://localhost:$PORT/auth"; then
  echo ""
  echo "  Pro Remote is already running (in another Terminal window)."
  echo "  Open http://localhost:$PORT in a browser, or close that window first to restart it."
  echo ""
  read -p "  Press Enter to close..."; exit 0
fi
cd "$RES/remote"
node server.js
echo ""
read -p "  Pro Remote stopped. Press Enter to close..."
SH
chmod +x "$APP/Contents/Resources/launch.command"
# re-seal the app after adding files (ad-hoc signature; Macs still ask once to "Open Anyway")
command -v codesign >/dev/null 2>&1 && codesign --force --deep -s - "$APP" >/dev/null 2>&1 || true
echo "Built $APP ($VER)"
