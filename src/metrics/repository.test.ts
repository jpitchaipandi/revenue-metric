import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { closePool, pool } from '../db/client.js';
import { CANONICAL_STATUS } from '../status/canonical-status.js';
import { bucketCollected, listUnknownStatuses, sumCollected } from './repository.js';

/**
 * Integration tests against a real Supabase. Each test runs inside a
 * transaction that ROLLBACKs in afterEach, so test data never persists.
 */
describe('metrics/repository', () => {
  let client: PoolClient;

  beforeAll(async () => {
    const test = await pool.query('SELECT 1');
    expect(test.rowCount).toBe(1);
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    // Wipe ALL transactions inside the transaction so each test runs
    // against a known-empty table. The ROLLBACK in afterEach restores
    // everything — production data is unaffected.
    await client.query('DELETE FROM transactions');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  afterAll(async () => {
    await closePool();
  });

  async function insertTx(args: {
    id: string;
    amountCents: number;
    canonicalStatus: string;
    occurredAt: string;
    currency?: string;
    sourceStatus?: string;
  }): Promise<void> {
    await client.query(
      `INSERT INTO transactions
        (source, source_transaction_id, amount_cents, currency,
         source_status, canonical_status, occurred_at)
       VALUES ('test', $1, $2, $3, $4, $5, $6)`,
      [
        args.id,
        args.amountCents,
        args.currency ?? 'USD',
        args.sourceStatus ?? 'mapped',
        args.canonicalStatus,
        args.occurredAt,
      ],
    );
  }

  describe('sumCollected', () => {
    it('returns zero when no transactions exist in the range', async () => {
      const result = await sumCollected(
        {
          from: new Date('2024-01-01T00:00:00Z'),
          to: new Date('2024-12-31T23:59:59Z'),
          currency: 'USD',
        },
        client,
      );
      expect(result.totalCents).toBe(0);
      expect(result.transactionCount).toBe(0);
    });

    it('sums only COLLECTED transactions', async () => {
      await insertTx({ id: 't1', amountCents: 1000, canonicalStatus: CANONICAL_STATUS.COLLECTED, occurredAt: '2024-03-01T10:00:00Z' });
      await insertTx({ id: 't2', amountCents: 2500, canonicalStatus: CANONICAL_STATUS.COLLECTED, occurredAt: '2024-03-15T10:00:00Z' });
      await insertTx({ id: 't3', amountCents: 999_999, canonicalStatus: CANONICAL_STATUS.PENDING, occurredAt: '2024-03-20T10:00:00Z' });
      await insertTx({ id: 't4', amountCents: 999_999, canonicalStatus: CANONICAL_STATUS.REFUNDED, occurredAt: '2024-03-25T10:00:00Z' });
      await insertTx({ id: 't5', amountCents: 999_999, canonicalStatus: CANONICAL_STATUS.UNKNOWN, occurredAt: '2024-03-26T10:00:00Z' });

      const result = await sumCollected(
        { from: new Date('2024-03-01T00:00:00Z'), to: new Date('2024-04-01T00:00:00Z'), currency: 'USD' },
        client,
      );
      expect(result.totalCents).toBe(3500);
      expect(result.transactionCount).toBe(2);
    });

    it('respects the half-open interval [from, to)', async () => {
      await insertTx({ id: 'edge-from', amountCents: 100, canonicalStatus: CANONICAL_STATUS.COLLECTED, occurredAt: '2024-03-01T00:00:00Z' });
      await insertTx({ id: 'edge-to',   amountCents: 200, canonicalStatus: CANONICAL_STATUS.COLLECTED, occurredAt: '2024-04-01T00:00:00Z' });

      const result = await sumCollected(
        { from: new Date('2024-03-01T00:00:00Z'), to: new Date('2024-04-01T00:00:00Z'), currency: 'USD' },
        client,
      );
      expect(result.totalCents).toBe(100); // edge-from included, edge-to excluded
    });

    it('filters by currency', async () => {
      await insertTx({ id: 'usd', amountCents: 100, canonicalStatus: CANONICAL_STATUS.COLLECTED, occurredAt: '2024-03-01T00:00:00Z', currency: 'USD' });
      await insertTx({ id: 'eur', amountCents: 999, canonicalStatus: CANONICAL_STATUS.COLLECTED, occurredAt: '2024-03-01T00:00:00Z', currency: 'EUR' });

      const result = await sumCollected(
        { from: new Date('2024-03-01T00:00:00Z'), to: new Date('2024-04-01T00:00:00Z'), currency: 'USD' },
        client,
      );
      expect(result.totalCents).toBe(100);
    });
  });

  describe('bucketCollected', () => {
    it('returns empty array when no data', async () => {
      const buckets = await bucketCollected(
        {
          from: new Date('2024-01-01T00:00:00Z'),
          to: new Date('2024-12-31T23:59:59Z'),
          currency: 'USD',
          granularity: 'day',
        },
        client,
      );
      expect(buckets).toEqual([]);
    });

    it('groups by day', async () => {
      await insertTx({ id: 'a1', amountCents: 100, canonicalStatus: CANONICAL_STATUS.COLLECTED, occurredAt: '2024-03-01T10:00:00Z' });
      await insertTx({ id: 'a2', amountCents: 200, canonicalStatus: CANONICAL_STATUS.COLLECTED, occurredAt: '2024-03-01T22:00:00Z' });
      await insertTx({ id: 'b1', amountCents: 50,  canonicalStatus: CANONICAL_STATUS.COLLECTED, occurredAt: '2024-03-02T05:00:00Z' });

      const buckets = await bucketCollected(
        { from: new Date('2024-03-01T00:00:00Z'), to: new Date('2024-04-01T00:00:00Z'), currency: 'USD', granularity: 'day' },
        client,
      );
      expect(buckets).toHaveLength(2);
      expect(buckets[0]!.totalCents).toBe(300); // 2024-03-01
      expect(buckets[1]!.totalCents).toBe(50);  // 2024-03-02
    });

    it('the sum of all daily buckets equals sumCollected over the same range', async () => {
      for (let i = 0; i < 10; i++) {
        await insertTx({
          id: `seq-${i}`,
          amountCents: 100 * (i + 1),
          canonicalStatus: CANONICAL_STATUS.COLLECTED,
          occurredAt: `2024-03-${String(i + 1).padStart(2, '0')}T12:00:00Z`,
        });
      }
      const filter = {
        from: new Date('2024-03-01T00:00:00Z'),
        to: new Date('2024-04-01T00:00:00Z'),
        currency: 'USD',
      };
      const total = await sumCollected(filter, client);
      const buckets = await bucketCollected({ ...filter, granularity: 'day' }, client);
      const summed = buckets.reduce((acc, b) => acc + b.totalCents, 0);
      expect(summed).toBe(total.totalCents);
    });

    it('excludes non-COLLECTED statuses from buckets', async () => {
      await insertTx({ id: 'c', amountCents: 100, canonicalStatus: CANONICAL_STATUS.COLLECTED, occurredAt: '2024-03-01T10:00:00Z' });
      await insertTx({ id: 'p', amountCents: 999, canonicalStatus: CANONICAL_STATUS.PENDING,   occurredAt: '2024-03-01T11:00:00Z' });

      const buckets = await bucketCollected(
        { from: new Date('2024-03-01T00:00:00Z'), to: new Date('2024-04-01T00:00:00Z'), currency: 'USD', granularity: 'day' },
        client,
      );
      expect(buckets).toHaveLength(1);
      expect(buckets[0]!.totalCents).toBe(100);
    });
  });

  describe('listUnknownStatuses', () => {
    it('returns empty when no UNKNOWN transactions exist', async () => {
      await insertTx({ id: 'c', amountCents: 100, canonicalStatus: CANONICAL_STATUS.COLLECTED, occurredAt: '2024-03-01T10:00:00Z' });
      const out = await listUnknownStatuses(client);
      expect(out).toEqual([]);
    });

    it('groups UNKNOWN rows by (source, source_status) with counts', async () => {
      await insertTx({ id: 'u1', amountCents: 1, canonicalStatus: CANONICAL_STATUS.UNKNOWN, occurredAt: '2024-03-01T10:00:00Z', sourceStatus: 'settled_with_fee' });
      await insertTx({ id: 'u2', amountCents: 1, canonicalStatus: CANONICAL_STATUS.UNKNOWN, occurredAt: '2024-03-02T10:00:00Z', sourceStatus: 'settled_with_fee' });
      await insertTx({ id: 'u3', amountCents: 1, canonicalStatus: CANONICAL_STATUS.UNKNOWN, occurredAt: '2024-03-03T10:00:00Z', sourceStatus: 'magicked' });

      const out = await listUnknownStatuses(client);
      const settled = out.find((r) => r.sourceStatus === 'settled_with_fee');
      const magicked = out.find((r) => r.sourceStatus === 'magicked');
      expect(settled?.count).toBe(2);
      expect(magicked?.count).toBe(1);
    });
  });
});
