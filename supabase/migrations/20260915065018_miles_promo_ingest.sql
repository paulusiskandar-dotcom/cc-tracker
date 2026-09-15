-- Promo bank & data miles dari n8n (NAS) → Ryūsei.
--
-- Lima tabel data publik diisi HANYA oleh Edge Function `ingest-miles-promo`
-- (service role). Klien boleh membaca baris miliknya, tidak boleh menulis.
-- Nama tabel & kolom sengaja sama dengan Data Table n8n, ditambah kolom
-- pengayaan yang diminta di ~/Downloads/prompt-n8n-lengkapi-data-miles.md
-- supaya n8n tak perlu menunggu migrasi baru saat mulai mengirimnya.
--
-- `sync_id`: tabel katalog (program_miles, kartu_miles, earn_rate_kartu) bisa
-- dikirim ulang utuh; baris yang tidak ikut kiriman terakhir dipangkas.
-- Baris tanpa sync_id (isian manual dari sumber resmi) tidak pernah dipangkas.
--
-- `pemetaan_kartu`: keputusan Paulus kartu Ryūsei ↔ produk katalog. Ditulis
-- dari app (pemilik), karena itu satu-satunya tabel di sini yang boleh ditulis klien.

-- ── program_miles ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS program_miles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  program_id        text NOT NULL,
  nama              text,
  jenis             text,
  kedaluwarsa_tipe  text,
  kedaluwarsa_bulan text,
  catatan           text,
  sumber_url        text,
  per_tanggal       text,
  status_verifikasi text,
  asal              text,
  sync_id           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, program_id)
);

-- ── kartu_miles ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kartu_miles (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kartu                          text NOT NULL,
  bank                           text,
  jaringan                       text,
  jenis                          text,
  program                        text,
  iuran_tahunan                  text,
  iuran_bisa_dihapus             text,
  hold_dana                      text,
  welcome_bonus                  text,
  fitur                          text,
  catatan                        text,
  sumber_url                     text,
  per_tanggal                    text,
  keyakinan                      numeric,
  kategori_dikecualikan          text,
  batas_perolehan                text,
  batas_konversi                 text,
  min_konversi                   text,
  biaya_konversi                 text,
  masa_berlaku_poin              text,
  konversi_otomatis              text,
  diperkaya_pada                 text,
  status_pengayaan               text,
  hash_sumber                    text,
  -- pengayaan terstruktur (tidak_dapat | terbatas | dapat | tidak_disebut)
  pengecualian_utilitas          text,
  pengecualian_cicilan           text,
  pengecualian_asuransi          text,
  pengecualian_qris              text,
  pengecualian_pajak             text,
  pengecualian_ewallet_topup     text,
  pengecualian_spbu              text,
  pengecualian_pendidikan        text,
  pengecualian_virtual_account   text,
  pengecualian_kutipan           jsonb,
  kelipatan_transaksi_rp         numeric,
  batas_perolehan_bulanan        text,
  biaya_konversi_rp              numeric,
  iuran_tahunan_utama_rp         numeric,
  asal                           text,
  sync_id                        text,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kartu),
  CONSTRAINT kartu_miles_pengecualian_nilai CHECK (
    COALESCE(pengecualian_utilitas,        'tidak_disebut') IN ('tidak_dapat','terbatas','dapat','tidak_disebut') AND
    COALESCE(pengecualian_cicilan,         'tidak_disebut') IN ('tidak_dapat','terbatas','dapat','tidak_disebut') AND
    COALESCE(pengecualian_asuransi,        'tidak_disebut') IN ('tidak_dapat','terbatas','dapat','tidak_disebut') AND
    COALESCE(pengecualian_qris,            'tidak_disebut') IN ('tidak_dapat','terbatas','dapat','tidak_disebut') AND
    COALESCE(pengecualian_pajak,           'tidak_disebut') IN ('tidak_dapat','terbatas','dapat','tidak_disebut') AND
    COALESCE(pengecualian_ewallet_topup,   'tidak_disebut') IN ('tidak_dapat','terbatas','dapat','tidak_disebut') AND
    COALESCE(pengecualian_spbu,            'tidak_disebut') IN ('tidak_dapat','terbatas','dapat','tidak_disebut') AND
    COALESCE(pengecualian_pendidikan,      'tidak_disebut') IN ('tidak_dapat','terbatas','dapat','tidak_disebut') AND
    COALESCE(pengecualian_virtual_account, 'tidak_disebut') IN ('tidak_dapat','terbatas','dapat','tidak_disebut')
  )
);

