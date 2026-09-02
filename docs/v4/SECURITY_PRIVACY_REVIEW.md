# Security and privacy review

Existing strengths: loopback-only desktop server, authenticated startup handshake, sessions/RBAC, store scope, encrypted backup test coverage, and redacted diagnostics.

V4 threats requiring implementation/testing: stolen device credential, event replay and payload collision, forged payment/GSP webhook, vendor/store IDOR, aggregate-version tampering, stale quote, unsafe media, SSRF, catch-up-safe rate limiting, and PII exposure in exports/backups. DPDP retention, consent, export/correction/erasure, legal hold, and breach workflows are **NEEDS_LEGAL_VALIDATION** until current Indian requirements and business policy are approved.
