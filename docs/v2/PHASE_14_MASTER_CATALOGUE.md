# V2 Phase 14 — Neutral master catalogue

**Status:** PARTIAL — the first-run neutral catalogue now covers 33 common
garment classes across men’s, women’s, household, accessories, formal, casual,
and ethnic categories with governed service/rate rules. Store-specific pricing
and any reference-catalogue import remain owner-controlled.

## Delivered

- Added seeded classes such as formal/casual shirts, jackets, ethnic sets,
  household linen, rugs, quilts, accessories, uniforms, and kilogram/square-foot
  services in addition to the original core set.
- Every seeded garment has an approved local branded visual or a safe local
  fallback, and every default price is editable through the catalogue command
  centre.
- Seeding is idempotent and never creates customer, order, payment, or expense
  activity in a production workspace.
- Owners can now import a reviewed JSON master catalogue from the authenticated
  desktop desk. The merge resolves scoped IDs or names, validates references and
  media, writes a durable `catalogue` import job, records setup completion, and
  restores the pre-import branch snapshot if any row fails.

## Evidence

| Check | Result |
|---|---|
| Catalogue self-test | PASS — governed price rules, visual validation, spreadsheet imports, JSON master import, rollback, and historical-rate behavior. |
| Authenticated E2E | PASS — owner catalogue import and idempotent retry are covered. |

## Remaining work

- Add per-store price approval/versioning and complete the full operator
  acceptance run against the reference catalogue.
