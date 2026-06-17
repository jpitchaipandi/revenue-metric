# Stripe Setup

Stripe is the live payment source. Test mode is free, doesn't move real money, and has the full PaymentIntent API.

## What this enables

| Endpoint | Behavior |
|---|---|
| `POST /ingest/stripe` | Fetch PaymentIntents via `stripe.paymentIntents.list` with 24h overlap window + cursor; idempotent upsert |
| `POST /ingest/all` | Includes Stripe + mock; failure-isolated |
| `/metrics/revenue/total` | Includes Stripe's COLLECTED transactions |

## Setup

### 1. Sign up + enable test mode
- Sign up at https://stripe.com (or log in)
- **Toggle "Test mode" at the top-right of the dashboard** — critical. The toggle persists; verify before each test data create.

### 2. Get the test API key
- **Developers → API keys** (left nav)
- Find the row for "Secret key" — it starts with `sk_test_` (NOT `sk_live_`)
- Click "Reveal test key" → copy the value
- This is your `STRIPE_TEST_KEY`

### 3. Paste credentials

**Local `.env.local`:**
```bash
STRIPE_TEST_KEY=sk_test_...
```

**Render dashboard** → Environment → add to `revenue-metric-api`.

### 4. Seed test data
A fresh Stripe test account has zero PaymentIntents. Two options:

**Option A: run the seed script** (recommended — 6 varied test PaymentIntents)
```bash
npx tsx src/sources/stripe/seed.ts
```
This creates:
- 5 succeeded PaymentIntents using `pm_card_visa`
- 1 declined using `pm_card_chargeDeclined` (status: `requires_payment_method` → maps to FAILED canonical)

**Option B: create test payments manually** in the Stripe dashboard
- **Payments** in the left nav (Test mode)
- "+ Add test payment"

### 5. Verify
```bash
TOKEN=$(grep '^API_SECRET=' .env.local | cut -d= -f2-)
curl -X POST http://localhost:3000/ingest/stripe -H "Authorization: Bearer $TOKEN" | jq
```

Expected first run: `recordsFetched: 6, recordsUpserted: 6`. Re-run: `recordsFetched: 6, recordsUpserted: 0, recordsSkipped: 6` (idempotency).

Then check the metric:
```bash
curl "http://localhost:3000/metrics/revenue/total?from=2024-01-01&to=2027-01-01" | jq
```

## Why test mode and not live

This is a portfolio demo. Test mode is:
- Free
- Indistinguishable in API shape from live mode
- Safer (no real card numbers, no real money)
- Idempotent — running the seed script multiple times doesn't charge anything

If you ever switch to live mode: rotate to an `sk_live_` key, set `INGEST_START_DATE` carefully to avoid ingesting years of history on first run, and consider rate limits (live mode caps are stricter).

## Stripe test cards

The seed script uses two test payment methods that drive different outcomes:

| Token | Outcome |
|---|---|
| `pm_card_visa` | Succeeds → status `succeeded` → maps to COLLECTED |
| `pm_card_chargeDeclined` | Declined → status `requires_payment_method` → maps to FAILED |
| `pm_card_authenticationRequired` | Requires 3DS → status `requires_action` → maps to PENDING |

Full list: https://docs.stripe.com/testing#payment-methods

## Gotchas we hit

### The SDK doesn't expose `LatestApiVersion` as a type constant
Stripe SDK v22 types `apiVersion` as plain `string`. Earlier examples on the internet show `apiVersion: '2025-…' as Stripe.LatestApiVersion`, which won't compile. The fix is to omit `apiVersion` entirely — the SDK defaults to a stable version that's fine for our use of PaymentIntents (`status`, `amount`, `currency`, `created` have been stable for years).

If you ever need a feature gated by a newer API version: pin explicitly with a string literal, and update mapper fixtures + tests at the same time.

### Stripe doesn't let you backdate `created`
The seed script creates 6 PaymentIntents all at "now" — they cluster in a single minute of wall-clock time. For demonstrating timeseries bucketing across months, the mock CSV source is what provides date-distributed test data. Stripe's role is to prove the *real* ingest path works.

### Status transitions don't change `created`
A PaymentIntent that starts as `processing` and finishes as `succeeded` has unchanged `created`. If our ingest cursor only filters `created >= last_fetched`, the status transition is missed. Our ingest uses a 24-hour overlap window (`created >= last_fetched - 24h`) plus the upsert WHERE guard to absorb the resulting duplication. The comment in `src/sources/stripe/ingest.ts` documents this — don't "optimise" the overlap away.

### Webhook integration is not wired
Production Stripe integrations use webhooks for real-time updates. This portfolio project uses polling only. If you add webhooks: validate the `Stripe-Signature` header against your webhook secret (different from the API key), dedup events via the `id` field, and route to the same upsert path.
