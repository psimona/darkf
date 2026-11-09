# Run feedback — usage-limit-backoff

- **Date**: 2026-11-01
- **Engine/workflow**: darkf dev-loop
- **Run**: ef6efe84-60c2-4b41-bcbf-13f1820e9a59
- **Final outcome**: merged. Squashed feature/usage-limit-backoff to master as `feat: usage-limit-backoff (usage-limit-backoff)` (a719a08); branch deleted.
- **Scopes**: Usage-limit backoff shipped end to end: `usage-limit` CrashReason, `usageLimitRetryMs` (30 min default) and `usageLimitMaxWaitMs` (24 h default) leaf fields, a wait-and-resume engine loop that spends no retry attempt and emits `limitBackoff` heartbeats, opencode runner limit matching (`usage limit` / `rate limit` / `limit exceeded` / `429`) with session-continuation resume, status and monitor limit warnings, plus tests and docs-site coverage.

## What worked

- The loop ran clean on first attempts: Implement, Check, Review, and Document each succeeded without a rework iteration.
- Check passed the full gate: secret-scan, typecheck, lint, arch-check, and bun tests with coverage at 96% lines.
- Review verified the diff field-for-field against docs/specs/usage-limit-backoff/spec.md and approved without findings.
- Document updated README and 8 docs-site pages; the astro build succeeded (17 pages).
- Finish merged cleanly and confirmed in git log (a719a08 at master HEAD).

## Failures and root causes

none observed

## Notes

- The run took about 33 minutes wall time. Most of it was agent idle time in Implement (~17 min) and Document (~12 min), not tool or gate failures.
- This run never exercised the new backoff path itself. No usage-limit event appears in the journal; the feature shipped untested in live conditions. The next dev-loop run that hits a provider usage limit is the first real test of wait-and-resume.
- The 24 h cap renders as "probe N/48" in status because the 30 min retry divides it; that denominator is display-derived, not stored.
- Limit matching only runs on non-zero exit for the opencode runner. Failures from other runners will still crash as runner-error until they gain the same matcher.
