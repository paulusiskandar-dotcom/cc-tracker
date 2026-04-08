-- ─────────────────────────────────────────────────────────────────
-- Paulus Finance v2.1 — Ledger column additions
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────

-- Columns inserted by the app that may not exist in the base schema
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS category_label  text;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS category_id     text;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS merchant_name   text;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS amount_idr      numeric default 0;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS currency        text    default 'IDR';
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS entity          text    default 'Personal';
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS is_reimburse    boolean default false;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS confidence      numeric default 1;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS notes           text;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS from_account_id uuid references accounts(id) on delete set null;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS to_account_id   uuid references accounts(id) on delete set null;
