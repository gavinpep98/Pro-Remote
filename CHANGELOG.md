# Changelog

## 1.2.1 — 2026-10-14
- **Pro Remote is now Slide Desk.** Renamed so it isn't confused with Renewed Vision's own ProPresenter Remote app. Nothing else changed.
- Mac: the app is now **Slide Desk.app**, and the first time it opens it moves your settings, people and PINs over from Pro Remote. Drag the old Pro Remote app to the Trash.
- Windows: **Install Slide Desk (Windows).bat** removes the old Pro Remote shortcuts and adds Slide Desk ones. The start files are now **Start Slide Desk (Mac).command** and **Start Slide Desk (Windows).bat**.
- Start-up settings are now named SLIDE_DESK_* (the old PRO_REMOTE_* names still work).

## 1.2 — 2026-10-13
- **Personal PINs and access levels.** Each person signs in with their own PIN and has a level: Viewer (watch only), Slides only (slides and Clear), Operator (runs the service) or Admin (everything, including Looks editing, screens on/off, capture, the connection and people). The remote hides what a level can't use, and the helper refuses it.
- A remote not used for 3 days asks for the PIN again.
- Admins manage people in Settings → Access: add, change level, show PIN, new PIN, sign out, remove. The Pro Remote window has the same commands (`users`, `add`, `pin`, `level`, `signout`, `remove`).
- A new install starts with an Admin and a made-up PIN, shown in the Pro Remote window until it's changed. The computer running the remote never needs a PIN.
- After 5 wrong PINs a computer waits a minute.
- The window log and problem reports say who did what.
- Updating: the old shared PIN becomes a person called Admin with the same PIN.
- Settings given when starting (like REMOTE_PORT) are no longer saved into config.json.
- Settings: People, Connection, Clear buttons and Hotkeys fold away (each shows a one-line summary when closed; each computer remembers which are open), so Save is in reach. Who's signed in and Sign out always show.
- Settings → Access → People: a green dot shows who's using the remote right now, each person says Online now / Signed in / Signed out, and Sign out is highlighted for anyone signed in (greyed out for anyone who isn't). The list updates itself while open.
- One computer at a time for everyone but Admins. A PIN never signs anyone out: if that person is already signed in somewhere, the PIN is refused ("This PIN is already in use") until they sign out there, an Admin signs them out, or the sign-in ends after 3 days without use. Admins can be signed in on any number of computers.
- Only Operators and Admins can change hotkeys. Viewers and Slides only still use them, and press ? to see them.
- A proper sign-in screen with the app icon covers the remote until you've signed in.
- The demo's sample songs are now public-domain hymns (Amazing Grace, Blessed Assurance), and the screenshots are retaken with them.
- The Pro Remote window notes each time a remote opens or closes (which computer and browser, and how many are open). Type `remotes` (or `who`, `connections`) there to list the open remotes.
- Each open remote checks in every 15 seconds, so one that drops off (computer asleep, Wi-Fi lost) shows as "Remote closed (stopped responding)" after 45 seconds, or 3 minutes if its tab was in the background.

## 1.1.1 — 2026-10-13
- The Pro Remote window shows the current PIN, and the PIN can be changed there: type `pin 1234`, `pin off` to remove it, or `pin` to show it (`help` lists the commands).
- A PIN changed in Settings is shown in the window too. The PIN never goes into problem reports.
- The PIN box and Settings say where to find a forgotten PIN.

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
