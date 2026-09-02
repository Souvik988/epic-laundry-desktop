# Epic Laundry V3 — Executive Refinement Audit

**Audit date:** 2026-08-30  
**Scope:** working tree derived from `main` at `2eb6b75`, including the uncommitted V3 refinement changes, Electron boundary, Fastify laundry domain, SQLite persistence, React laundry workspace, and automated self-tests.

## Executive Summary

The current implementation already had a strong offline-first foundation: atomic booking, durable garment units, lifecycle events, store isolation, authenticated APIs, recovery tooling, and a working native print boundary. The highest-value correctness defect was in tag semantics: the operation named “reprint” rotated the active identifier and made the previous physical label operationally disappear.

V3 refinement corrects that defect without replacing the existing architecture. Active tag identity is now separate from print attempts; same-tag reprints preserve identity, replacements issue a new active tag, old tags remain resolvable, and print/PDF actions are recorded as evidence-backed jobs.

## What Was Already Strong

- Piece/pair booking creates one durable garment unit per physical quantity inside the booking transaction.
- Weight and area units do not create fabricated garment units.
- Garment lifecycle transitions, rack occupancy, production tasks, QC, store isolation, idempotency, backup/restore, and authenticated session boundaries were already implemented.
- QR code generation, offline-compatible libraries, Electron context isolation, and a controlled HTML print window were already available as platform primitives.

## Bugs Found

| Finding | Severity | Resolution / state |
|---|---|---|
| “Reprint” generated a new active tag code and invalidated the old code | CRITICAL | FIXED: same-tag reprint preserves the active code; replacement is explicit |
| Retired tags resolved as “not found” | HIGH | FIXED: `TAG_RETIRED` response includes current tag, unit, date, and operator |
| Tag sequence was line-local rather than order-wide | HIGH | FIXED in tag presentation: `1 / N … N / N`, with line sequence retained |
| Booking completion printed the surrounding modal/application view | HIGH | FIXED: completion actions use the shared controlled print renderer |
| Print output was not represented as a durable job | HIGH | FIXED: `tag_print_jobs` stores document, template, tag IDs, status, actor, and evidence |
| Cash register selection used a browser prompt | MEDIUM | FIXED: booking now uses an application select fed by open cash shifts |
| Report worker could remain queued when the source tree was executed directly, and the E2E poll was too short under concurrent Windows load | HIGH | FIXED: source/dist worker resolution, inherited runtime loader, and a bounded 5-second completion poll |
| Print controls could report success for a cancelled native dialog or invoice jobs could carry tag counts | HIGH | FIXED: native result is propagated into evidence/status; invoice and tag job semantics are separated |

## Tagging V3 Architecture

Three concepts are now kept distinct:

1. `garment_units.id` / `GU-…` — permanent physical identity.
2. `garment_units.active_tag_code` / `ELT-YYYYMMDD-######` — current physical identifier.
3. `tag_print_jobs.id` — a documented attempt to render/print/download labels.

The QR payload is versioned and opaque: `ELT:v1:<active-tag-code>`. It contains no customer phone, address, payment, or notes. Resolution happens locally through the store-scoped API.

## Tag Data Model

Migration 17 adds `tag_history` with store scope, tag code uniqueness, active/retired status, issue/retirement actor and timestamps, replacement linkage, reason, and version. Existing units receive a compatibility history row during migration. Migration 18 hardens `tag_print_jobs` with database-level document-type, status, and bounded integer copy-count checks. Migration 19 adds explicit store-scoped `laundry_containers` and `laundry_container_events` records for weighted/bulk bags, with distinct `ELB-…` identities and lifecycle history.

Same-tag reprint appends an immutable `tag_reprints` record with identical previous/new codes and a `tag_reprinted_same` garment event. Replacement atomically creates a new history row, retires the old row, updates the unit’s active code, appends replacement evidence, and requires `tags.replace` (owner-only under current role policy) plus a reason.

## Print Architecture

