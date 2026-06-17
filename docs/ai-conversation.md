# AI Conversation Log — Project 2 (Revenue Metric Service)

A narrative record of the dialogue between the developer and Claude (Opus 4.7, 1M context) that produced this project. Code, terminal output, and shell commands are intentionally omitted — the focus is on the *questions asked*, *trade-offs discussed*, and *decisions made*.

This is Project 2 of a two-project assignment. Project 1 (sync-pipeline) lives in a separate repo at https://github.com/jpitchaipandi/sync-pipeline. Many lessons from Project 1 carried directly into Project 2's foundation (`migrate:prod` from compiled JS, `fastify-plugin` wrapping for hook propagation, error-class constructor pattern).

---

## 1. Carry-over from Project 1

The developer chose to start Project 2 immediately after Project 1 closed. Claude restated the plan summary, highlighted two differences from Project 1 (Supabase instead of Neon; metric endpoints public instead of bearer-protected), and proposed defaults for the open questions in the plan.

The developer accepted the defaults:
- USD-only for MVP; non-USD ingest rejected
- Refunds tracked separately, not subtracted from `COLLECTED`
- `INGEST_START_DATE=2024-01-01` env-var floor
- No granularity zero-fill (omitted buckets when no data)
- Skip Square sandbox — use only Stripe + a deliberate mock CSV with divergent vocabulary

And added: *"skip square and go"*.

The mock CSV was a deliberate design move. Project 1 used three real external sources (HubSpot, GCal, Notion) to demonstrate cross-source normalization. Project 2's challenge is different: prove that "revenue" is unambiguous even across vocabularies. One real source (Stripe) plus a CSV with statuses like `invoice_paid`, `invoice_void`, `invoice_disputed`, and a deliberate `settled_with_fee` (deliberately unmapped) exercises the allow-list mapper more rigorously than two real sources would, with no third-party signup friction.

---

## 2. Phase 1 went smoothly because Project 1 already debugged the foundation

Phase 1 of Project 2 was the same shape as Phase 1 of Project 1 — Fastify, Postgres, migrations, `/health`, Render. The patterns that had been hard-won in Project 1 carried over verbatim:

- `dotenv` preload in `config/env.ts`
- `migrate:prod` script running compiled JS so Render's `npm ci` (which skips devDependencies under `NODE_ENV=production`) doesn't fail on missing `tsx`
- Build copies SQL files into `dist/db/migrations/`
- Error classes use `this.name = '...'` in constructor to avoid the TypeScript strict-mode literal-narrowing issue from Project 1
- Fastify error handler types `err: FastifyError` explicitly

Nothing surprised us in Phase 1. `/health` returned `{ success: true, data: { db: 'ok' } }` first try, both locally and on Render. The developer's response was just "yes" and "go" — momentum was the right call.

---

## 3. Phase 2 — the architectural keystone

Phase 2 is what makes Project 2 worth building. The conversation here was about *defenses*, not features.

### The five-layer design

Claude proposed five layers of enforcement, each catching a different evasion:

1. **SQL VIEW** — the WHERE clause lives in one place
2. **`metrics/repository.ts`** — the only TS file allowed to query the view
3. **`REVENUE_ALLOW_LIST` Set** — code-level mirror of the filter
4. ESLint **`no-restricted-syntax`** — banning the view name literal
4. dependency-cruiser — banning imports of `canonical-status.ts`
5. fast-check **property test** — asserting `total == sum(buckets)` for random tuples

The developer didn't push back on the design — but the discussion was useful because it forced Claude to articulate *why* a single layer isn't enough. The ADR in `ARCHITECTURE.md` documents this with five concrete attack vectors and which layer catches each one.

### The headline property test

The "two endpoints must always agree" requirement is what makes this project worth grading. Claude designed the property test as **fast-check generating 200 random `(from, to, granularity)` triples**, each asserting `computeTotal({from, to}).totalCents === sum(computeTimeseries({from, to, granularity}).buckets.map(b => b.totalCents))`.

