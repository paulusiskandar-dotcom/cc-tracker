-- ═══════════════════════════════════════════════════════════════
-- Ryusei 隆盛 — scheduled jobs via Supabase pg_cron (replaces GitHub Actions)
-- Jalankan SEKALI di: Supabase Dashboard → SQL Editor → paste → Run.
-- Waktu pg_cron = UTC. WIB = UTC+7.  (21:00 WIB = 14:00 UTC, 08:00 WIB = 01:00 UTC)
-- Edge functions sudah di-deploy --no-verify-jwt, jadi cukup Content-Type saja.
-- ═══════════════════════════════════════════════════════════════

-- 1) Aktifkan extension (aman diulang)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) (opsional) hapus jadwal lama kalau pernah dibuat, biar tidak dobel
select cron.unschedule('ryusei-daily-digest')      where exists (select 1 from cron.job where jobname = 'ryusei-daily-digest');
select cron.unschedule('ryusei-payment-reminder')  where exists (select 1 from cron.job where jobname = 'ryusei-payment-reminder');
select cron.unschedule('ryusei-monthly-report')    where exists (select 1 from cron.job where jobname = 'ryusei-monthly-report');

-- 3) Digest harian — 21:00 WIB (14:00 UTC): transaksi pending
select cron.schedule('ryusei-daily-digest', '0 14 * * *', $$
  select net.http_post(
    url     := 'https://zxkxfaoxzldxojwepnca.supabase.co/functions/v1/daily-digest',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

-- 4) Payment reminder — 08:00 WIB (01:00 UTC): jatuh tempo CC/cicilan/reimburse
select cron.schedule('ryusei-payment-reminder', '0 1 * * *', $$
  select net.http_post(
    url     := 'https://zxkxfaoxzldxojwepnca.supabase.co/functions/v1/payment-reminder',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

-- 5) Laporan bulanan — tanggal 1, 08:00 WIB (01:00 UTC)
select cron.schedule('ryusei-monthly-report', '0 1 1 * *', $$
  select net.http_get(
    url := 'https://zxkxfaoxzldxojwepnca.supabase.co/functions/v1/telegram-webhook?wh=report'
  );
$$);

-- ── Cek hasil ──────────────────────────────────────────────────
-- Lihat jadwal aktif:
--   select jobname, schedule, active from cron.job;
-- Lihat 20 run terakhir:
--   select jobname, status, start_time, return_message
--   from cron.job_run_details order by start_time desc limit 20;
