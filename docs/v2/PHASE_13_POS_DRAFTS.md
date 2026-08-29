# V2 Phase 13 — Counter POS drafts

**Status:** PARTIAL — the booking desk now keeps a durable local draft, a
server-audited store-scoped hold queue with offline fallback, and a bounded
local hold queue, clearing active work only after a confirmed booking; keyboard
acceleration is delivered and multi-counter ownership now includes an explicit
claim/release policy plus a derived 15-minute lease/presence signal.

## Delivered

- The counter booking form persists its current cart, customer selection,
  fulfilment details, pricing adjustments, and notes in local storage.
- A browser/app restart can restore that draft without persisting credentials,
  payment references, or uploaded photos.
- Operators can explicitly clear a draft, and a successful server booking
  removes it automatically.
- Operators can explicitly hold up to ten unfinished orders, switch customers,
  and resume a held draft with its cart, fulfilment, pricing rules, notes, and
  manual payment method restored. Online holds are persisted as audited,
  store-scoped records with explicit Held/Resumed/Cancelled states; if the
  local server is unavailable, the renderer retains the same bounded local
  fallback. Holds never contain passwords or uploaded photos.
- The draft is independent of the offline command queue: a failed booking can
  be retried with the same visible cart while the queued command retains its
  stable idempotency key.

## Evidence

| Check | Result |
|---|---|
| Web TypeScript and production build | PASS |
| Authenticated booking E2E | PASS |
| Hold/resume queue | PASS — E2E covers idempotent server hold creation, active listing, explicit resume, closed-history retention, audit evidence, cross-counter ownership/claim, and the read-only 15-minute lease/presence projection; offline fallback remains covered by the web build. |

## Remaining work

- Add renderer keyboard E2E coverage, supervisor workflow metrics, and an
  explicit heartbeat/lease renewal if long-running edits need to exceed the
  default 15-minute window.
