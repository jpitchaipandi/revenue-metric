/**
 * Canonical status vocabulary for the revenue metric service.
 *
 * Every provider-specific status is mapped to one of these at ingest time
 * (see `src/status/mappers.ts` + `src/status/map.ts`). The DB CHECK
 * constraint on `transactions.canonical_status` enforces this same set —
 * adding a value here must be paired with a SQL migration that updates
 * the constraint.
 *
 * UNKNOWN is the default-deny terminal: any source status the mapper
 * doesn't recognise lands here. Such transactions are still inserted
 * (so they're auditable and can be replayed once the mapping is added),
 * but they are NEVER counted as revenue.
 */
export const CANONICAL_STATUS = {
  COLLECTED: 'COLLECTED',
  PENDING: 'PENDING',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
  VOIDED: 'VOIDED',
  UNKNOWN: 'UNKNOWN',
} as const;

export type CanonicalStatus = (typeof CANONICAL_STATUS)[keyof typeof CANONICAL_STATUS];

/**
 * THE allow-list of statuses that count toward "revenue collected".
 *
 * This is the single, authoritative definition. The SQL view
 * `collected_revenue_v` (002_views.sql) filters on `canonical_status =
 * 'COLLECTED'` — those two definitions must stay in sync.
 *
 * DO NOT add PENDING, REFUNDED, or any other status here. Refunds are
 * tracked as a separate metric — net revenue, if ever required,
 * composes at the service layer.
 *
 * This is a `Set` (not an array) so membership checks are O(1) and the
 * intent is unambiguous.
 */
export const REVENUE_ALLOW_LIST: ReadonlySet<CanonicalStatus> = new Set<CanonicalStatus>([
  CANONICAL_STATUS.COLLECTED,
]);

/**
 * True iff the given canonical status counts as collected revenue.
 * The ONLY function that should be used to make this determination
 * in TypeScript code — never compare against a string literal.
 */
export function isCollectedRevenue(status: CanonicalStatus): boolean {
  return REVENUE_ALLOW_LIST.has(status);
}
