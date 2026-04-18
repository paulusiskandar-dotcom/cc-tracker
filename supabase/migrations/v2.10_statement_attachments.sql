-- ─────────────────────────────────────────────────────────────────
-- Paulus Finance v2.10 — Statement PDF attachments detected in Gmail
-- Stores metadata about statement PDFs found in bank emails so the
-- Reconcile UI can offer to download & extract them on demand.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS statement_attachments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gmail_message_id  text NOT NULL,
  attachment_id     text NOT NULL,
  filename          text,
  sender_email      text,
  bank_name         text,
  account_id        uuid REFERENCES accounts(id) ON DELETE SET NULL,
  period_year       integer,
  period_month      integer,
  subject           text,
  received_at       timestamptz,
  processed_at      timestamptz,
  transaction_count integer,
  created_at        timestamptz DEFAULT now(),
  UNIQUE(user_id, gmail_message_id, attachment_id)
);

ALTER TABLE statement_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own statement_attachments"
  ON statement_attachments FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_stmt_att_user_period
  ON statement_attachments(user_id, period_year, period_month);

CREATE INDEX IF NOT EXISTS idx_stmt_att_account
  ON statement_attachments(user_id, account_id);
