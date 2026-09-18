-- Saldo poin/miles per kartu, diisi parser statement (gmail-estatement) atau manual.
-- Tampil di Wallet HP: "43.331 Travel Miles · statement 12 Sep · 0 hangus 31 Okt".
-- Tidak menyentuh saldo/tagihan; hanya informasi.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS points_balance     numeric,
  ADD COLUMN IF NOT EXISTS points_unit        text,      -- "Travel Miles", "Livin'poin", "TREATS", "Poin Xtra", "UOB Points" ...
  ADD COLUMN IF NOT EXISTS points_expiring    numeric,   -- poin yang akan hangus berikutnya
  ADD COLUMN IF NOT EXISTS points_expiry_date date,
  ADD COLUMN IF NOT EXISTS points_as_of       date,      -- tanggal statement / tanggal isi manual
  ADD COLUMN IF NOT EXISTS points_source      text CHECK (points_source IN ('statement','manual'));
