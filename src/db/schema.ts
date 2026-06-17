import { bigint, char, index, jsonb, pgTable, pgView, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Drizzle schema for the transactions table. Mirrors the SQL DDL in
 * 001_initial_schema.sql exactly. If you add a column to the SQL,
 * mirror it here.
 *
 * Note: the `canonical_status` CHECK constraint is declared in SQL only —
 * Drizzle doesn't yet have a clean way to express enum-via-CHECK
 * portably. The status/canonical-status.ts module is the runtime
 * source of truth for the allowed values.
 */
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    sourceTransactionId: text('source_transaction_id').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    sourceStatus: text('source_status').notNull(),
    canonicalStatus: text('canonical_status').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    rawPayload: jsonb('raw_payload'),
  },
  (t) => ({
    occurredIdx: index('idx_tx_occurred').on(t.occurredAt),
    sourceIdx: index('idx_tx_source').on(t.source, t.occurredAt),
  }),
);

/**
 * The canonical revenue view. `.existing()` tells Drizzle to expect
 * this view to already exist in the database (created via migrations
 * in 002_views.sql) — it does NOT issue a CREATE VIEW.
 *
 * IMPORTANT: only `src/metrics/repository.ts` is permitted to import
 * and query this view. See ARCHITECTURE.md (added in Phase 3).
 */
export const collectedRevenueView = pgView('collected_revenue_v', {
  id: uuid('id').notNull(),
  source: text('source').notNull(),
  sourceTransactionId: text('source_transaction_id').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull(),
}).existing();

/**
 * ingest_cursors — last-fetched position per source.
 */
export const ingestCursors = pgTable('ingest_cursors', {
  source: text('source').primaryKey(),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true })
    .notNull()
    .default(sql`'1970-01-01T00:00:00Z'`),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }).notNull().defaultNow(),
  recordsFetched: bigint('records_fetched', { mode: 'number' }).notNull().default(0),
});

/**
 * ingest_runs — append-only audit log of every ingest execution.
 */
export const ingestRuns = pgTable('ingest_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  status: text('status').notNull().default('RUNNING'),
  recordsFetched: bigint('records_fetched', { mode: 'number' }).notNull().default(0),
  recordsUpserted: bigint('records_upserted', { mode: 'number' }).notNull().default(0),
  recordsSkipped: bigint('records_skipped', { mode: 'number' }).notNull().default(0),
  unknownStatusesFound: bigint('unknown_statuses_found', { mode: 'number' }).notNull().default(0),
  errorMessage: text('error_message'),
});
