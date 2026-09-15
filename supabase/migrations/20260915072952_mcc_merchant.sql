-- mcc_merchant: pengetahuan merchant → MCC → dampaknya ke kartu.
--
-- Kartu tidak melihat "belanja online" atau "bayar listrik"; kartu melihat MCC
-- yang dikirim bank acquiring. Merchant yang sama bisa tercatat dengan MCC tak
-- terduga (contoh dari Paulus 15 Sep 2026: Lazada tercatat sebagai groceries,
-- sehingga masuk Double Yay "Belanja Bulanan" Jenius). Tips seperti ini banyak
-- beredar di grup Telegram; tabel ini menyimpannya BERSAMA sumber dan status
-- verifikasi, dan mencatat kalau ada pernyataan resmi yang bertentangan.
--
-- Diisi lewat ingest-miles-promo (tabel "mcc_merchant", tanpa prune). Klien baca saja.

CREATE TABLE IF NOT EXISTS mcc_merchant (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kunci               text NOT NULL,          -- merchant|kartu_atau_bank|kategori_spending
  merchant            text NOT NULL,
  mcc_kode            text,                   -- kosong kalau kodenya tidak diketahui; jangan ditebak
  kategori_mcc        text,                   -- nama kategori MCC apa adanya dari sumber
  kategori_spending   text,                   -- everyday | dining | groceries | travel | online | overseas | utilitas | ...
  kartu               text,                   -- nama katalog kartu kalau spesifik
  bank                text,
  dampak              text,                   -- mis. "Masuk Double Yay Belanja Bulanan"
  sumber_jenis        text CHECK (sumber_jenis IN ('resmi','komunitas','pribadi')),
  sumber_url          text,
  bukti               text,                   -- kutipan / ringkasan bukti
  status_verifikasi   text CHECK (status_verifikasi IN ('terverifikasi','belum_diverifikasi','bertentangan','kedaluwarsa')),
  bertentangan_dengan text,                   -- kutipan sumber resmi yang berlawanan, kalau ada
  per_tanggal         text,
  catatan             text,
  asal                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kunci)
);

ALTER TABLE mcc_merchant ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner reads mcc_merchant" ON mcc_merchant;
CREATE POLICY "Owner reads mcc_merchant" ON mcc_merchant FOR SELECT TO authenticated USING (user_id = auth.uid());
