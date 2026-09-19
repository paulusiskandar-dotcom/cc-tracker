-- One row per card per statement: what the bank printed about points/miles that cycle.
-- Written by gmail-estatement (prepare) from the statement summary; never reconstructed by guessing.
-- balance is null for cards whose miles leave the card every month (BCA KrisFlyer prints only "miles this month").
CREATE TABLE IF NOT EXISTS points_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  statement_date date NOT NULL,
  unit           text,
  balance        numeric,
  previous       numeric,
  earned         numeric,
  bonus          numeric,
  redeemed       numeric,
  expiring       numeric,
  expiry_date    date,
  source         text NOT NULL DEFAULT 'statement',
  source_file    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, statement_date)
);
ALTER TABLE points_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS points_history_owner ON points_history;
CREATE POLICY points_history_owner ON points_history FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
NOTIFY pgrst, 'reload schema';
