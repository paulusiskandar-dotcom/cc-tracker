-- =====================================================
-- v3.0 — Fresh Schema (Replaces all v2 tables)
-- Run in Supabase Dashboard → SQL Editor
-- ⚠️  THIS WIPES ALL v2 DATA — confirm before running
-- =====================================================

-- DROP all v2 tables (CASCADE handles FK)
DROP TABLE IF EXISTS account_currencies CASCADE;
DROP TABLE IF EXISTS account_recurring_fees CASCADE;
DROP TABLE IF EXISTS app_settings CASCADE;
DROP TABLE IF EXISTS asset_value_history CASCADE;
DROP TABLE IF EXISTS assets CASCADE;
DROP TABLE IF EXISTS budgets CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS employee_loan_payments CASCADE;
DROP TABLE IF EXISTS employee_loans CASCADE;
DROP TABLE IF EXISTS estatement_password_list CASCADE;
DROP TABLE IF EXISTS estatement_pdfs CASCADE;
DROP TABLE IF EXISTS expense_categories CASCADE;
DROP TABLE IF EXISTS fx_rate_history CASCADE;
DROP TABLE IF EXISTS fx_rates CASCADE;
DROP TABLE IF EXISTS import_drafts CASCADE;
DROP TABLE IF EXISTS income_records CASCADE;
DROP TABLE IF EXISTS income_sources CASCADE;
DROP TABLE IF EXISTS incomes CASCADE;
DROP TABLE IF EXISTS installments CASCADE;
DROP TABLE IF EXISTS ledger CASCADE;
DROP TABLE IF EXISTS liabilities CASCADE;
DROP TABLE IF EXISTS merchant_mappings CASCADE;
DROP TABLE IF EXISTS merchant_rules CASCADE;
DROP TABLE IF EXISTS reconcile_sessions CASCADE;
DROP TABLE IF EXISTS reconcile_transactions CASCADE;
DROP TABLE IF EXISTS recurring_reminders CASCADE;
DROP TABLE IF EXISTS recurring_templates CASCADE;
DROP TABLE IF EXISTS reimburse_settlements CASCADE;
DROP TABLE IF EXISTS scan_batches CASCADE;
DROP TABLE IF EXISTS stock_dividends CASCADE;
DROP TABLE IF EXISTS stocks CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;

-- KEEP: email_sync, gmail_tokens (preserve as-is)

-- =====================================================
-- CORE TABLES
-- =====================================================

CREATE TABLE accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('bank','cash','credit_card','asset','liability','receivable')),
  subtype          TEXT,
  bank_name        TEXT,
  account_number   TEXT,
  card_last4       TEXT,
  credit_limit     NUMERIC,
  due_day          INT,
  statement_day    INT,
  currency         TEXT NOT NULL DEFAULT 'IDR',
  balance          NUMERIC NOT NULL DEFAULT 0,
  balance_idr      NUMERIC NOT NULL DEFAULT 0,
  purchase_value   NUMERIC,
  purchase_date    DATE,
  color            TEXT,
  icon             TEXT,
  card_image_url   TEXT,
  display_order    INT DEFAULT 0,
  is_active        BOOLEAN DEFAULT TRUE,
  include_in_networth BOOLEAN DEFAULT TRUE,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_accounts_user ON accounts(user_id);

CREATE TABLE categories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  name             TEXT NOT NULL,
  parent_id        UUID REFERENCES categories(id),
  type             TEXT NOT NULL CHECK (type IN ('expense','income')),
  icon             TEXT,
  color            TEXT,
  is_tax_deductible BOOLEAN DEFAULT FALSE,
  display_order    INT DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_categories_user ON categories(user_id);

CREATE TABLE fx_rates (
  currency         TEXT PRIMARY KEY,
  rate_to_idr      NUMERIC NOT NULL,
  source           TEXT DEFAULT 'manual',
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE employee_loans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  borrower_name    TEXT NOT NULL,
  borrower_dept    TEXT,
  principal        NUMERIC NOT NULL,
  monthly_installment NUMERIC,
  total_paid       NUMERIC NOT NULL DEFAULT 0,
  start_date       DATE NOT NULL,
  expected_end_date DATE,
  actual_end_date  DATE,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','settled','written_off')),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_loans_user_status ON employee_loans(user_id, status);

CREATE TABLE reimburse_settlements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  entity           TEXT NOT NULL CHECK (entity IN ('Hamasa','SDC','Travelio')),
  total_out        NUMERIC NOT NULL DEFAULT 0,
  total_in         NUMERIC NOT NULL DEFAULT 0,
  fee_adjustment   NUMERIC NOT NULL DEFAULT 0,
  period_start     DATE,
  period_end       DATE,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled')),
  settled_date     DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_settled_has_date CHECK (
    (status = 'pending' AND settled_date IS NULL) OR
    (status = 'settled' AND settled_date IS NOT NULL)
  )
);
CREATE INDEX idx_settlements_user ON reimburse_settlements(user_id, entity, status);

CREATE TABLE budgets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  category_id      UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  amount_idr       NUMERIC NOT NULL,
  period_year      INT NOT NULL,
  period_month     INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  rollover         BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category_id, period_year, period_month)
);

