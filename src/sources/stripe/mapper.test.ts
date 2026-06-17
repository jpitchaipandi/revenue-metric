import { describe, expect, it } from 'vitest';
import { CANONICAL_STATUS } from '../../status/canonical-status.js';
import { IngestError } from '../../errors/domain-errors.js';
import { mapStripePaymentIntent } from './mapper.js';

function makePi(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'pi_test123',
    object: 'payment_intent',
    amount: 12500,
    currency: 'usd',
    status: 'succeeded',
    created: 1_704_067_200, // 2024-01-01T00:00:00Z
    ...overrides,
  };
}

describe('mapStripePaymentIntent', () => {
  it('maps a succeeded PaymentIntent to NormalizedTransaction with COLLECTED', () => {
    const tx = mapStripePaymentIntent(makePi());
    expect(tx.source).toBe('stripe');
    expect(tx.sourceTransactionId).toBe('pi_test123');
    expect(tx.amountCents).toBe(12500);
    expect(tx.currency).toBe('USD');
    expect(tx.sourceStatus).toBe('succeeded');
    expect(tx.canonicalStatus).toBe(CANONICAL_STATUS.COLLECTED);
    expect(tx.occurredAt.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('uppercases lowercase currency', () => {
    const tx = mapStripePaymentIntent(makePi({ currency: 'usd' }));
    expect(tx.currency).toBe('USD');
  });

  it('preserves Stripe amount in cents unchanged', () => {
    const tx = mapStripePaymentIntent(makePi({ amount: 99 }));
    expect(tx.amountCents).toBe(99);
  });

  it('converts Stripe created (epoch seconds) to JS Date', () => {
    const tx = mapStripePaymentIntent(makePi({ created: 1_710_000_000 }));
    expect(tx.occurredAt.toISOString()).toBe('2024-03-09T16:00:00.000Z');
  });

  it.each([
    ['succeeded', CANONICAL_STATUS.COLLECTED],
    ['processing', CANONICAL_STATUS.PENDING],
    ['requires_action', CANONICAL_STATUS.PENDING],
    ['requires_payment_method', CANONICAL_STATUS.FAILED],
    ['canceled', CANONICAL_STATUS.VOIDED],
  ])('maps Stripe status %s to canonical %s', (status, expected) => {
    const tx = mapStripePaymentIntent(makePi({ status }));
    expect(tx.canonicalStatus).toBe(expected);
  });

  it('maps an unknown Stripe status to UNKNOWN — never silently to COLLECTED', () => {
    const tx = mapStripePaymentIntent(makePi({ status: 'settled_with_fee' }));
    expect(tx.canonicalStatus).toBe(CANONICAL_STATUS.UNKNOWN);
  });

  it('preserves the raw PaymentIntent in rawPayload', () => {
    const raw = makePi({ extra_field: 'extra_value' });
    const tx = mapStripePaymentIntent(raw);
    expect(tx.rawPayload).toEqual(raw);
  });

  it('throws IngestError when id is missing', () => {
    const bad = { ...(makePi() as object), id: undefined };
    expect(() => mapStripePaymentIntent(bad)).toThrow(IngestError);
  });

  it('throws IngestError when id has wrong prefix', () => {
    expect(() => mapStripePaymentIntent(makePi({ id: 'ch_oldstylecharge' }))).toThrow(
      IngestError,
    );
  });

  it('throws IngestError when amount is negative', () => {
    expect(() => mapStripePaymentIntent(makePi({ amount: -100 }))).toThrow(IngestError);
  });

  it('throws IngestError when amount is fractional', () => {
    expect(() => mapStripePaymentIntent(makePi({ amount: 100.5 }))).toThrow(IngestError);
  });

  it('throws IngestError when currency is empty', () => {
    expect(() => mapStripePaymentIntent(makePi({ currency: '' }))).toThrow(IngestError);
  });
});
