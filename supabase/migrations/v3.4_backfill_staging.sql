-- v3.4 — backfill staging + freeze (2026-08-26, usulan Paulus: "nilai 1 April
-- freeze dulu, kalau sudah cocok baru sambungin")
-- backfill_freeze: snapshot abadi anchor & saldo saat ini per akun, referensi
-- validasi sebelum/selesai penyambungan. ledger_staging: baris hasil parse
-- statement historis; TIDAK mempengaruhi saldo sampai status 'connected'.
CREATE TABLE IF NOT EXISTS backfill_freeze (
  account_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  freeze_note text,
  frozen_initial_balance numeric,
  frozen_outstanding numeric,
  frozen_current_balance numeric,
  captured_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  tx_date date NOT NULL,
  amount numeric NOT NULL,
  currency text DEFAULT 'IDR',
  direction text NOT NULL,          -- 'in' | 'out' relatif ke akun
  description text,
  tx_type text,                     -- klasifikasi usulan (expense/income/transfer/pay_cc/reimburse_*)
  category_id uuid,
  entity text,
  counter_account_id uuid,          -- pasangan transfer antar akun sendiri
  split_group_hint uuid,
  source_file text,
  statement_month text,             -- 'YYYY-MM'
  status text DEFAULT 'staged',     -- staged | connected | rejected
  needs_review boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staging_acct ON ledger_staging(account_id, tx_date);
CREATE INDEX IF NOT EXISTS idx_staging_status ON ledger_staging(user_id, status);
