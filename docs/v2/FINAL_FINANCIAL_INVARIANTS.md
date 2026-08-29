# Epic Laundry — Final Financial Invariants

## Canonical representation

INR money crosses command boundaries through a strict two-decimal parser and is stored as integer paise in normalized financial records. Floating-point values are presentation-only.

## Enforced invariants

- Amounts are non-negative except explicitly modelled variance/reversal values.
- A payment cannot exceed the outstanding invoice balance.
- Reversal/refund operations are append-only and idempotent.
- Wallet entries require a valid customer, supported entry type, and positive amount.
- Customer ledger rows contain exactly one debit or credit side.
- Package collections and redemptions remain separately auditable; partial deposits cannot silently settle a balance.
- Cash close stores immutable paise totals, movement counts, variance and supervisor approval.
- Normalized mirrors are source-linked and conflict-checked before apply.
- Financial normalization commits only when reconciliation returns `Reconciled`.

## Evidence

`test:money`, `test:payment`, `test:reconciliation`, `test:cash-shift`, `test:package`, `test:financial-normalization`, authenticated E2E, encrypted backup/restore, and recovery rehearsal all pass.

## Remaining certification

Historical generic financial rows still need a controlled production backfill and subsequent source-field retirement. Off-device retention, accounting policy ownership, and real payment-provider callback evidence remain deployment responsibilities.
