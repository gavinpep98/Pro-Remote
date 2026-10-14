# Contributing to Slide Desk

Thanks for helping! Slide Desk is a volunteer, church-built project.

- **Found a bug?** Open an issue (there's a template), or use the bug button inside the remote and attach what it saved. Include your ProPresenter version.
- **Have an idea?** Open a feature request issue.
- **Want to change the code?** Fork the repo, make your change, and open a pull request. Try it with the demo first: `node demo/start-demo.js` runs the remote against a pretend ProPresenter on http://localhost:8090, no ProPresenter needed.

## Making a release (maintainers)
1. Bump the version in `server.js` (`APP_VERSION`) and `public/index.html` (`PAGE_VERSION`) and add a section to `CHANGELOG.md`.
2. On a Mac, open the **tools** folder and double-click **Build Mac Installer.command**. It makes **dist/Slide Desk <version>.dmg** with the "drag Slide Desk to Applications" window (the first time, allow Terminal to control Finder). Build it on a Mac: an app built elsewhere asks Apple Silicon Macs to install Rosetta.
3. On GitHub: Releases → Create a new release → tag `v<version>` → attach the .dmg → Publish.

(`tools/make-mac-app.sh` builds just the app into `dist/`.)

How it's built: `server.js` is a small Node.js helper with no dependencies (it passes commands to ProPresenter's network API and sends live updates to the page). `public/index.html` is the whole remote page. `demo/` holds the pretend ProPresenter.

If you change anything, bump the version in both `server.js` (`APP_VERSION`) and `public/index.html` (`PAGE_VERSION`) and add a line to `CHANGELOG.md`.

By contributing you agree your contribution is shared under the project's license (GNU GPL v3 or later).
