-- One net-worth figure per month, written by the app from calcNetWorth() each time it
-- loads (the current month's row is simply overwritten). There was no history before
-- 2026-09, and none is reconstructed: the trend chart starts from the first real row.
CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  month          text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  total          numeric NOT NULL,
  bank           numeric, cash numeric, assets numeric, receivables numeric,
  employee_loans numeric, cc_debt numeric, liabilities numeric,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);
ALTER TABLE net_worth_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS net_worth_snapshots_owner ON net_worth_snapshots;
CREATE POLICY net_worth_snapshots_owner ON net_worth_snapshots FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
NOTIFY pgrst, 'reload schema';
