-- ─── Deposito fields for accounts table ──────────────────────
-- Adds deposit_bank_id column (link to the bank account holding the deposit)
-- Other deposito fields (interest_rate, tenor_months, maturity_date,
-- monthly_interest_payout, deposit_rollover_type, deposit_status)
-- are assumed to already exist from prior account setup.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deposit_bank_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

-- Index for looking up deposito accounts by bank
CREATE INDEX IF NOT EXISTS accounts_deposit_bank_id_idx ON accounts(deposit_bank_id) WHERE deposit_bank_id IS NOT NULL;
