import { z } from 'zod';
import { IngestError } from '../../errors/domain-errors.js';
import { mapToCanonical } from '../../status/map.js';
import type { NormalizedTransaction } from '../types.js';

/**
 * Minimal Stripe PaymentIntent shape — full type has dozens of fields
 * we don't need. We capture identity, amount, currency, status, and the
 * created timestamp.
 *
 * Stripe returns `amount` in the smallest currency unit (cents for USD).
 * No conversion needed.
 *
 * `created` is a Unix epoch in SECONDS (Stripe convention) — multiply by
 * 1000 to get JS milliseconds.
 *
 * `currency` is lowercase from Stripe ("usd"); we uppercase to match
 * our schema convention.
 */
const StripePaymentIntentSchema = z.object({
  id: z.string().startsWith('pi_'),
  object: z.literal('payment_intent').optional(),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: z.string().min(1),
  created: z.number().int().positive(),
});

export type StripePaymentIntent = z.infer<typeof StripePaymentIntentSchema>;

/**
 * Map a Stripe PaymentIntent to a NormalizedTransaction.
 *
 * Throws IngestError on malformed input. UNKNOWN statuses (anything not
 * in STRIPE_STATUS_MAP) do NOT throw — they're mapped to UNKNOWN and
 * flagged via the log + status-coverage endpoint, per allow-list semantics.
 */
export function mapStripePaymentIntent(raw: unknown): NormalizedTransaction {
  const parsed = StripePaymentIntentSchema.safeParse(raw);
  if (!parsed.success) {
    const id =
      typeof (raw as { id?: unknown })?.id === 'string'
        ? (raw as { id: string }).id
        : 'unknown';
    throw new IngestError('stripe', 'PaymentIntent failed schema validation', {
      sourceTransactionId: id,
      issues: parsed.error.issues,
    });
  }

  const pi = parsed.data;
  const canonicalStatus = mapToCanonical('stripe', pi.status, {
    sourceTransactionId: pi.id,
  });

  return {
    source: 'stripe',
    sourceTransactionId: pi.id,
    amountCents: pi.amount,
    currency: pi.currency.toUpperCase(),
    sourceStatus: pi.status,
    canonicalStatus,
    occurredAt: new Date(pi.created * 1000),
    rawPayload: raw as Record<string, unknown>,
  };
}
