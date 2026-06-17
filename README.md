# Revenue Metric Service

Single-source-of-truth revenue metric service. Ingests transactions from multiple payment sources (Stripe test mode + a mock CSV source) into one normalized Postgres schema on Supabase. Computes "total revenue collected" via an **allow-list** of canonical statuses, exposes two endpoints (summary total + time-series breakdown) that are structurally guaranteed to agree, and uses module boundaries + lint rules + property-based contract tests to make it impossible for a divergent revenue calculation to silently appear later.

## Design highlights

| Concern | Choice |
|---|---|
| HTTP framework | **Fastify** |
| Database | **Supabase Postgres** (free tier) |
| ORM | **Drizzle + pg** (pooler URL for queries, direct URL for migrations) |
| Money | **`BIGINT` cents** — no floating-point arithmetic, ever |
| Status normalization | **Code-level enum + per-source mapper** — adding a status requires a code change, never a DB row |
| Revenue filter | **A single SQL VIEW** (`collected_revenue_v`) — the WHERE clause lives in exactly one place |
| Allow-list semantics | New/unmapped statuses default to `UNKNOWN` and are excluded from revenue (fail-conservative) |
| Two-view consistency | Both endpoints query the same view via one repository module + property test + ESLint + dependency-cruiser |

## Local setup

### Prerequisites
- Node.js 20.x (`>=20.0.0 <21`)
- A Supabase Postgres project (https://supabase.com, free tier)
- A Stripe account with **Test mode** enabled (free)

### Configure
```bash
cp .env.example .env.local
# Edit .env.local with your Supabase connection strings + Stripe test key
```

### Install, migrate, run
```bash
npm install
npm run migrate
npm run dev
```

### Verify
```bash
curl http://localhost:3000/health
# → {"success":true,"data":{"status":"ok","db":"ok","uptime":...}}
```

## API surface (planned)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | none | Liveness + DB ping |
| `POST` | `/ingest/:source` | Bearer | Trigger ingest for `stripe` / `mock` |
| `POST` | `/ingest/all` | Bearer | Ingest from all sources sequentially |
| `GET` | `/metrics/revenue/total` | **none — public** | `?from=&to=&currency=` → single number |
| `GET` | `/metrics/revenue/timeseries` | **none — public** | `?from=&to=&granularity=&currency=` → array of buckets that sum to the same total |
| `GET` | `/metrics/status-coverage` | none | Diagnostic — lists any `(source, source_status)` pairs that map to `UNKNOWN` |

## Status

This is Project 2 of a two-project assignment. Project 1 (sync pipeline) is at https://github.com/jpitchaipandi/sync-pipeline.

## Architecture details

See [`../docs/plans/plan-revenue-metric.md`](../docs/plans/plan-revenue-metric.md) for the full implementation plan with data model, key flows, failure modes, and testing strategy.

## AI usage

This project was built with Claude (Anthropic). See `AI_USAGE.md` once added.
