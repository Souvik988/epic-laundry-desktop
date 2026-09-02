# Release readiness

Current status: **not a production candidate**.

Passed locally in this V4 work session: the complete current server CI test list (including the formerly failing `test:ops`), clean database bootstrap regression, migration/catalogue/garment-asset checks, server typecheck/build, SQL-backed order pagination regression, web build, static accessibility audit, Playwright smoke, desktop workspace/recovery/signature/manifest checks, Windows unsigned packaging, installed launch, and responsive/contact-sheet runtime inspection. The fresh release manifest verifies 3,719 entries; the installed package contains the new cancellation-credit-note module and current IRN service. The most recent remote `main` CI run for baseline SHA `7276726` failed at `test:ops`; local fixes have not been pushed and therefore cannot be called green remotely.

Missing or partial: real marketplace cloud contract/transport, complete canonical invoice wiring through every legacy document path, Windows package/launch CI on remote main, production signing, trusted update feed, real hardware validation, provider credentials, performance benchmark evidence, remaining visual-owner review, and legal/CA approvals.
