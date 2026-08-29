# V2 Phase 6 — Cash shift and daily close

**Status:** PARTIAL — the operator cash-control workflow is now usable and
auditable, including named-register attribution; certified hardware drawers,
receipt evidence, and authoritative paise source columns remain before
production sign-off.

## Delivered

- A store can open one active counter shift per named register. The opening
  float, register, operator, business date, and note are recorded as a durable
  `laundry_cash_shift` document. Duplicate opens for the same register are
  rejected; when multiple registers are open, cash transactions must name the
  target register.
- Expected drawer cash is calculated from the opening float plus shift-scoped
  submitted cash collections, less cash expenses and reversed cash refunds.
  New bookings, collections, and expenses persist the cash-shift ID and
  register; legacy rows retain a timestamp fallback so a later shift cannot
  silently absorb an earlier movement.
- Closing requires a counted cash amount. The system stores expected, counted,
  and variance values and transitions the shift to an immutable `Closed` state.
  A normalized `cash_shift_closes` record snapshots all paise totals,
  movement counts, register, approval actor, and close note exactly once per
  shift, so historical close reports do not depend on mutable legacy rows.
- Non-zero variances require a written explanation and an owner/supervisor
  approval actor; the approval is retained with the closed shift.
- The reconciliation control independently recomputes every closed shift from
  canonical paise movements and reports a `CASH_CLOSE_MISMATCH` exception if
  persisted expected cash has drifted.
- Authenticated API routes expose current shift, history, open, and close
  operations with idempotency protection. Counter staff receive the required
  permissions; processing staff do not.
- A Cash closing desk shows live movement counts, expected drawer cash, close
  variance, and closed-shift history.
- The desk now exposes a read-only `GET /api/laundry/cash-close-drill` control
  which recomputes each normalized close equation, checks counted-versus-
  expected variance and fixed-scale integrity, and reports per-register
  exceptions without mutating data.

## Evidence

| Check | Result |
|---|---|
| `server npm run test:cash-shift` | PASS — duplicate-register protection, named-register isolation, ambiguous multi-register rejection, shift-scoped movement capture, matched close, normalized paise close snapshot, non-zero variance approval, terminal state, and history. |
| `server npm run test:money` | PASS |
| `server npm run test:reconciliation` | PASS — closed-shift expected cash is checked against canonical movements and the daily-close drill proves normalized equations. |
| `server npm run typecheck` and `webapp npm run build` | PASS |

## Remaining work before daily-close production readiness

- Add supervisor approval for material variance thresholds (the current
  control requires approval for every non-zero variance).
- Add cash-drawer/receipt-printer adapters with a recorded hardware receipt;
  no hardware success is claimed by the current workflow.
- Migrate the mutable shift source and related financial records to
  integer-paise columns; normalized close totals are now included in the
  daily reconciliation drill.
