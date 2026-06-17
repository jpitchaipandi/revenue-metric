import { describe, expect, it } from 'vitest';
import { CANONICAL_STATUS } from '../../status/canonical-status.js';
import { IngestError } from '../../errors/domain-errors.js';
import { mapMockRow, parseMockCsv } from './mapper.js';

describe('parseMockCsv', () => {
  it('parses a small CSV with header into records', () => {
    const csv = `id,amount_cents,status\nm1,100,paid\nm2,200,pending`;
    const rows = parseMockCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: 'm1', amount_cents: '100', status: 'paid' });
  });

  it('ignores blank lines', () => {
    const csv = `id,amount_cents\n\nm1,100\n\n`;
    expect(parseMockCsv(csv)).toEqual([{ id: 'm1', amount_cents: '100' }]);
  });

  it('handles CRLF line endings', () => {
    const csv = `id,amount_cents\r\nm1,100\r\n`;
    expect(parseMockCsv(csv)).toEqual([{ id: 'm1', amount_cents: '100' }]);
  });

  it('returns empty array for empty input', () => {
    expect(parseMockCsv('')).toEqual([]);
  });
});

describe('mapMockRow', () => {
  const baseRow = {
    id: 'mock_001',
    amount_cents: '12500',
    currency: 'USD',
    status: 'paid',
    occurred_at: '2024-01-15T10:00:00Z',
    description: 'Monthly subscription',
  };

  it('maps a paid row to a NormalizedTransaction with COLLECTED status', () => {
    const tx = mapMockRow(baseRow);
    expect(tx.source).toBe('mock');
    expect(tx.sourceTransactionId).toBe('mock_001');
    expect(tx.amountCents).toBe(12500);
    expect(tx.currency).toBe('USD');
    expect(tx.sourceStatus).toBe('paid');
    expect(tx.canonicalStatus).toBe(CANONICAL_STATUS.COLLECTED);
    expect(tx.occurredAt.toISOString()).toBe('2024-01-15T10:00:00.000Z');
  });

  it('coerces amount_cents from string to integer', () => {
    const tx = mapMockRow({ ...baseRow, amount_cents: '99999' });
    expect(tx.amountCents).toBe(99999);
  });

  it('uppercases currency', () => {
    const tx = mapMockRow({ ...baseRow, currency: 'usd' });
    expect(tx.currency).toBe('USD');
  });

  it('maps invoice_void to VOIDED canonical', () => {
    const tx = mapMockRow({ ...baseRow, status: 'invoice_void' });
    expect(tx.canonicalStatus).toBe(CANONICAL_STATUS.VOIDED);
  });

  it('maps invoice_disputed to FAILED canonical', () => {
    const tx = mapMockRow({ ...baseRow, status: 'invoice_disputed' });
    expect(tx.canonicalStatus).toBe(CANONICAL_STATUS.FAILED);
  });

  it('maps unmapped status to UNKNOWN — never silently to COLLECTED', () => {
    const tx = mapMockRow({ ...baseRow, status: 'settled_with_fee' });
    expect(tx.canonicalStatus).toBe(CANONICAL_STATUS.UNKNOWN);
  });

  it('preserves description in rawPayload', () => {
    const tx = mapMockRow({ ...baseRow, description: 'Special note' });
    expect(tx.rawPayload).toEqual({ description: 'Special note' });
  });

  it('throws IngestError when amount_cents is not an integer', () => {
    expect(() => mapMockRow({ ...baseRow, amount_cents: 'not-a-number' })).toThrow(
      IngestError,
    );
  });

  it('throws IngestError when currency is wrong length', () => {
    expect(() => mapMockRow({ ...baseRow, currency: 'US' })).toThrow(IngestError);
  });

  it('throws IngestError when occurred_at is not ISO 8601', () => {
    expect(() => mapMockRow({ ...baseRow, occurred_at: 'January 15, 2024' })).toThrow(
      IngestError,
    );
  });
});
