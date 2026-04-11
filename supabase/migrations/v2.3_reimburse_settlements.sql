-- ─── Reimburse Settlements ────────────────────────────────────
CREATE TABLE IF NOT EXISTS reimburse_settlements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity               text NOT NULL,
  settled_at           timestamptz NOT NULL DEFAULT now(),
  out_ledger_ids       uuid[] NOT NULL DEFAULT '{}',
  in_ledger_ids        uuid[] NOT NULL DEFAULT '{}',
  total_out            numeric(15,2) NOT NULL DEFAULT 0,
  total_in             numeric(15,2) NOT NULL DEFAULT 0,
  reimbursable_expense numeric(15,2) NOT NULL DEFAULT 0,
  re_category_id       uuid REFERENCES expense_categories(id),
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reimburse_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own settlements"
  ON reimburse_settlements FOR ALL
  USING (auth.uid() = user_id);

-- ─── Link ledger rows to their settlement ────────────────────
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS reimburse_settlement_id uuid REFERENCES reimburse_settlements(id);