CREATE TABLE recurring_charges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL,
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('expense','income','fee')),
  amount                NUMERIC NOT NULL,
  currency              TEXT DEFAULT 'IDR',
  category_id           UUID REFERENCES categories(id),
  from_account_id       UUID REFERENCES accounts(id),
  to_account_id         UUID REFERENCES accounts(id),
  description_template  TEXT,
  entity                TEXT DEFAULT 'Personal',
  frequency             TEXT NOT NULL CHECK (frequency IN ('monthly','quarterly','yearly')),
  day_of_month          INT CHECK (day_of_month BETWEEN 1 AND 31),
  month_of_year         INT CHECK (month_of_year BETWEEN 1 AND 12),
  is_active             BOOLEAN DEFAULT TRUE,
  last_generated_date   DATE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE statement_uploads (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL,
  account_id              UUID REFERENCES accounts(id) ON DELETE SET NULL,
  filename                TEXT,
  file_size               INT,
  storage_path            TEXT,
  period_start            DATE,
  period_end              DATE,
  opening_balance         NUMERIC,
  closing_balance         NUMERIC,
  ledger_closing_balance  NUMERIC,
  is_balanced             BOOLEAN,
  total_transactions      INT DEFAULT 0,
  matched_count           INT DEFAULT 0,
  added_count             INT DEFAULT 0,
  status                  TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  ai_extracted_json       JSONB,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  completed_at            TIMESTAMPTZ
);

CREATE TABLE import_drafts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  source     TEXT CHECK (source IN ('email_sync','ai_scan','statement_import')),
  state      JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ledger (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  tx_date          DATE NOT NULL,
  tx_type          TEXT NOT NULL CHECK (tx_type IN (
                     'expense','income','transfer','pay_cc','fx_exchange',
                     'give_loan','collect_loan','reimburse_out','reimburse_in',
                     'buy_asset','sell_asset','adjustment'
                   )),
  amount           NUMERIC NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'IDR',
  amount_idr       NUMERIC NOT NULL,
  fx_rate          NUMERIC,
  from_account_id  UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  to_account_id    UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id      UUID REFERENCES categories(id) ON DELETE SET NULL,
  description      TEXT,
  notes            TEXT,
  entity           TEXT NOT NULL DEFAULT 'Personal' CHECK (entity IN ('Personal','Hamasa','SDC','Travelio')),
  loan_id          UUID REFERENCES employee_loans(id) ON DELETE SET NULL,
  settlement_id    UUID REFERENCES reimburse_settlements(id) ON DELETE SET NULL,
  recurring_id     UUID REFERENCES recurring_charges(id) ON DELETE SET NULL,
  statement_id     UUID REFERENCES statement_uploads(id) ON DELETE SET NULL,
  idempotency_key  TEXT UNIQUE,
  source           TEXT DEFAULT 'manual' CHECK (source IN (
                     'manual','email_sync','ai_scan','statement_import','recurring_generate'
                   )),
  source_ref       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_tx_account_consistency CHECK (
    CASE tx_type
      WHEN 'expense'      THEN from_account_id IS NOT NULL
      WHEN 'income'       THEN to_account_id IS NOT NULL
      WHEN 'transfer'     THEN from_account_id IS NOT NULL AND to_account_id IS NOT NULL AND from_account_id <> to_account_id
      WHEN 'pay_cc'       THEN from_account_id IS NOT NULL AND to_account_id IS NOT NULL
      WHEN 'fx_exchange'  THEN from_account_id IS NOT NULL AND to_account_id IS NOT NULL
      WHEN 'give_loan'    THEN from_account_id IS NOT NULL AND loan_id IS NOT NULL
      WHEN 'collect_loan' THEN to_account_id IS NOT NULL AND loan_id IS NOT NULL
      WHEN 'reimburse_out' THEN from_account_id IS NOT NULL AND entity <> 'Personal'
      WHEN 'reimburse_in'  THEN to_account_id IS NOT NULL AND entity <> 'Personal'
      WHEN 'buy_asset'    THEN from_account_id IS NOT NULL AND to_account_id IS NOT NULL
      WHEN 'sell_asset'   THEN from_account_id IS NOT NULL AND to_account_id IS NOT NULL
      ELSE TRUE
    END
  )
);
CREATE INDEX idx_ledger_user_date ON ledger(user_id, tx_date DESC);
CREATE INDEX idx_ledger_idempotency ON ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- =====================================================
-- RLS POLICIES
-- =====================================================
ALTER TABLE accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rates             ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_loans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE reimburse_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_charges    ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_uploads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_drafts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger               ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounts_owner      ON accounts             FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY categories_owner    ON categories           FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY fx_public           ON fx_rates             FOR ALL USING (TRUE)                 WITH CHECK (TRUE);
CREATE POLICY loans_owner         ON employee_loans       FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY settlements_owner   ON reimburse_settlements FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY budgets_owner       ON budgets              FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY recurring_owner     ON recurring_charges    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY statements_owner    ON statement_uploads    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY drafts_owner        ON import_drafts        FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY ledger_owner        ON ledger               FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- SEED DEFAULT FX RATES
-- =====================================================
INSERT INTO fx_rates (currency, rate_to_idr) VALUES
  ('IDR', 1),
  ('USD', 16400),
  ('SGD', 12200),
  ('MYR', 3700),
  ('JPY', 110),
  ('EUR', 17800),
  ('AUD', 10500),
  ('GBP', 21200),
  ('CHF', 18500),
  ('CNY', 2250),
  ('THB', 470),
  ('HKD', 2100)
ON CONFLICT DO NOTHING;
