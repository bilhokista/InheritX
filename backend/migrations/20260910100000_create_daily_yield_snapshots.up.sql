-- Historical yield ledger. Accrued yield was only ever computed on read, so
-- there was no record of what a plan was worth on any past day.

CREATE TABLE IF NOT EXISTS daily_yield_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id         UUID NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
    snapshot_date   DATE NOT NULL,
    -- Mirrors plans.amount / plans.yield_rate_bps as they stood on the day, so
    -- a later rate change does not silently rewrite history.
    principal       NUMERIC(78, 0) NOT NULL,
    yield_rate_bps  INTEGER NOT NULL,
    accrued_yield   NUMERIC(78, 4) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- The ledger's integrity constraint, not a nicety: the worker can run
    -- twice for the same day after a restart, a redeploy, or on a second
    -- replica. Without this, each of those silently doubles a plan's history.
    CONSTRAINT daily_yield_snapshots_plan_date_unique UNIQUE (plan_id, snapshot_date)
);

-- Supports the query this table exists for: one plan's history, oldest first.
CREATE INDEX IF NOT EXISTS daily_yield_snapshots_plan_date_idx
    ON daily_yield_snapshots (plan_id, snapshot_date);
