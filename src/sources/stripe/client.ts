import Stripe from 'stripe';
import { env } from '../../config/env.js';

let cached: Stripe | null = null;

/**
 * Lazy Stripe client. The SDK is initialised on first use so importing
 * this module doesn't require STRIPE_TEST_KEY to be set (lets the rest
 * of the app — health, mock ingest, metrics — boot without it).
 *
 * Throws if STRIPE_TEST_KEY is missing or doesn't start with `sk_test_`
 * (the Zod schema in config/env.ts already rejects non-test keys, but
 * we double-check here for defence in depth).
 */
export function getStripe(): Stripe {
  if (cached) return cached;
  if (!env.STRIPE_TEST_KEY) {
    throw new Error('STRIPE_TEST_KEY is not configured');
  }
  if (!env.STRIPE_TEST_KEY.startsWith('sk_test_')) {
    throw new Error('STRIPE_TEST_KEY must be a Stripe test-mode key (sk_test_...)');
  }
  cached = new Stripe(env.STRIPE_TEST_KEY, {
    // SDK default API version is fine — we only consume status, amount,
    // currency, created on PaymentIntent, which have been stable for years.
    // Pin explicitly here if a future field of interest is version-gated.
    typescript: true,
  });
  return cached;
}
