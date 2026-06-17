/**
 * Re-export of `REVENUE_ALLOW_LIST` for use within `metrics/`.
 *
 * Architectural contract:
 * - This is the only module outside `src/status/` permitted to import
 *   from `src/status/canonical-status.ts`.
 * - The SQL view `collected_revenue_v` (002_views.sql) is the runtime
 *   authority on which transactions count as revenue; this constant
 *   documents the same intent at the TypeScript level and supports
 *   the property test in `metrics/service.test.ts`.
 *
 * If a future engineer wants to compute "revenue" by some other
 * definition, they must (a) add a new canonical status, (b) update
 * the view, (c) update REVENUE_ALLOW_LIST — and CI will catch each
 * step independently.
 */
export {
  CANONICAL_STATUS,
  REVENUE_ALLOW_LIST,
  isCollectedRevenue,
  type CanonicalStatus,
} from '../status/canonical-status.js';
