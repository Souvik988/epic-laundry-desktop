# Marketplace event contracts

Status: **PARTIAL / EPIC_EXTENSION; no accepted cloud edge contract yet.**

Every envelope must carry `eventId`, `eventType`, `eventVersion`, `aggregateType`, `aggregateId`, `aggregateVersion`, `occurredAt`, `tenantId`, `vendorId`, `storeId`, `deviceId` where applicable, correlation ID, and a schema-validated object payload. The local edge rejects missing identity, invalid timestamps, wrong event families, invalid versions, and non-object financial payloads before inbox application. Delivery is at-least-once: the desktop only transitions an outbound event to `Acknowledged` after receiving a durable remote receipt. Inbound application is deduplicated by `eventId` and held when an aggregate version arrives out of order.

Initial contract families: `order.requested`, `order.assignment.changed`, `order.accepted/rejected`, `order.reassessment.requested/approved`, `payment.captured/refunded`, `cash.collection.recorded`, `fulfillment.updated`, and `availability.updated`.

## Verified adjacent backend reference

The workspace contains `C:\Users\MSI\OneDrive\Desktop\lndry_management_system\Lndry_backend`, package `lndry-backend` version `1.0.0`. This is **VERIFIED_REFERENCE**, not an accepted production integration contract.

Observed registered surfaces at the current checkout:

- customer orders: `/api/v1/orders` (`prepare`, place, list, detail, cancel, invoice, reconciliation accept/reject);
- vendor operations: `/api/v1/vendor/orders` (list, stats, detail, accept, reject, processing stage, reconciliation), with `/api/v1/vendor-orders` retained as a deprecated alias;
- payments: `/api/v1/payments` (`create-order`, `verify`, history, refund) and `/api/v1/payments/webhook`;
- rider operations: `/api/v1/rider`, with `/api/v1/delivery` retained as a deprecated alias;
- catalogue/discovery: `/api/v1/discovery`, `/api/v1/service-categories`, `/api/v1/garment-types`, `/api/v1/quotes`;
- vendor/store management: `/api/v1/shops`, `/api/v1/vendors`, vendor applications, and device registration under `/api/v1/devices`.

The reference backend uses UUID orders, `order_number`, `vendor_id`, vendor-scoped queries, `order_events`, `order_reconciliations`, and an order-draft-to-order idempotency check. Its Razorpay path verifies the raw-body HMAC and supports provider callbacks, but the inspected code does not expose the desktop envelope, durable sync receipt, cursor/checkpoint, device machine-auth, external-order-link, or cross-vendor edge contract required by V4. The payment implementation also has a mock order path when Razorpay is not configured; that state must remain an explicit non-production capability and must never be treated as provider success by the desktop.

## Adapter boundary

Epic Laundry therefore keeps the local `sim://marketplace` transport for deterministic development tests and requires a future cloud adapter to translate the reference backend's REST/domain events into the versioned envelope above. The adapter must not call the local Fastify server from customer, website, vendor-app, or admin clients. Before enabling `Marketplace Connected` in production, the parties still need to agree on:

- cloud endpoint and authentication scopes for registered devices;
- outbound receipt shape and inbound cursor semantics;
- mapping from backend order UUID/order number/vendor assignment to `order_external_links`;
- event ordering and replay behavior;
- provider event identity and refund/chargeback semantics;
- vendor/store authorization and privacy projection;
- canonical quote, reassessment, invoice, and settlement payloads.

Until those items are jointly versioned and tested against the real backend, classification remains **EXTERNAL_BLOCKER / NEEDS_PROVIDER**. No production endpoint is fabricated in this repository.
