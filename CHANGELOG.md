# Changelog

## 1.1 — 2026-10-13
- New app icon.
- Mac: **Pro Remote.app** to keep in Applications / the Dock (settings in ~/Library/Application Support/Pro Remote).
- Mac installer: a disk image with the "drag Pro Remote to Applications" window (made with **tools/Build Mac Installer.command** on a Mac).
- Windows: **Install Pro Remote (Windows).bat** adds Start menu and desktop shortcuts with the icon.
- Team computers can add the remote as an app from Safari (Add to Dock) or Chrome / Edge (Create shortcut).

## 1.0.1 — 2026-10-13
- ↓ / ↑ pick the next / previous playlist item without changing the screen ("Up next"); → / Space / clicker puts its first slide live. Esc cancels.

## 1.0 — 2026-10-13
First release.
- Three-column layout like ProPresenter: Playlists & Library · slides · live preview with clear buttons, media playback and a tabbed box (Props, Stage, Audio, Timers, Macros).
- Continuous: the whole playlist in the middle in one scroll, following the live slide; Next flows into the next item.
- Correct handling of arrangements (repeated sections), updated live when changed in ProPresenter.
- Planning Center plans: follows the item selected in ProPresenter.
- Looks dropdown with Edit Looks (screens, layers, masks), Capture, Audience / Stage screen buttons.
- Media bin (media + live inputs), playback bar with scrubbing.
- Hotkeys for song sections, clearing and more, customizable per computer.
- Instant updates from ProPresenter with automatic fallback to regular checks.
- Report a problem (screenshot + details, emailed, saved offline), dark / light mode, demo mode.
- Playlists are view-only: ProPresenter's API resets song arrangements when a playlist is saved from outside.
