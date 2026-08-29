# V2 Phase 9 — Hardware adapter boundaries

**Status:** PARTIAL — local scanner and native print paths are explicit and
receipt-backed; physical scale, cash-drawer, RFID, and thermal-printer drivers
are not configured in this workspace.

## Delivered

- Added a capability registry that reports each device class as available or
  not configured with evidence, never as a fabricated success.
- Added hardware-receipt records with operation, device, source document,
  result, evidence, actor, timestamp, and SHA-256 evidence hash.
- Electron print callbacks now create a receipt for successful or cancelled
  receipt/tag print attempts.
- Receipt creation is idempotent and available through owner/operational API
  permissions for support and audit tooling.
- Added `GET /api/ops/hardware-status` and a Store settings health panel. The
  branch-scoped projection distinguishes adapter availability from observed
  receipts (`evidence_seen`, `awaiting_evidence`, `degraded`, or
  `not_configured`) and exposes last-seen device evidence without claiming a
  physical connection.

## Evidence

| Check | Result |
|---|---|
| `server npm run test:hardware` | PASS — truthful capabilities, evidence requirement, hash, retained receipt, and health projection. |
| `server npm run test:e2e` | PASS — authenticated hardware-status endpoint. |
| `server npm run typecheck` and `webapp npm run build` | PASS |

## Remaining work before hardware production readiness

- Implement and certify vendor-specific scanner, weighing-scale, cash-drawer,
  thermal-printer, and RFID adapters with device-level receipts and failure
  recovery tests.
- Add device enrollment, active health polling, access control, and offline
  queueing for transient hardware outages; the current status projection is
  receipt-based rather than a live driver connection.
