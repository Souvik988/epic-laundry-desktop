# Release readiness

Current status: **not a production candidate**.

Passed locally in this V4 work session: clean database bootstrap regression, server typecheck/build and complete server self-test set (including cross-channel simulator), web build, static accessibility audit, Playwright smoke, desktop workspace/recovery/signature/manifest checks, Windows unsigned packaging, installed launch, and responsive runtime inspection at 1024/1366/1440/1920px. The most recent remote `main` CI run for baseline SHA `7276726` failed at `test:ops`; local fixes have not been pushed and therefore cannot be called green remotely.

Missing or partial: real marketplace cloud contract/transport, complete canonical invoice wiring through every legacy document path, Windows package/launch CI on remote main, production signing, trusted update feed, real hardware validation, provider credentials, performance benchmark evidence, full media contact-sheet review, and legal/CA approvals.
