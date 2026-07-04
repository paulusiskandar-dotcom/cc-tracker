-- ═══════════════════════════════════════════════════════════════
-- Ryusei 隆盛 — Telegram upgrades (#5 memory + #6 weekly insight cron)
-- Jalankan di: Supabase Dashboard → SQL Editor → paste → Run.
-- ═══════════════════════════════════════════════════════════════

-- #5 AI multi-turn memory — tabel kecil (1 baris per chat)
create table if not exists tg_chat_memory (
  chat_id    bigint primary key,
  turns      jsonb        default '[]'::jsonb,
  updated_at timestamptz  default now()
);
-- Enable RLS with NO policies: only the edge function (service-role, bypasses RLS)
-- touches this table; anon/authenticated API access is fully blocked.
alter table tg_chat_memory enable row level security;

-- #6 Insight mingguan — Senin 08:00 WIB (01:00 UTC)
select cron.schedule('ryusei-weekly-insight', '0 1 * * 1', $$
  select net.http_get(
    url := 'https://zxkxfaoxzldxojwepnca.supabase.co/functions/v1/telegram-webhook?wh=weekly'
  );
$$);

-- cek: select jobname, schedule, active from cron.job;
