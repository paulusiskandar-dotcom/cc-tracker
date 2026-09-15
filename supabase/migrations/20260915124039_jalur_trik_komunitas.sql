-- Laporan grup Telegram yang sudah dianalisis n8n (15 Sep 2026): rute
-- QRIS/dompet digital & top up e-money per kartu, dan trik miles.
-- Sumbernya komunitas, bukan S&K bank. Hanya untuk dibaca pemilik; tidak ada
-- nama anggota grup (n8n sudah membuangnya), kutipan bukti maks ±250 karakter.
-- Diisi HANYA lewat Edge Function ingest-miles-promo.

-- ── jalur_transaksi_kartu ─────────────────────────────────────
-- kunci = topik|kartu_atau_bank|kanal|jenis_transaksi (diturunkan ingest bila kosong).
-- kartu_katalog = array nama kartu_miles yang dicakup baris ini ([] untuk baris
-- umum/kanal). Diisi n8n; app tidak menebak dari teks kartu_atau_bank.
CREATE TABLE IF NOT EXISTS jalur_transaksi_kartu (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kunci                      text NOT NULL,
  topik                      text,          -- qris_dompet | topup_emoney
  kartu_atau_bank            text,
  kartu_katalog              jsonb,
  kanal                      text,
  jenis_transaksi            text,
  dapat_poin                 text,          -- dapat | terbatas | tidak_dapat | berubah
  biaya_admin                text,
  mcc_dilaporkan             text,
  detail                     text,
  pertama_dilaporkan         text,
  terakhir_dilaporkan        text,
  jumlah_laporan             numeric,
  status_dugaan              text,          -- masih_berlaku | tidak_jelas | sudah_ditutup
  bertentangan_dengan_resmi  boolean,
  keyakinan                  text,          -- tinggi | sedang | rendah
  catatan                    text,
  bukti                      jsonb,
  sumber                     text,
  per_tanggal                text,
  sync_id                    text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kunci)
);

-- ── trik_miles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trik_miles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kode               text NOT NULL,
  kategori           text,
  skor_manfaat       numeric,
  judul              text,
  ringkasan          text,
  langkah            jsonb,
  syarat             text,
  manfaat_perkiraan  text,
  risiko             text,
  relevan_paulus     text,           -- ya | sebagian | tidak
  alasan_relevansi   text,
  pertama_dibahas    text,
  terakhir_dibahas   text,
  status_dugaan      text,
  keyakinan          text,
  bukti              jsonb,
  sumber             text,
  per_tanggal        text,
  sync_id            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kode)
);

ALTER TABLE jalur_transaksi_kartu ENABLE ROW LEVEL SECURITY;
ALTER TABLE trik_miles            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads jalur_transaksi_kartu" ON jalur_transaksi_kartu;
CREATE POLICY "Owner reads jalur_transaksi_kartu" ON jalur_transaksi_kartu FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Owner reads trik_miles" ON trik_miles;
CREATE POLICY "Owner reads trik_miles" ON trik_miles FOR SELECT TO authenticated USING (user_id = auth.uid());
