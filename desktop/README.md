# Epic BOS — Desktop (Electron)

**Self-contained desktop app for Windows / macOS / Linux.** The backend server is bundled *inside*
the app — Electron boots it on launch, waits for it to be healthy, then loads the control UI from it.
No external server and no internet required. Your data is stored locally in the OS user-data folder.

The current Windows release line uses Electron 44.0.0 with electron-builder 26.15.3. The packaged
server includes its production dependency tree (including native `better-sqlite3`) under
`resources/server/node_modules` so the installed app does not depend on a developer checkout.

## How it works (ADR-003)
- `main.js` spawns the Fastify server as a child process (`serverBin`/`serverArgs`):
  - **Dev:** `npx tsx ../server/src/index.ts`
  - **Prod:** `node resources/server/dist/index.js` (compiled server copied via `extraResources`)
- After `/api/health` returns 200, a `BrowserWindow` loads `http://127.0.0.1:3001/ui/`.
- Settings can create and restore passphrase-protected `.epicbackup` files. The
  passphrase is held only for the request and is never persisted by Electron.
- The app also creates rolling local recovery snapshots every six hours (and on
  quit). On Windows/macOS/Linux builds with Electron `safeStorage`, those
  snapshots are encrypted with a per-install key; the interval can be tuned via
  `EPIC_AUTO_BACKUP_INTERVAL_MS` but is bounded to 15 minutes–7 days. Owner
  settings can select an OS folder (such as a removable or network-backed
  destination); production and demo snapshots are kept in separate subfolders.
- All API calls go to the bundled server on `127.0.0.1` (not `0.0.0.0`) — no LAN exposure.
- On quit (or macOS hide-to-tray) the child server is terminated cleanly.
- Data lives in `app.getPath('userData')/epic.json` (outside the read-only `asar`).

## Run (dev)
```bash
cd ../server && npm install        # once
cd ../desktop && npm install        # once (installs electron + electron-builder)
npm start                           # boots server + opens the window
```
- `EPIC_DEVTOOLS=1 npm start` opens DevTools.
- `EPIC_DEBUG=1 npm start` streams server logs to the terminal.

## Build installers (per platform)
The server must be compiled first, then electron-builder packages it:
```bash
npm run dist:win      # -> desktop/dist/Epic Laundry Setup <ver>.exe (NSIS) + portable
npm run dist:mac      # -> desktop/dist/EpicBOS-<ver>.dmg + .zip
npm run dist:linux    # -> desktop/dist/EpicBOS-<ver>.AppImage + .deb + .tar.gz
```
or `npm run dist` to build for the **current** OS.

Every `pack`/`dist` command also writes `dist/release-manifest.json`, a
deterministically sorted SHA-256 inventory of the generated release tree. Keep
that manifest with the artifact and run `npm run verify:manifest` before signing
or distribution. For a protected release, provide an Ed25519 private key only
through the build environment (`EPIC_RELEASE_PRIVATE_KEY_PEM` or
`EPIC_RELEASE_PRIVATE_KEY_FILE`), run `npm run sign:manifest`, then verify with
the trusted public key (`EPIC_RELEASE_PUBLIC_KEY_PEM` or
`EPIC_RELEASE_PUBLIC_KEY_FILE`) using `npm run verify:signature`. The signature
artifact is `dist/release-manifest.sig.json`; no key is committed to the repo.
Unsigned local builds are intentionally not production release evidence.

> **Windows code-sign quirk:** electron-builder downloads a `winCodeSign` cache that contains
> macOS `.dylib` symlinks. On some Windows accounts the extractor lacks symlink privilege and the
> build aborts with *"Cannot create symbolic link … privilege not held"*. Fixes:
> 1. Open **PowerShell as Administrator** and re-run `npm run dist:win`, **or**
> 2. Enable **Settings → Privacy & Security → For developers → Developer Mode** (grants non-admin
>    symlink creation), then build normally.
> This is an electron-builder/environment limitation, not an app bug. macOS/Linux builds are unaffected.

## Security posture
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (renderer never gets Node).
- Renderer reaches the backend only via the REST API on `127.0.0.1`.
- External links (WhatsApp, Razorpay, GSP portals) open in the OS browser, never a new Electron window.
- Single-instance lock; system tray with Show/Quit.
