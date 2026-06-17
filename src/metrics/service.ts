import type { Pool, PoolClient } from 'pg';
import { InvalidCurrencyError, InvalidQueryError } from '../errors/domain-errors.js';
import {
  bucketCollected,
  type Granularity,
  type MetricFilter,
  type MetricTimeseriesFilter,
  sumCollected,
} from './repository.js';

export interface ComputeTotalInput {
  from: Date;
  to: Date;
  currency: string;
}

export interface ComputeTotalResult {
  totalCents: number;
  currency: string;
  from: string;
  to: string;
  transactionCount: number;
}

export interface ComputeTimeseriesInput extends ComputeTotalInput {
  granularity: Granularity;
}

export interface ComputeTimeseriesResult {
  currency: string;
  granularity: Granularity;
  from: string;
  to: string;
  totalCents: number;
  buckets: Array<{ bucket: string; totalCents: number; transactionCount: number }>;
}

const SUPPORTED_CURRENCIES = new Set(['USD']);

function validate(args: ComputeTotalInput): void {
  if (!SUPPORTED_CURRENCIES.has(args.currency)) {
    throw new InvalidCurrencyError(args.currency);
  }
  if (!(args.from instanceof Date) || Number.isNaN(args.from.getTime())) {
    throw new InvalidQueryError('from is not a valid Date');
  }
  if (!(args.to instanceof Date) || Number.isNaN(args.to.getTime())) {
    throw new InvalidQueryError('to is not a valid Date');
  }
  if (args.from >= args.to) {
    throw new InvalidQueryError('from must be earlier than to', {
      from: args.from.toISOString(),
      to: args.to.toISOString(),
    });
  }
}

/**
 * Compute the total revenue collected over [from, to) in the given currency.
 *
 * Delegates to the repository's `sumCollected` — there is no other code
 * path in the system that can produce a revenue number.
 */
export async function computeTotal(
  args: ComputeTotalInput,
  client?: Pool | PoolClient,
): Promise<ComputeTotalResult> {
  validate(args);
  const filter: MetricFilter = {
    from: args.from,
    to: args.to,
    currency: args.currency,
  };
  const result = client ? await sumCollected(filter, client) : await sumCollected(filter);
  return {
    totalCents: result.totalCents,
    currency: args.currency,
    from: args.from.toISOString(),
    to: args.to.toISOString(),
    transactionCount: result.transactionCount,
  };
}

/**
 * Compute the revenue time-series over [from, to) at the given granularity.
 *
 * Buckets sum (across the returned array) to the same value computeTotal
 * returns over the same date range. This is structurally guaranteed because
 * both functions delegate to repository queries against the same view with
 * the same WHERE clause; the property test in service.test.ts asserts the
 * invariant explicitly across 200 random inputs.
 */
export async function computeTimeseries(
  args: ComputeTimeseriesInput,
  client?: Pool | PoolClient,
): Promise<ComputeTimeseriesResult> {
  validate(args);
  const filter: MetricTimeseriesFilter = {
    from: args.from,
    to: args.to,
    currency: args.currency,
    granularity: args.granularity,
  };
  const buckets = client ? await bucketCollected(filter, client) : await bucketCollected(filter);
  const totalCents = buckets.reduce((acc, b) => acc + b.totalCents, 0);
  return {
    currency: args.currency,
    granularity: args.granularity,
    from: args.from.toISOString(),
    to: args.to.toISOString(),
    totalCents,
    buckets: buckets.map((b) => ({
      bucket: b.bucket.toISOString(),
      totalCents: b.totalCents,
      transactionCount: b.transactionCount,
    })),
  };
}
