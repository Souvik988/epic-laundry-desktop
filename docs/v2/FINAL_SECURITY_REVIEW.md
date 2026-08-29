# Epic Laundry — Final Security Review

## Implemented controls

- Authenticated parent/child startup handshake with nonce and HMAC proof.
- OS-assigned loopback port; no fixed-port trust assumption.
- Real URL parsing and allowlisted external navigation.
- Sender validation for privileged Electron IPC handlers.
- Deny-by-default renderer permission handling and restrictive local CSP.
- Preload isolation and role/permission checks enforced server-side.
- Tenant/store binding before operational handlers execute; cross-store authorization tests pass.
- Passwords/session tokens are excluded from diagnostics and logs; WhatsApp logging stores hash/length metadata only.
- Encrypted AES-256-GCM backups with scrypt key derivation and tamper rejection.
- SHA-256 release manifest and Ed25519 signing/verification tooling with tamper/trust-anchor tests.

## Not yet certified

- Protected production signing keys and Windows Authenticode certificate custody.
- Hosted, authenticated update origin and release-channel rollback policy.
- Crash telemetry and centralized redacted structured logs.
- Manual red-team review of packaged Electron permissions and all external-link paths.

The local bundle is therefore security-hardened for development/controlled deployment, but must not be described as a signed enterprise release until the external trust infrastructure is configured.
