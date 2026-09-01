-- Hand-written constraints that Drizzle's schema DSL cannot express.
-- Applied by scripts/apply-constraints.ts after every push. Idempotent.

-- At most one live competition. The in-process ticker and read cache assume this.
CREATE UNIQUE INDEX IF NOT EXISTS one_live_competition
  ON competitions ((state IN ('pre_open','open','paused')))
  WHERE state IN ('pre_open','open','paused');

-- Order-flow aggregation only ever looks at un-voided trades.
CREATE INDEX IF NOT EXISTS trades_flow_active
  ON trades (stock_id, tick_index) WHERE voided_at IS NULL;

-- audit_log is append-only, enforced by the database rather than by convention.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS TRIGGER AS $fn$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
