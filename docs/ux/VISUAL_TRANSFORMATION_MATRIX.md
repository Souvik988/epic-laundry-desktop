# Epic Laundry visual transformation matrix

Legend: `AUTOMATED-PASS` means the authenticated route rendered without shell/runtime errors in the populated demo capture. `HUMAN-REVIEW-OPEN` means composition, density, copy, and visual hierarchy still require owner acceptance. `FOLLOW-UP` means a variant or content slice remains intentionally open.

| Area | Demo coverage | Visual system | Empty/loading/error | Responsive/a11y | Status |
|---|---:|---|---|---|---|
| Dashboard | 256 orders + finance | KPI, pipeline, trend, attention, ranking | shared visual empty state; named loading surface | 33-route matrix pass at six widths; reduced-motion runtime pass; human review open | AUTOMATED-PASS / HUMAN-REVIEW-OPEN |
| Overview | rich orders/finance | period charts with data-derived text alternatives | page-level states | 33-route matrix pass at six widths; reduced-motion runtime pass; human review open | AUTOMATED-PASS / HUMAN-REVIEW-OPEN |
| Counter / New Order | 143 garments, 5 services | category and garment visuals | order-tray illustration | keyboard path preserved; reduced-motion runtime pass; 33-route matrix pass | AUTOMATED-PASS / HUMAN-REVIEW-OPEN |
| Orders / Online Orders | 256 local + 12 marketplace | queue, state, payment and channel | visual empty states | 33-route matrix pass at six widths; human review open | AUTOMATED-PASS / HUMAN-REVIEW-OPEN |
| Customers / Packages | 177 parties, 3 package assignments, 2 redemptions | segment, value, allowance and liability views | customer/order visual empty states | 33-route matrix pass; customer-detail variant still open | AUTOMATED-PASS / FOLLOW-UP |
| Production / QC / Tracking | 995 tasks, durable units | stage, due and exception views | quality visual added | 33-route matrix pass at six widths; human review open | AUTOMATED-PASS / HUMAN-REVIEW-OPEN |
| Delivery / Routes | 3 riders, 3 route runs, 9 stops, 3 rider settlements | queue, handoff, planned-route and reconciliation views | delivery visual added | 33-route matrix pass at six widths; human review open | AUTOMATED-PASS / HUMAN-REVIEW-OPEN |
| Finance / Statutory | 249 invoices, taxes, expenses | reconciliation and readiness charts | finance visual added | 33-route matrix pass at six widths; reduced-motion runtime pass; human review open | AUTOMATED-PASS / HUMAN-REVIEW-OPEN |
| Payroll / People | 12 employees, 72 attendance, 12 salary slips, HR-depth records | attendance, payroll status, leave, claims, loans and hiring cards | visual attendance fallbacks | 33-route matrix pass at six widths; human review open | AUTOMATED-PASS / HUMAN-REVIEW-OPEN |
| Marketplace / Sync | 12 projections, settlement/outbox data | health and state flow | visual state coverage | 33-route matrix pass at six widths; human review open | AUTOMATED-PASS / HUMAN-REVIEW-OPEN |
| Catalogue / Pricing | 143 garments, 216 prices | visual matrix and coverage | visual empty states | 33-route matrix pass at six widths; human review open | AUTOMATED-PASS / HUMAN-REVIEW-OPEN |
| Print / Reports / Settings | routes and persisted documents | grouped evidence views; settings workspace tabs | route-level error/loading states | 33-route matrix includes reports/import/settings; settings tab-panel runtime check; human review open | AUTOMATED-PASS / HUMAN-REVIEW-OPEN |

## Release evidence required before marking all areas complete

1. Runtime screenshot or browser accessibility tree for each route at 1024, 1366, 1440 and 1920 where supported. Current automated evidence covers 33 populated-demo routes at 1024, 1280, 1366, 1440, 1920 and 2560 (198 captures); representative direct image review covers 13 primary routes plus customer detail at 1024, 1366 and 1920; a separate production-mode walkthrough verifies branded empty states on ten core operational surfaces. This is not yet a substitute for complete human visual acceptance.
2. Full server/web/desktop regression, clean database bootstrap and recovery evidence. The static accessibility audit, reduced-motion browser pass, authenticated server E2E workflow, 38 targeted server regressions, server typecheck/build and desktop release checks are green for the current implementation slice.
3. Demo fixture count and integrity check after restart.
4. Asset transparency/recognisability review and optimized derivatives for large generated files.
5. No unresolved critical/high visual or operational defects.

## Route-level evidence ledger

The automated route test is the evidence source for the shell, seeded data path, responsive render, and basic error guard. The `human review` column is intentionally explicit: a passing browser test does not certify visual quality by itself.

