import type { CanonicalStatus } from '../status/canonical-status.js';

/**
 * A transaction normalized to the schema in `transactions`.
 *
 * Notes:
 * - `amountCents` is an integer; floating-point currency is forbidden
 *   throughout the system. Provider amounts that arrive as decimals
 *   must be `Math.round(amount * 100)` at ingest.
 * - `canonicalStatus` is the OUTPUT of `mapToCanonical(source, sourceStatus)`.
 *   The mapper, not the caller, decides what to put here.
 * - `rawPayload` lets us replay or audit a transaction without re-fetching
 *   from the provider; useful when a new mapping entry retroactively
 *   re-classifies historical UNKNOWN rows.
 */
export interface NormalizedTransaction {
  source: string;
  sourceTransactionId: string;
  amountCents: number;
  currency: string;
  sourceStatus: string;
  canonicalStatus: CanonicalStatus;
  occurredAt: Date;
  rawPayload?: Record<string, unknown>;
}

/**
 * Result of an ingest run for a single source. Returned from each
 * ingest module's main entry point so the `/ingest/:source` route can
 * report what happened.
 */
export interface IngestResult {
  source: string;
  recordsFetched: number;
  recordsUpserted: number;
  recordsSkipped: number;
  unknownStatusesFound: number;
  durationMs: number;
}
