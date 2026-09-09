-- ─────────────────────────────────────────────────────────────────
-- Paulus Finance v2.2 — FX rate used per ledger entry
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE ledger ADD COLUMN IF NOT EXISTS fx_rate_used numeric;
