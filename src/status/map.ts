import { logger } from '../config/logger.js';
import { CANONICAL_STATUS, type CanonicalStatus } from './canonical-status.js';
import { SOURCE_STATUS_MAPS } from './mappers.js';

/**
 * Map a provider-specific status string to a CanonicalStatus.
 *
 * Allow-list semantics: any source string not explicitly mapped returns
 * `UNKNOWN` and emits a structured `warn` log. UNKNOWN transactions are
 * still inserted into the database (so the mapping can be added later
 * and they replay correctly) but are NEVER counted as revenue by
 * `collected_revenue_v`.
 *
 * Never throws. Callers don't need a try/catch — they get a
 * CanonicalStatus back unconditionally.
 *
 * @param source     The source identifier (e.g. 'stripe', 'mock')
 * @param rawStatus  The raw status string from the provider
 * @param context    Extra fields included in the warning log if unmapped
 *                   (e.g. `{ sourceTransactionId }`)
 */
export function mapToCanonical(
  source: string,
  rawStatus: string,
  context: Record<string, unknown> = {},
): CanonicalStatus {
  const sourceMap = SOURCE_STATUS_MAPS[source];

  if (!sourceMap) {
    logger.warn(
      { source, rawStatus, ...context, action: 'mapToCanonical' },
      'unknown_ingest_source',
    );
    return CANONICAL_STATUS.UNKNOWN;
  }

  const canonical = sourceMap[rawStatus];
  if (canonical === undefined) {
    logger.warn(
      {
        source,
        rawStatus,
        ...context,
        action: 'mapToCanonical',
        resolution: 'Add mapping to src/status/mappers.ts and re-ingest',
      },
      'unmapped_source_status',
    );
    return CANONICAL_STATUS.UNKNOWN;
  }

  return canonical;
}
