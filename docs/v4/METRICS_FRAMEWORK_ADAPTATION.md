# Management metrics framework adaptation

Source reviewed: `mabge ment system_Metrics_Dashboard_Framework.xlsx` (a quick-commerce dashboard framework).

The workbook is a useful metrics design reference, not an Epic Laundry data contract. Grocery-specific benchmarks, SKU spoilage, 59-minute delivery, app-download and pincode-density assumptions are not imported.

| Workbook theme | Epic Laundry decision | Evidence / gate |
| --- | --- | --- |
| Sales, collection, AOV, repeat behaviour | **VERIFIED_CURRENT** | Derived from local orders, payments and customer history. |
| Quality, rewash, claims | **VERIFIED_CURRENT** | Durable garment claim/correction records. |
| Customer returns | **EPIC_EXTENSION** | A return case is evidence only; it does not claim a refund, credit note or provider outcome. |
| Rider and route productivity | **PARTIAL** | Route/rider records exist; staff shift evidence is now available. No traffic ETA is inferred. |
| Attendance / workforce capacity | **EPIC_EXTENSION** | Submitted daily attendance is unique per employee/date. Payroll remains policy-gated. |
| EBITDA / contribution bridge | **NEEDS_CONFIGURATION** | Direct cost, payroll cost, overhead and non-cash classifications must be supplied before calculation. |
| TDS/TCS | **NEEDS_LEGAL_VALIDATION** | No rate, threshold, filing, remittance or liability is inferred. A CA-approved effective-dated policy is required. |
| Cohorts, retention, customer lifetime value | **PARTIAL** | Possible from customer/order history after definitions and privacy policy approval. |

## Management dashboard principles

1. Visuals are used only for an operator or owner decision: capacity, quality risk, collections, exceptions, or cost readiness.
2. Every displayed financial amount traces to local canonical records and uses the existing reconciliation path.
3. Missing policy is a first-class state, not a zero value or a green success state.
4. The Finance and Workforce control room is part of the active Laundry Desk route tree; it is not a legacy Epic BOS surface.
