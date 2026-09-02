# Release readiness

Current status: **not a production candidate**.

Passed locally in this V4 work session: clean database bootstrap regression, server typecheck/build and all existing server self-tests, web build, and static accessibility audit. The most recent remote `main` CI run for baseline SHA `7276726` failed at `test:ops`; its source fix is local and cannot be called green until committed and evaluated by CI.

Missing: marketplace sync acceptance tests, line-level tax/invoice evidence, runtime visual QA, Windows package/launch CI, production signing, trusted update feed, real hardware validation, provider credentials, and legal/CA approvals.
