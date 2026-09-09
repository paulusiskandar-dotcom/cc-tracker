-- v3.5 — RLS untuk dua tabel backfill (2026-09-09)
--
-- Security Advisor Supabase menandai keduanya "RLS Disabled in Public". Sebabnya
-- sederhana: v3.4 dibuat cepat waktu backfill Januari–Maret dan RLS-nya kelupaan,
-- sementara semua migrasi lain di repo ini memakainya.
--
-- Kenapa penting: REACT_APP_SUPABASE_ANON_KEY ikut ter-bundle ke frontend, jadi
-- kunci itu dipegang siapa pun yang membuka ryusei.paulusiskandar.com. Tanpa RLS,
-- 1.828 baris ledger_staging (nominal, tanggal, keterangan tiap transaksi hasil
-- parse statement) dan 57 baris backfill_freeze (snapshot saldo tiap akun) bisa
-- dibaca DAN ditulis siapa saja yang tahu nama tabelnya.
--
-- Keduanya tidak dihapus meski backfill sudah selesai 27 Agu 2026: freeze adalah
-- referensi validasi anchor saldo, staging adalah jejak asal-usul tiap baris yang
-- akhirnya masuk ledger. Skrip zz_*.cjs yang memakainya login dengan
-- signInWithPassword, jadi kebijakan berbasis auth.uid() tidak mematahkannya.
--
-- Pola kebijakan menyalin v2.3_reimburse_settlements.sql: FOR ALL + USING, yang
-- di Postgres juga dipakai sebagai WITH CHECK saat baris baru ditulis.

ALTER TABLE backfill_freeze ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own backfill freeze" ON backfill_freeze;
CREATE POLICY "Users manage own backfill freeze"
  ON backfill_freeze FOR ALL
  USING (auth.uid() = user_id);

ALTER TABLE ledger_staging ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own ledger staging" ON ledger_staging;
CREATE POLICY "Users manage own ledger staging"
  ON ledger_staging FOR ALL
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Bagian kedua (9 Sep 2026): sisa peringatan Security Advisor.
--
-- 1. Delapan fungsi tanpa search_path tetap. Fungsi tanpa search_path bisa
--    dibelokkan lewat skema palsu yang menyusup di depan `public`. Diperiksa
--    dulu isinya: satu-satunya rujukan lintas-skema adalah auth.uid() di
--    set_user_id, dan itu SUDAH berawalan skema, jadi mempersempit search_path
--    tidak mematahkannya. Dibuktikan dengan tulisan sungguhan sesudahnya —
--    lihat catatan di bawah.
ALTER FUNCTION public.increment_account_balance(p_account_id uuid, p_field text, p_delta numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_merchant_rule_usage(p_rule_id uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.recompute_settlement_totals()    SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at()                 SET search_path = public, pg_temp;
ALTER FUNCTION public.set_user_id()                    SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at()              SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_ledger_business_rules() SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_transfer_currency()     SET search_path = public, pg_temp;

-- 2. increment_merchant_rule_usage adalah SECURITY DEFINER (satu-satunya) DAN
--    bisa dipanggil peran `anon` — artinya siapa pun tanpa login. Ternyata dia
--    YATIM: tidak dipanggil dari src/, edge function, maupun skrip mana pun.
--    Migrasi create_merchant_rules.sql bahkan mendefinisikan tanda tangan lain
--    (p_user_id, p_merchant_name), sedangkan yang hidup (p_rule_id) — sisa
--    rancangan lama. Haknya dicabut, fungsinya tidak dihapus supaya bisa dilihat
--    lagi kalau ternyata ada pemakai di luar repo.
--    increment_account_balance TIDAK disentuh haknya: dia dipanggil src/api.js:161.
REVOKE ALL ON FUNCTION public.increment_merchant_rule_usage(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_merchant_rule_usage(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.increment_merchant_rule_usage(uuid) FROM authenticated;

-- Uji sesudah penerapan (klien authenticated, bukan service_role):
--   insert ledger TANPA user_id  -> set_user_id mengisinya           OK
--   insert IDR ke akun USD       -> validate_transfer_currency tolak OK
--   insert IDR ke akun IDR       -> lolos, baris uji dihapus          OK
-- Security Advisor: 2 error + 12 peringatan -> 0 error + 1 peringatan.
-- Sisa satu itu "Leaked Password Protection Disabled" — sakelar di dashboard
-- Auth, bukan kode.
