# Revenue Metric Service

A single-source-of-truth revenue service. Ingests transactions from Stripe (test mode) and a mock CSV source into one normalized Postgres schema on Supabase. Computes "total revenue collected" via an **allow-list** of canonical statuses, exposes two endpoints (summary total + time-series breakdown) that are **structurally guaranteed to agree**, and uses five layers of architectural defense to make divergent revenue calculations impossible to introduce silently.

**Live:** https://revenue-metric-api.onrender.com  
**Read first:** [`ARCHITECTURE.md`](ARCHITECTURE.md) — the ADR for the single-canonical-metric design.

## The design property this enforces

> Two endpoints, queried over the same time range, must always return the same total. Even after a new source is added. Even after a new status appears that nobody anticipated. Even if someone tries to introduce a competing revenue calculation in a different file.

The defense is **five layers deep**, each catching a different evasion:

| Layer | Mechanism | What it catches |
|---|---|---|
| 1 | **SQL VIEW** `collected_revenue_v` | The WHERE clause that defines "revenue" lives in exactly one place. The view deliberately excludes `canonical_status` from its select list so consumers can't accidentally re-filter |
| 2 | **`metrics/repository.ts`** | The only TS file permitted to query the view. Both `sumCollected` and `bucketCollected` share an identical WHERE clause; they differ only in GROUP BY — structural sameness is what makes them agree |
| 3 | **`REVENUE_ALLOW_LIST = Set(['COLLECTED'])`** | Code-level mirror of the VIEW filter. Adding a new revenue status requires explicit code change + review |
| 4a | **ESLint `no-restricted-syntax`** | Bans the string literal `'collected_revenue_v'` outside permitted modules |
| 4b | **dependency-cruiser** | Bans imports of `canonical-status.ts` outside the canonical paths |
| 5 | **fast-check property test** | 50 random `(from, to, granularity)` trials assert `total == sum(timeseries buckets)` against a seeded dataset |

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full ADR including five concrete attack vectors and how each layer catches them.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | — | Liveness + DB ping |
| `POST` | `/ingest/:source` | Bearer | Trigger ingest for `stripe` or `mock` |
| `POST` | `/ingest/all` | Bearer | Ingest from all sources sequentially (failure-isolated) |
| `GET` | `/metrics/revenue/total` | **public** | `?from=&to=&currency=` → single number |
| `GET` | `/metrics/revenue/timeseries` | **public** | `?from=&to=&granularity=day\|week\|month&currency=` → array whose sum equals `total` |
| `GET` | `/metrics/status-coverage` | **public** | Diagnostic — lists any `(source, source_status)` pair currently mapping to `UNKNOWN` |

All responses follow `{ success: true, data: T }` or `{ success: false, error: { code, message } }`.

### Sample calls against the live deployment

```bash
URL='https://revenue-metric-api.onrender.com'
TOKEN='<get from your Render dashboard API_SECRET>'

# 1. Health
curl "$URL/health" | jq

# 2. Ingest from both sources
curl -X POST "$URL/ingest/all" -H "Authorization: Bearer $TOKEN" | jq

# 3. Total revenue across an open range
curl "$URL/metrics/revenue/total?from=2024-01-01&to=2027-01-01" | jq

# 4. Monthly breakdown — the sum of these buckets equals the total above
curl "$URL/metrics/revenue/timeseries?from=2024-01-01&to=2027-01-01&granularity=month" | jq

# 5. Surfaces any UNKNOWN statuses (the mock CSV deliberately includes one
#    so this endpoint is non-empty after a mock ingest)
curl "$URL/metrics/status-coverage" | jq
```

Cold-start note: free-tier Render spins down after 15 minutes idle. First request after that takes ~30 seconds.

## Local setup

