# V2 Phase 2 — Desktop Trust Boundary

**Status:** PARTIAL — the immediate local-process trust boundaries are hardened;
release signing, updater infrastructure and Electron fuse evaluation remain open.

## Delivered controls

| Control | Implementation | Evidence |
|---|---|---|
| Authenticated backend startup | Electron generates a high-entropy secret and nonce, launches Fastify on `PORT=0`, validates an HMAC proof containing the actual assigned loopback port, and only then loads the UI. | `desktop/main.js`, `server/src/index.ts`, `test:startup-handshake`. |
| Fixed-port exposure removed | Electron no longer assumes `3001`; all main-process API calls and renderer URLs use the authenticated assigned port. | Same source and handshake test. |
| IPC sender validation | Every exposed privileged IPC channel checks that the sender is the known main window and is serving the local `/ui/` origin. | `desktop/main.js`. |
| External navigation policy | Renderer-triggered windows/navigation are denied by default. Only explicit HTTPS hosts are opened through the OS browser. | `desktop/main.js`. |
| Update feed fail-closed policy | Packaged builds do not contact an implicit updater feed. Self-update is enabled only when `EPIC_UPDATE_FEED_URL` is explicitly configured as HTTPS on an allow-listed host. | `desktop/main.js`, `configuredUpdateFeed()`. |
| Permission denial | Electron session permission request/check handlers deny every ambient renderer permission. | `desktop/main.js`. |
| Local CSP | The local app response gets a restrictive self-only policy with only needed data-image/font and inline-style allowances. | `desktop/main.js`. |
| Request workspace binding | The authenticated guard binds tenant/store context before legacy and laundry handlers run; legacy routes no longer fall back to `STORE-DEFAULT` for a signed-in branch. | `server/src/api.ts`, `server/src/kernel/store.ts`, `test:auth`. |

## Verification

- `npm run test:startup-handshake` — **PASS**: backend selects an OS-assigned
  port, returns the matching nonce/HMAC proof, and its authenticated port serves
  health.
- `npm run test:workspace-mode` — **PASS**.
- `npm run test:restart` — **PASS**.
- `npm run pack` — **PASS** for Windows unpacked Electron artifact.

## Not yet claimed

- Current supported Electron upgrade and associated regression matrix.
- Electron fuse profile.
- Windows code-signing certificate, signed installer/update artifacts.
- Provider-backed update channels, rollback and update telemetry (the local
  feed URL validation and fail-closed default are implemented).
- OS-native secret storage and production provider credentials.
- Full packaged-Electron IPC/navigation adversarial E2E automation.

Those gaps remain release blockers and are tracked in
`WORLD_CLASS_GAP_MATRIX.md` and `SECURITY_MODEL_V2.md`.
