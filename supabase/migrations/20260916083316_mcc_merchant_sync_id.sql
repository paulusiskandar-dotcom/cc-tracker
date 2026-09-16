-- mcc_merchant kini boleh dipangkas seperti tabel katalog (ingest-miles-promo),
-- supaya tip yang kuncinya diganti tidak meninggalkan baris kembar di UI.
-- Baris tanpa sync_id (isian manual) tetap tidak pernah dipangkas.
--
-- Migrasi dengan timestamp ini sempat tercatat kosong (isinya salah tulis ke
-- README), jadi kolomnya ditambahkan lewat 20260916084500 di bawahnya.
ALTER TABLE mcc_merchant ADD COLUMN IF NOT EXISTS sync_id text;
