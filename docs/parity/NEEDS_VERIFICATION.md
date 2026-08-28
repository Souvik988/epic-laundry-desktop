# Needs verification

These items are deliberately excluded from claims of UniClean parity until
authorised, non-destructive evidence exists. Epic may implement them as
labelled extensions when they are needed for a safe product.

| Item | Reason | Treatment |
|---|---|---|
| Reward earning/redemption formula | Metrics observed, formula not observed | Configurable Epic policy; label Epic extension. |
| Tax and discount precedence | Forms observed, calculation precedence not proven | Governed Epic policy; document decisions. |
| Package expiry and restoration | Package fields observed, lifecycle not proven | Implement explicit Epic policy and audit it. |
| OTP, proof of delivery and signatures | Not directly observed | Only add as Epic extension. |
| Garment barcode/QR encoding | Tags observed, encoding not proven | Use non-PII Epic payload and document it. |
| Payment gateway verification | Payment modes observed, provider flow not proven | Manual/configured-safe mode unless provider verifies success. |
| Hidden reports/tables/filter semantics | Some pages had no visible table | Implement only source-supported calculations. |
| Role permissions and store selection | Reference hidden role behavior was not tested | Define server-enforced Epic RBAC. |
| WhatsApp templates/automation | Action observed, template/automation not proven | Explicit-send, opt-in configuration, queued delivery. |

## Resolved baseline regressions

- Local browser smoke originally logged `GET /favicon.ico` → 404. The browser-served
  desktop app now references and serves the supplied Lndry mark as a local PNG
  favicon; repository-side builds and packaged static-asset checks pass.
