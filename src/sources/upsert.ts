import type { Pool, PoolClient } from 'pg';
import type { NormalizedTransaction } from './types.js';
import { CANONICAL_STATUS } from '../status/canonical-status.js';

export interface UpsertResult {
  /** True iff a write occurred (inserted or status/amount changed). */
  written: boolean;
  /** True iff canonical_status === UNKNOWN — useful for ingest-run counters. */
  isUnknown: boolean;
}

/**
 * Idempotent upsert of a normalized transaction.
 *
 * Key: (source, source_transaction_id). Re-ingesting the same transaction
 * with unchanged status + amount is a structural no-op — no row written,
 * no `ingested_at` churn — because of the WHERE guard.
 *
 * The guard checks BOTH amount and canonical_status because a transaction
 * can legitimately transition over its lifecycle (e.g. `processing` →
 * `succeeded`), and that transition IS a write we want to capture.
 *
 * Returns:
 *  - `written: true` if the row was inserted, or updated due to a status/
 *    amount change.
 *  - `written: false` if the row already existed with identical values.
 *  - `isUnknown` is independent: it's true whenever the new row has
 *    `canonical_status = UNKNOWN`, regardless of whether a write occurred.
 */
export async function upsertTransaction(
  client: Pool | PoolClient,
  tx: NormalizedTransaction,
): Promise<UpsertResult> {
  const result = await client.query<{ id: string }>(
    `
    INSERT INTO transactions (
      source, source_transaction_id, amount_cents, currency,
      source_status, canonical_status, occurred_at, raw_payload
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    ON CONFLICT (source, source_transaction_id) DO UPDATE
      SET amount_cents     = EXCLUDED.amount_cents,
          currency         = EXCLUDED.currency,
          source_status    = EXCLUDED.source_status,
          canonical_status = EXCLUDED.canonical_status,
          occurred_at      = EXCLUDED.occurred_at,
          raw_payload      = EXCLUDED.raw_payload,
          ingested_at      = NOW()
      WHERE transactions.canonical_status <> EXCLUDED.canonical_status
         OR transactions.amount_cents     <> EXCLUDED.amount_cents
         OR transactions.source_status    <> EXCLUDED.source_status
    RETURNING id
    `,
    [
      tx.source,
      tx.sourceTransactionId,
      tx.amountCents,
      tx.currency,
      tx.sourceStatus,
      tx.canonicalStatus,
      tx.occurredAt,
      tx.rawPayload ? JSON.stringify(tx.rawPayload) : null,
    ],
  );

  return {
    written: result.rows.length > 0,
    isUnknown: tx.canonicalStatus === CANONICAL_STATUS.UNKNOWN,
  };
}
