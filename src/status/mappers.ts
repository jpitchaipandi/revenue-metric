import { CANONICAL_STATUS, type CanonicalStatus } from './canonical-status.js';

/**
 * Stripe PaymentIntent and Charge status → canonical status.
 *
 * Every status string Stripe documents is mapped explicitly. New
 * statuses that ship from Stripe will fall through to UNKNOWN in
 * mapToCanonical() and trigger a structured warning log; the
 * /metrics/status-coverage endpoint surfaces them so a code-level
 * mapping can be added.
 *
 * Sources:
 *   https://docs.stripe.com/api/payment_intents/object#payment_intent_object-status
 *   https://docs.stripe.com/api/charges/object#charge_object-status
 */
export const STRIPE_STATUS_MAP: Readonly<Record<string, CanonicalStatus>> = {
  // PaymentIntent statuses
  succeeded: CANONICAL_STATUS.COLLECTED,
  requires_payment_method: CANONICAL_STATUS.FAILED,
  requires_confirmation: CANONICAL_STATUS.PENDING,
  requires_action: CANONICAL_STATUS.PENDING,
  processing: CANONICAL_STATUS.PENDING,
  requires_capture: CANONICAL_STATUS.PENDING,
  canceled: CANONICAL_STATUS.VOIDED,
  // Charge statuses
  paid: CANONICAL_STATUS.COLLECTED,
  pending: CANONICAL_STATUS.PENDING,
  failed: CANONICAL_STATUS.FAILED,
  // Synthetic — emitted by ingest when charge.refunded is true
  refunded: CANONICAL_STATUS.REFUNDED,
};

/**
 * Mock CSV source vocabulary — deliberately divergent from Stripe's
 * vocabulary to exercise the mapper. Drawn from the kind of strings a
 * legacy billing system or fictional second processor might emit.
 */
export const MOCK_STATUS_MAP: Readonly<Record<string, CanonicalStatus>> = {
  paid: CANONICAL_STATUS.COLLECTED,
  invoice_paid: CANONICAL_STATUS.COLLECTED,
  completed: CANONICAL_STATUS.COLLECTED,
  pending: CANONICAL_STATUS.PENDING,
  invoice_pending: CANONICAL_STATUS.PENDING,
  refunded: CANONICAL_STATUS.REFUNDED,
  invoice_void: CANONICAL_STATUS.VOIDED,
  voided: CANONICAL_STATUS.VOIDED,
  failed: CANONICAL_STATUS.FAILED,
  invoice_disputed: CANONICAL_STATUS.FAILED,
};

/**
 * Registry of all source mappers. To add a source: add its map here
 * + create src/sources/<source>/.
 */
export const SOURCE_STATUS_MAPS: Readonly<Record<string, Readonly<Record<string, CanonicalStatus>>>> =
  {
    stripe: STRIPE_STATUS_MAP,
    mock: MOCK_STATUS_MAP,
  };

export type KnownSource = keyof typeof SOURCE_STATUS_MAPS;
