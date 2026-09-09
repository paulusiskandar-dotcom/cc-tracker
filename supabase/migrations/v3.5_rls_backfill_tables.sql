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
