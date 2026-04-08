-- ============================================================
-- PAULUS FINANCE - Session 3: Asset Tracker
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. ASSETS TABLE
-- Stores all asset types: Properti, Kendaraan, Saham, Reksa Dana,
-- Crypto, Emas, Deposito, Barang Berharga, FX/Cash
-- ============================================================
CREATE TABLE IF NOT EXISTS assets (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        uuid REFERENCES auth.users NOT NULL,
  name           text NOT NULL,
  category       text NOT NULL,          -- ASSET_CATS value
  current_value  numeric DEFAULT 0,      -- nilai sekarang (IDR)
  purchase_value numeric DEFAULT 0,      -- nilai beli (IDR)
  purchase_date  date,
  currency       text DEFAULT 'IDR',     -- mata uang aset asli
  notes          text,
  linked_bank_id uuid,                   -- untuk Deposito: link ke bank_accounts.id
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own assets"
  ON assets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS assets_user_id_idx ON assets(user_id);


-- 2. LIABILITIES TABLE
-- Stores liabilities: KPR, Kredit Kendaraan, Pinjaman
-- ============================================================
CREATE TABLE IF NOT EXISTS liabilities (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid REFERENCES auth.users NOT NULL,
  name             text NOT NULL,
  category         text NOT NULL,          -- KPR | Kredit Kendaraan | Pinjaman
  outstanding      numeric DEFAULT 0,      -- sisa hutang
  original_amount  numeric DEFAULT 0,      -- total hutang awal
  monthly_payment  numeric DEFAULT 0,      -- cicilan per bulan
  interest_rate    numeric DEFAULT 0,      -- bunga % per tahun
  start_date       date,
  end_date         date,
  linked_asset_id  uuid,                   -- link ke assets.id (opsional)
  notes            text,
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE liabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own liabilities"
  ON liabilities FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS liabilities_user_id_idx ON liabilities(user_id);


-- 3. ASSET PRICE HISTORY TABLE
-- Log setiap kali nilai aset diupdate (manual atau AI valuation)
-- ============================================================
CREATE TABLE IF NOT EXISTS asset_price_history (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid REFERENCES auth.users NOT NULL,
  asset_id      uuid REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
  recorded_date date NOT NULL,
  value         numeric NOT NULL,          -- nilai dalam IDR
  notes         text,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE asset_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own asset history"
  ON asset_price_history FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS asset_price_history_asset_id_idx ON asset_price_history(asset_id);
CREATE INDEX IF NOT EXISTS asset_price_history_user_id_idx  ON asset_price_history(user_id);
CREATE INDEX IF NOT EXISTS asset_price_history_date_idx     ON asset_price_history(recorded_date DESC);
