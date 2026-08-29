# V2 Phase 3 — Migration ledger and schema integrity

**Status:** PARTIAL — the installed database now records and verifies ordered
migration checksums, including constrained financial source columns and
customer/order projections; operational dual-write and final compatibility
field retirement are still required.

## Delivered

- Added a durable `schema_migrations` ledger with monotonically ordered version,
  name, SHA-256 checksum, and applied timestamp.
- Existing installations validate the checksum and name of every recorded
  migration at startup. A modified migration definition fails closed instead of
  silently applying a different schema contract.
- Current migration entries cover store-scope indexes, garment traceability
  indexes, cash-shift query indexes, the integer-paise financial journal,
  normalized financial-document storage, customer addresses, request
  fingerprints for idempotent commands, constrained source columns, and
  server-audited POS order holds.
- Migration v5 adds the constrained `financial_documents` table and indexes;
  the authenticated backup envelope includes these records for restore drills.
- Migration v8 adds the request fingerprint column to the idempotency command
  ledger, allowing safe conflict detection for offline retries.
- Migration v9 adds checksum-tracked, non-negative integer-paise source columns
  to entity rows for invoices, payments, packages, expenses, wallets and
  customer-ledger movements. New writes populate these columns while the
  compatibility JSON remains available during the migration period.
- Migration v6 adds constrained `customer_ledger_entries` and `wallet_entries`
  tables, with branch/customer indexes and backup/restore coverage.
  Each SQL operation is idempotent.
- Added an owner-protected `/api/ops/migrations` diagnostic endpoint for support
  and release verification.
- Added an owner-protected read-only `/api/ops/compatibility-audit` preflight that
  reports generic-row counts, normalized mirror counts, explicit retirement
  blockers, and no payload contents before any future destructive migration.
- Added passphrase-protected AES-256-GCM backup/restore endpoints with scrypt
  key derivation, workspace binding, authenticated tamper detection and no
  passphrase persistence. The desktop Settings flow can create or restore the
  `.epicbackup` envelope after an explicit confirmation.
- Desktop shutdown and scheduled recovery snapshots now use a per-install
  random passphrase wrapped by Electron `safeStorage` (when the OS keystore is
  available), retain the latest ten envelopes, and fall back explicitly to the
  existing JSON snapshot only when OS-backed encryption is unavailable. The
  interval is bounded to 15 minutes–7 days and defaults to six hours.
- Legacy SQLite store-scope migration still runs before the ledger and remains
  covered by the migration self-test.
- The Phase 15 normalization operation can resume the v9 source-column
  backfill after an operator-approved preview; invalid amounts abort before any
  source column or mirror is written.
- Migration v10 adds the store-scoped `laundry_order_holds` table with explicit
  Held/Resumed/Cancelled states, bounded payloads, and indexes for counter
  retrieval. Holds are included in scoped backup/restore envelopes.
- Migration v11 adds one-per-shift normalized `cash_shift_closes` rows with
  integer-paise totals, movement counts, variance approval metadata, and a
  closed-at index; close snapshots are included in scoped backup/restore.
- Migration v12 adds store-scoped SQLite expression indexes for order,
  payment, expense and customer report-date predicates. Report E2E coverage
  asserts the order-date planner uses the dedicated index.
- Migration v13 adds the branch-scoped `financial_normalization_runs` ledger.
  Every certified historical backfill records its counts, reconciliation
  certificate and actor so support can prove which migration pass was applied.
- Migration v14 adds wallet-row counts to that evidence ledger. Legacy wallet
  movements are now backfilled into constrained `wallet_entries` rows with
  customer/reference conflict checks, not only financial-document mirrors.
- Migration v15 adds audited POS-hold ownership and an owner index. A held
  draft is associated with the creating counter, and another counter must
  explicitly claim it before resuming or cancelling it.
- Migration v16 adds constrained `customers`, `laundry_orders` and
  `laundry_order_items` projections plus a `compatibility_migration_runs`
  ledger. The owner-only entity-normalization preview/apply operation uses a
  deterministic source fingerprint, bounded resumable batches, fixed-scale
  quantity/money columns, validation failures and idempotent source hashes;
  generic compatibility rows remain untouched until a separately approved
  cutover. Desktop Settings now exposes payload-free previews, validation
  blockers, cursor progress and an explicit next-batch action for both
  customers and laundry orders.

## Evidence

| Check | Result |
|---|---|
| `server npm run test:store-migration` | PASS — legacy schema migration, store isolation, ordered versions through v16, constrained-source/hold-ownership/cash-close/report-index/normalization-evidence/customer-order projection migration naming, and 64-character checksums. |
| `server npm run test:entity-normalization` | PASS — customer/order preflight, resumable one-row batches, fixed-scale item projection, source-hash idempotency and durable evidence. |
| `server npm run test:restart` | PASS — packaged restart persistence remains intact. |
| `server npm run typecheck` | PASS |

## Remaining work before migration production readiness

- Define and execute remaining entity-specific migrations for garments,
  packages and operational records rather than relying on generic compatibility
  JSON rows. Customers and orders now have a controlled projection path, but
  their writes still need dual-write cutover evidence before source retirement.
- Add preflight compatibility checks and resumable migration progress. The
  desktop now creates encrypted rollback snapshots where OS-backed encryption
  is available, but monitored off-device retention and RPO/RTO ownership remain
  operational boundaries; the local scheduled fresh-database drill is covered
  by Phase 16. The backup endpoint emits a versioned,
  workspace-bound SHA-256 envelope; the authenticated E2E test proves restore
  and tamper rejection, but scheduled/off-device retention is still required.
