# Demo Data V4 — Installed Workspace Fixture

## Purpose

The demo workspace is intentionally populated so that operational, finance, tax, quality, returns, marketplace and reporting screens have meaningful data at first launch. This is a visual and workflow fixture, not production evidence.

## Safety

The seed runs only when `EPIC_WORKSPACE_MODE=demo` for tenant `T1`. It uses versioned V4.6–V4.10 markers and deterministic source references, so restarting the app does not duplicate records. Production mode does not receive generated demo data.

The isolated demo login is deterministic for training builds: username `demo`, password `DemoLaundry!2026`. The account is created and maintained only while the server is in demo mode; production never seeds or accepts this demo credential. The login screen pre-fills these values in demo mode so a reviewer can open the seeded workspace without guessing which historical account was used.

## Evidence boundary

Prepared statutory returns, sandbox e-invoice state, pending sync events and demo settlement evidence are visibly demo/control-plane fixtures. They do not mean that a government return, IRN, payment-provider capture or payout occurred. Real PAN/TAN/GST, state policies, provider credentials and external filing evidence remain user-configured.

The installed demo workspace also includes additive lifecycle, experience and HR-depth coverage (V4.9–V4.10): 256 orders across every order state, 177 customers/parties, 249 canonical invoice snapshots, a garment in the Rewash state, 13 wallet entries, 4 reward entries, 11 customer addresses, 6 print jobs spanning queued, rendering, printed, downloaded, failed and cancelled states, 3 leave applications, 3 expense claims, 2 employee loans, 2 job openings, 4 applicants and 3 interviews. Route coverage includes completed, in-progress and planned runs plus one persisted skipped stop with a required audit reason. These fixtures are created through the domain commands and are idempotent; they remain demo evidence only.

## Installed verification

The current installed database was checked after reinstall:

| Fixture | Count |
| --- | ---: |
| Laundry orders | 256 |
| Canonical invoice snapshots | 249 |
| Expenses | 24 |
| TDS transactions | 18 |
| TCS transactions | 20 |
| Prepared returns | 8 |
| Quality claims | 8 |
| Return cases | 6 |
| Marketplace projections | 12 |
| Marketplace settlements | 6 |
| Marketplace cash collections | 2 |
| Route runs | 3 |
| Employees | 12 |
| Attendance records | 72 |
| Leave applications | 3 |
| Expense claims | 3 |
| Employee loans | 2 |
| Job openings | 2 |
| Job applicants | 4 |
| Interviews | 3 |

The local server health endpoint returned `ok` after launch, and the clean temporary-workspace restart test returned identical counts before and after restart.
