# Security and privacy review

Existing strengths: loopback-only desktop server, authenticated startup handshake, sessions/RBAC, store scope, encrypted backup test coverage, redacted diagnostics, event-ID/payload-collision rejection, ordered aggregate checks, and fail-closed provider webhook verification.

V4 threats requiring implementation/testing: stolen device credential, forged payment/GSP webhook, vendor/store IDOR, aggregate-version tampering, stale quote, unsafe media, SSRF, catch-up-safe rate limiting, and PII exposure in exports/backups. Local event replay and payload collision controls are verified against the simulator; cloud-issued device credentials, signed transport, and cross-tenant authorization remain external-contract work. DPDP retention, consent, export/correction/erasure, legal hold, and breach workflows are **NEEDS_LEGAL_VALIDATION** until current Indian requirements and business policy are approved.
