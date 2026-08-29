# V2 Phase 7 — Production station queue

**Status:** PARTIAL — the floor now has durable station tasks, a truthful live
station-load view, and a supervised quality-claim workflow tied to physical
garment units; capacity planning, hardware receipts, and full rack/route
controls remain before production sign-off.

## Delivered

- Booking a piece/pair garment opens a durable Intake task for every physical
  unit. Tasks are store-scoped and linked to the opaque unit tag and order.
- A valid garment scan completes the open station task and opens the next task
  for the destination state (Sorting, Processing, Quality control, Rewash,
  Assembly, Rack, or Dispatch). Delivered/Cancelled terminal states do not
  create phantom work.
- Task priority is Urgent for Rewash, Missing, and Damaged states. Those state
  changes require an operator reason, preserving quality accountability.
- Production staff can view the queue, assign or reassign an Open/In Progress
  task, and start an Open task. The queue exposes the assignment control and
  server commands are idempotent, so a retry cannot duplicate the transition;
  completion and assignment actions are audited with actor and timestamps.
- Cancellation and controlled pre-processing order edits close superseded
  tasks rather than leaving orphaned open work.
- Added a Production queue page with status filters, urgent counts, station,
  tag, assignment, and “scan to advance” guidance. The queue now derives an
  order-due SLA, exposes overdue counts/filtering, and sorts overdue work first.
- Added `GET /api/laundry/production-load` and a live Station load panel that
  summarizes durable work by station (total, open, in-progress, urgent,
  overdue, and completed). Owners can persist per-station open-task targets in
  Store settings; the API derives utilization and capacity-reached flags from
  durable tasks. This is an operational workload view, not a fabricated
  throughput promise.
- Added `GET /api/laundry/production-workload`, which derives branch-scoped
  open-task loads per enabled owner/processing operator and deterministic
  lowest-load suggestions for unassigned work. Suggestions are advisory and
  never mutate assignments; assignment commands remain authenticated,
  idempotent and audited.
- Added a supervised `POST /api/laundry/production-workload/assign` command.
  Operators select a bounded set of recommendations, confirm the action, and
  the server assigns only to active staff in the current branch. Each result is
  idempotent, individually audited and reports skipped tasks instead of
  overwriting existing assignments.
- Added `GET /api/laundry/production-schedule`, a branch-scoped forward due-date
  dispatch view. It groups every open/in-progress/blocked task by delivery
  commitment and station, preserves urgent/overdue markers, references current
  station targets, and keeps undated work in an explicit exception bucket. It
  does not invent throughput or completion promises.
- Added a Quality claims register. Counter operators can open a claim against a
  tag; processing staff can resolve it as Rewash, Damaged, Missing, Release, or
  Reject. Rewash/Damaged/Missing decisions advance the garment through the same
  validated lifecycle and append audit/event history. Every terminal decision
  issues one immutable, order/claim/unit-linked customer correction document
  with a customer-safe message; the register displays it and the read-only
  corrections endpoint feeds the dedicated local print-delivery workspace.
- Racked transitions now require a non-empty physical bin/rack location and
  reject case-insensitive collisions with another active racked garment. The
  previous location is preserved in the audit event for retrieval traceability.
  `GET /api/laundry/rack-occupancy` and the Garment Tracking desk summarize
  occupied locations, tagged units and unassigned rack exceptions from those
  durable records. Owner-managed `laundry_rack_profile` masters now add
  validated physical capacity, available-slot and over-capacity metrics while
  unconfigured locations remain count-only. Profile changes are audited.
- `GET /api/laundry/quality-analytics` provides truthful, branch-scoped QC
  telemetry from durable claims: open/resolved/rejected totals, rewash loops,
  correction-document count, category/decision breakdowns and measured
  resolution hours. The Claims workspace surfaces these metrics without
  inventing throughput or savings.
- Added a dedicated Correction documents workspace. Staff can review the
  immutable branch-scoped correction register and print a branded customer-safe
  copy through the native print boundary; each print callback records a
  hardware receipt linked to the correction document.

## Evidence

| Check | Result |
|---|---|
| `server npm run test:garment-traceability` | PASS — intake task creation, state-driven processing task, explicit start, supervised quality claim resolution, immutable customer correction issuance, rack/bin assignment and collision rejection, rack occupancy retrieval rows, exception reason, tag lifecycle, and cancellation behavior. |
| `server npm run test:e2e` | PASS — authenticated E2E covers queue access, durable intake work, station-load aggregation, branch-scoped workload guidance, forward due-date schedule reconciliation, overdue filtering, idempotent assignment/start retries, and quality analytics rewash telemetry after a supervisor disposition. |
| `server npm run typecheck` and `webapp npm run build` | PASS |

## Remaining work before production-floor readiness

- Add customer-facing portal delivery with immutable correction documents and
  richer claim codes/attachments; local branded print delivery is now covered.
- Add richer slot assignment and customer-facing portal delivery; the forward
  due-date schedule, supervised workload assignment, SLA views, overdue
  filtering and advisory lowest-load guidance are now delivered. Automatic
  calendar mutation remains intentionally separate until business rules are
  defined. Add richer physical slot assignment
  workflows around the occupancy view.
- Add scanner/printer hardware adapters and a recorded print/scan receipt.
