# V2 Phase 8 — Route runs and rider handoffs

**Status:** PARTIAL — pickup and delivery orders can now be grouped into an
auditable, service-zone-aware route run with deterministic planned ETAs and an
owner-managed service-zone master; optimized navigation, live ETA telemetry,
and B2B route contracts remain future production gates.

## Delivered

- A route run is store-scoped, assigned to one active rider, dated, staged as
  Pickup or Delivery, and contains an explicit ordered stop list.
- Route creation validates order eligibility, rider assignment, and duplicate
  active-stop protection. Orders are persisted with an optional service zone;
  a route inherits that zone or accepts an explicit matching zone and rejects
  mixed-zone stop lists.
- Operators can set a planned route start time and minutes-per-stop cadence;
  each stop exposes a deterministic planned ETA in the API and route desk.
- The scoped `/api/laundry/service-zones` endpoint derives canonical zone
  suggestions from existing orders and route runs; the route desk exposes them
  as an operator datalist without inventing a separate unsourced master. Rider
  sessions receive only zones present on their own assigned orders or routes.
- Owners can maintain a branch-scoped service-zone master through
  `/api/laundry/service-zone-master`, including stable codes, active/inactive
  status, and pickup/delivery windows. Route creation resolves names or codes
  against active master rows when a master is configured; legacy free-text zones
  remain readable for migration safety.
- Starting a delivery route moves Ready orders to Out for Delivery.
- Completing a pickup stop advances the order to Picked Up; completing a delivery
  stop advances Ready → Out for Delivery → Delivered.
- Skipped stops require an operator reason. Route and stop actions are audited.
- Rider logins can be linked by an owner to an active rider record. Linked riders
  see only their own route runs and may start/close only their assigned stops;
  unlinked rider accounts receive no route data and cannot access the branch-wide
  dispatch queue. Link validation resolves the target branch explicitly, so an
  owner creating a user for another store cannot attach a rider from the current
  store by accident.
- The Route runs desk exposes route construction, ordered stops, start, complete,
  and skip controls, plus server-backed coverage analytics for ready orders,
  service zones, active runs, stop completion, and per-zone workload.

## Evidence

| Check | Result |
|---|---|
| `server npm run test:routes` | PASS — validation, ordered stops, lifecycle handoff, route completion, duplicate protection, rider-scoped zone suggestions, planned ETA output, assigned-rider ownership checks, and scoped coverage analytics. |
| `server npm run test:auth` | PASS — linked rider session reconstruction, own-route visibility, assigned route start/stop, unlinked rider denial, and cross-store rider-link rejection. |
| `server npm run typecheck` and `webapp npm run build` | PASS |

## Remaining work before route production readiness

- Add route optimization, live
  ETA/time-window enforcement, GPS or
  proof-of-delivery integrations, and rider-specific permissions.
- Add B2B route contracts and route-level collection/settlement reconciliation.
