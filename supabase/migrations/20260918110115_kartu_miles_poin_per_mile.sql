-- Rasio tukar poin bank ke KrisFlyer, diisi n8n dari S&K resmi (berapa poin
-- bank untuk 1 mile). Dipakai Wallet untuk menampilkan "≈ N KrisFlyer miles"
-- di samping saldo poin kartu. NULL = belum ada data atau tidak bisa ditukar.
ALTER TABLE kartu_miles ADD COLUMN IF NOT EXISTS poin_per_mile_kf numeric;
NOTIFY pgrst, 'reload schema';
