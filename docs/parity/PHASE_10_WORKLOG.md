# Phase 10 worklog — expenses, notifications and communication

Status: In progress. The internal notification path is now live and scoped to
the authenticated branch; expense editing/attachments and communication
provider verification remain open.

## Implemented

- Laundry bookings, lifecycle transitions and payment collections create
  internal notification-centre entries without sending customer messages.
- Notification APIs now use the authenticated tenant/store context instead of
  the legacy global tenant, preventing cross-branch inbox leakage.
- The header bell is a working notification inbox with unread indicator,
  timestamps, severity-aware styling and mark-read actions.
- Existing WhatsApp/email/SMS gateway remains explicit-send and provider-safe;
  offline outcomes are labelled as logged rather than falsely delivered.

## Evidence

- Auth self-test verifies booking notification visibility through the scoped API.
- Server typecheck and laundry/payment/auth regression tests pass.
- No booking path invokes external customer messaging; booking still carries
  `suppress_notifications` on the invoice.

## Remaining gate items

- Expense edit/cancel, attachments and tax-detail UI with export reconciliation.
- Authenticated visual notification-centre and explicit WhatsApp template-send
  evidence, including retry/failure visibility.
