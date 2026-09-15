-- Kolom pengayaan yang sudah diisi n8n (riset sumber resmi 15 Sep 2026) tetapi
-- belum ada di Ryūsei. Tanpa ini ingest menolak seluruh kiriman kartu_miles
-- dan promo_bank (kolom tak dikenal). Nama & tipe mengikuti Data Table n8n.
--
-- Dua kategori baru permintaan Paulus 15 Sep:
--   pengecualian_emoney_topup    isi saldo kartu uang elektronik (Flazz, e-money, Brizzi, TapCash)
--   pengecualian_bayar_ewallet   kartu kredit ditautkan ke dompet digital (DANA, GoPay, OVO,
--                                ShopeePay) lalu dipakai bayar merchant / QRIS
-- Bedanya dengan pengecualian_ewallet_topup (isi saldo dompet digital) dan
-- pengecualian_qris (bayar QRIS langsung dengan kartu/aplikasi bank).

ALTER TABLE kartu_miles
  ADD COLUMN IF NOT EXISTS kelipatan_hasil                  text,
  ADD COLUMN IF NOT EXISTS batas_perolehan_bulanan_angka    numeric,
  ADD COLUMN IF NOT EXISTS batas_perolehan_bulanan_satuan   text,
  ADD COLUMN IF NOT EXISTS batas_perolehan_bulanan_kategori text,
  ADD COLUMN IF NOT EXISTS batas_konversi_angka             numeric,
  ADD COLUMN IF NOT EXISTS batas_konversi_satuan            text,
  ADD COLUMN IF NOT EXISTS batas_konversi_periode           text,
  ADD COLUMN IF NOT EXISTS min_konversi_angka               numeric,
  ADD COLUMN IF NOT EXISTS min_konversi_satuan              text,
  ADD COLUMN IF NOT EXISTS iuran_hapus_status               text,
  ADD COLUMN IF NOT EXISTS iuran_hapus_syarat               text,
  ADD COLUMN IF NOT EXISTS angka_kutipan                    jsonb,
  ADD COLUMN IF NOT EXISTS sumber_resmi_dibaca              jsonb,
  ADD COLUMN IF NOT EXISTS catatan_resmi                    text,
  ADD COLUMN IF NOT EXISTS asal_resmi                       text,
  ADD COLUMN IF NOT EXISTS resmi_per_tanggal                text,
  ADD COLUMN IF NOT EXISTS paper_via_blibli_tokopedia       text,
  ADD COLUMN IF NOT EXISTS pengecualian_emoney_topup        text,
  ADD COLUMN IF NOT EXISTS pengecualian_bayar_ewallet       text;

ALTER TABLE kartu_miles DROP CONSTRAINT IF EXISTS kartu_miles_pengecualian_tambahan_nilai;
ALTER TABLE kartu_miles ADD CONSTRAINT kartu_miles_pengecualian_tambahan_nilai CHECK (
  COALESCE(paper_via_blibli_tokopedia, 'tidak_disebut') IN ('tidak_dapat','terbatas','dapat','tidak_disebut') AND
  COALESCE(pengecualian_emoney_topup,  'tidak_disebut') IN ('tidak_dapat','terbatas','dapat','tidak_disebut') AND
  COALESCE(pengecualian_bayar_ewallet, 'tidak_disebut') IN ('tidak_dapat','terbatas','dapat','tidak_disebut')
);

ALTER TABLE promo_bank
  ADD COLUMN IF NOT EXISTS program_reward   text,
  ADD COLUMN IF NOT EXISTS klasifikasi_oleh text;
