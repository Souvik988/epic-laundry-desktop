# Phase 5 — Master data, configured pricing, tax, charges, discounts, media and imports

Status: **In progress**. This record distinguishes shipped, tested Epic behavior
from the remaining Phase 5 acceptance evidence.

## Implemented and tested

- Owner-only server commands for category, service, garment, price, charge,
  discount and tax masters. Name/code/rule conflicts are rejected in the domain,
  not only by the UI.
- Required service units: Piece, Kilogram, Pair and Square Foot. A price rule is
  rejected when the selected service does not permit the garment's unit.
- General and customer-specific price selection. The quote stores the selected
  price-rule ID on every item, and booked order price/rule snapshots are never
  rewritten by later master edits.
- Configured flat/percentage charge and discount rules plus selected tax rules.
  Selected rules are calculated by the Fastify domain layer; manual fields remain
  available only as the pre-existing Epic desk capability pending Phase 6
  permission-governed override work.
- Lndry-branded garment visual manifest and curated shirt illustration. Garment
  upload accepts only PNG/JPEG/WebP under 1 MB in the owner UI; the server
  revalidates local asset paths/data URLs and rejects remote URLs.
- Catalogue command centre UI: create/edit/retire through active state for all
  masters, a customer-price selector, approved visual selection/upload, and
  configured-rule panels. Counter staff stay read-only by both UI affordance and
  server permission checks.
- Customer and garment-price imports record a durable scoped import job with
  actor, timestamp, result counts and row-level rejection evidence. The import
  desk shows history and downloads a CSV of rejected worksheet rows.

## Automated evidence

- `server: npm run typecheck` — passed.
- `server: npm run test:catalogue` — passed: duplicate constraints, units,
  image validation, special-price precedence, price snapshot, configuration math,
  import row errors and durable job history.
- `server: npm run test:laundry` — passed after price snapshot changes.
- `server: npm run test:auth` — passed after protected catalogue routes were
  registered; the counter-role denial test proves a counter user cannot mutate
  catalogue configuration through the API.
- `webapp: npm run build` — passed; current bundle was written to
  `server/public/app`.
- `desktop: npm run pack` — passed after the Phase 5 renderer/server changes;
  Electron Builder produced a fresh `desktop/dist/win-unpacked` package.
- Isolated HTTP verification — owner bootstrap, category/service/garment/price,
  charge/tax and server quote returned expected identifiers and `₹141.75`; a
  mixed-validity price import returned `Completed with errors` and persisted a
  job with worksheet row 3 as the rejection.

## Remaining Phase 5 work

- Run visual interaction smoke of the authenticated owner catalogue and the
  counter configured-rule selection in a fresh local browser session.
- Add a Phase 5 completion report only after that visual gate and a final
  cross-role API verification are recorded.
