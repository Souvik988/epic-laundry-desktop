# Epic Laundry visual transformation execution plan

Status: ACTIVE · derived from current repository evidence on 10 September 2026

## Evidence baseline

The current product has 31 laundry routes, a shared `LaundryShell`, bundled Manrope/Noto Sans Devanagari fonts, Recharts visualisations, garment/service media, an offline Fastify + SQLite runtime, and an existing V4 design-system document that correctly classifies the visual system as partial. The highest-impact current gap is not missing route coverage; it is uneven visual hierarchy and insufficient relational demo depth across those routes.

The demo workspace is intentionally isolated from production. Its deterministic V4.6 seed plus additive V4.7/V4.8/V4.9/V4.10 lifecycle, experience and HR-depth coverage now exercises 256 orders, 177 parties, 249 canonical invoices, 143 garment masters, 995 production tasks, 3 care-package definitions, 3 customer package assignments, 2 package redemptions, 3 route runs with 9 stops, 3 rider settlements, 13 wallet entries, 4 reward entries, 11 customer addresses, 6 print jobs, 12 employees, 72 attendance records, 3 leave applications, 3 expense claims, 2 employee loans, 2 job openings, 4 applicants and 3 interviews, plus finance/statutory records, claims, returns, marketplace projections, routes, tags and settlements. Route coverage includes a persisted skipped-stop exception with an audit reason. Order-level coverage includes Booked, Picked Up, In Process, Ready, Out for Delivery, Delivered and Cancelled; garment-level coverage includes an active Rewash path.

## Dependency-led phases

### Phase 0 — Runtime truth and safety

- Keep production and demo databases separate.
- Run the server, web, Electron, database bootstrap and recovery checks before each visual release.
- Treat demo seed markers as versioned and idempotent; never insert demo data from React.
- Capture evidence for any runtime screen called visually inspected.

### Phase 1 — Visual language foundation

- Consolidate semantic brand tokens around deep teal, cream, mint, brass, violet and critical coral.
- Keep Manrope as the bundled operational typeface and Noto Sans Devanagari as the multilingual fallback.
- Standardise page headers, KPI hierarchy, panels, status pills, tables, charts, loading, error and empty-state primitives.
- Preserve premium density: charts clarify; tables remain the evidence surface.

### Phase 2 — Operational heartbeat

- Dashboard: make collections, order pipeline, pickup/delivery, payment attention, production risk and sync health the first scan.
- Overview/statistics: add compact trends and distribution views with readable summaries.
- Use deterministic copy only; every insight must be derived from API data.

### Phase 3 — Counter intelligence

- New Order: retain fast keyboard/scanner flow, add compact visual category recognition and explicit unit-aware quantity controls.
- Orders, customers and catalogue: combine useful visual summaries with precise searchable tables.
- Customer detail: add bounded lifetime/order/service summaries without exposing unauthorised data.

### Phase 4 — Floor and delivery clarity

- Production, garment tracking, QC, returns, routes and dispatch: show queue depth, urgency, stage and next action before detail.
- Use delivery and quality illustrations only for true empty states; never imply a completed operation.

### Phase 5 — Finance and control-room comprehension

- Finance, statutory controls, cash, expenses, settlements, payroll and setup: preserve canonical calculations and make readiness, liability, reconciliation and evidence states scannable.
- Keep GST/TDS/TCS/PF/ESI and management metrics separate in UI and data.

### Phase 6 — Marketplace and configuration

- Online Orders and Sync Status: expose acceptance, intake, approval, payment, retry, dead-letter, device and clock state.
- Settings, reports and imports: group by owner task and surface missing configuration instead of blank forms.

### Phase 7 — Runtime acceptance

- Run route-level Playwright smoke coverage at 1024/1366/1440/1920 where available.
- Run accessibility, typecheck, builds, finance/regression suites and database integrity checks.
- Capture a screen-by-screen evidence index; mark unrendered screens as pending rather than passing them by assumption.
- Audit generated assets for recognisability, transparency, bundle size and correct use.

## Current implementation slice

Completed in this slice: deterministic seed expansion to 248 orders; additive V4.7 lifecycle coverage to 256 orders; idempotent re-run guards for marketplace catalogue, settlement, outbox and lifecycle fixtures; a V4.5 care-package fixture slice with paid, part-paid, expired and redeemed states; a V4.6 planned-delivery and rider-settlement fixture slice with same-zone order selection; V4.9 HR-depth fixtures with visual People & Payroll cards for leave, claims, loans and hiring; V4.10 persisted route-exception coverage with skipped-stop analytics; a Customer 360 order-status journey using persisted status counts; delivery, quality and customer empty-state assets; shared visual empty-state usage in Dashboard, Dispatch, Statutory Finance, Quality Claims, Customers, Orders, Production Queue, Online Orders, Rider Settlements and Customer 360 detail panels; branded empty states for correction documents, filtered garment tracking, rack occupancy and import history; visual category recognition in New Order; an explicit Print Centre → Order Work Card handoff; a page-scoped visual Order Pulse above the precise Store Orders table; keyboard-accessible settings workspace tabs with one visible panel at a time; route-level scroll restoration for drill-down headings; shared named loading surfaces across data-backed operator pages and route visual QA; settled-font/animation screenshot capture; data-derived chart text alternatives for Overview, Dashboard, Statutory Finance, Expenses and People & Payroll; a fresh-production empty-state walkthrough; and a replacement service-worker/manifest shell that targets the integrated Epic Laundry app instead of the retired ERP cache.

Runtime acceptance evidence: the route-level visual smoke audit passed all 33 major operator routes—including report-detail and import surfaces—at 1024, 1280, 1366, 1440, 1920 and 2560px, producing 198 screenshot attachments with the authenticated shell and populated demo data rendered and no detected application-error text. The route audit now explicitly waits for any named page-loading surface to resolve, preventing a transient blank/spinner capture from being accepted as visual evidence. A separate demo-login test proves the deterministic seeded credential contract, the representative screenshot run covers 13 primary routes plus customer detail at 1024, 1366 and 1920px, and the production-mode empty-state walkthrough passed across ten core operational surfaces. The reduced-motion/accessibility runtime pass now verifies the global motion contract, named loading surfaces and chart text alternatives on Dashboard, New Order, Orders, Finance, Statutory, Expenses and People & Payroll under `prefers-reduced-motion: reduce`; the static interactive-control audit passes as well. The full authenticated server E2E workflow and 38 targeted server regressions also pass after the latest visual changes. The audits use disposable workspaces and do not touch production data.

Remaining visual work: extend the human review to lower-frequency report-detail/import and all remaining route variants, continue replacing setup-specific placeholders where a shared state primitive is appropriate, and obtain visual-owner sign-off for composition, copy and density.