-- ── earn_rate_kartu ───────────────────────────────────────────
-- `kunci` (kartu|kategori|program) dari n8n TIDAK unik: per 15 Sep 2026 ada
-- 29 kunci kembar yang angkanya sah berbeda. Kunci upsert = `kunci_baris`.
-- Kalau n8n belum mengirim kunci_baris, Edge Function menurunkannya.
CREATE TABLE IF NOT EXISTS earn_rate_kartu (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kunci_baris      text NOT NULL,
  kunci            text,
  varian           text,
  kartu            text,
  bank             text,
  kategori         text,
  program          text,
  rupiah_per_mile  numeric,
  cashback_pct     numeric,
  min_transaksi    text,
  batas_bulanan    text,
  satuan           text,
  perlu_cek        boolean,
  catatan          text,
  sumber_url       text,
  per_tanggal      text,
  asal             text,
  sync_id          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kunci_baris)
);
CREATE INDEX IF NOT EXISTS earn_rate_kartu_kartu_idx ON earn_rate_kartu (user_id, kartu);

-- ── promo_bank ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promo_bank (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url                     text NOT NULL,
  bank                    text,
  judul                   text,
  kategori                text,
  merchant                text,
  benefit                 text,
  minimal_transaksi       text,
  kartu_atau_produk       text,
  periode_mulai           text,
  periode_akhir           text,
  kode_promo              text,
  syarat_penting          text,
  miles_poin              boolean,
  ditemukan               text,
  status                  text,
  jenis_produk            text,
  bank_penerbit_kartu     text,
  kartu_berlaku           jsonb,
  jenis_reward            text,
  program                 text,
  butuh_status_prioritas  boolean,
  detail_kosong           boolean,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, url)
);
CREATE INDEX IF NOT EXISTS promo_bank_akhir_idx ON promo_bank (user_id, periode_akhir);

-- ── miles_update ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS miles_update (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url            text NOT NULL,
  judul          text,
  terbit         text,
  jenis          text,
  relevan_miles  boolean,
  program        text,
  bank           text,
  kartu          text,
  rate_lama      text,
  rate_baru      text,
  berlaku_mulai  text,
  berlaku_akhir  text,
  ringkasan      text,
  aksi           text,
  sumber         text,
  ditemukan      text,
  status         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, url)
);

-- ── pemetaan_kartu ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pemetaan_kartu (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kartu_katalog  text,
  status         text NOT NULL CHECK (status IN ('matched','not_in_catalog')),
  catatan        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, account_id),
  CONSTRAINT pemetaan_kartu_katalog_wajib CHECK (status <> 'matched' OR kartu_katalog IS NOT NULL)
);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE program_miles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kartu_miles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE earn_rate_kartu ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_bank      ENABLE ROW LEVEL SECURITY;
ALTER TABLE miles_update    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pemetaan_kartu  ENABLE ROW LEVEL SECURITY;

-- data publik: pemilik membaca saja (tanpa policy INSERT/UPDATE/DELETE = klien tak bisa menulis)
DROP POLICY IF EXISTS "Owner reads program_miles" ON program_miles;
CREATE POLICY "Owner reads program_miles" ON program_miles FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Owner reads kartu_miles" ON kartu_miles;
CREATE POLICY "Owner reads kartu_miles" ON kartu_miles FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Owner reads earn_rate_kartu" ON earn_rate_kartu;
CREATE POLICY "Owner reads earn_rate_kartu" ON earn_rate_kartu FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Owner reads promo_bank" ON promo_bank;
CREATE POLICY "Owner reads promo_bank" ON promo_bank FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Owner reads miles_update" ON miles_update;
CREATE POLICY "Owner reads miles_update" ON miles_update FOR SELECT TO authenticated USING (user_id = auth.uid());

-- pemetaan: keputusan pemilik, ditulis dari app
DROP POLICY IF EXISTS "Owner manages pemetaan_kartu" ON pemetaan_kartu;
CREATE POLICY "Owner manages pemetaan_kartu" ON pemetaan_kartu FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
