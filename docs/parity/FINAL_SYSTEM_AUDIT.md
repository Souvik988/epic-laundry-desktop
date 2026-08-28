# Epic Laundry — Final System Audit

**Reassessment date:** 28 August 2026
**Baseline evidence:** `C:/Users/MSI/OneDrive/Desktop/lndry_management_system/Epic-Laundry-Product-Audit.md`
**Implementation:** `epic_crm_shotlin` working tree
**Assessment:** post-implementation, evidence-backed reassessment

## How to read this report

The original audit is retained as the historical baseline. Its sections 5–12
describe the pre-implementation prototype and must not be read as the current
state. This report and `MASTER_PARITY_MATRIX.md` are the current status records.
Reference-product behaviour is only called **verified** when it is supported by
the supplied UniClean audit; unobserved behaviour remains **needs verification**.

## Current outcome

Epic Laundry now has a production-shaped, offline-first laundry operating desk:
session authentication, branch-scoped SQLite persistence, server-authoritative
pricing and money calculations, customer 360, packages, order work cards,
partial item fulfilment, payments and reversals, dispatch and settlements,
expenses, fifteen report routes, statistics, backup/restore, native printing,
branded local assets, and a packaged Windows installer.

There are no known CRITICAL repository defects after the hardening pass. The
remaining incomplete items are evidence gates or intentionally unverified
reference semantics, not silently claimed parity.

## Requirement-to-evidence matrix

| Requirement | Current implementation | Evidence | Status |
|---|---|---|---|
| Local desktop/offline operation | Electron launches a loopback Fastify server and persists to SQLite in the Electron user-data directory | `desktop/main.js`; `npm run test:restart`; packaged health `HTTP 200` | PASS |
| Authentication and owner bootstrap | First-run owner creation, hashed passwords, sessions, revocation and password-change paths | `server/src/modules/auth`; `npm run test:auth`; installed first-run screen visually inspected | PASS; authenticated visual gate pending |
| Session exit | Accessible shell sign-out control, cookie revocation, and reload to the sign-in gate | `LaundryShell.tsx`; `apiPost` no-body fix; isolated authenticated browser click returned to “Welcome back” | PASS |
| Session expiry | Unauthorized responses notify the auth gate, clear credential fields, and replace stale operational UI with the sign-in state | `api.ts` 401 signal; `AuthGate.tsx`; isolated browser event test displayed “Your session expired. Sign in again.” | PASS |
| RBAC and branch isolation | Session-derived role/store context, guarded laundry routes, branch selector, scoped data and audit records | `server/src/api.ts`; `npm run test:auth`; `npm run test:store-migration` | PASS |
| Customer search/profile/ledger | Name, phone and invoice search; editable profile; revenue, balance, wallet, rewards, packages, timeline and immutable ledger | `LaundryCustomers.tsx`; customer self-tests and local visual checks | PASS |
| Catalogue/master data | Categories, services, units, garments, local approved visuals, active state, owner CRUD and import history | `LaundryCatalogue.tsx`; catalogue self-test; local asset validation | PASS |
| Pricing/charges/discounts/tax | Server quote authority, customer-specific price rules, configured rules, snapshots and import validation | `server/src/modules/laundry/domain.ts`; catalogue/payment self-tests | PASS; precedence remains Epic policy pending reference evidence |
| POS booking | Customer creation/selection, delivery mode/date/address, catalogue quantities, photos, notes, charges, discounts, tax and payment mode | `LaundryBooking.tsx`; `npm run test:e2e` | PASS |
| Partial payments and reversals | Multiple allocations, idempotent collections, balance calculation, reasoned reversal/refund | payment APIs/domain; `npm run test:payment`; E2E workflow | PASS |
| Order work card | Customer/order context, editable catalogue-backed lines, collection/reversal, cancellation, delivery evidence, timeline and notes | `LaundryOrders.tsx`, `OrderItemEditor.tsx`; order/payment self-tests | PASS; authenticated visual gate pending |
| Item fulfilment | Immutable item-level Picked Up/In Process/Ready/Delivered events and ordered-quantity guard | laundry domain fulfilment commands; E2E and regression tests | PASS |
| Garment tags and invoices | Server snapshots, one tag per physical unit, escaped receipt/tag documents and branded print centre; each tag carries explicit unit sequence, customer, garment, service, order date and due date; store logo/contact and opt-in UPI QR flow through a staff-readable print-settings endpoint | `LaundryPrintCentre.tsx`, `domain.ts` (`tagsFor`), `/api/laundry/print-settings`; native `epic:print-html` IPC; package smoke | PASS; thermal layout visual comparison pending |
| Pickup/delivery/riders | Dispatch queues, assignment, rider work, settlement and reconciliation ledger | `LaundryDispatch.tsx`, `LaundrySettlements.tsx`; ops self-test | PASS; OTP/POD/signature intentionally unverified |
| Expenses | Scoped expense posting/listing, tax fields, edit/cancel paths and reporting | `LaundryExpenses.tsx`; ops self-test | PASS |
| Notifications/communications | Scoped notification centre, operational alerts and explicit-send provider-safe gateway | notification routes/UI; ops tests | PASS for safe local behaviour; provider delivery unverified |
| Reports | Fifteen scoped report routes with date/search filters, authoritative rows, print and spreadsheet export | `LaundryReports.tsx`, `LaundryReportDetail.tsx`; report self-tests | PASS |
| Statistics overview | Today/Week controls, order-state composition, collection trend, customer frequency and new-customer trend cards | `LaundryStatistics.tsx`; statistics self-test; lifecycle reconciliation assertion | PASS; authenticated visual comparison pending |
| Backup/restore | Owner-only branch-scoped snapshot, validation, safety backup and restore | settings UI; migration/ops tests | PASS |
| Branding and original artwork | Supplied Lndry mark used in shell/auth/favicon/native icon; regenerated shirt has Lndry care tag/chest mark; asset manifest and local-only validation | `docs/brand/GENERATED_VISUALS.md`; PNG hash checks; packaged asset checks | PASS |
| Packaging/install | NSIS installer and portable executable built; installed copy matches packaged resources; Start Menu shortcut exists | `desktop/dist/Epic Laundry Setup 0.1.0.exe`; `app.asar` SHA-256 match; installed launch | PASS |

