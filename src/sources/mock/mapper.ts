import { z } from 'zod';
import { IngestError } from '../../errors/domain-errors.js';
import { mapToCanonical } from '../../status/map.js';
import type { NormalizedTransaction } from '../types.js';

/**
 * CSV row schema — matches the columns of src/sources/mock/data.csv.
 *
 * `amount_cents` arrives as a string (CSV); coerce to integer. Anything
 * that isn't a clean integer fails the Zod parse → IngestError.
 *
 * `occurred_at` must be ISO 8601 (Z-suffixed UTC by convention).
 */
export const MockCsvRowSchema = z.object({
  id: z.string().min(1),
  amount_cents: z.coerce.number().int(),
  currency: z.string().length(3),
  status: z.string().min(1),
  occurred_at: z.string().datetime(),
  description: z.string().optional().default(''),
});

export type MockCsvRow = z.infer<typeof MockCsvRowSchema>;

/**
 * Map a raw CSV row to a NormalizedTransaction.
 *
 * The mapper looks up the canonical status via `mapToCanonical('mock', ...)` —
 * unmapped strings come back as `UNKNOWN` and trigger a structured warn log
 * (handled inside mapToCanonical). Unknown rows are still returned so the
 * ingest can upsert them and surface them via /metrics/status-coverage.
 *
 * Throws IngestError if the row fails Zod validation (malformed CSV).
 */
export function mapMockRow(raw: unknown): NormalizedTransaction {
  const parsed = MockCsvRowSchema.safeParse(raw);
  if (!parsed.success) {
    const id =
      typeof (raw as { id?: unknown })?.id === 'string'
        ? (raw as { id: string }).id
        : 'unknown';
    throw new IngestError('mock', 'CSV row failed schema validation', {
      sourceTransactionId: id,
      issues: parsed.error.issues,
    });
  }

  const row = parsed.data;
  const canonicalStatus = mapToCanonical('mock', row.status, {
    sourceTransactionId: row.id,
  });

  return {
    source: 'mock',
    sourceTransactionId: row.id,
    amountCents: row.amount_cents,
    currency: row.currency.toUpperCase(),
    sourceStatus: row.status,
    canonicalStatus,
    occurredAt: new Date(row.occurred_at),
    rawPayload: { description: row.description },
  };
}

/**
 * Tiny CSV parser for the controlled mock data file. Assumes:
 * - First row is a header
 * - No commas in field values
 * - No quoted strings
 * - No escapes
 * - LF or CRLF line endings
 *
 * If the CSV grows to need any of those, swap this for the `csv-parse`
 * package — it's intentionally cheap because the file is ours and small.
 */
export function parseMockCsv(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0]!.split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? '').trim();
    });
    return row;
  });
}
