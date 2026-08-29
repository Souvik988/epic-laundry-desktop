# PHASE 2 COMPLETE — Security, authentication and transactional data foundation

## Evidence used

- Phase 2 requirements in the master implementation mandate.
- Current server, Electron and React implementation.

## Implemented

- First-owner bootstrap, sign-in, sign-out, password change, session expiry and revocation.
- Per-password salted `scrypt` hashes; no shipped user password.
- HttpOnly local session cookie; the renderer no longer contains a reusable API key.
- Server-derived actor/tenant/store context for laundry endpoints.
- Role permissions and a server-only operational-user primitive for the Phase 3 staff UI.
- Electron-only, per-launch loopback key for backup/restore IPC; it is not sent to the renderer.

## Database/migrations

- SQLite/WAL is the authoritative local persistence store.
- Existing JSON data imports once on first launch.
- Existing pre-scope SQLite rows migrate to `STORE-DEFAULT`.
- Entity rows, audit, outbox, GL, stock and IMS records are scoped by the active store context.

## API/domain

- Auth bootstrap/session/sign-in/sign-out/password-change endpoints.
- Session-derived laundry actor and tenant.
- Transactional booking and durable booking/import idempotency.

## UI

- Responsive first-run owner bootstrap and sign-in gate with loading, validation and error states.
- Original Epic SVG favicon to remove the browser console 404.

## Security/permissions

- Store B cannot list or retrieve Store A orders in the integration test.
- Non-owner role permissions are server-side; the Phase 3 UI will expose staff management.

## Tests added

- `_selftest-auth.ts`
- `_selftest-store-migration.ts`
- Atomic rollback assertions in `_selftest-laundry.ts`

## Commands actually run

- `npm run test:store-migration`
- `npm run test:auth`
- `npm run test:laundry`
- `npm run typecheck`
- `webapp: npm run build`
- `desktop: npm run pack`

## Browser/Electron verification

- Local bootstrap screen rendered with no browser console error after favicon correction.
- Electron packaging completed with the SQLite native dependency rebuilt for Electron 44.

## Generated assets

- None in this backend/security phase; original generated raster assets begin with the Phase 5 catalogue/media work.

## Parity matrix changes

- Security, persistence and store-isolation foundation advanced from Missing to Partial/Existing as appropriate; staff/settings remain Phase 3 work.

## Problems discovered

- Windows test cleanup requires the SQLite handle to close before removing temporary fixtures; self-tests now do so.

## Remaining risks

- Staff-management UI and rich store configuration are Phase 3 work.
- Payments/refunds/wallet commands do not yet exist, so their idempotency arrives with their respective phases.

## Regression status

Passed.