### Prerequisites
- Node.js 20.x (`>=20.0.0 <21`)
- A Supabase Postgres project (https://supabase.com, free tier) — [setup guide](docs/guides/guide-supabase.md)
- A Stripe account with **Test mode** enabled (free) — [setup guide](docs/guides/guide-stripe.md)

For step-by-step setup of each external system, see [`docs/guides/`](docs/guides/README.md).

### Configure + run
```bash
cp .env.example .env.local
# Edit .env.local: DATABASE_URL (port 6543 pooler), DATABASE_URL_DIRECT (port 5432),
# API_SECRET (32+ chars), STRIPE_TEST_KEY (sk_test_...)

npm install
npm run migrate    # applies SQL migrations in src/db/migrations/
npm run dev        # starts Fastify on $PORT (default 3000)

# In another terminal:
curl http://localhost:3000/health
```

### Seed Stripe test mode (one-time)
A fresh Stripe test account is empty. Populate it with sample PaymentIntents:

```bash
npx tsx src/sources/stripe/seed.ts
# Creates 6 test PaymentIntents (5 succeeded + 1 declined)
```

Then run the ingest to pull them into your DB:

```bash
TOKEN=$(grep '^API_SECRET=' .env.local | cut -d= -f2-)
curl -X POST http://localhost:3000/ingest/all -H "Authorization: Bearer $TOKEN" | jq
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start in watch mode via `tsx` |
| `npm run build` | Compile to `dist/` + copy SQL migrations |
| `npm start` | Run compiled output (production) |
| `npm run migrate` | Apply pending SQL migrations (local dev) |
| `npm run migrate:prod` | Same, from compiled JS (Render build) |
| `npm test` | Run Vitest suite (68 tests, includes the property test) |
| `npm run typecheck` | TypeScript only, no emit |
| `npm run lint` | ESLint — fails on the `'collected_revenue_v'` literal in unauthorized files |
| `npm run depcruise` | dependency-cruiser — fails on `canonical-status.ts` imports in unauthorized modules |

## Deployment

Deployed on Render free tier as a Blueprint (`render.yaml`):
- Web Service, Oregon region, Node 20
- Build: `npm ci && npm run build && npm run migrate:prod`
- Health check polls `/health`

Required env vars (Render dashboard):
- `DATABASE_URL` — Supabase pooler URL (port 6543, mode: Transaction)
- `DATABASE_URL_DIRECT` — Supabase direct URL (port 5432, used only for DDL migrations)
- `API_SECRET` — auto-generated by the Blueprint
- `STRIPE_TEST_KEY` — `sk_test_...` from Stripe dashboard

### Scheduled ingest
Render's free tier doesn't host Cron Jobs. Current deployment runs no automatic schedule — manual `POST /ingest/all` works for the portfolio demo. Production path: upgrade Render to a paid plan. Free-tier alternative: cron-job.org pointed at `POST /ingest/all` with the bearer header.

## Project structure

```
src/
├── index.ts                              ─ Fastify bootstrap
├── config/{env,logger}.ts                ─ Zod-validated env + Pino logger
├── errors/domain-errors.ts               ─ RevenueError + typed subclasses
├── db/
│   ├── client.ts                         ─ pg.Pool + Drizzle
│   ├── migrate.ts                        ─ schema_migrations runner
│   ├── schema.ts                         ─ Drizzle schema (declares the VIEW)
│   └── migrations/                       ─ 001 schema, 002 view, 003 audit
├── status/
│   ├── canonical-status.ts               ─ CANONICAL_STATUS + REVENUE_ALLOW_LIST
│   ├── mappers.ts                        ─ STRIPE/MOCK status maps
│   └── map.ts                            ─ mapToCanonical (returns UNKNOWN by default)
├── sources/
│   ├── types.ts                          ─ NormalizedTransaction interface
│   ├── upsert.ts                         ─ Shared upsert with skip-if-unchanged
│   ├── mock/{data.csv, mapper.ts, ingest.ts}
│   └── stripe/{client.ts, mapper.ts, ingest.ts, seed.ts}
├── metrics/
│   ├── canonical.ts                      ─ Re-export of REVENUE_ALLOW_LIST
│   ├── repository.ts                     ─ THE only file querying the view
│   └── service.ts                        ─ computeTotal, computeTimeseries
└── api/
    ├── server.ts                         ─ app factory + plugin registration
    ├── plugins/{auth.ts, error-handler.ts}
    └── routes/{health, metrics, ingest}.ts
```

## Sources & references

**Architectural & language**
- [Allow-list vs Blocklist (default-deny, allow by exception)](https://www.magna5.com/default-deny-allow-by-exception/) — NIST 800-171 + CERT Top 10 Secure Coding #2
- [Working with Money in Postgres — Crunchy Data](https://www.crunchydata.com/blog/working-with-money-in-postgres) — BIGINT cents over NUMERIC and FLOAT
- [PostgreSQL timezone handling](https://oneuptime.com/blog/post/2026-01-25-postgresql-timezone-handling/view) — the double-`AT TIME ZONE 'UTC'` pattern for date_trunc

**Architectural enforcement**
- [ESLint `no-restricted-syntax`](https://eslint.org/docs/latest/rules/no-restricted-syntax) — AST-selector-based bans
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) — import-graph rules
- [fast-check](https://github.com/dubzzz/fast-check) — property-based testing for invariant assertions

**Provider docs**
- [Stripe PaymentIntent statuses](https://docs.stripe.com/api/payment_intents/object#payment_intent_object-status)
- [Stripe testing](https://docs.stripe.com/testing) — test cards (`pm_card_visa`, `pm_card_chargeDeclined`, etc.)

**Stack**
- [Drizzle ORM views](https://orm.drizzle.team/docs/views) — `.existing()` to declare a view without managing it
- [Supabase free-tier limits](https://www.itpathsolutions.com/supabase-free-tier-limits) — 7-day inactivity pause behavior

**Libraries used**: `fastify`, `pg`, `drizzle-orm`, `zod`, `pino`, `dotenv`, `tsx`, `vitest`, `fast-check`, `stripe`, `eslint`, `typescript-eslint`, `dependency-cruiser`, `fastify-plugin` — versions pinned in `package.json`.

## AI usage

This project was built with Claude (Anthropic) for both planning and implementation. See [`AI_USAGE.md`](AI_USAGE.md) for what AI was used for and [`docs/ai-conversation.md`](docs/ai-conversation.md) for the narrative of design decisions.
