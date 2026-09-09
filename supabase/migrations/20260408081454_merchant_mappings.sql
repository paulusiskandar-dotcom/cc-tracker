-- ─────────────────────────────────────────────────────────────────
-- Paulus Finance v2.1 — Merchant Mappings + scan_batches
-- Run BEFORE v2.1_gmail_tables.sql (gmail_tables references scan_batches)
-- ─────────────────────────────────────────────────────────────────

-- Scan batches (AI import sessions — photo, PDF, email)
create table if not exists scan_batches (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users not null,
  source         text not null,  -- 'photo' | 'pdf' | 'email'
  status         text default 'processing',  -- processing | done | error
  total_found    integer default 0,
  total_imported integer default 0,
  ai_model       text,
  created_at     timestamptz default now(),
  completed_at   timestamptz
);

alter table scan_batches enable row level security;
create policy "Users own scan_batches"
  on scan_batches for all using (auth.uid() = user_id);
create index if not exists idx_scan_batches_user
  on scan_batches(user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────
-- Merchant mappings — learned category per merchant name
-- ─────────────────────────────────────────────────────────────────
create table if not exists merchant_mappings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users not null,
  merchant_name  text not null,        -- lowercase, normalized
  category_id    text,                 -- matches EXPENSE_CATEGORIES id
  category_label text,
  entity         text default 'Personal',
  confidence     integer default 1,    -- increments on each confirmation
  last_seen      timestamptz default now(),
  created_at     timestamptz default now(),
  unique(user_id, merchant_name)
);

alter table merchant_mappings enable row level security;
create policy "Users own merchant_mappings"
  on merchant_mappings for all using (auth.uid() = user_id);
create index if not exists idx_merchant_mappings_user
  on merchant_mappings(user_id, merchant_name);
