# Architecture — Single-Source-of-Truth Revenue Metric

> **The rule:** there is exactly one definition of "revenue collected" in this codebase. It lives in one SQL view, queried by one repository module, behind layered enforcement that catches divergence at five different points in the dev/CI pipeline.

This document is the ADR (architectural decision record) for the single-canonical-metric design. **Read this before:**
- Adding a new payment source
- Adding a new canonical status
- Modifying the revenue allow-list
- Querying transactions for any metric-shaped purpose

---

## The design constraint

The assignment ([requirement.md](../requirement.md), Problem 2):

> Build a single metrics service that computes total revenue collected for an arbitrary date range across all sources using one canonical definition of "collected" and an **allow-list of statuses that count, not an exclusion list of statuses that don't**, since exclusion lists silently let new or unexpected statuses through as revenue. Expose that same number through two different views, [...] and make sure both views always agree, even after a new source system or a new status value is added. **Structure the code so that if someone later adds a second, slightly different way of computing this same number somewhere else in the codebase, something would actually catch it.**

Translation: prevent revenue drift caused by accidental divergence. Treat "collected revenue" as a security boundary, not a business calculation.

---

## The single source of truth — five layers deep

### Layer 1: the SQL VIEW

`collected_revenue_v` (defined in [`src/db/migrations/002_views.sql`](src/db/migrations/002_views.sql)) is the only authoritative answer to *"which rows count as revenue?"*

```sql
CREATE VIEW collected_revenue_v AS
SELECT id, source, source_transaction_id, amount_cents, currency, occurred_at, ingested_at
FROM transactions
WHERE canonical_status = 'COLLECTED';
```

The view **deliberately omits the `canonical_status` column from its select list.** Consumers can't accidentally re-filter on it, double-check it, or even reference it in a WHERE clause downstream. The only way to use the view is to trust the filter that's already baked in.

To change what counts as revenue: amend this VIEW via a SQL migration. The migration file's sequence prefix and `schema_migrations` row make the change visible in `git log` and on every fresh deployment.

### Layer 2: the repository module

[`src/metrics/repository.ts`](src/metrics/repository.ts) is **the only TypeScript file permitted to query `collected_revenue_v` or the `transactions` table for revenue purposes.**

It exports exactly two revenue-shaped methods:
- `sumCollected({ from, to, currency })` → scalar
- `bucketCollected({ from, to, currency, granularity })` → array

Both methods share identical WHERE clauses against the same view. The only difference is the GROUP BY / aggregation shape. **Structural sameness is what makes them always agree.**

The diagnostic `listUnknownStatuses()` lives here too — it queries `transactions` directly (not the view) because by definition unmapped statuses are excluded from the view.

### Layer 3: the canonical status enum

[`src/status/canonical-status.ts`](src/status/canonical-status.ts) declares:

```typescript
export const REVENUE_ALLOW_LIST: ReadonlySet<CanonicalStatus> = new Set([
  CANONICAL_STATUS.COLLECTED,
]);
```

This is the TypeScript-level mirror of the VIEW's WHERE clause. The two definitions must stay in sync; the contract test (Layer 5) enforces it indirectly by asserting metric numbers behave as expected.