## Verification run

The following checks passed against the current working tree:

- `webapp`: `npm run build` (TypeScript plus Vite 8.2.2 production build).
- `server`: `npm run typecheck`.
- `server`: laundry, auth, store-migration, customer, package, catalogue,
  payment, operations, E2E and restart/offline self-tests.
- `server`: authenticated E2E confirms the branch-scoped
  `/api/laundry/print-settings` metadata is available, and the auth self-test
  confirms that a counter-staff session can read it safely.
- `server`: authentication self-test confirms a counter-staff session can read
  only its own branch print metadata while remaining forbidden from mutating
  owner-only store settings.
- `server`: `npm audit --omit=dev --audit-level=high` → `found 0 vulnerabilities`.
- `webapp`: `npm audit --audit-level=high` → `found 0 vulnerabilities`.
- Electron syntax checks for `desktop/main.js` and `desktop/preload.js`.
- `git diff --check` (only expected line-ending conversion warnings).
- Packaged loopback health: `GET http://127.0.0.1:3001/api/health` → `200`.
- Installed `resources/app.asar` SHA-256 equals the packaged
  `desktop/dist/win-unpacked/resources/app.asar` SHA-256.
- Installed index, brand mark and shirt asset hashes equal the current build.
- The approved regenerated shirt asset is RGBA (1230×1278) with SHA-256
  `923A03BEA59C311029D7B68004742B28F7AD9FF3978B399428722D5D37989223` in both
  the web source and installed server resources; the PNG is RGBA with real
  per-pixel alpha (no baked checkerboard).
- Garment-tag payload and print markup were rechecked after regeneration: tags
  are numbered as `order-line-unit`, display `sequence / total`, and include
  the Lndry mark plus customer, garment, service, order date and due date in
  both the browser fallback and native Electron print document.
- Print Centre now consumes branch-scoped print settings through
  `/api/laundry/print-settings` (`orders.read`), so counter/processing staff can
  print without owner-only settings access. A configured business logo/contact
  block and opt-in UPI QR are embedded into the self-contained print HTML.
- The browser print fallback is constrained by print-only CSS to the active
  receipt/tag dialog, preventing the surrounding desktop shell from appearing
  on paper; the latest production build completed without unresolved-asset
  warnings.
- Statistics overview lifecycle buckets now reconcile exactly to active orders,
  and payment-mix report totals exclude cancelled orders; dedicated regression
  assertions cover both invariants.
- Order transitions and rider assignments now commit inside SQLite transactions,
  keeping lifecycle/dispatch mutations and audit/outbox records atomic.
- Rider-settlement status updates use the shared API client, preserving the
  centralized session-expiry signal and consistent error handling.
