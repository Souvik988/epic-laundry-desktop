# Phase 4 — Customer 360, ledger, wallet, rewards and packages

Status: **Complete**. The phase gate passed with the browser checks recorded in
`PHASE_04_COMPLETE.md`; this log retains the implementation detail without
claiming unknown UniClean behavior as parity.

## Completed, tested slices

- Store-scoped customer creation, phone normalisation, per-branch deduplication,
  editable name/contact/address/notes, and search by name, mobile or linked invoice.
- Customer work card with revenue, order balance, wallet balance, reward points,
  last visit, order history, state counts, timeline and immutable ledger views.
- Immutable `laundry_customer_ledger` entries for opening balances, booked order
  debits, paid booking credits, wallet movements and package sale movements.
- Wallet credit/debit/refund/adjustment command foundation with reason validation,
  permission checks, audit rows, derived balance, and no-overdraft enforcement.
- Reward entry history and auditable manual adjustment. This is explicitly an
  **EPIC_EXTENSION** because the UniClean earning/redemption formula was not
  observed.
- Service-package definition, garment/service allowances, customer assignment,
  expiry state, redemption history and a hard allowance cap.
- Package desk UI for owner definition, counter assignment, active allowance view
  and one-unit redemption. Server permissions allow counter staff to read, sell
  and redeem packages; only owners may define package masters.
- Idempotency on customer creation, wallet movements, rewards, package definition,
  package purchase and package redemption routes.

## Current automated evidence

- `server: npm run typecheck` passed after the package model/API integration.
- `server: npm run test:customer` passed: normalisation/deduplication, immutable
  opening/invoice ledger, wallet cap, reward cap and a duplicate-wallet retry.
- `server: npm run test:package` passed: definition, purchase retry, counter
  read/redeem permission, partial use, cap rejection, exhaustion and package-sale
  ledger reconciliation.
- `webapp: npm run build` produced the current `server/public/app` bundle after
  the care-package desk was added.
- Visual test of the customer directory and customer work card passed in a clean
  local branch: creation, opening balance, metrics, ledger and owner control
  surface all rendered with no application error.

## Deferred follow-up (not a Phase 4 gate failure)

- Implement the controlled historical-order ledger backfill/reconciliation
  migration during Phase 12. Until then the customer work card explicitly labels
  any affected historical orders and reports a ledger-only balance rather than
  fabricating a figure.
- Verify package expiry/restoration behavior from source evidence when available;
  until then preserve the documented Epic expiry policy.
