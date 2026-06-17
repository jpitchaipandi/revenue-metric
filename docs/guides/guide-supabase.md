# Supabase Setup

Supabase hosts the Postgres database. Migrations create `transactions`, `ingest_cursors`, `ingest_runs`, `metric_computations`, plus the canonical `collected_revenue_v` VIEW.

## Why Supabase (not Neon)

The assignment for Problem 2 says explicitly: *"store your normalized data in a free Supabase Postgres project."* (Project 1 — sync-pipeline — uses Neon by choice.)

Both work; Supabase's free tier is restrictive in a different way than Neon's:

| | Supabase free | Neon free |
|---|---|---|
| Storage | 500 MB | 0.5 GB |
| Inactivity behavior | Pauses after **7 days** with no DB query | Scale-to-zero (auto-wake on next query) |
| Recovery from pause | Manual unpause via dashboard | Automatic (~1s cold start) |
| Connection pooling | Built-in (port 6543 = transaction mode, 5432 = session) | Built-in PgBouncer |

The 7-day pause behaviour is the most operationally interesting difference. For a portfolio project that gets demoed occasionally, the manual unpause is acceptable. For production, configure a cron to ping the DB at least weekly.

## Setup

### 1. Create the project
- Sign up at https://supabase.com (GitHub login works)
- **+ New project**
  - Name: `revenue-metric` (anything)
  - Database password: pick a strong one — store it
  - Region: closest to your Render region (Oregon → West US)
- Create. Provisioning takes ~2 minutes.

### 2. Copy two connection strings
**Project Settings → Database → Connection pooling**. You need both:

| Variable | Mode | Port | Use case |
|---|---|---|---|
| `DATABASE_URL` | **Transaction** | 6543 | Runtime queries — short-lived, multiplexed across requests |
| `DATABASE_URL_DIRECT` | **Session** | 5432 | Migrations only — DDL needs session-scoped connections, doesn't work through pgbouncer's transaction mode |

Both should look like:
```
postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:PORT/postgres
```

### 3. Paste into env vars

**Local `.env.local`:**
```bash
DATABASE_URL=postgresql://postgres.xxxx:pass@aws-0-us-west-1.pooler.supabase.com:6543/postgres
DATABASE_URL_DIRECT=postgresql://postgres.xxxx:pass@aws-0-us-west-1.pooler.supabase.com:5432/postgres
```

**Render dashboard** → Environment → add both to `revenue-metric-api`.

### 4. Apply migrations

The Render build runs `npm run migrate:prod` automatically. For local setup:

```bash
npm install
npm run migrate
```

Should see:
```
migration_applied filename=001_initial_schema.sql
migration_applied filename=002_views.sql
migration_applied filename=003_metric_computations.sql
migrations_complete total=3 applied=3
```

Migrations are idempotent (tracked in `schema_migrations`). Re-runs are no-ops.

### 5. Verify in the Supabase dashboard

**Table Editor** in the left nav. You should see:
- `transactions` — the main records table
- `ingest_cursors` — last-fetched timestamp per source
- `ingest_runs` — audit log
- `metric_computations` — optional metric audit
- `schema_migrations` — migration tracker
- `collected_revenue_v` (under "Views") — the canonical revenue view

## Gotchas

### Use the transaction pooler URL for `DATABASE_URL`
The direct URL (port 5432) caps connection count low and is unsuitable for a serverless web service that may spawn many short-lived workers. The transaction-mode pooler (port 6543) multiplexes.

### Don't run migrations via the pooler
pgbouncer's transaction mode resets prepared statements between transactions; DDL statements can't rely on that. Migrations use `DATABASE_URL_DIRECT` (port 5432) explicitly. The runner falls back to `DATABASE_URL` if direct isn't set, but expect intermittent DDL failures in that case.

### 7-day inactivity pause
If you don't query the database for 7 days, Supabase pauses the project. The next query returns a connection error. Recovery:
- Open the Supabase dashboard
- Find the paused project
- Click "Restore project"
- Wait ~30 seconds

For an actively-demoed project, periodic `curl /health` (every few days) keeps it active. The `/health` route hits `SELECT 1` against the DB.

### Free-tier limits
- 500 MB storage — generous; the schema has only ~50 MB of metadata overhead, plus actual transaction rows.
- 5 GB egress/month — fine for a demo deployment, may matter under load
- No PITR (Point-In-Time Recovery) — backups are daily snapshots only
