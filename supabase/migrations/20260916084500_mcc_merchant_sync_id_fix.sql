-- Migrasi 20260916083316 tercatat di riwayat tetapi isinya kosong (SQL-nya
-- salah tertulis ke README, sudah dipulihkan), jadi kolomnya ditambahkan di sini.
ALTER TABLE mcc_merchant ADD COLUMN IF NOT EXISTS sync_id text;
NOTIFY pgrst, 'reload schema';
