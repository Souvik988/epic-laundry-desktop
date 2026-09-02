# Marketplace edge-sync architecture

Status: **PARTIAL / EPIC_EXTENSION — local edge implementation verified; real cloud transport remains external.**

The operator status contract distinguishes retry/dead-letter delivery backlog from held version or target conflicts, so a store can identify lifecycle review work without inspecting raw logs.

V4 has separate normalized `sync_outbox`, `sync_inbox`, and checkpoint structures. The legacy generic outbox cannot be reused because it transitions to published before durable remote receipt.

- Delivery: at least once, with idempotent receivers.
- Outbox lifecycle: `Pending → InFlight → Acknowledged`, with `Retry` and `DeadLetter` paths; a relay attempt is never acknowledgement.
- Inbox: global event-ID uniqueness plus payload hash; duplicate identical events are no-ops, mismatched reuse is a security/conflict failure.
- Ordering: aggregate ID plus version; gaps are held, stale events cannot regress an aggregate.
- Device identity: scoped device credential, rotatable/revocable; no user password or universal binary secret.
- Operations: dashboard must show last push/pull, queue counts, dead letters, clock skew, identity, and diagnostics export.

The local implementation and deterministic simulator are covered by marketplace sync/cross-channel tests. No cloud URL, token format, or provider success is fabricated in this repository.
