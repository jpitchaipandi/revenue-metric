# Setup Guides

Step-by-step guides for each external system the project depends on. Read in order if you're setting up the project from scratch.

| Guide | What it enables | Free tier? |
|---|---|---|
| [guide-supabase.md](guide-supabase.md) | Postgres database (transactions, ingest_cursors, ingest_runs, collected_revenue_v VIEW) | ✅ |
| [guide-stripe.md](guide-stripe.md) | Stripe test mode — the live payment source | ✅ |
| [guide-render.md](guide-render.md) | Hosting the Fastify web service | ✅ (web only; cron requires paid) |

## Minimum viable setup

To run a deployed pipeline, you need all three. The mock CSV source ships in the repo — no external setup required.

Each guide tells you exactly which env vars to set. The full list lives in [`../../.env.example`](../../.env.example).

## Going to production

Three things this design doesn't ship in the free-tier deployment:

1. **Scheduled ingest** — Render Cron requires a paid plan; the script (`src/cron-runner.ts` pattern from Project 1) and the underlying `/ingest/all` endpoint are already in place.
2. **Multi-currency support** — `src/metrics/service.ts` rejects non-USD currencies. Lifting that requires a designed migration, not an ad-hoc fix.
3. **A second real payment source** — Stripe is the only live integration; mock CSV demonstrates the divergent-vocabulary normalization. Adding Square / PayPal / etc. follows the pattern in [`guide-stripe.md`](guide-stripe.md).
