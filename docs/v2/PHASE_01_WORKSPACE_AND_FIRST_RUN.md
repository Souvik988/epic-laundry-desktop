# V2 Phase 1 — Workspace Separation and First Run

**Status:** PARTIAL — the P0 data-contamination defect is fixed; the full
commercial setup checklist continues in later V2 work.

## Delivered

- Electron Main owns a persisted workspace preference and maps it to distinct
  files: `epic.sqlite` for production and `epic-demo.sqlite` for demo.
- The backend receives `EPIC_WORKSPACE_MODE`; only the explicit demo workspace
  seeds synthetic laundry records.
- Production startup creates neither fake customers, orders, riders, payments,
  expenses nor unrelated ERP demo records.
- Production catalogue masters are created only after explicit owner bootstrap.
- The first-run UI now captures business profile, owner credentials and core
  operational defaults (tax/GSTIN, currency, timezone and printer profile) in
  three resumable stages, writes store settings locally, and explains what was
  created. Business fields and the current step survive renderer restarts as a
  local draft; passwords are memory-only and removed after successful setup.
- Bootstrap preserves an explicitly requested tenant/store scope instead of
  silently falling back to the server default.
- The renderer displays the active workspace before sign-in and a permanent
  production/demo indicator afterward. Demo reset is separately confirmed and
  only deletes demo files.
- Owner settings can choose an OS directory for rolling recovery snapshots. The
  destination is selected by Electron, namespaced into separate production and
  demo folders, and is never accepted as an arbitrary renderer path.
- Owner settings now persist tax mode/GSTIN, currency, IANA timezone and printer
  profile, and show a readiness checklist for business profile, tax,
  currency/timezone, printer, catalogue and verified recovery snapshots. The
  checklist is derived from saved settings and live local capability/data checks.
- The owner setup-progress record is branch-scoped and audited: bootstrap marks
  business/owner/operations complete, the catalogue page explicitly records
  review, and a successful backup records recovery verification.

## Evidence

| Check | Result |
|---|---|
| `desktop` workspace isolation test | PASS — demo reset cannot touch the production file. |
| `server test:workspace-mode` | PASS — empty production has zero generated orders; explicit demo has sample orders. |
| Existing auth, customer, package, catalogue, payment, laundry, E2E, migration and restart tests | PASS. |
| Web build and Electron directory package | PASS. `workspace.js` verified inside `app.asar`. |
| Clean local production first-run walkthrough | PASS — setup renders, moves from business to owner stage, no browser console errors. |
| Bootstrap scope and resumable draft | PASS — API E2E verifies tenant preservation; renderer build verifies the password-free draft path. |

## Remaining Phase-1 work

- Catalogue review is now an explicit authenticated owner action from the
  catalogue command centre; its completion is persisted and audited per branch.
- Bootstrap completion and recovery verification are persisted in the scoped
  setup-progress record, so optional steps survive restarts instead of being
  inferred only from rendered UI.
- Upgrade backup format before presenting it as a full disaster-recovery package
  (tracked in V2 Phase 23).

No test data was placed in a production workspace during verification.
