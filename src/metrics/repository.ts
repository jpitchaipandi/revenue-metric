import type { Pool, PoolClient } from 'pg';
import { pool as defaultPool } from '../db/client.js';

export type Granularity = 'day' | 'week' | 'month';

export interface MetricFilter {
  from: Date;
  to: Date;
  currency: string;
}

export interface MetricTimeseriesFilter extends MetricFilter {
  granularity: Granularity;
}

export interface RevenueTotal {
  totalCents: number;
  transactionCount: number;
}

export interface RevenueBucket {
  bucket: Date;
  totalCents: number;
  transactionCount: number;
}

/**
 * ============================================================
 * THE ONLY FILE IN THE CODEBASE PERMITTED TO QUERY
 * `collected_revenue_v` OR THE `transactions` TABLE FOR REVENUE.
 * ============================================================
 *
 * Both `sumCollected` and `bucketCollected` share an identical WHERE
 * clause (currency + half-open date range) against the same view. They
 * differ only in GROUP BY / aggregation shape. That structural sameness
 * is the architectural guarantee that summary total == sum of timeseries
 * buckets — see the property test in `metrics/service.test.ts`.
 *
 * Half-open interval: `occurred_at >= from AND occurred_at < to`. The
 * service layer is responsible for validating from < to; this module
 * trusts inputs.
 *
 * Bucket boundaries use `date_trunc(... AT TIME ZONE 'UTC')` — the
 * timezone is explicit and constant so identical date ranges return
 * identical buckets regardless of session settings.
 */

const VIEW = 'collected_revenue_v';

export async function sumCollected(
  filter: MetricFilter,
  client: Pool | PoolClient = defaultPool,
): Promise<RevenueTotal> {
  const result = await client.query<{ total_cents: string | null; transaction_count: string }>(
    `
    SELECT
      COALESCE(SUM(amount_cents), 0)::TEXT AS total_cents,
      COUNT(*)::TEXT                       AS transaction_count
    FROM ${VIEW}
    WHERE currency = $1
      AND occurred_at >= $2
      AND occurred_at <  $3
    `,
    [filter.currency, filter.from, filter.to],
  );

  const row = result.rows[0]!;
  return {
    totalCents: Number(row.total_cents ?? '0'),
    transactionCount: Number(row.transaction_count),
  };
}

export async function bucketCollected(
  filter: MetricTimeseriesFilter,
  client: Pool | PoolClient = defaultPool,
): Promise<RevenueBucket[]> {
  // Timezone trap: `AT TIME ZONE 'UTC'` once converts TIMESTAMPTZ to a
  // naive TIMESTAMP at the UTC instant. date_trunc on that naive value
  // truncates correctly in UTC. The second `AT TIME ZONE 'UTC'` re-tags
  // the result as TIMESTAMPTZ so node-postgres serialises it as a UTC
  // ISO string. Without the second wrap, Node interprets the naive
  // timestamp in the server's session timezone — bucket boundaries
  // silently drift to whatever local TZ the server is on.
  const result = await client.query<{
    bucket: Date;
    total_cents: string;
    transaction_count: string;
  }>(
    `
    SELECT
      (date_trunc($1, occurred_at AT TIME ZONE 'UTC')) AT TIME ZONE 'UTC' AS bucket,
      COALESCE(SUM(amount_cents), 0)::TEXT             AS total_cents,
      COUNT(*)::TEXT                                   AS transaction_count
    FROM ${VIEW}
    WHERE currency = $2
      AND occurred_at >= $3
      AND occurred_at <  $4
    GROUP BY bucket
    ORDER BY bucket ASC
    `,
    [filter.granularity, filter.currency, filter.from, filter.to],
  );

  return result.rows.map((r) => ({
    bucket: r.bucket,
    totalCents: Number(r.total_cents),
    transactionCount: Number(r.transaction_count),
  }));
}

/**
 * Diagnostic: list every (source, source_status) pair where the mapper
 * produced `UNKNOWN`. Surfaces drift — new statuses from providers
 * that haven't yet been added to a code-level mapper.
 *
 * Empty array = healthy. Non-empty = action needed
 * (add entries to src/status/mappers.ts and re-ingest).
 */
export interface UnknownStatusCoverage {
  source: string;
  sourceStatus: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
}

export async function listUnknownStatuses(
  client: Pool | PoolClient = defaultPool,
): Promise<UnknownStatusCoverage[]> {
  const result = await client.query<{
    source: string;
    source_status: string;
    count: string;
    first_seen: Date;
    last_seen: Date;
  }>(
    `
    SELECT
      source,
      source_status,
      COUNT(*)::TEXT          AS count,
      MIN(ingested_at)        AS first_seen,
      MAX(ingested_at)        AS last_seen
    FROM transactions
    WHERE canonical_status = 'UNKNOWN'
    GROUP BY source, source_status
    ORDER BY count DESC, source, source_status
    `,
  );

  return result.rows.map((r) => ({
    source: r.source,
    sourceStatus: r.source_status,
    count: Number(r.count),
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
  }));
}