- `webapp/src/lib/laundryPrint.ts` is the authoritative renderer for preview payloads, native printing, and PDF export.
- The Electron preload exposes `exportHtmlPdf`; the main process renders the supplied controlled HTML in a hidden sandboxed `BrowserWindow` and writes through the OS Save dialog.
- A4 and thermal tag CSS uses physical millimetres and owner-configured presets (A4 4/6/8/10-up, 50.8×51.4 mm, 50×25 mm, or custom). QR images are generated offline with `qrcode`; Code 128 is embedded as generated SVG with `jsbarcode`.
- The Print Centre supports order search, invoice/mini-invoice/garment-tag/bag-tag/history tabs, selection, Print selected/all, and Download PDF.
- Print evidence keeps distinct physical `tagIds` separate from `requestedCopies`; a batch of five unique tags is one rendered document copy containing five labels.
- Correction documents now use the same shared renderer foundation, keeping customer-facing print styling and escaping in one place.
- Tracking “Print again” and “Replace tag” execute the lifecycle command and then invoke the controlled single-tag renderer; a failed print is surfaced without hiding the durable lifecycle record.
- Print status messaging is truthful: native success is described as “Native print command accepted”; the system does not claim that a physical page emerged.
- Booking completion and tracking now distinguish print cancellation, successful output, and missing print-history persistence; a durable lifecycle mutation is never presented as fully audited when its print-job record could not be saved.
- Owner controls provide a branch-scoped tag-template configurator with live preview, field toggles for logo/garment/service/customer/order/invoice/date/due/sequence/code/notes/express/special-care, code-format selection, physical dimensions, orientation/page size/margins/font/line spacing, and reset-to-defaults. Changes remain local until the operator explicitly saves.
- Branch-scoped printer profiles record document type, device/connection, paper dimensions, orientation, margins, DPI, copies, code support, active state, and a safe silent-print flag. Profiles describe intent only; they do not claim hardware verification.
- Post-booking behavior is explicitly configurable as ask, open Print Centre, auto-open native tag print, or no automatic print.

## Scanner Architecture

The existing keyboard-wedge scanner and lifecycle transitions were preserved. Active garment tags continue to transition operational state. A separate bag/container scan mode resolves `ELB-…` identities and advances bulk-container state. Retired garment tag scans now stop safely and return structured `TAG_RETIRED` details rather than silently becoming a missing-tag failure. Fast Scan mode captures rapid scanner sequences at the application boundary, including when another search or form field has focus: garment/unit tags are sent to garment tracking, bag tags are sent to container tracking regardless of the selected tab, and order/invoice payloads resolve through the store-scoped global search into the order workflow. Scans continuously submit on scanner delimiters and visibly distinguish accepted, already-at-stage, and rejected scans; ordinary slow text entry remains in the active field.

## UI Changes

- Print Centre is now a document workspace with order list, document tabs, actual tag cards, visible QR, sequence, due date, and selection state.
- Print Centre queue filters include Today, Ready, Unprinted, Partially printed, Reprints, Completed, and All; unprinted/partial/reprint states are derived from durable physical identities and print history.
- Booking completion exposes separate Print tags, Print invoice, and Tags PDF actions.
- Cash register selection is an in-app control when cash shifts are open; order cancellation, payment reversal, route-stop skipping, and expense corrections use in-application reason forms rather than browser prompts.
- Order work cards expose an assembly-safety traceability summary, piece/container accounting, current state/location/condition, and links to scan/history/reprint/replace and Print Centre workflows.
- The design remains aligned with the existing Epic Laundry teal/cream visual language while strengthening hierarchy and operator feedback.
- The fixed desktop sidebar now uses role-filtered Home, Counter, Production, Pickup & delivery, Finance, Customer programs, and Management groups with active-group expansion and its own scroll region, keeping the complete navigation reachable at 1024px and other short-height desktop surfaces.
- The root workspace now lands owners on Dashboard, counter staff on Order booking, processing staff on Production queue, and riders on their assigned Route runs.

## Backend Changes

- Added stable laundry domain errors for tag lookup, retired tags, invalid transitions, stale orders, assembly blocking, and print-job validation; the frontend maps these codes to operator guidance.
- Added Fastify JSON Schema validation at the critical V3 boundaries for search queries, order/tag/container identifiers, order transitions, scans, reprint/replacement commands, and print-job payloads. Broader legacy ERP routes remain unchanged and are being migrated separately.
- Added `replaceLaundryTag`, `createLaundryPrintJob`, and `listLaundryPrintJobs`.
- Added `/api/laundry/garment-units/:id/replace-tag`, `/api/laundry/print-jobs` GET/POST, `/api/laundry/containers/:id`, and `/api/laundry/containers/scan`.
- Added active tag payloads to presented tag data and order-wide sequence mapping.
- Print job inputs are validated server-side: document/status allowlists, bounded integer copies, canonical unit IDs, and selected-order membership.
- Scanner lookup accepts the permanent garment-unit code as well as the active tag code while preserving retired-tag rejection.
- Existing production, QC, rack, payment, and order workflows were not rewritten.

## Database/Migrations

- SQLite migrations 17–19 create the durable tag/print/container tables and harden print-job and container lifecycle invariants with database constraints.
- Backup snapshots and scoped restore include tag history, print jobs, containers, and container events.
- Diagnostics expose counts for all new operational tables.
- No compatibility fields were deleted.

## Performance Results

