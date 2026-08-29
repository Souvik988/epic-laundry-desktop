# V2 Phase 11 — Offline command replay boundary

**Status:** PARTIAL — authenticated store-and-forward replay and a durable
renderer queue are now available. Exponential backoff and operator recovery
controls are delivered; edit conflict policy and cloud coordination remain
outside this local boundary.

## Delivered

- `/api/sync/push` now requires an authenticated session and executes inside the
  caller's tenant/store scope. It no longer uses process-level tenant or user
  defaults for replayed work.
- Replayed commands require a stable per-command `clientId` or
  `idempotencyKey`; retries return the original result instead of creating a
  second customer, booking, or expense.
- The idempotency ledger stores a SHA-256 request fingerprint. Reusing a key
  with a different payload is rejected with an actionable conflict, while an
  identical retry returns the original result. Conflicts are committed as
  `ops:idempotency-conflict` audit events after the failed transaction, so the
  audit trail itself is not lost to rollback.
- Batch size is bounded at 500 commands to keep recovery predictable.
- Core offline operations use the authoritative laundry handlers for bookings,
  expenses, and customer creation, so pricing, integer-paise postings, garment
  units, ledgers, notifications, and audit records are not bypassed.
- Unsupported generic documents fail per item with an actionable error rather
  than silently being posted through the legacy ERP path.
- The renderer persists booking, customer, and expense commands in local storage
  when the local server cannot be reached. It retries on reconnect and on a
  bounded timer, shows pending/dead-letter counts in the shell, and stops
  automatically after five rejected attempts instead of retrying forever.
- Retries use bounded exponential backoff (5 seconds to 15 minutes), preventing
  rejected commands from hot-looping the local server.
- Operators can explicitly reset dead letters for retry and export the complete
  queue for support/recovery from the shell indicator. Queue state survives
  renderer reloads.
- Successful replays and changed-payload conflicts are available through the
  authenticated `/api/sync/replay-audit` view, with hashes instead of raw
  idempotency keys.
- Order transitions, cancellation, and controlled edits now accept an explicit
  `expectedVersion`; the server rejects stale writes and increments the order
  version after each accepted mutation. This protects future offline edit
  commands from overwriting newer counter or route work.
- `/api/sync/push` admits versioned `laundry_order_transition`,
  `laundry_order_edit`, and `laundry_order_cancel` commands through the same
  authoritative handlers; stale replay returns a per-item conflict and does
  not mutate the order.

## Evidence

| Check | Result |
|---|---|
| Authenticated laundry E2E | PASS — booking, customer replay, retry idempotency, versioned offline transition acceptance/conflict, and unsupported-document rejection. |
| Packaged server restart replay | PASS — the harness kills the server while a delayed six-customer sync batch is in flight, then replays it after restart with unique original entities and no loss; a mixed customer/create, versioned transition, and controlled edit batch also replays with state/version changes intact. |
| Server typecheck | PASS |
| Web build | PASS — queue helper and shell indicator compile into the production bundle. |
| Backoff/dead-letter controls | PASS — bounded delays and shell retry/export actions are implemented. |
| Conflict audit | PASS — E2E verifies changed-payload rejection and the committed audit event. |
| Replay audit view | PASS — E2E verifies successful replay entries are queryable without exposing keys or payloads. |

## Remaining work before offline production readiness

- Keep the cloud sync boundary optional and tenant-authorized; no cloud
  provider is assumed by this local replay proof.
