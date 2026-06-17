-- Optional audit table for metric endpoint invocations.
-- Useful for forensic verification that total == sum(timeseries) historically.
-- Cheap (small rows) and gives us a way to detect any post-hoc divergence
-- without re-running queries.

CREATE TABLE IF NOT EXISTS metric_computations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint      TEXT        NOT NULL,             -- 'total' | 'timeseries'
  from_ts       TIMESTAMPTZ NOT NULL,
  to_ts         TIMESTAMPTZ NOT NULL,
  currency      CHAR(3)     NOT NULL,
  granularity   TEXT,                             -- only set for timeseries
  result_cents  BIGINT      NOT NULL,             -- single value (total) or sum-of-buckets
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metric_computations_endpoint_window
  ON metric_computations (endpoint, from_ts, to_ts);