| Route | Purpose / primary action | Populated demo evidence | Chart / visual surface | Empty / loading / error state | Responsive / accessibility guard | Human review |
|---|---|---|---|---|---|---|
| Dashboard | Daily operating heartbeat | 256 orders, finance, attention queue | KPI strip, pipeline, trend, rankings | Shared operations/finance states; `VisualLoadingState` on query wait | 1024–2560 capture + shell/error guard + loading gate | Open |
| Overview | Period performance | Orders and collections | Trend, mix, comparisons | Shared finance state | 1024–2560 capture + shell/error guard | Open |
| Operations centre | Workload overview | Production and order workload | Flow cards and workload visuals | Shared operations state | 1024–2560 capture + shell/error guard | Open |
| New Order | Fast visual counter booking | 143 garments, five services | Category visuals, garment imagery, service tiles, order tray | Visual tray, query loading/error | 1024–2560 capture + keyboard path | Open |
| Store orders | Local order control | 256 orders | Page-scoped Order Pulse, state pipeline, payment attention, precise table | Visual order empty state + loading summary | 1024–2560 capture + shell/error guard | Open |
| Online orders | Marketplace acceptance and intake | 12 projections | Channel/state queue and work card | Visual order empty state | 1024–2560 capture + shell/error guard | Open |
| Customers | Customer 360 directory | 177 parties | Segments, value, retention signals | Visual customer empty state | 1024–2560 capture + shell/error guard | Open |
| Customer work card | Customer detail and lifecycle | Demo customer detail variant | Status journey, ledger, wallet, history | Detail loading/error states | Representative 1024/1366/1920 capture | Open |
| Print centre | Document output control | Persisted print jobs | Queue status and output actions | Visual operations empty state | 1024–2560 capture + shell/error guard | Open |
| Garment tracking | Physical identity trace | Durable units and tags | Scan/history surfaces | Visual operations state | 1024–2560 capture + shell/error guard | Open |
| Production queue | Stage execution | 995 tasks | Stage/due/exception views | Visual operations state | 1024–2560 capture + shell/error guard | Open |
| Quality claims | QC exceptions | Eight claims, rewash loop | Quality KPI and exception cards | Visual quality state | 1024–2560 capture + shell/error guard | Open |
| Corrections | Customer correction evidence | Correction documents | Evidence list and print action | Visual quality state | 1024–2560 capture + shell/error guard | Open |
| Returns | Return case control | Six return cases | Case register and refund distinction | Visual quality state | 1024–2560 capture + shell/error guard | Open |
| Pickup & delivery | Dispatch handoffs | Dispatch fixtures | Delivery queue and handoff state | Visual delivery state | 1024–2560 capture + shell/error guard | Open |
| Route runs | Rider route control | Three runs, nine stops | Capacity and exception visuals | Visual delivery state | 1024–2560 capture + shell/error guard | Open |
| Rider settlements | Collection reconciliation | Three settlements | Handover ledger and status | Visual finance state | 1024–2560 capture + shell/error guard | Open |
| Cash closing | Drawer accountability | Cash close fixtures | Variance and close controls | Visual finance state | 1024–2560 capture + shell/error guard | Open |
| Finance command centre | Management finance | 249 invoices, expenses, tax evidence | Revenue, cash, EBITDA, waterfall, settlement and quality charts | Finance readiness states | 1024–2560 capture + shell/error guard | Open |
| Statutory controls | TDS/TCS evidence | 18 TDS, 20 TCS, returns | Liability bars, policy distribution, calendar | Finance visual state | 1024–2560 capture + shell/error guard | Open |
| Store expense | Expense accounting | 24 expenses | Mix, drivers, ledger | Finance visual state | 1024–2560 capture + shell/error guard | Open |
| Care packages | Wallet/package liability | Package and redemption fixtures | Utilization and liability cards | Visual finance state | 1024–2560 capture + shell/error guard | Open |
| People & payroll | Workforce control | 12 employees, 72 attendance, payroll fixtures | Attendance ring, payroll and quality visuals | Operations visual state | 1024–2560 capture + shell/error guard | Open |
| Finance setup | Entity readiness | Store/tax configuration | Readiness sequence and configuration cards | Explicit incomplete-config state | 1024–2560 capture + shell/error guard | Open |
| Marketplace sync | Edge health | Sync checkpoint/outbox fixtures | Delivery state and diagnostics | Explicit not-configured/error states | 1024–2560 capture + shell/error guard | Open |
| Reports | Report centre | Saved/report fixtures | KPI, trend, fulfillment and ranking views | Finance visual state | 1024–2560 capture + shell/error guard | Open |
| Report detail | Evidence drill-down | Invoice/customer report rows | Structured table with pagination/export | Visual no-rows state | 1024–2560 capture + shell/error guard | Open |
| Catalogue | Visual pricing catalogue | 143 garments, 216 prices | Media matrix and rule panels | Visual operations state | 1024–2560 capture + shell/error guard | Open |
| Import prices/customers/catalogue | Controlled data import | Import history and templates | Review scope and job status | Progress/error/empty states | 1024–2560 capture + shell/error guard | Open |
| Store settings | Configuration and recovery | Settings fixture | Grouped readiness, capacity, hardware and recovery plus area navigator | Explicit loading/error states | 1024–2560 capture + shell/error guard | Open |
