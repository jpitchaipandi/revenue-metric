import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { pool } from '../../db/client.js';
import { IngestError } from '../../errors/domain-errors.js';
import { upsertTransaction } from '../upsert.js';
import type { IngestResult } from '../types.js';
import { getStripe } from './client.js';
import { mapStripePaymentIntent } from './mapper.js';

const PAGE_LIMIT = 100;

/**
 * 24-hour overlap window. Stripe's `created` filter doesn't catch status
 * transitions (e.g. processing → succeeded happens with unchanged
 * created), so we re-fetch the last 24 hours of PaymentIntents to pick
 * up state changes. Idempotency at the upsert layer makes the overlap
 * a no-op for unchanged records.
 */
const OVERLAP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Ingest from Stripe test mode.
 *
 * Cursor: last_fetched_at on ingest_cursors. We fetch PaymentIntents
 * created in [max(INGEST_START_DATE, last_fetched_at - 24h), now). The
 * overlap absorbs status transitions; idempotency absorbs the duplication.
 *
 * Pagination: Stripe's auto-paginating iterator (`for await`) handles
 * `starting_after` internally — no manual loop needed.
 */
export async function ingestStripe(): Promise<IngestResult> {
  const started = Date.now();
  const startDate = new Date(`${env.INGEST_START_DATE}T00:00:00Z`);

  const runResult = await pool.query<{ id: string }>(
    `INSERT INTO ingest_runs (source, status) VALUES ('stripe', 'RUNNING') RETURNING id`,
  );
  const runId = runResult.rows[0]!.id;

  const log = logger.child({ source: 'stripe', runId });
  log.info('stripe_ingest_started');

  let recordsFetched = 0;
  let recordsUpserted = 0;
  let recordsSkipped = 0;
  let unknownStatusesFound = 0;

  try {
    const cursorResult = await pool.query<{ last_fetched_at: Date }>(
      `SELECT last_fetched_at FROM ingest_cursors WHERE source = 'stripe'`,
    );
    const lastFetched = cursorResult.rows[0]?.last_fetched_at;
    const since = lastFetched
      ? new Date(Math.max(startDate.getTime(), lastFetched.getTime() - OVERLAP_WINDOW_MS))
      : startDate;
    const sinceEpochSeconds = Math.floor(since.getTime() / 1000);

    log.info({ sinceIso: since.toISOString() }, 'stripe_fetch_window');

    const stripe = getStripe();
    const iter = stripe.paymentIntents.list({
      created: { gte: sinceEpochSeconds },
      limit: PAGE_LIMIT,
    });

    for await (const pi of iter) {
      try {
        const tx = mapStripePaymentIntent(pi);
        recordsFetched++;
        const { written, isUnknown } = await upsertTransaction(pool, tx);
        if (written) recordsUpserted++;
        else recordsSkipped++;
        if (isUnknown) unknownStatusesFound++;
      } catch (err) {
        if (err instanceof IngestError) {
          log.warn({ err, piId: pi.id }, 'stripe_pi_skipped');
          recordsSkipped++;
          continue;
        }
        throw err;
      }
    }

    // Update cursor: bookmark NOW so the next run picks up records
    // created after this one. The overlap window in the next run will
    // still re-fetch the last 24h to catch status transitions.
    await pool.query(
      `INSERT INTO ingest_cursors (source, last_fetched_at, records_fetched)
       VALUES ('stripe', NOW(), $1)
       ON CONFLICT (source) DO UPDATE
         SET last_fetched_at = NOW(),
             last_run_at = NOW(),
             records_fetched = ingest_cursors.records_fetched + EXCLUDED.records_fetched`,
      [recordsFetched],
    );

    const durationMs = Date.now() - started;
    await pool.query(
      `UPDATE ingest_runs
       SET status='SUCCESS', completed_at=NOW(),
           records_fetched=$1, records_upserted=$2, records_skipped=$3, unknown_statuses_found=$4
       WHERE id=$5`,
      [recordsFetched, recordsUpserted, recordsSkipped, unknownStatusesFound, runId],
    );
    log.info(
      { recordsFetched, recordsUpserted, recordsSkipped, unknownStatusesFound, durationMs },
      'stripe_ingest_complete',
    );

    return {
      source: 'stripe',
      recordsFetched,
      recordsUpserted,
      recordsSkipped,
      unknownStatusesFound,
      durationMs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE ingest_runs
       SET status='FAILED', completed_at=NOW(),
           records_fetched=$1, records_upserted=$2, records_skipped=$3, unknown_statuses_found=$4,
           error_message=$5
       WHERE id=$6`,
      [recordsFetched, recordsUpserted, recordsSkipped, unknownStatusesFound, message, runId],
    );
    log.error({ err }, 'stripe_ingest_failed');
    throw err;
  }
}
