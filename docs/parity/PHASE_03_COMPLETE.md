# PHASE 3 COMPLETE — Tenant, store, staff, role and settings foundation

## Evidence used

- Verified UniClean settings, staff and branch observations in the product audit.
- The Phase 3 implementation mandate and acceptance gate.

## Implemented

- Durable SQLite branch registry and membership model; existing identities migrate to their prior default branch.
- Session-backed active branch switching, with each branch owning separate settings and operational records.
- Owner-only branch creation and branch selector in the desktop shell.
- Full store-user form: first/last name, username, write-only password, email, phone, role set, description and enabled state.
- Safe staff profile/role updates, credential resets that revoke existing sessions, final-owner continuity protection and no password-hash responses.
- Owner store profile: business details, local logo, address, UPI identifier, original local QR preview and QR-on-print setting.
- Server-side scoped audit records for settings/staff/branch changes.
- Role-aware desktop navigation and route guard, paired with server-side permission enforcement.

## Database and migration

- `stores` and `auth_store_memberships` are added to the local SQLite database.
- Existing identities receive a backfilled branch and membership.
- Staff profile columns migrate non-destructively.
- Logo data is validated as a bounded local PNG/JPEG/WebP/SVG data URL before persistence.

## Acceptance evidence

- Owner creates a staff profile, edits roles, resets a password and enables/disables access in automated tests.
- Store profile, audit records, branch creation and active branch switching are integration-tested.
- Store B cannot read Store A orders; a Store A rider cannot mutate a Store B delivery; a counter cannot edit owner settings.
- Browser verification covered first-owner bootstrap, owner profile/QR/logo upload, staff creation, branch creation/switching and counter direct-route denial.
- Final verified browser run had no console errors.

## Commands actually run

- `server: npm run typecheck`
- `server: npm run test:auth`
- `server: npm run test:store-migration`
- `server: npm run test:laundry`
- `webapp: npm run build`

## Boundary with later phases

- Charge/discount/tax eligibility and immutable pricing snapshots are Phase 5 work.
- Customer packages are represented by verified settings evidence but their sale, usage and balance lifecycle belongs to Phase 4.
- Master-data CRUD, catalogue media and imports are completed in Phase 5.

## Regression status

Passed for the Phase 3 gate.
