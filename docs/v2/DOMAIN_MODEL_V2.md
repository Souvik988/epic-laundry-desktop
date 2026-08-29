# Epic Laundry V2 — Domain Model

## Core invariants

- Money is represented by integer paise in new financial records. UI decimal input
  is a display/input concern, never the ledger truth.
- Billing quantity and physical garment units are independent. A `2.5 kg` item is
  not inferred to contain three tagged pieces.
- Meaningful commercial and operational history is append-only; corrections use
  reversals, adjustments, cancellations or superseding facts.
- Every business fact has tenant, store, actor/source and timestamp context.
- Retry-sensitive commands require idempotency keys.

## Incremental normalized model

V2 introduces constrained tables for organization, customers, catalogue, orders,
garment units/events, invoices/payments/allocations/ledger entries, package
entitlements, production tasks, route tasks and communication outbox records.
Existing generic records remain a compatibility layer during migration rather than
being silently discarded.

## Classification notes

Verified UniClean workflows retain their classifications in the current parity
matrix. Opaque Epic garment-unit codes, non-piece tagging policy, production
stations, cash-close mechanics and route optimization are **EPIC_EXTENSION** or
**INDUSTRY_BENCHMARK** until reference evidence exists.