Reality intervened: 200 trials × 2 Supabase round-trips × ~50ms latency = ~20 seconds. Way over the 10-second Vitest default. Two options were discussed:

- Reduce trials to ~25
- Increase trial budget, accept slow CI

Compromise landed on **50 trials with a per-test 120-second timeout**. Still a meaningful property gate (50 random tuples is plenty to catch a divergence bug); CI-economical at ~25 seconds.

### The bucket-boundary timezone bug

Claude's first attempt at the bucketed timeseries query used:

```sql
date_trunc($1, occurred_at AT TIME ZONE 'UTC') AS bucket
```

That looked correct. It wasn't. The smoke test against the seeded mock data returned buckets like `2023-12-31T18:30:00.000Z` instead of `2024-01-01T00:00:00.000Z`. The IST offset (UTC+5:30) was bleeding through.

The bug: `AT TIME ZONE 'UTC'` strips the timezone to produce a naive `TIMESTAMP`. `date_trunc` truncates that naive timestamp correctly in UTC. But when the result is sent back to Node, node-postgres interprets the naive timestamp using the *server's local timezone* and converts it to UTC ISO — which silently shifts the boundary.

Fix: double-wrap.

```sql
date_trunc($1, occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS bucket
```

The first conversion does the truncation correctly in UTC; the second re-tags the result as `TIMESTAMPTZ` so node-postgres serialises it as a proper UTC ISO string. The comment in `repository.ts` documents this so future maintainers don't peel off the second wrap thinking it's redundant.

This is a classic Postgres timezone trap. It would have been a real bug in production. Catching it during the local smoke test reinforced Project 1's lesson about end-to-end exercises catching what type-checks miss.

### Test isolation surprise

Running the full test suite after Phase 2's manual ingest revealed a different problem: the live `/ingest/mock` call I'd just made committed 12 mock CSV rows to the database. The repository integration tests then expected empty-table semantics and saw `totalCents: 146000` instead of `0`.

Fix: tests `BEGIN; DELETE FROM transactions; ...; ROLLBACK;` inside their own transaction. The wipe is local to the transaction and never persists.

But that created a second bug: Vitest's default parallel file execution caused two test files to issue concurrent `DELETE FROM transactions` against the same Supabase. They each held row locks waiting for the other, and the hooks timed out at 10s.

Fix: `fileParallelism: false` in `vitest.config.ts`. The integration tests share a database; serial execution is required. Documented as a load-bearing config setting.

---

## 4. Phase 3 — Stripe + the enforcement layer

### Stripe ingest cursor

A subtle design point came up here. Stripe's PaymentIntent `created` timestamp doesn't change when status transitions — a payment that starts as `processing` and finishes as `succeeded` has the same `created` value. If the cursor only filters on `created >= last_fetched`, status transitions to a previously-fetched record would be missed.

Solution: use a **24-hour overlap window**.

The cursor is `last_fetched_at`. Each ingest fetches `created >= max(INGEST_START_DATE, last_fetched_at - 24h)`. The overlap re-fetches the last day of records to capture any status transitions; the upsert's WHERE guard (which compares `canonical_status`, `amount_cents`, `source_status`) makes unchanged rows a no-op write.

Documented as a comment in `ingest.ts` so the overlap can't be "optimised" away by a future contributor who thinks it's wasteful.

### Stripe test mode starts empty

The first `/ingest/stripe` run returned 0 records — and that's correct: a fresh Stripe test account has no PaymentIntents. The developer didn't need to manually create test payments in the Stripe dashboard. Instead Claude wrote `src/sources/stripe/seed.ts` — a standalone script that creates 6 PaymentIntents (5 succeeded + 1 declined) via the Stripe API.

Stripe doesn't allow backdating `created`, so all the seeded transactions have the same timestamp. That's fine for proving ingest works; the mock CSV is what provides date-distributed test data.

