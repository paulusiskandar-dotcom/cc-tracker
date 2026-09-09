-- ─── Reimburse Settlements — add status tracking ─────────────
-- Existing rows (created via manual settle flow) get 'settled'.
-- New pending rows (auto-created on reimburse_out) default to 'pending'.

ALTER TABLE reimburse_settlements ADD COLUMN IF NOT EXISTS status          text;
ALTER TABLE reimburse_settlements ADD COLUMN IF NOT EXISTS linked_ledger_id uuid;
ALTER TABLE reimburse_settlements ADD COLUMN IF NOT EXISTS to_account_id   uuid;

-- Back-fill existing (already-settled) rows
UPDATE reimburse_settlements SET status = 'settled' WHERE status IS NULL;

ALTER TABLE reimburse_settlements ALTER COLUMN status SET NOT NULL;
ALTER TABLE reimburse_settlements ALTER COLUMN status SET DEFAULT 'pending';

-- Index for fast pending lookups
CREATE INDEX IF NOT EXISTS reimburse_settlements_status_idx
  ON reimburse_settlements (user_id, status);
