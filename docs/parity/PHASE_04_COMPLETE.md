# Phase 4 acceptance — Customer 360, ledger, wallet, rewards and packages

Status: **Complete** on 27 August 2026.

## Delivered behavior

- Customer creation normalises phone input and rejects duplicates within the active
  branch. Customer records expose editable identity, contact, full address and
  notes fields.
- The Customer 360 work card supplies invoice-aware search, revenue, last visit,
  status count, order history, an auditable timeline, customer ledger, wallet
  history, reward balance and active-care metric.
- Customer ledger entries are append-only and support opening balances, invoice
  debits, payment credits and wallet/package references. Wallet debits cannot
  exceed the derived wallet balance.
- Reward adjustments are immutable and audited. They remain labelled
  **EPIC_EXTENSION_MANUAL** because the UniClean earning/redeeming formula was
  not verified.
- The Care Package desk lets owners define prepaid garment/service allowances;
  counter staff can read, sell and redeem packages. A redemption cannot exceed
  the remaining allowance and a fully used package becomes `Exhausted`.
- Customer creation, wallet/reward mutations, package definition, package sale
  and redemption all enforce idempotency keys before writing state.

## Evidence

- `server: npm run typecheck` — passed.
- `server: npm run test:customer` — passed (normalisation/deduplication, opening
  balance, immutable booking ledger, wallet and reward caps, retry safety, invoice
  search and scoped audit).
- `server: npm run test:package` — passed (definition, purchase retry, counter
  catalogue/package/redeem access, allowance cap, exhaustion and ledger entries).
- `server: npm run test:auth` — passed.
- `webapp: npm run build` — passed, producing the current desktop application
  bundle.
- Local browser verification — customer directory, work card, opening-balance
  metric/ledger, owner controls, direct profile editor, Care Package desk, package
  navigation and empty states rendered with no console errors or warnings.

## Controlled boundary

Package expiry/restoration behavior was not observed in UniClean. Epic uses a
documented expiry policy and calls it an **EPIC_EXTENSION**. Historical orders
that predate the new customer ledger are not silently backfilled: the customer
work card marks their balance as ledger-only until the controlled Phase 12
migration/reconciliation tool is delivered.
