# V2 Phase 12 — Customer address book

**Status:** PARTIAL — customers now have a branch-scoped, auditable address
book with default-address rules and explicit preference/consent history; address
verification and route optimization remain separate production gates.

Customer directory also exposes a read-only lifecycle projection derived from
durable non-cancelled orders. It reports deterministic New, Active first-time,
Active repeat, At risk, Lapsed, and No orders segments, lifetime revenue/order
activity, and consent-aware contact eligibility. The projection is explicitly
not a churn prediction and never sends a message.

## Delivered

- Customer creation with an address materializes a durable `Primary` address.
- Customers can add, edit, set a default, and archive multiple addresses.
- Exactly one active default is maintained per customer; archiving the default
  promotes the next active address when one exists.
- Address records are included in versioned and encrypted backups, scoped to the
  authenticated tenant/store, and counted in redacted diagnostics.
- Customer profile UI exposes saved addresses for counter staff and owners.
- Customer records persist a preferred contact channel and service preferences.
- Marketing consent is explicit and every grant/withdrawal is retained in the
  append-only `laundry_customer_consent` history entity with actor/time/source.

## Evidence

| Check | Result |
|---|---|
| Authenticated laundry E2E | PASS — create, add, default replacement, archive, profile read, preference persistence, and consent withdrawal history. |
| Store migration self-test | PASS — migration v7 is ordered and checksummed. |
| Server typecheck and web build | PASS |

## Remaining work

- Add address verification and route-level eligibility/optimization before
  automated delivery planning.
