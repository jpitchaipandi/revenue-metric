# Render Setup

Render hosts the Fastify web service. Deploy is driven by `render.yaml` (Infrastructure-as-Code Blueprint).

## What runs where

| Component | Hosting |
|---|---|
| Web service (`revenue-metric-api`) | Render Web Service, Free tier, Node 20 |
| Postgres | Supabase (external — see [guide-supabase.md](guide-supabase.md)) |
| Scheduled ingest | **Deferred** — Render Cron Jobs require a paid plan |

## Setup

### 1. Push the repo to GitHub
```bash
gh repo create revenue-metric --public --source=. --remote=origin --push
```

### 2. Connect Render to the repo
- Sign up at https://render.com (GitHub login)
- **New +** → **Blueprint**
- Select the `revenue-metric` repo
- Render reads `render.yaml` and shows it'll create one service: `revenue-metric-api`
- Click **Apply / Create Resources**

### 3. Set secret env vars

Render auto-generates `API_SECRET`. You need to paste the rest:

| Variable | Source |
|---|---|
| `DATABASE_URL` | Supabase Transaction-mode pooler URL (port 6543) — see [guide-supabase.md](guide-supabase.md) |
| `DATABASE_URL_DIRECT` | Supabase Session-mode URL (port 5432) — see [guide-supabase.md](guide-supabase.md) |
| `STRIPE_TEST_KEY` | `sk_test_...` from Stripe dashboard — see [guide-stripe.md](guide-stripe.md) |

### 4. Verify
After the first deploy:
```bash
curl https://revenue-metric-api.onrender.com/health
# → {"success":true,"data":{"status":"ok","db":"ok","uptime":...}}
```

Note the auto-generated `API_SECRET` for use with the ingest endpoints (Render dashboard → Environment → click the eye icon to reveal).

## Free-tier facts

| Limit | Value |
|---|---|
| Instance hours | 750/month — more than enough for one always-on service |
| Spin-down | After 15 min idle — cold start ~30–60 s |
| Cron jobs | **Not on free tier** |
| Background workers | **Not on free tier** |
| Postgres | Available but 30-day expiry — we use Supabase instead |

## Gotchas — all carried over from Project 1

### `tsx: not found` during build
Render sets `NODE_ENV=production`, so `npm ci` skips devDependencies — `tsx` lives there. Already fixed in `package.json` with `migrate:prod` running compiled JS via `node dist/db/migrate.js`. Build copies SQL files into `dist/db/migrations/` as part of the build step.

### `render.yaml` changes don't auto-apply
Blueprints apply `render.yaml` at creation time only. Subsequent commits to `render.yaml` don't auto-update existing services. Two ways forward:
- **Re-sync the Blueprint:** Render dashboard → Blueprints → your Blueprint → **Sync**
- **Edit manually:** Dashboard → Service → Settings → edit Build Command / env vars directly

### Cron is paid
Render's free tier doesn't host Cron Jobs (`free not a valid plan for service type cron`). Two options for production:
- Upgrade to a paid plan (~$1/month per cron)
- Use cron-job.org (free, external) pointed at `POST /ingest/all` with the bearer header

The current deployment runs no scheduled ingest. Manual `POST /ingest/all` works for demos.

### Repo access warning
First-time Render → GitHub setup may produce *"It looks like we don't have access to your repo, but we'll try to clone it anyway."* Render is cloning anonymously via public access. Builds work; auto-deploy webhooks may lag. Fix: Settings → Repository → reconnect with proper GitHub OAuth.

## Spin-down behavior

After 15 minutes with no requests, the service stops. First request after that takes ~30 seconds. For demos: hit `/health` once 30 seconds before showing anything to wake the service.

## Build sequence

The `render.yaml` build runs:
```
npm ci && npm run build && npm run migrate:prod
```

Which:
1. Installs production deps (skips devDeps because `NODE_ENV=production`)
2. Compiles TypeScript to `dist/` AND copies `src/db/migrations/*.sql` into `dist/db/migrations/`
3. Runs `node dist/db/migrate.js` — applies any pending migrations against Supabase using `DATABASE_URL_DIRECT`

If a migration fails, the deploy fails — that's the right behaviour. The Render log surfaces the SQL error.
