import { describe, expect, it } from 'vitest';
import {
  CANONICAL_STATUS,
  REVENUE_ALLOW_LIST,
  isCollectedRevenue,
  type CanonicalStatus,
} from './canonical-status.js';
import { mapToCanonical } from './map.js';
import { MOCK_STATUS_MAP, STRIPE_STATUS_MAP } from './mappers.js';

describe('REVENUE_ALLOW_LIST', () => {
  it('contains exactly one value', () => {
    expect(REVENUE_ALLOW_LIST.size).toBe(1);
  });

  it('contains COLLECTED and only COLLECTED', () => {
    expect(REVENUE_ALLOW_LIST.has(CANONICAL_STATUS.COLLECTED)).toBe(true);
    expect(REVENUE_ALLOW_LIST.has(CANONICAL_STATUS.PENDING)).toBe(false);
    expect(REVENUE_ALLOW_LIST.has(CANONICAL_STATUS.REFUNDED)).toBe(false);
    expect(REVENUE_ALLOW_LIST.has(CANONICAL_STATUS.FAILED)).toBe(false);
    expect(REVENUE_ALLOW_LIST.has(CANONICAL_STATUS.VOIDED)).toBe(false);
    expect(REVENUE_ALLOW_LIST.has(CANONICAL_STATUS.UNKNOWN)).toBe(false);
  });
});

describe('isCollectedRevenue', () => {
  it('is true only for COLLECTED', () => {
    expect(isCollectedRevenue(CANONICAL_STATUS.COLLECTED)).toBe(true);
    expect(isCollectedRevenue(CANONICAL_STATUS.PENDING)).toBe(false);
    expect(isCollectedRevenue(CANONICAL_STATUS.UNKNOWN)).toBe(false);
  });
});

describe('mapToCanonical — Stripe', () => {
  it('maps every documented Stripe status to a non-UNKNOWN canonical', () => {
    for (const rawStatus of Object.keys(STRIPE_STATUS_MAP)) {
      const canonical = mapToCanonical('stripe', rawStatus);
      expect(canonical).not.toBe(CANONICAL_STATUS.UNKNOWN);
    }
  });

  it.each([
    ['succeeded', CANONICAL_STATUS.COLLECTED],
    ['paid', CANONICAL_STATUS.COLLECTED],
    ['processing', CANONICAL_STATUS.PENDING],
    ['requires_action', CANONICAL_STATUS.PENDING],
    ['canceled', CANONICAL_STATUS.VOIDED],
    ['failed', CANONICAL_STATUS.FAILED],
    ['refunded', CANONICAL_STATUS.REFUNDED],
  ])('maps stripe "%s" to %s', (raw, expected) => {
    expect(mapToCanonical('stripe', raw)).toBe(expected);
  });
});

describe('mapToCanonical — Mock', () => {
  it('maps every documented mock status to a non-UNKNOWN canonical', () => {
    for (const rawStatus of Object.keys(MOCK_STATUS_MAP)) {
      const canonical = mapToCanonical('mock', rawStatus);
      expect(canonical).not.toBe(CANONICAL_STATUS.UNKNOWN);
    }
  });

  it.each([
    ['paid', CANONICAL_STATUS.COLLECTED],
    ['invoice_paid', CANONICAL_STATUS.COLLECTED],
    ['invoice_void', CANONICAL_STATUS.VOIDED],
    ['invoice_disputed', CANONICAL_STATUS.FAILED],
    ['refunded', CANONICAL_STATUS.REFUNDED],
  ])('maps mock "%s" to %s', (raw, expected) => {
    expect(mapToCanonical('mock', raw)).toBe(expected);
  });

  it('mock vocabulary is deliberately distinct from Stripe', () => {
    // These tokens exist only in the mock source — Stripe should not have them.
    expect(STRIPE_STATUS_MAP['invoice_paid']).toBeUndefined();
    expect(STRIPE_STATUS_MAP['invoice_void']).toBeUndefined();
    expect(STRIPE_STATUS_MAP['invoice_disputed']).toBeUndefined();
  });
});

describe('mapToCanonical — UNKNOWN paths', () => {
  it('returns UNKNOWN for an unknown source', () => {
    const result = mapToCanonical('zombie-bank', 'paid', { sourceTransactionId: 'tx_xyz' });
    expect(result).toBe(CANONICAL_STATUS.UNKNOWN);
  });

  it('returns UNKNOWN for an unmapped status from a known source', () => {
    const result = mapToCanonical('stripe', 'settled_with_fee', { sourceTransactionId: 'pi_xyz' });
    expect(result).toBe(CANONICAL_STATUS.UNKNOWN);
  });

  it('UNKNOWN is NOT in the revenue allow-list', () => {
    expect(REVENUE_ALLOW_LIST.has(CANONICAL_STATUS.UNKNOWN)).toBe(false);
    expect(isCollectedRevenue(CANONICAL_STATUS.UNKNOWN)).toBe(false);
  });
});

// Allow-list completeness — protect against a status being silently dropped
// from a mapper. If you delete a mapping entry by mistake, this test fires.
describe('mapper completeness', () => {
  it('every value of CANONICAL_STATUS appears in at least one mapper (except UNKNOWN)', () => {
    const allMappedValues = new Set<CanonicalStatus>();
    for (const map of [STRIPE_STATUS_MAP, MOCK_STATUS_MAP]) {
      for (const value of Object.values(map)) {
        allMappedValues.add(value);
      }
    }
    const expected = Object.values(CANONICAL_STATUS).filter(
      (v) => v !== CANONICAL_STATUS.UNKNOWN,
    );
    for (const status of expected) {
      expect(
        allMappedValues,
        `${status} should appear as a target of some mapper`,
      ).toContain(status);
    }
  });
});