### ESLint + dependency-cruiser as paired enforcement

Claude initially wrote the dependency-cruiser rule too strictly — banning *any* import of `canonical-status.ts` outside `src/status/` and `src/metrics/`. The first depcruise run found three "violations":

- `src/sources/types.ts` — imports `CanonicalStatus` for the `NormalizedTransaction` interface
- `src/sources/stripe/mapper.test.ts` — asserts on `CANONICAL_STATUS.COLLECTED`
- `src/sources/mock/mapper.test.ts` — same

All three were legitimate. The rule was too broad. Claude added explicit carve-outs to the `pathNot` list (`sources/types.ts`, `sources/upsert.ts`, and `*.test.ts`). After that, depcruise passed cleanly and still caught the deliberate violation written to test it.

The same pattern emerged with ESLint. The first attempt banned `'collected_revenue_v'` everywhere except `metrics/repository.ts`. But `src/db/schema.ts` uses `pgView('collected_revenue_v', ...)` to declare the view to Drizzle — also legitimate. Carve-out added.

**Lesson recorded:** architectural rules in CI are valuable, but they need to be tuned around the *actual* legitimate import graph, not a theoretical "perfect" one. Both rules catch real violations now without firing on the modules that genuinely need the imports.

---

## 5. Documentation phase

After all three implementation phases closed, the developer asked for Phase 4 — docs and guides — to wrap.

Pattern from Project 1: README rewritten to focus on what the project *is* (no assignment/status framing), with sample curl commands against the deployed URL. `ARCHITECTURE.md` written during Phase 3 already; this phase just polished the README around it. `CLAUDE.md` added to help future Claude Code sessions understand the project's invariants. Setup guides for Supabase + Stripe + Render in `docs/guides/`. `AI_USAGE.md` mirroring Project 1's.

Same project shape, same documentation structure. The build diary and conversation log live in this same docs/ folder.

---

## Patterns reinforced from Project 1

A few patterns surfaced in Project 1 carried straight into Project 2 without re-debating:

### Ask before you build
At every design decision — five-layer enforcement, source selection (Square or mock), test isolation strategy, property test trial count, cron deferral — Claude presented options with trade-offs rather than picking unilaterally. The plan defined the shape; the developer made the calls.

### Trust but verify
Typecheck + unit tests caught the obvious bugs. End-to-end smoke testing with real Supabase + real Stripe caught the timezone trap, the test-isolation parallelism issue, and the depcruise over-restriction. Same lesson as Project 1's auth-bypass bug.

### Document the load-bearing details
Comments like *"do not remove this wrapper"* and *"do not optimise away the 24-hour overlap"* and *"the second `AT TIME ZONE 'UTC'` is intentional"* — these are notes to whoever maintains the code next, including future-Claude. They cost nothing to write and prevent classes of regression.

### Documentation kept up with code
Every phase ended with a commit that updated the README, the test suite, and (when relevant) `ARCHITECTURE.md`. The repo's history reads as a single coherent story from initial scaffold to final deployment.

---

## Outstanding for submission

Code is complete. What remains is not code:

- 5-minute demo video — recommended script:
  - Show `/metrics/revenue/total` and `/metrics/revenue/timeseries` returning matching totals
  - Trigger `/ingest/all`, watch the numbers update
  - Hit `/metrics/status-coverage` to surface the deliberate `settled_with_fee` UNKNOWN
  - Write a deliberate violation in a file, run `npm run lint` to see it caught; clean up and show lint passes again
  - (Optional) Same demo with `npm run depcruise`
- Public Claude chat share link → `AI_USAGE.md`
- (Optional) Render → GitHub OAuth reconnect for auto-deploy

Both Problem 1 and Problem 2 are now functionally complete from the assignment's "live deployment + GitHub repo + README" perspective. Demo videos are the last gating step.
