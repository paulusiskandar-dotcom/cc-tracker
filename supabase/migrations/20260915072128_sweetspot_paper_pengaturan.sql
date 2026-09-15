-- SweetSpot: pengecualian Paper.id + pengaturan pribadi per kartu.
--
-- pengecualian_paper: transaksi lewat platform tagihan bisnis/invoice (Paper.id).
-- Jenius menyebutnya resmi ("platform pembayaran bisnis & invoice"), Mandiri
-- Bonvoy lewat "Pembayaran tagihan bisnis/invoicing".
--
-- pemetaan_kartu.pengaturan: pilihan pemegang kartu yang tidak ada di katalog
-- publik, mis. kategori Double Yay Jenius yang dipilih sendiri tiap bulan.
-- Bentuk: {"bonus_pilihan": {"nama": "Double Yay", "kategori": "groceries",
--          "label_bank": "Belanja Bulanan", "diatur_pada": "2026-09-15"}}

ALTER TABLE kartu_miles ADD COLUMN IF NOT EXISTS pengecualian_paper text;
ALTER TABLE kartu_miles DROP CONSTRAINT IF EXISTS kartu_miles_pengecualian_paper_nilai;
ALTER TABLE kartu_miles ADD CONSTRAINT kartu_miles_pengecualian_paper_nilai
  CHECK (COALESCE(pengecualian_paper, 'tidak_disebut') IN ('tidak_dapat','terbatas','dapat','tidak_disebut'));

ALTER TABLE pemetaan_kartu ADD COLUMN IF NOT EXISTS pengaturan jsonb;
