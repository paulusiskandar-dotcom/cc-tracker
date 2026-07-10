-- ─────────────────────────────────────────────────────────────
-- Foreign-currency (valas) import → "waiting for statement" queue
-- ─────────────────────────────────────────────────────────────
-- Rate isn't known at parse time (email/Telegram give an estimate only),
-- so valas transactions are NOT pushed to the ledger. They are parked in
-- email_sync with a dedicated status so they stay visible but out of balances.
--
-- No new column needed — email_sync.status is free-text. Existing values:
--   pending | review | confirmed | skipped | imported | error
-- New value:
--   waiting_statement  → parked valas; cleared when the monthly statement
--                        (with the bank's exact settled IDR) lands in the ledger.
--
-- Per-tx marker lives inside ai_raw_result[i]._waiting_statement = true
-- (mirrors the existing _imported / confirmed / skipped per-tx flags).
--
-- Index for fast lookup of the waiting queue (partial, tiny).
CREATE INDEX IF NOT EXISTS email_sync_waiting_idx
  ON email_sync (user_id)
  WHERE status = 'waiting_statement';

-- Nothing to backfill: existing valas rows currently sit in 'pending' and will
-- be re-parked to 'waiting_statement' automatically on the next /import run.
