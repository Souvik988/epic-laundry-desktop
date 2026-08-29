# Epic Laundry V2 — Security Model

## Existing controls

- Renderer sandboxing, context isolation and disabled Node integration.
- Scrypt password hashes and token hashes in SQLite.
- HTTP-only Strict same-site session cookie.
- Server-side guards and role/store membership checks for the operational API.
- The authenticated request context is bound to the selected tenant/store for
  both modern laundry handlers and legacy ERP handlers; process-default tenant
  constants are reserved for explicitly public webhooks/portals and the local
  internal desktop key.

## Required hardening

1. The fixed-port model has been replaced by a parent/child nonce challenge on an
   OS-assigned loopback port.
2. Privileged IPC sender/frame checks now require the known local renderer URL.
3. Parsed URL allowlists now gate external navigation.
4. Deny-by-default session permission handlers and a restrictive local CSP are in place.
5. Evaluate Electron fuses and document the chosen production profile.
6. Keep signing keys, provider credentials and backup secrets out of source and
   protect local secrets with OS facilities where appropriate.

## Current security status

Authentication, application authorization and the local desktop bootstrap boundary
are **EPIC_EXISTING**. Code signing, verified updates, OS-native secret storage,
fuse evaluation and a packaged-Electron adversarial test suite remain
**PARTIAL/MISSING** and block a production release.
