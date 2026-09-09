-- v3.3 — split-transaction model (2026-08-26)
-- One real-world transaction (= one statement line) split into N ledger rows:
-- all members share split_group_id, and the sum of members must equal the
-- statement amount. Reconcile matchers (client matchRows + server matchRowsSrv)
-- sum a group and match it as one virtual row before any fuzzy matching.
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS split_group_id uuid;
CREATE INDEX IF NOT EXISTS idx_ledger_split_group
  ON ledger(split_group_id) WHERE split_group_id IS NOT NULL;
