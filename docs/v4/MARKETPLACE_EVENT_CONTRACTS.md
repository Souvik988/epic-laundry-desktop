# Marketplace event contracts

Status: **EPIC_EXTENSION; no accepted cloud endpoint yet.**

Every envelope must carry `eventId`, `eventType`, `eventVersion`, `aggregateType`, `aggregateId`, `aggregateVersion`, `occurredAt`, `tenantId`, `vendorId`, `storeId`, `deviceId` where applicable, correlation ID, and a schema-validated payload.

Initial contract families: `order.requested`, `order.assignment.changed`, `order.accepted/rejected`, `order.reassessment.requested/approved`, `payment.captured/refunded`, `cash.collection.recorded`, `fulfillment.updated`, and `availability.updated`.

The adjacent backend currently documents customer order, Razorpay verification, and rider APIs. It does **not** document these envelopes, ACK semantics, ordering, device authentication, or vendor isolation; integration is blocked pending a jointly versioned contract.
