import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { pool } from '../../db/client.js';
import { IngestError } from '../../errors/domain-errors.js';
import { upsertTransaction } from '../upsert.js';
import type { IngestResult } from '../types.js';
import { mapMockRow, parseMockCsv } from './mapper.js';

/**
 * Ingest from the mock CSV. The mock source represents a legacy
 * billing system whose status vocabulary deliberately diverges from
 * Stripe — `paid`, `invoice_paid`, `invoice_void`, `invoice_disputed`,
 * etc. — so the allow-list mapper is exercised non-trivially.
 *
 * Records before INGEST_START_DATE are skipped (treated as already
 * ingested by an earlier system).
 */
export async function ingestMock(): Promise<IngestResult> {
  const started = Date.now();
  const startTime = new Date(`${env.INGEST_START_DATE}T00:00:00Z`);

  const runResult = await pool.query<{ id: string }>(
    `INSERT INTO ingest_runs (source, status) VALUES ('mock', 'RUNNING') RETURNING id`,
  );
  const runId = runResult.rows[0]!.id;

  const log = logger.child({ source: 'mock', runId });
  log.info('mock_ingest_started');

  let recordsFetched = 0;
  let recordsUpserted = 0;
  let recordsSkipped = 0;
  let unknownStatusesFound = 0;

  try {
    const csvPath = resolve(process.cwd(), env.MOCK_CSV_PATH);
    const content = await readFile(csvPath, 'utf8');
    const rows = parseMockCsv(content);

    for (const row of rows) {
      try {
        const tx = mapMockRow(row);
        if (tx.occurredAt < startTime) {
          recordsSkipped++;
          continue;
        }
        recordsFetched++;
        const { written, isUnknown } = await upsertTransaction(pool, tx);
        if (written) recordsUpserted++;
        else recordsSkipped++;
        if (isUnknown) unknownStatusesFound++;
      } catch (err) {
        if (err instanceof IngestError) {
          log.warn({ err, row }, 'mock_row_skipped');
          recordsSkipped++;
          continue;
        }
        throw err;
      }
    }

    await pool.query(
      `UPDATE ingest_cursors
       SET last_run_at = NOW(),
           last_fetched_at = NOW(),
           records_fetched = records_fetched + $1
       WHERE source = 'mock'`,
      [recordsFetched],
    );
    await pool.query(
      `INSERT INTO ingest_cursors (source, last_fetched_at, records_fetched)
       VALUES ('mock', NOW(), $1)
       ON CONFLICT (source) DO NOTHING`,
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
      'mock_ingest_complete',
    );

    return {
      source: 'mock',
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
    log.error({ err }, 'mock_ingest_failed');
    throw err;
  }
}
