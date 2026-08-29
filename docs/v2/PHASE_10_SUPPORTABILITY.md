# Phase 10 — Supportability and release confidence

## Delivered

- Owner-only `GET /api/ops/diagnostics` returns a versioned, redacted support bundle.
- The bundle includes application/runtime versions, workspace mode and scope, migration names/checksums, aggregate entity/record counts, hardware capability status, and an explicit redaction contract.
- Customer names/phones, credentials, session tokens, database paths, financial amounts and raw row payloads are never returned.
- WhatsApp inbound audit/log records use one-way sender/message hashes and
  message length only; phone numbers and message bodies are not written to
  operational logs or audit payloads.
- Settings exposes **Export diagnostics** using the native Save As boundary in Electron (clipboard fallback in a browser build).
- GitHub Actions verifies server type safety, boundary self-tests (including
  financial normalization and authenticated offline replay), web production
  build, desktop workspace isolation, and high-severity production dependency
  audits on every main-branch push and pull request. It also publishes a
  CycloneDX server SBOM artifact.
- Passphrase-protected `.epicbackup` files use scrypt and AES-256-GCM; the
  passphrase is transient and never written to the database or diagnostics.
- A repeatable fresh-database recovery drill now restores a versioned backup
  after process/database replacement and verifies both the operational order
  and canonical financial entries.

## Operational boundary

Diagnostics are evidence for support and release triage, not a replacement for monitoring or an incident-management system. Production deployments still need signed artifacts, hosted CI secrets, crash telemetry and a tested restore drill before a release is called production-ready.
