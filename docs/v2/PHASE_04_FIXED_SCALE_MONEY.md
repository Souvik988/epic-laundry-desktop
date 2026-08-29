# V2 Phase 4 — Fixed-scale money boundary

**Status:** PARTIAL — operator/API money inputs have a strict two-decimal
boundary and cash-affecting events now have an append-only integer-paise journal.
New financial entity rows also populate checksum-tracked constrained paise
source columns; legacy records and entity-specific table retirement remain in
the controlled migration boundary.

## Delivered

- Added one shared money boundary that parses decimal strings/numbers into
  integer paise, rejects binary-float-shaped values with more than two decimal
  places, rejects unsafe magnitudes, and makes negative values explicit.
- Applied the boundary to laundry collections, expenses, wallet commands,
  package prices/purchases, catalogue rates, flat charge/discount rules, and
  quote-level charges/discounts.
- Existing arithmetic and reporting remain backward-compatible while accepted
  values are normalized to two decimal places before persistence.
- Added a read-only `/api/laundry/reconciliation` control report. It totals
  invoices, collections, refunds, expenses, and journal postings in paise,
  verifies closed cash-shift expected drawers against canonical movements, and
  returns explicit invalid-money, orphan-payment, overpayment,
  invoice-mismatch, cash-close-mismatch, and unbalanced-journal exceptions.
  It also reports normalized cash-close snapshot coverage and verifies each
  snapshot's component totals, counted/expected equation, and variance.
- Added a Financial controls panel to the Reports page so operators can see
  reconciliation status, totals, and the first actionable exceptions without
  leaving the reporting workflow.
- Added store-scoped `financial_entries` with integer-paise checks, immutable
  source linkage, and backup/restore coverage. Collections, refunds, expenses,
  and paid package purchases write canonical entries; reconciliation detects
  missing, orphaned, and amount-mismatched entries.
- Added store-scoped `financial_documents` with constrained integer-paise
amounts for invoices, payments, refunds, expenses, package payments and
wallet movements. Operational financial reads prefer these normalized amounts;
reconciliation validates every normalized document against its source row while
keeping the compatibility JSON fields visible during migration.
- Added constrained integer-paise customer-ledger and wallet tables. New
  writes dual-write to these tables, and profile reads prefer normalized rows
  while retaining a legacy fallback for historical records.
- Added migration v9 constrained paise source columns on financial entity rows;
  new invoice, payment, package, expense, wallet and customer-ledger writes
  populate them without removing compatibility JSON.
- Added a guarded owner-only financial normalization preview/apply operation;
  invalid source amounts abort before any write and successful runs are audited.

## Evidence

| Check | Result |
|---|---|
| `server npm run test:money` | PASS — paise conversion, zero/negative policy, over-precision, invalid formatted inputs, 2,000 deterministic round-trips, split/recombine and reversal invariants. |
| `server npm run test:reconciliation` | PASS — invoice/payment source rows contain constrained paise amounts; canonical values survive compatibility drift, refunds and closed cash shifts reconcile, and intentionally corrupted money is surfaced as an exception. |
| Existing laundry, customer, package, payment, catalogue, and E2E suites | PASS |
| `server npm run typecheck` | PASS |

## Remaining work before financial production readiness

- Move invoice, payment, wallet, package, expense, and customer-ledger source
  storage to constrained integer-paise columns with migration checksums and a
  dual-read verification period.
- Extend reconciliation to customer balances and package liability, migrate
  the mutable cash-shift source row to integer-paise columns, and add a
  scheduled daily-close drill.
- Add immutable correction documents and extend property coverage across
  partial payments, refunds, discounts, taxes, and cancellation/reversal flows.
