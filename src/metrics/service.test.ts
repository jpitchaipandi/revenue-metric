import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import type { PoolClient } from 'pg';
import { closePool, pool } from '../db/client.js';
import { CANONICAL_STATUS } from '../status/canonical-status.js';
import { computeTimeseries, computeTotal } from './service.js';
import { InvalidCurrencyError, InvalidQueryError } from '../errors/domain-errors.js';

/**
 * THE CONTRACT TEST.
 *
 * For ANY (from, to, granularity) tuple over the seeded dataset:
 *   computeTotal(...).totalCents === sum(computeTimeseries(...).buckets[*].totalCents)
 *
 * If a future commit accidentally changes one query but not the other,
 * or introduces a divergent revenue calculation, this test fails and
 * blocks the PR.
 */

const TEST_SOURCE_PREFIX = 'proptest-';
const TEST_SOURCE = `${TEST_SOURCE_PREFIX}${crypto.randomUUID()}`;

describe('metrics/service — contract: total == sum(timeseries buckets)', () => {
  let client: PoolClient;

  // Seeded fixed-yet-varied dataset spanning roughly 9 months, mixed
  // statuses, mixed currencies — enough to make the invariant non-trivial.
  const seedSpec: Array<{ amount: number; status: string; iso: string; currency?: string }> = [
    { amount: 12500, status: CANONICAL_STATUS.COLLECTED, iso: '2024-01-05T08:00:00Z' },
    { amount: 27500, status: CANONICAL_STATUS.COLLECTED, iso: '2024-01-15T12:30:00Z' },
    { amount: 9000,  status: CANONICAL_STATUS.PENDING,   iso: '2024-01-20T10:00:00Z' },
    { amount: 18000, status: CANONICAL_STATUS.COLLECTED, iso: '2024-02-03T14:00:00Z' },
    { amount: 7000,  status: CANONICAL_STATUS.REFUNDED,  iso: '2024-02-10T09:00:00Z' },
    { amount: 33000, status: CANONICAL_STATUS.COLLECTED, iso: '2024-02-25T11:45:00Z' },
    { amount: 44000, status: CANONICAL_STATUS.COLLECTED, iso: '2024-03-10T15:00:00Z' },
    { amount: 5500,  status: CANONICAL_STATUS.UNKNOWN,   iso: '2024-03-12T20:00:00Z' },
    { amount: 19999, status: CANONICAL_STATUS.COLLECTED, iso: '2024-03-25T08:30:00Z' },
    { amount: 12000, status: CANONICAL_STATUS.FAILED,    iso: '2024-04-02T17:00:00Z' },
    { amount: 60000, status: CANONICAL_STATUS.COLLECTED, iso: '2024-04-18T10:00:00Z' },
    { amount: 22000, status: CANONICAL_STATUS.COLLECTED, iso: '2024-05-05T13:15:00Z' },
    { amount: 8000,  status: CANONICAL_STATUS.VOIDED,    iso: '2024-05-12T16:00:00Z' },
    { amount: 75000, status: CANONICAL_STATUS.COLLECTED, iso: '2024-05-30T11:00:00Z' },
    { amount: 11000, status: CANONICAL_STATUS.COLLECTED, iso: '2024-06-14T09:30:00Z' },
    { amount: 28800, status: CANONICAL_STATUS.COLLECTED, iso: '2024-07-04T19:45:00Z' },
    { amount: 16500, status: CANONICAL_STATUS.COLLECTED, iso: '2024-08-12T07:00:00Z' },
    { amount: 999_999, status: CANONICAL_STATUS.COLLECTED, iso: '2024-08-12T07:00:00Z', currency: 'EUR' }, // different currency — must be excluded
    { amount: 9999, status: CANONICAL_STATUS.COLLECTED, iso: '2024-09-01T00:00:00Z' },
  ];

  beforeAll(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    // Wipe ALL transactions inside the transaction so the property test
    // runs against ONLY the deterministic seedSpec. The ROLLBACK at the
    // end restores any production data; nothing outside this transaction
    // is affected.
    await client.query('DELETE FROM transactions');
    for (let i = 0; i < seedSpec.length; i++) {
      const row = seedSpec[i]!;
      await client.query(
        `INSERT INTO transactions
          (source, source_transaction_id, amount_cents, currency,
           source_status, canonical_status, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          TEST_SOURCE,
          `tx-${i}`,
          row.amount,
          row.currency ?? 'USD',
          'mapped',
          row.status,
          row.iso,
        ],
      );
    }
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    client.release();
    await closePool();
  });

  // Each trial does two Supabase round-trips, so the trial count is
  // bounded by CI time. 50 random trials is still a meaningful contract
  // gate; bump to 500 locally before any change to the metric queries.
  it(
    'runs 50 random (from, to, granularity) trials with the invariant holding',
    async () => {
      const dateArb = fc.date({
        min: new Date('2023-06-01T00:00:00Z'),
        max: new Date('2025-06-01T00:00:00Z'),
        noInvalidDate: true,
      });
      const granArb = fc.constantFrom('day', 'week', 'month' as const);

      await fc.assert(
        fc.asyncProperty(dateArb, dateArb, granArb, async (a, b, granularity) => {
          const [from, to] = a < b ? [a, b] : [b, a];
          if (from.getTime() === to.getTime()) return; // skip degenerate case

          const filter = { from, to, currency: 'USD' };
          const total = await computeTotal(filter, client);
          const series = await computeTimeseries({ ...filter, granularity }, client);

          const summed = series.buckets.reduce((acc, b) => acc + b.totalCents, 0);
          expect(summed).toBe(total.totalCents);
          expect(series.totalCents).toBe(total.totalCents);
        }),
        { numRuns: 50 },
      );
    },
    120_000, // 2-minute timeout for the property block
  );

  it('returns same totalCents for /total and /timeseries.totalCents on a known range', async () => {
    const filter = {
      from: new Date('2024-01-01T00:00:00Z'),
      to: new Date('2024-09-30T23:59:59Z'),
      currency: 'USD',
    };
    const total = await computeTotal(filter, client);
    const series = await computeTimeseries({ ...filter, granularity: 'month' }, client);
    expect(series.totalCents).toBe(total.totalCents);
    expect(series.totalCents).toBeGreaterThan(0);
  });

  it('excludes EUR transactions from USD totals', async () => {
    const filter = {
      from: new Date('2024-08-01T00:00:00Z'),
      to: new Date('2024-09-01T00:00:00Z'),
      currency: 'USD',
    };
    const total = await computeTotal(filter, client);
    // The only USD transaction in August is amount 16500. The 999999 EUR row
    // must not be included.
    expect(total.totalCents).toBe(16500);
  });
});

describe('metrics/service — input validation', () => {
  it('rejects non-USD currency', async () => {
    await expect(
      computeTotal({
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-02-01T00:00:00Z'),
        currency: 'EUR',
      }),
    ).rejects.toBeInstanceOf(InvalidCurrencyError);
  });

  it('rejects from >= to', async () => {
    await expect(
      computeTotal({
        from: new Date('2024-02-01T00:00:00Z'),
        to: new Date('2024-01-01T00:00:00Z'),
        currency: 'USD',
      }),
    ).rejects.toBeInstanceOf(InvalidQueryError);
  });

  it('rejects invalid Date inputs', async () => {
    await expect(
      computeTotal({
        from: new Date('not a date'),
        to: new Date('2024-02-01T00:00:00Z'),
        currency: 'USD',
      }),
    ).rejects.toBeInstanceOf(InvalidQueryError);
  });
});
