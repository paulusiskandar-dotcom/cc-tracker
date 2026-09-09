# Migrations

Nama berkas wajib `<YYYYMMDDHHMMSS>_nama.sql` (UTC). Supabase CLI mengurutkan dan melacak berdasarkan timestamp itu.

Bikin migrasi baru:

    npx supabase migration new nama_singkat

Terapkan ke produksi:

    npx supabase db push --dry-run --linked   # lihat dulu apa yang akan jalan
    npx supabase db push --linked

Cek riwayat lokal vs server:

    npx supabase migration list --linked

Kalau DDL sudah terlanjur dijalankan manual di dashboard, JANGAN push — tandai sudah terpakai:

    npx supabase migration repair --status applied <timestamp>

Catatan: 22 berkas pertama (Apr–Sep 2026) dulu bernama `v2.x_*`/`v3.x_*` dan dijalankan manual.
Pada 9 Sep 2026 semuanya diganti nama ke pola timestamp (urutan diambil dari tanggal commit git)
lalu ditandai `applied`, jadi isinya jangan diubah lagi — bikin migrasi baru untuk perubahan.