- Tag lookup remains indexed by `(tenant, store_id, tag_code, status)` through `tag_history` and by active code on `garment_units`.
- Print Centre order search continues to use the existing bounded laundry order query path; the renderer only loads the selected order’s tag set.
- No full historical tag dataset is loaded into the renderer for a selected order.

## Tests

Passed during this refinement:

- `server npm run build`
- `server npm run test:garment-traceability`
- `server npm run test:garment-backfill`
- `server npm run test:restart`
- `webapp npm run build`
- `webapp npm run audit:a11y` — interactive controls retain accessible names or label ancestry after the V3 interaction refinements
- `webapp npm run test:e2e` — clean workspace setup, role-filtered grouped navigation reachability, dashboard, Print Centre tag selection, shared-renderer PDF fallback, global scanner dispatch, tag reprint/replacement controls, command palette interaction, hold/resume, keyboard booking, production, QC claim creation, assembly-safety visibility, payment collection, customer search, reports, routes, and cash-closing surfaces

The garment traceability self-test now asserts same-code reprint, new-code replacement, old-tag resolution, replacement status, replacement linkage, permanent unit-code lookup, and print-job validation. The store migration self-test also opens the migrated SQLite schema directly and proves invalid print-job status and document values are rejected by database constraints. The full serial server self-test matrix and broad `server npm run test:e2e` pass after the report worker source/dist resolution and bounded polling fix.

## Visual QA

Source-level, production-build, and local authenticated browser review completed for the Print Centre, booking completion, garment tracking, correction print surface, and cross-workflow operator surfaces. The repeatable Playwright smoke test covers workspace setup, dashboard load, Print Centre selection, shared-renderer PDF fallback, global scanner dispatch, tag reprint/replacement, command palette, hold/resume, keyboard booking, production, QC claim creation, assembly visibility, payment collection, customer search, reports, routes, and cash-closing surfaces. Current runtime screenshots were inspected at 1024px and 1920px; the 1024px tracking layout and sidebar navigation were refined after inspection so controls and destinations remain reachable instead of truncating or disappearing. Route exceptions and accounting corrections now collect auditable reasons inside the application. The shared documents have one authoritative HTML/CSS rendering path with millimetre dimensions, A4 six-up layout, order-wide sequence, due date, garment/service, active code, and opaque QR.

**Needs real-device verification:** printed output at A4/thermal sizes, QR readability after physical printing, paper scaling, margins, printer driver behavior, and native PDF output on representative Windows hardware.

## Remaining Hardware Certification

`system-default` native printing is the safe baseline. No ESC/POS, TSPL, ZPL, Zebra, TSC, scanner, scale, or cash-drawer adapter is claimed as certified. Physical page emergence cannot be independently verified by the current native callback.

## Remaining Provider Dependencies

- Production Authenticode certificate and trusted update hosting.
- Monitored off-device backup ownership.
- Provider-backed customer communications, live route telemetry, payment integrations, and external device adapters.

## Remaining Release Gates

- Keep the full E2E suite green as future worker/runtime changes land.
- Run manual Electron/browser acceptance at 1024, 1366, 1440, and 1920px.
- Print and visually inspect representative 1/2/5/10-tag, long-name, express, special-care, A4, thermal, and QR cases.
- Perform a controlled production review of tag-template presets and explicit bulk-container booking on representative weighted/area orders.
- Verify that the assembly guard and exception handling match the branch's approved floor policy before production rollout.
- Complete production signing, update, backup monitoring, and hardware certification evidence.

## Final Capability Matrix

| Capability | Classification |
|---|---|
| Durable physical garment identity | VERIFIED |
| Atomic piece/pair tag generation | VERIFIED |
| Weight/area lines do not fabricate garment tags | VERIFIED |
| Order-wide `1/N … N/N` tag sequencing | VERIFIED |
| Same-tag reprint preserves identity | VERIFIED |
| Replace/reissue retires old tag and preserves history | VERIFIED |
| Retired tag resolution with structured details | VERIFIED |
| Offline opaque QR payload | VERIFIED in software boundary |
| Shared preview/native/PDF HTML renderer | VERIFIED in software boundary |
| Print selected/all and direct PDF workflow | VERIFIED in software boundary |
| Durable print history/evidence | VERIFIED in software boundary |
| Explicit weighted/bulk container identity | VERIFIED in software boundary |
| Branch-scoped tag template configuration | VERIFIED in software boundary |
| Physical printer/QR readability | NEEDS_REAL_HARDWARE |
| Weighted/bulk container tags | VERIFIED in software boundary |
| Assembly completion guard | VERIFIED in software boundary |
| Full broad E2E regression | VERIFIED |
| Authenticode/update/off-device backup | EXTERNAL_BLOCKER |
