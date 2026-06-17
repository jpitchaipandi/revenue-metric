/**
 * Standalone script to seed Stripe test mode with a handful of
 * PaymentIntents in various states. Run once after setting up the
 * test account so /ingest/stripe has something to pull:
 *
 *   npx tsx src/sources/stripe/seed.ts
 *
 * Stripe doesn't let us backdate PaymentIntents — `created` is always
 * the server timestamp at create time. So the seeded transactions will
 * all be within seconds of each other. That's fine for proving ingest
 * works; the mock CSV source is what produces a date-distributed
 * dataset for demo purposes.
 */
import { getStripe } from './client.js';
import { logger } from '../../config/logger.js';

interface SeedSpec {
  amountCents: number;
  description: string;
  /**
   * Stripe test card that drives the desired outcome. See
   * https://docs.stripe.com/testing#payment-methods for the full list.
   */
  paymentMethod: 'pm_card_visa' | 'pm_card_chargeDeclined' | 'pm_card_authenticationRequired';
}

const SEED: SeedSpec[] = [
  { amountCents: 12_500, description: 'Test charge — monthly subscription', paymentMethod: 'pm_card_visa' },
  { amountCents: 45_000, description: 'Test charge — annual upgrade',      paymentMethod: 'pm_card_visa' },
  { amountCents: 7_500,  description: 'Test charge — add-on seat',         paymentMethod: 'pm_card_visa' },
  { amountCents: 30_000, description: 'Test charge — consulting',          paymentMethod: 'pm_card_visa' },
  { amountCents: 18_000, description: 'Test charge — retainer',            paymentMethod: 'pm_card_visa' },
  { amountCents: 9_900,  description: 'Test charge — declined card',       paymentMethod: 'pm_card_chargeDeclined' },
];

async function main(): Promise<void> {
  const stripe = getStripe();
  logger.info({ count: SEED.length }, 'stripe_seed_started');

  for (const spec of SEED) {
    try {
      const pi = await stripe.paymentIntents.create({
        amount: spec.amountCents,
        currency: 'usd',
        payment_method: spec.paymentMethod,
        confirm: true,
        description: spec.description,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      });
      logger.info(
        { id: pi.id, amount: pi.amount, status: pi.status },
        'stripe_seed_pi_created',
      );
    } catch (err) {
      // Declined cards throw from .create() with confirm:true — that's
      // the point. We still want the PaymentIntent recorded; Stripe does
      // record it on its side, so the next /ingest/stripe will pick it up.
      const message = err instanceof Error ? err.message : String(err);
      logger.info({ err: message }, 'stripe_seed_create_error_expected');
    }
  }

  logger.info('stripe_seed_complete');
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.fatal({ err }, 'stripe_seed_failed');
    process.exit(1);
  });
