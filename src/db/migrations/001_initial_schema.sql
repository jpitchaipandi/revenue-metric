-- Initial schema for revenue-metric service.
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- transactions — normalized records from all sources
-- canonical_status: the mapped status, gated by a CHECK constraint
--   to the canonical enum. The single source of truth for what
--   counts as revenue is the WHERE clause inside collected_revenue_v
--   (see 002_views.sql).
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source                  TEXT        NOT NULL,
  source_transaction_id   TEXT        NOT NULL,
  amount_cents            BIGINT      NOT NULL,            -- never floats; always integer cents
  currency                CHAR(3)     NOT NULL DEFAULT 'USD',
  source_status           TEXT        NOT NULL,            -- raw, preserved verbatim
  canonical_status        TEXT        NOT NULL
                          CHECK (canonical_status IN
                            ('COLLECTED','PENDING','REFUNDED','FAILED','VOIDED','UNKNOWN')),
  occurred_at             TIMESTAMPTZ NOT NULL,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload             JSONB,
  CONSTRAINT uq_source_tx UNIQUE (source, source_transaction_id)
);

-- Time-range queries
CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions (occurred_at);

-- The partial index that the metric queries rely on. Postgres will use
-- this for both the summary total and the timeseries breakdown queries.
CREATE INDEX IF NOT EXISTS idx_tx_canonical_collected
  ON transactions (occurred_at)
  WHERE canonical_status = 'COLLECTED';

-- Per-source diagnostics + status-coverage queries
CREATE INDEX IF NOT EXISTS idx_tx_source ON transactions (source, occurred_at);

-- Surfaces UNKNOWN statuses cheaply for the /metrics/status-coverage endpoint
CREATE INDEX IF NOT EXISTS idx_tx_unknown
  ON transactions (source, source_status)
  WHERE canonical_status = 'UNKNOWN';

-- ============================================================
-- ingest_cursors — last-fetched position per source, enables incremental ingest
-- ============================================================
CREATE TABLE IF NOT EXISTS ingest_cursors (
  source           TEXT        PRIMARY KEY,
  last_fetched_at  TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  last_run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  records_fetched  INTEGER     NOT NULL DEFAULT 0
);

-- ============================================================
-- ingest_runs — append-only audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS ingest_runs (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source                   TEXT        NOT NULL,
  started_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ,
  status                   TEXT        NOT NULL DEFAULT 'RUNNING'
                           CHECK (status IN ('RUNNING','SUCCESS','FAILED','PARTIAL')),
  records_fetched          INTEGER     NOT NULL DEFAULT 0,
  records_upserted         INTEGER     NOT NULL DEFAULT 0,
  records_skipped          INTEGER     NOT NULL DEFAULT 0,
  unknown_statuses_found   INTEGER     NOT NULL DEFAULT 0,
  error_message            TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingest_runs_source ON ingest_runs (source, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_runs_status ON ingest_runs (status);