- The dashboard `todayRevenue` KPI now reconciles with reports and trend charts
  by excluding cancelled orders; a regression assertion verifies the exact
  cancellation delta.
- Rider settlement creation is idempotent at the API boundary, and reconciled
  or rejected settlement records are immutable; focused and authenticated E2E
  regression tests cover both safeguards.
- Laundry calendar dates now use the configured business timezone (default
  `Asia/Kolkata`) across booking, payment, package, customer, dashboard, and
  statistics paths; browser date defaults no longer shift through UTC.
- Laundry expense posting now atomically commits its journal entry and expense
  record, preventing partial accounting writes; the full server self-test set
  remains green after this integrity fix.
- Growth-report tax and pre-tax subtotals now use the same active-order filter
  as revenue, preventing cancelled orders from inflating financial summaries;
  a regression assertion verifies the exact tax cancellation delta.
- Every seeded garment now has a distinct, approved, branded local visual with
  real transparency, and the owner catalogue editor can select any of them;
  the idempotent seed now maintains a 13-item starter garment master.
- The authenticated UniClean Order & Billing master was imported through the
  governed local price-import path: 167 observed price rows, 124 distinct
  garment/category combinations, 8 reference categories, and 5 services. The
  local catalogue now contains 132 garments and 183 active price rules; the
  import completed with 158 creates, 9 updates, and no rejected rows.
- Fresh installs seed a deterministic eight-order laundry demo (date-spread,
  paid/unpaid, pickup/delivery and lifecycle variety) so statistics, charts,
  dispatch and customer-frequency views are demonstrable immediately.
- Order detail now surfaces the generated garment tag numbers and unit sequence
  beside the existing print-centre tag workflow.
- First-run owner bootstrap is now guarded by a SQLite transaction, and the
  historical shared API-key literal has been removed from browser-delivered
  compatibility pages; no `dev-key-change-me` occurrence remains under
  `server/public`.
- The supplied `Lndry Delivery File.zip` brand pack was rechecked against the
  active shirt visual. Generated candidates with baked checkerboards were
  rejected; the shipped `lndry-folded-shirt-v3.png` remains the approved RGBA
  asset with the official mark and `#664cf0` purple treatment.
- Installed executable is currently launched into the authenticated local
  counter workspace; existing local data is preserved across reinstall.
- The rebuilt NSIS and portable artifacts are present at `desktop/dist`; the
  installed Start Menu shortcut resolves to the installed executable, and the
  refreshed installed JavaScript bundle hash matches the current packaged build.
- Isolated authenticated browser smoke created a disposable owner/staff fixture,
  loaded all fifteen laundry routes without failure banners or page errors, and
  confirmed the shell's sign-out control returns to the sign-in gate. This uses a
  temporary audit database and does not alter the installed application's data.

## Remaining gates and deliberate limits

1. **Installed authenticated visual/cross-role gate.** The installed app is at
   first-run owner setup. The isolated temporary audit server has now exercised
   the authenticated owner route set and logout flow, but a real owner account
   must still be created in the installed user-data store before claiming
   authenticated screenshots for that specific installation. Password entry is
   intentionally not fabricated or inferred from the reference account.
2. **Reference semantics not observed.** Reward earning formulas, exact
   tax/discount precedence, payment-provider success callbacks, OTP/proof of
   delivery/signature, barcode encoding, and hidden report-table semantics are
   kept in `NEEDS_VERIFICATION.md` rather than presented as UniClean facts.
3. **Non-laundry legacy ERP routes.** The original generic ERP compatibility
   routes still use their existing placeholder pages. They are outside the
   verified UniClean laundry workflow and are not counted as required laundry
   routes; every `/laundry/*` route is implemented and wired.

## Release recommendation

The repository is ready for a controlled local release and operator acceptance
run. Do not claim complete visual parity with authenticated UniClean screens
until the first-run account is created and the remaining visual/cross-role gate
is executed. No source changes are committed or pushed by this audit.

## Latest Overview release

The post-Dashboard Overview is now the primary navigation destination for
business intelligence. It includes Today, Last 7 days and Lifetime filters;
Revenue, Orders, Collections, Average order, Customers and New customers KPIs;
a combined revenue/collections/orders chart; lifecycle and customer-frequency
donuts; acquisition and receipts trends; service-demand ranking; and daily
throughput. All charts are driven by the statistics API and render against the
deterministic demo seed on a fresh install. The refreshed NSIS installer was
built, the prior installation was removed, the new build installed and opened,
and its loopback health check returned HTTP 200.
