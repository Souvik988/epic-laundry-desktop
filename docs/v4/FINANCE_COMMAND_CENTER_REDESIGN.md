# Finance Command Center redesign

## Audit snapshot — 2026-09-10

The statutory workspace is backed by `server/src/modules/finance/statutory.ts` and not by frontend-only totals. It already uses fixed-scale paise, stores an immutable source-reference snapshot, creates a liability posting, de-duplicates source retries, records audit events, and preserves policy/version data with each posting.

Return preparation is idempotent for the return type and period. A submitted, acknowledged, or accepted return requires an evidence reference; accepted also requires an acknowledgement number. The local product has no government portal upload adapter, so the UI must not report a filing as complete merely because a return was prepared.

## Current capability map

| Area | Current authority | Redesigned experience |
| --- | --- | --- |
| TDS | Controlled server calculation and immutable source posting | Explainable preview before post; liability/source drill-down |
| GST ECO TCS | Controlled server calculation and immutable source posting | Separate posting path; never blended with income-tax TCS |
| Income-tax TCS | Accountant-configured, effective-dated policy; approval state required by existing engine | Guided policy builder with advanced details collapsed |
| Returns | Prepared/validated/exported/submitted/acknowledged/accepted lifecycle | Calendar, attention queue and focused return drawer |
| Evidence | Reference and acknowledgement fields with audit event | Evidence workspace; no fictional upload or portal success |
| Liability reporting | Posted TDS/TCS transactions grouped by policy | Finance health, segmented liability picture, transaction traceability |

## Deliberate constraints

- The redesign does not alter statutory rates, deadlines, classifications, or calculation code.
- No payment, filing, ARN, acknowledgement, IRN, or provider success is fabricated.
- The health indicator is deterministic (`Controlled`, `On track with actions`, or `Attention required`), not an unexplained numeric score.
- A prepared return remains explicitly *not filed*.
- Raw policy keys are available only in advanced details; operators see human names first.

## Implementation decisions

The API now supplies a read-only command-center projection derived from the same statutory records: attention items, due/overdue timeline states, human policy labels, and a deterministic finance-health state. No schema migration was required and no posted financial data is changed by the projection.

The frontend is organized by the operating questions:

1. Overview — what needs attention?
2. Liabilities — what is recorded and which source created it?
3. Returns — what must be prepared, evidenced, or completed?
4. Policies — which controlled calculation policy applies?

Posting and return evidence are contained in right-side workspaces so the command view remains compact. The post workflow always requests a server calculation preview before enabling a post action.
