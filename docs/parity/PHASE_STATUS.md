# Epic Laundry phase status

| Phase | Name | Status | Gate evidence |
|---:|---|---|---|
| 1 | Baseline, evidence map and regression harness | Complete | All nine existing laundry routes loaded in browser smoke; regression fixture, evidence map and phase documents exist; builds/self-test/typecheck/Electron pack passed. |
| 2 | Security, authentication and transactional data foundation | Complete | SQLite with JSON migration, session auth, hashed passwords, server RBAC foundation, store-scoped persistence, booking transactions and idempotency verified by automated and browser checks. |
| 3 | Tenant, store, staff, role and settings foundation | Complete | Branch registry/membership and selector, scoped staff CRUD/password resets, server and UI RBAC, local profile/logo/UPI QR settings, scoped audit, and cross-store/role tests passed. Master data, charges/discounts and package lifecycle progress in Phases 4–5. |
| 4 | Customer 360, ledger, wallet, rewards and packages | Complete | Store-scoped searchable/editable customer work card, append-only ledger/wallet/reward evidence, package lifecycle with hard caps, idempotent financial writes, role tests and local visual checks passed. Historical pre-ledger orders are explicitly reconciled as ledger-only pending Phase 12 migration. |
| 5 | Master data, pricing, tax, charges, discounts, media and imports | In progress | Protected master-data/configuration APIs, immutable price-rule snapshots, Lndry asset manifest/media validation, import-job history, owner command centre and POS configured-rule selectors pass automated/HTTP checks; authenticated visual/cross-role gate remains. |
| 6 | POS/order billing and complete payments | In progress | Payment authority, multiple allocations, reversal/refund, idempotency and order-work-card collection controls pass automated tests; authenticated visual/E2E gate and remaining POS capture fields are pending. |
| 7 | Order work card, fulfilment, editing, cancellation and refunds | In progress | Work-card collection plus immutable item-level fulfilment events and over-quantity guards are implemented; full edit/cancellation/refund visual gate remains. |
| 8 | Invoice, mini invoice, tags, print centre and UPI QR | In progress | Branded searchable print centre with server-backed receipt/tag previews is implemented; visual reprint/layout/UPI-QR gate remains. |
| 9 | Pickup, delivery, riders and settlement | In progress | Dispatch/rider assignment, item fulfilment linkage and durable rider settlement/reconciliation UI are implemented; rider-role isolation, reporting and visual gate remain. |
| 10 | Expenses, notifications and operational communication | In progress | Scoped notification centre, operational event alerts and explicit-send provider-safe gateway are implemented; expense editing/attachments and visual communication gate remain. |
| 11 | Fifteen reports and statistics overview | In progress | Fifteen scoped report routes, export/print controls, and server-backed Today/Week statistics overview implemented; authenticated visual reconciliation remains in Phase 12. |
| 12 | UI parity pass, E2E hardening, migration and packaging | In progress | Branch-scoped backup/restore, native safety backups, settings controls, authenticated API E2E, process restart/offline persistence, branded icon and refreshed Electron packaging implemented; authenticated visual browser gate remains. |

## Phase 1 command baseline

- `server: npm run test:laundry` — passed.
- `server: npm run typecheck` — passed.
- `webapp: npm run build` — passed.
- `desktop: npm run build:server` — passed.
- `desktop: npm run pack` — passed; refreshed `dist/win-unpacked` was produced.

## Phase 1 route smoke

`/laundry/dashboard`, `/laundry/new-order`, `/laundry/orders`,
`/laundry/dispatch`, `/laundry/expenses`, `/laundry/import-prices`,
`/laundry/import-customers`, `/laundry/reports` and `/laundry/catalogue`
all rendered under the local Fastify-served desktop UI. No application error
banner appeared. The browser-served favicon now resolves to the local branded
Lndry PNG; the earlier non-functional `favicon.ico` note is superseded by the
current build.

No lint script exists in the inspected package manifests.

## Phase 2 command and verification evidence

- `server: npm run test:store-migration` — passed: legacy SQLite rows become `STORE-DEFAULT` scoped and are hidden from other stores.
- `server: npm run test:auth` — passed: password hashing, bootstrap restriction, session revocation, password change, authenticated booking, idempotency and cross-store order isolation.
- `server: npm run test:laundry` — passed: booking rollback and current laundry regression fixture.
- `server: npm run typecheck` — passed.
- `webapp: npm run build` — passed.
- `desktop: npm run pack` — passed with Electron-native SQLite rebuild.
- Browser smoke — first-owner bootstrap, owner settings (profile, UPI QR, staff creation, branch creation), cross-branch switch and counter-staff access denial rendered locally. The final corrected switch uses the Electron-served hash route and left no console errors.

## Final authenticated route smoke

- A disposable local audit server was booted from the current compiled build.
- Owner bootstrap and staff creation were exercised with test-only credentials;
  all fifteen `/laundry/*` routes rendered without failure banners or page errors.
- The shell sign-out control was clicked and returned to the sign-in gate after
  fixing the bodyless POST request path.
- This fixture used a temporary database and was not the installed application's
  user-data store; the installed package remains at its first-run owner setup.
