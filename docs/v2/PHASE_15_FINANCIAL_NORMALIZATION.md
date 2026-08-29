# V2 Phase 15 — Controlled financial normalization

**Status:** DELIVERED as a guarded migration operation with canonical normalized
  financial rows now preferred for invoice, payment, package, expense, wallet and cash
  report reads. Certified apply runs are durably recorded per branch; source entity
payloads remain compatibility records until a later schema migration moves the
stored source columns themselves.

## Delivered

- Added owner/settings-only `GET /api/ops/financial-normalization` to preview
  legacy invoices, collections/refunds, expenses, paid packages, customer
  ledger and wallet movements that need normalized financial documents or
  integer-paise journal entries.
- Added owner/settings-only `POST /api/ops/financial-normalization` to apply
  only missing mirrors, customer-ledger rows, normalized cash-close snapshots,
  normalized wallet rows, and v9 constrained source columns.
  The operation is idempotent, store-scoped and records an audit event.
- Every candidate amount passes the shared fixed-scale parser. If any source
  amount is invalid, the operation fails before writing anything; it never
  silently rounds or creates a partial migration.
- The preview exposes candidate count, missing document/entry counts, invalid
  count, missing source-column and cash-close snapshot counts, issue details and
  the exact IDs that would be written for a dry-run approval workflow. It also performs a dual-read
  comparison of existing normalized mirrors and constrained source columns;
  amount, direction or currency conflicts are surfaced explicitly.
- Apply refuses to overwrite or silently accept a source/mirror conflict. The
  operator must resolve the discrepancy before any migration rows are written.
- Apply runs the read-only financial reconciliation control inside the same
  transaction after backfill. A non-reconciled result aborts and rolls back the
  entire operation; successful results return `certified: true` with the clean
  reconciliation status for release evidence. Each successful pass also writes a
  branch-scoped `financial_normalization_runs` evidence row and returns its
  immutable run ID; support diagnostics include the count of certified runs.
- Legacy wallet movements are validated for customer, type, fixed-scale amount,
  date and reference, then backfilled into the constrained `wallet_entries`
  table. Existing normalized wallet rows are compared before apply and any
  disagreement blocks the transaction.
- The E2E workflow verifies owner preview and idempotent apply behavior.
- Store settings now contains an owner-facing migration panel showing missing
  mirrors, ledger rows, cash-close snapshots, source columns, invalid values,
  and conflicts before the operator confirms an apply.
- Operational payment, cash, package, order-presentation, overview and report
  reads use the normalized paise rows when available; reconciliation still
  flags drift in the retained compatibility JSON instead of silently accepting
  it.
- Added a read-only `GET /api/laundry/package-liability` control and Care
  Package desk panel. It separates contract value, collected cash, outstanding
  receivable and remaining allowance units, and flags over-redemption, payment
  state mismatches and missing canonical payment evidence.
- Package assignment now stores an explicit contract value and supports bounded
  partial deposits plus subsequent balance collection through immutable
  `customer_package_payment` records. Each collection writes canonical paise
  financial evidence and a customer-ledger credit, updates `Unpaid`/`Part Paid`/
  `Paid` deterministically, is idempotent at the API boundary, and is included
  in normalization/reconciliation checks.

## Operator workflow

1. Open the owner Store settings page and review the financial normalization
   preview (or call the GET endpoint from a controlled support session).
2. Resolve every reported invalid source amount before applying.
3. Apply once with an idempotency key. The operation only commits when its
   in-transaction reconciliation certificate is clean; retain that result and
   the audit event with the release evidence.

## Remaining boundary

This is a deliberate backfill bridge, not a claim that compatibility JSON is
already removed. A future migration must add constrained source columns,
dual-read verification, rollback snapshots and property tests before the
compatibility fields can be retired.

## Evidence

| Check | Result |
|---|---|
| `server npm run typecheck` | PASS |
| `server npm run test:financial-normalization` | PASS — missing mirrors, customer-ledger rows, constrained source columns, and cash-close snapshots are backfilled once, each certified pass is retained as auditable evidence, a second pass is a no-op, the post-apply reconciliation certificate is clean, and a conflicting mirror is surfaced and rejected |
| `server npm run test:e2e` | PASS — preview, idempotent apply, and the clean reconciliation certificate response |
| `server npm run test:reconciliation` | PASS — canonical invoice reads survive compatibility-field drift and drift is reported |