**Adding a status that counts as revenue requires:**
1. New value added to `CANONICAL_STATUS` here (if it's a new canonical state)
2. New SQL migration updating the CHECK constraint
3. New SQL migration updating the VIEW's WHERE clause (if expanding revenue semantics)
4. New entry added to `REVENUE_ALLOW_LIST`
5. CI must pass — meaning every layer of enforcement is satisfied

### Layer 4a: ESLint `no-restricted-syntax`

[`eslint.config.js`](eslint.config.js) bans the string literal `'collected_revenue_v'` in any TypeScript file except:
- `src/metrics/repository.ts` (the blessed query module)
- `src/db/schema.ts` (Drizzle's view declaration)

```typescript
// eslint.config.js
{
  selector: "Literal[value='collected_revenue_v']",
  message: "The view name 'collected_revenue_v' may only appear in src/metrics/repository.ts ...",
}
```

This catches the string-level signal — anyone trying to write a raw SQL query against the view from a non-permitted location fails CI at lint time.

### Layer 4b: dependency-cruiser

[`.dependency-cruiser.cjs`](.dependency-cruiser.cjs) catches the import-graph signal: nothing outside `src/status/`, `src/metrics/`, the upsert helper, the shared types module, and test files may import `canonical-status.ts`.

This stops the second-tier evasion: even if someone tried to bypass ESLint by re-exporting `REVENUE_ALLOW_LIST` or `CANONICAL_STATUS` from a side module, the import graph still betrays them.

### Layer 5: the fast-check property test

[`src/metrics/service.test.ts`](src/metrics/service.test.ts) seeds a fixed dataset and asserts:

```typescript
fc.assert(
  fc.asyncProperty(dateArb, dateArb, granArb, async (a, b, granularity) => {
    const [from, to] = a < b ? [a, b] : [b, a];
    const total  = await computeTotal({ from, to, currency: 'USD' });
    const series = await computeTimeseries({ from, to, currency: 'USD', granularity });
    expect(series.buckets.reduce((acc, b) => acc + b.totalCents, 0)).toBe(total.totalCents);
  }),
  { numRuns: 50 },
);
```

For 50 random `(from, to, granularity)` triples, the property `total == sum(buckets)` must hold. If a future commit accidentally changes one query's filter but not the other, this test fails and blocks the PR. Bump `numRuns` to 500+ locally before any change to either repository method.

---

## What this design rules OUT

Five attack vectors a future engineer might use to introduce divergence — and how each layer catches them:

| Attack | Caught by |
|---|---|
| Writing a raw `SELECT … WHERE canonical_status = 'COLLECTED'` in a new route handler | ESLint (`'canonical_status'` literal flagged) **+** dependency-cruiser (route doesn't import the canonical module so can't reach it cleanly) **+** the SQL VIEW makes this redundant |
| Querying `collected_revenue_v` directly from outside `metrics/repository.ts` | ESLint (`'collected_revenue_v'` literal flagged in any other file) |
| Re-exporting REVENUE_ALLOW_LIST from a side module to bypass ESLint | dependency-cruiser (the side module would need to import `canonical-status.ts`, which is restricted) |
| Changing what counts as revenue without changing the VIEW | The SQL VIEW is the runtime authority — TypeScript constants are documentation, queries always go through the VIEW |
| Modifying one of `sumCollected` / `bucketCollected` but not the other | Property test (50 random trials assert agreement) **+** the explicit known-range tests |
| Adding a new payment source with an unknown status that maps to COLLECTED by accident | mapToCanonical returns UNKNOWN by default; only explicit code-level mappings can claim COLLECTED; `/metrics/status-coverage` surfaces drift |

---

## The mental model for contributors

> "Revenue numbers come out of `metrics/service.ts`. They come into `metrics/service.ts` from `metrics/repository.ts`. They come into `metrics/repository.ts` from `collected_revenue_v`. **That's it.** There is no other path."

If you find yourself wanting to bypass any of these layers, you've probably found a real bug — the metric is wrong somewhere upstream, and the answer is to fix it there, not route around it.

---

## When this design will fail

The design is robust against accidental divergence by future contributors. It is NOT robust against:

- A malicious contributor with merge access (they can disable the lint rule, bypass dep-cruiser, rewrite the VIEW). The defence here is code review + branch protection, which lives outside this codebase.
- A data quality problem upstream (e.g. Stripe miscategorising payments). The defence is the `UNKNOWN` allow-list semantics + `/metrics/status-coverage` diagnostic.
- Multi-currency semantics. The current design rejects non-USD at the service layer. Lifting that constraint requires a designed migration; do not add ad-hoc currency conversion.

---

## How to extend

### Adding a new payment source
1. Add the source name to `KNOWN_SOURCES` in `src/api/routes/ingest.ts`
2. Build `src/sources/<source>/{client,mapper,ingest}.ts` following the Stripe pattern
3. Add a `<SOURCE>_STATUS_MAP` to `src/status/mappers.ts` covering every status the source documents
4. Register the source in `SOURCE_STATUS_MAPS`
5. Run the test suite — `map.test.ts`'s completeness check will flag missing canonical mappings

### Adding a new canonical status
1. Add the value to `CANONICAL_STATUS` in `src/status/canonical-status.ts`
2. Migration: update the `CHECK` constraint on `transactions.canonical_status` (new file under `src/db/migrations/`)
3. Decide if it belongs in `REVENUE_ALLOW_LIST` — most don't
4. If it does belong: migration to update the VIEW's WHERE clause
5. Re-run the property test locally with `numRuns: 500`
6. Add a release note for the metric definition change

### Reading from the metric in a new place
Don't. Import from `src/metrics/service.ts`. If `service.ts` doesn't expose what you need, add it there.
