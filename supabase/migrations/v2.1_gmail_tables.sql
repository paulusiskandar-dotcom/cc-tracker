-- ─────────────────────────────────────────────────────────────────
-- Paulus Finance v2.1 — Gmail Integration Tables
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────

-- Gmail OAuth tokens (encrypted at rest via Supabase Vault)
create table if not exists gmail_tokens (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users not null unique,
  access_token   text not null,
  refresh_token  text not null,
  token_expiry   timestamptz,
  gmail_email    text,
  client_id      text,
  connected_at   timestamptz default now(),
  last_sync      timestamptz
);

-- Email sync history
create table if not exists email_sync (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users not null,
  gmail_message_id  text not null,
  sender_email      text,
  subject           text,
  received_at       timestamptz,
  email_type        text,  -- transaction_notification | monthly_statement | unknown | skipped
  raw_body          text,
  attachment_name   text,
  ai_raw_result     jsonb,
  extracted_count   integer default 0,
  imported_count    integer default 0,
  status            text default 'pending',  -- pending | review | confirmed | skipped | error
  error_message     text,
  scan_batch_id     uuid references scan_batches(id),
  created_at        timestamptz default now(),
  unique(user_id, gmail_message_id)
);

-- RLS
alter table gmail_tokens enable row level security;
alter table email_sync   enable row level security;

create policy "Users own gmail_tokens"
  on gmail_tokens for all using (auth.uid() = user_id);

create policy "Users own email_sync"
  on email_sync for all using (auth.uid() = user_id);

-- Indexes
create index if not exists idx_email_sync_user
  on email_sync(user_id, status);

create index if not exists idx_email_sync_msgid
  on email_sync(gmail_message_id);

create index if not exists idx_gmail_tokens_user
  on gmail_tokens(user_id);
