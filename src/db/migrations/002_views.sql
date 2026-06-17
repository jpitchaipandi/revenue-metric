-- ============================================================
-- collected_revenue_v — THE single source of truth for revenue.
--
-- The WHERE clause is the only place in the system that defines
-- "what counts as revenue." Adding/changing this filter requires
-- a SQL migration with a sequence prefix → goes through code review.
--
-- `canonical_status` is intentionally EXCLUDED from the select list:
-- consumers of this view can't accidentally re-filter or query it.
-- Any attempt to do so will fail at parse time, which is exactly what
-- the design wants.
-- ============================================================
DROP VIEW IF EXISTS collected_revenue_v;
CREATE VIEW collected_revenue_v AS
SELECT
  id,
  source,
  source_transaction_id,
  amount_cents,
  currency,
  occurred_at,
  ingested_at
FROM transactions
WHERE canonical_status = 'COLLECTED';
