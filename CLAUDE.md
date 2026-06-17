# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                 # tsx watch mode on $PORT (default 3000)
npm run build               # tsc + copies src/db/migrations/*.sql into dist/
npm start                   # run compiled dist/index.js (production)
npm run migrate             # apply pending SQL migrations (tracked in schema_migrations)
npm run migrate:prod        # same, from compiled dist/ (used in Render build step)
npm run typecheck           # tsc --noEmit
npm run lint                # eslint src — fails on 'collected_revenue_v' literal in unauthorized files
npm run depcruise           # dependency-cruiser — fails on canonical-status.ts imports outside permitted paths
npm test                    # vitest run (one-shot)
npm run test:watch          # vitest in watch mode

# Run a single test file
npx vitest run src/metrics/service.test.ts

# Run a single test by name
npx vitest run -t "total == sum"

# Seed Stripe test mode (one-time after setting STRIPE_TEST_KEY)
npx tsx src/sources/stripe/seed.ts
```

Node version is pinned to `>=20.0.0 <21` via `engines`. The project is ESM (`"type": "module"`), so internal imports use the `.js` extension even though the source is `.ts` (e.g. `import { foo } from './bar.js'`).

## Database connections

Two URLs, used in different contexts (Supabase):

- `DATABASE_URL` — **Transaction-mode pooler** (port 6543). Used by `src/db/client.ts` for all runtime queries.
- `DATABASE_URL_DIRECT` — **Session mode** (port 5432). Used **only** by `src/db/migrate.ts` because DDL doesn't play well with pgbouncer's transaction pooling.

`src/config/env.ts` loads `.env.local` first, then `.env`. In production (Render), neither file exists — env vars come from the dashboard.

## The architecture (this is what makes the project worth reading)

**The rule:** there is exactly one definition of "revenue collected" in this codebase. It lives in one SQL view, queried by one repository module, behind layered enforcement that catches divergence at five different points in the dev/CI pipeline. **Read [`ARCHITECTURE.md`](ARCHITECTURE.md) before changing anything related to revenue.**

### The 5-layer defense (summary)

| Layer | File | Catches |
|---|---|---|
| 1 — SQL VIEW | `src/db/migrations/002_views.sql` | Wrong WHERE clause anywhere downstream — the filter lives ONLY here |
| 2 — Repository | `src/metrics/repository.ts` | Querying the view from outside the blessed module |
| 3 — Code constants | `src/status/canonical-status.ts` | `REVENUE_ALLOW_LIST` adding statuses without explicit code review |
| 4a — ESLint | `eslint.config.js` | `'collected_revenue_v'` string literal in unauthorized files |
| 4b — dependency-cruiser | `.dependency-cruiser.cjs` | Imports of `canonical-status.ts` outside permitted paths |
| 5 — Property test | `src/metrics/service.test.ts` | `total != sum(timeseries.buckets)` for any random tuple |

### Idempotency (read `src/sources/upsert.ts`)

All writes go through `upsertTransaction`. The SQL ON CONFLICT clause uses a **WHERE guard** that compares `(canonical_status, amount_cents, source_status)` — unchanged content produces zero writes (no `ingested_at` churn). This makes:
- Webhook replays safe
- Back-to-back ingest jobs safe
- Status transitions (e.g. `processing` → `succeeded`) correctly detected and updated

The guard checks status + amount because a transaction can legitimately transition over its lifecycle.

### Stripe ingest cursor strategy

Stripe's `created` timestamp doesn't change when a PaymentIntent's status changes (`processing` → `succeeded` happens with unchanged `created`). To catch these transitions:

- Cursor = `last_fetched_at` from `ingest_cursors`
- Each ingest fetches PaymentIntents created in `[max(INGEST_START_DATE, last_fetched_at - 24h), now)`
- The 24-hour overlap re-fetches recent records to catch status updates
- Idempotency at the upsert layer (Layer 2 above) absorbs the duplication

Do not "optimize" by removing the overlap window — it's load-bearing for status correctness.

### Auth model

- **Ingest routes (`/ingest/:source`, `/ingest/all`)** are bearer-protected via `src/api/plugins/auth.ts`
- **Metric routes (`/metrics/revenue/total`, `/timeseries`, `/status-coverage`)** are intentionally PUBLIC — reviewers, monitoring tools, dashboards can hit them without a token

If you ever add an authentication layer to the metric endpoints, that's a product decision that needs its own ADR — the current "public reads" model is intentional.

### Auth plugin gotcha (lesson from Project 1)

`src/api/plugins/auth.ts` is wrapped in `fastify-plugin` (`fp(...)`) so the `preHandler` hook propagates to the parent scope. **Do not remove the wrapper** — without it the hook gets encapsulated inside the plugin and the auth check silently fails on sibling routes. The metrics routes are public; the ingest route encapsulates the auth plugin inside its own scope so it applies only to `/ingest/*`.

### Timezone handling in date_trunc

`src/metrics/repository.ts` uses the double-`AT TIME ZONE 'UTC'` pattern:

```sql
date_trunc($1, occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS bucket
```

The first conversion strips the timezone to compute UTC-naive truncation. The second tags the result back as TIMESTAMPTZ so node-postgres serialises it as a UTC ISO string. **Without the second wrap, Node interprets the naive timestamp in the server's local timezone — bucket boundaries silently drift to whatever TZ the server is on.**

Found this the hard way during Phase 2 verification when daily buckets showed up offset by IST (UTC+5:30). The fix is documented as a comment in the SQL.

## Conventions

- Internal imports use `.js` extensions (ESM requirement) even though sources are `.ts`.
- Response shape is always `{ success: true, data: T }` or `{ success: false, error: { code, message } }`. The Fastify error handler (`src/api/plugins/error-handler.ts`) maps `RevenueError` instances to this envelope with appropriate HTTP statuses.
- All env access goes through `src/config/env.ts` (zod-validated). Don't read `process.env.*` directly elsewhere.
- Money is stored and computed as `BIGINT` cents. Never use FLOAT or NUMERIC for amounts. Conversion to decimal dollars happens only at the presentation layer (not in this service).
- Logging uses Pino with secret redaction (`src/config/logger.ts`). Use structured fields (`logger.info({ source, runId }, 'event_name')`), not interpolated strings.
- Tests are colocated as `*.test.ts` next to the source and run in Node environment.
- New SQL migrations go in `src/db/migrations/NNN_description.sql` with a zero-padded sequence prefix; the runner applies them in lexicographic order and records each in `schema_migrations`.
- Vitest is configured with `fileParallelism: false` because multiple test files do `DELETE FROM transactions` inside their own transactions; parallel execution causes lock contention against Supabase.

## When changing metric logic

This is the project's most architecturally-significant code. Read `ARCHITECTURE.md` first, then:

1. If the change touches `metrics/repository.ts` or the VIEW: bump the property test to `numRuns: 500+` locally before pushing.
2. If the change adds a new canonical status: run through the "Adding a new canonical status" checklist in ARCHITECTURE.md.
3. If `npm run depcruise` or `npm run lint` starts failing on existing code, that's a signal you've introduced an architectural violation — investigate before adding a carve-out.
