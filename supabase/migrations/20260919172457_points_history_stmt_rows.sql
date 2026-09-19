-- The statement's own transaction lines for that cycle (date, description, amount, direction), kept so the
-- earn rule can be re-applied whenever the rule catalogue changes. The ledger cannot stand in for this:
-- its dates are purchase dates, not the bank's billing cycle.
ALTER TABLE points_history ADD COLUMN IF NOT EXISTS stmt_rows jsonb;
NOTIFY pgrst, 'reload schema';
