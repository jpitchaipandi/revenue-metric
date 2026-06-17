## Summary
<!-- 1-3 bullets describing what changed and why -->

## Revenue metric checklist
<!-- Required if your diff touches anything related to revenue calculation.
     Delete this section if your change doesn't touch metrics. -->

- [ ] No new direct queries against `transactions` or `collected_revenue_v` outside `src/metrics/repository.ts`
- [ ] No new uses of the string `'collected_revenue_v'` outside `src/metrics/repository.ts` or `src/db/schema.ts`
- [ ] If a new provider status was added: mapper updated in `src/status/mappers.ts`, allow-list completeness test still passes, status-coverage endpoint returns the new status under `unknown_statuses` (or doesn't if it's mapped to a non-UNKNOWN canonical)
- [ ] If `REVENUE_ALLOW_LIST` or `collected_revenue_v` changed: updated [ARCHITECTURE.md](../ARCHITECTURE.md) and added a release note explaining the metric-definition change
- [ ] Property test in `src/metrics/service.test.ts` still passes (bumped to `numRuns: 500` if metric logic was touched)

## CI gates
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean (catches `'collected_revenue_v'` string drift)
- [ ] `npm run depcruise` clean (catches `canonical-status.ts` import drift)
- [ ] `npm test` clean (52+ tests including 50 property-test trials)

## Test plan
<!-- How did you verify this works? Curl commands, screenshots, etc. -->
