# Ingest promo & miles dari n8n ke Ryūsei

Satu pintu untuk data **publik** (promo bank, katalog kartu, earn rate, berita miles) yang dikumpulkan n8n di NAS. Ryūsei menyimpannya di Supabase dan tab **SweetSpot** membacanya langsung.

Tidak ada data transaksi, saldo, atau email pribadi yang lewat sini, ke arah mana pun.

## Endpoint

```
POST https://zxkxfaoxzldxojwepnca.supabase.co/functions/v1/ingest-miles-promo
Content-Type: application/json
x-ingest-key: <nilai secret RYUSEI_INGEST_KEY>
```

- Secret Supabase: `RYUSEI_INGEST_KEY`. Nilainya ada di Mac mini: `~/n8n-keys/ryusei_ingest.key` (mode 600). Jangan ditulis di kode, alur n8n yang diekspor, atau memori.
- Pemilik baris diambil dari secret `TELEGRAM_AUTHORIZED_USER_ID`; n8n tidak perlu (dan tidak boleh) mengirim `user_id`.
- Fungsi dideploy dengan `verify_jwt = false` (lihat `supabase/config.toml`); satu-satunya penjaga adalah header di atas.

## Bentuk permintaan

```json
{
  "table": "promo_bank",
  "rows": [ { "url": "https://…", "bank": "BCA", "judul": "…" } ],
  "sync_id": "2026-09-16T06:00",
  "prune": false
}
```

- Satu tabel per permintaan, maksimal **1000 baris**. Lebih dari itu: pecah jadi beberapa batch.
- **Kolom yang tidak dikenal = seluruh permintaan ditolak**, tidak ada baris yang ditulis. Buang kolom internal Data Table n8n (`id`, `createdAt`, `updatedAt`) sebelum mengirim.
- Nilai `""` disimpan sebagai NULL. Kolom angka menerima angka atau teks angka; kolom boolean menerima `true/false/1/0`. Nilai yang tidak bisa dikonversi = seluruh permintaan ditolak dengan nomor baris dan kolomnya.
- Teks disimpan apa adanya: `[PERLU CEK …]`, `[POIN BANK/HOTEL …]`, dan `per_tanggal` seperti `2026-01 approx` tidak diubah.
- Kunci sama dua kali dalam satu batch: baris terakhir yang dipakai.

## Tabel dan kunci upsert

| table | kunci upsert | sync_id / prune |
|---|---|---|
| `promo_bank` | `url` | tidak |
| `miles_update` | `url` | tidak |
| `kartu_miles` | `kartu` | ya |
| `program_miles` | `program_id` | ya |
| `earn_rate_kartu` | `kunci_baris` | ya |

### earn_rate_kartu: kenapa bukan `kunci`

`kunci` (`kartu|kategori|program`) **tidak unik**: per 15 Sep 2026 ada 29 kunci kembar yang angkanya sah berbeda, mis. `BCA Singapore Airlines KrisFlyer Visa Signature|fx|KrisFlyer` = 13.500 dan 8.060. Kalau `kunci` dijadikan kunci upsert, satu varian hilang diam-diam.

Urutan penentuan `kunci_baris`:
1. dikirim n8n → dipakai apa adanya (disarankan: `kunci|varian`);
2. ada `varian` → `kunci|varian`;
3. tidak ada keduanya → `kunci|h:<12 hex sha256 dari rupiah_per_mile|cashback_pct|catatan|sumber_url|min_transaksi|batas_bulanan>`.

`kunci` sendiri diturunkan dari `kartu|kategori|program` kalau tidak dikirim.

Konsekuensi cara 3: kalau angka suatu varian berubah, hash-nya berubah dan baris lama tertinggal. Karena itu **kirim katalog utuh dengan `sync_id` + `prune`**, atau kirim `varian`/`kunci_baris` yang stabil.

### sync_id dan prune (hanya tabel katalog)

Kirim seluruh isi tabel dalam satu atau beberapa batch dengan `sync_id` yang sama. Pada batch **terakhir** tambahkan `"prune": true`: baris tabel itu yang `sync_id`-nya lain (dan tidak NULL) dihapus.

Baris dengan `sync_id` NULL tidak pernah dipangkas. Itu dipakai untuk isian manual dari sumber resmi (saat ini: `Marriott Bonvoy Mandiri Visa Signature`, `asal = resmi_manual`). Kalau n8n kelak mengirim kartu dengan nama yang sama, barisnya menimpa isian manual dan ikut siklus sync.

Jangan kirim `prune: true` kalau salah satu batch sebelumnya gagal: baris yang belum terkirim akan ikut terhapus.

## Kolom per tabel

**program_miles**: program_id, nama, jenis, kedaluwarsa_tipe, kedaluwarsa_bulan, catatan, sumber_url, per_tanggal, status_verifikasi, asal

**kartu_miles**: kartu, bank, jaringan, jenis, program, iuran_tahunan, iuran_bisa_dihapus, hold_dana, welcome_bonus, fitur, catatan, sumber_url, per_tanggal, keyakinan (angka), kategori_dikecualikan, batas_perolehan, batas_konversi, min_konversi, biaya_konversi, masa_berlaku_poin, konversi_otomatis, diperkaya_pada, status_pengayaan, hash_sumber, asal
pengayaan: pengecualian_utilitas, pengecualian_cicilan, pengecualian_asuransi, pengecualian_qris, pengecualian_pajak, pengecualian_ewallet_topup, pengecualian_spbu, pengecualian_pendidikan, pengecualian_virtual_account (masing-masing hanya `tidak_dapat` | `terbatas` | `dapat` | `tidak_disebut`; nilai lain ditolak database), pengecualian_kutipan (JSON `{kategori: {kutipan, sumber_url, per_tanggal}}`, kunci kategori tanpa awalan `pengecualian_`), kelipatan_transaksi_rp (angka), batas_perolehan_bulanan, biaya_konversi_rp (angka), iuran_tahunan_utama_rp (angka)

**earn_rate_kartu**: kunci_baris, kunci, varian, kartu, bank, kategori, program, rupiah_per_mile (angka), cashback_pct (angka), min_transaksi, batas_bulanan, satuan (`miles_maskapai` | `poin_bank` | `poin_hotel` | `cashback`), perlu_cek (boolean), catatan, sumber_url, per_tanggal, asal

**promo_bank**: url, bank, judul, kategori, merchant, benefit, minimal_transaksi, kartu_atau_produk, periode_mulai, periode_akhir, kode_promo, syarat_penting, miles_poin (boolean), ditemukan, status
pengayaan: jenis_produk, bank_penerbit_kartu, kartu_berlaku (JSON), jenis_reward, program, butuh_status_prioritas (boolean), detail_kosong (boolean)

**miles_update**: url, judul, terbit, jenis, relevan_miles (boolean), program, bank, kartu, rate_lama, rate_baru, berlaku_mulai, berlaku_akhir, ringkasan, aksi, sumber, ditemukan, status

Kolom pengayaan boleh tidak dikirim; UI memakai kolom lama sebagai cadangan.

## Balasan

Sukses (200):
```json
{"ok":true,"table":"promo_bank","diterima":85,"unik":85,"baru":82,"diperbarui":3,"kunci_diturunkan":0,"dipangkas":0,"sync_id":null}
```

Gagal:

| kode | arti |
|---|---|
| 401 | header `x-ingest-key` salah atau tidak ada |
| 405 | bukan POST |
| 400 | tabel tidak dikenal, kolom tidak dikenal, nilai tidak valid, kunci kosong, `prune` di tabel non-katalog, `prune` tanpa `sync_id` |
| 413 | lebih dari 1000 baris |
| 500 | secret hilang di server atau database menolak; lihat `error` |

Semua 400 berarti **tidak ada baris yang ditulis**. 500 saat menulis membawa `sudah_ditulis_sebelum_gagal`.

## Contoh curl (kunci palsu)

```bash
curl -s -X POST "https://zxkxfaoxzldxojwepnca.supabase.co/functions/v1/ingest-miles-promo" \
  -H "Content-Type: application/json" \
  -H "x-ingest-key: 0000000000000000000000000000000000000000000000000000000000000000" \
  -d '{"table":"miles_update","rows":[{"url":"https://pinterpoin.com/contoh/","judul":"Contoh","relevan_miles":true,"status":"ok"}]}'
```

Katalog utuh dengan pemangkasan, dua batch:

```bash
KEY=$(cat ~/n8n-keys/ryusei_ingest.key)
URL="https://zxkxfaoxzldxojwepnca.supabase.co/functions/v1/ingest-miles-promo"
curl -s -X POST "$URL" -H "Content-Type: application/json" -H "x-ingest-key: $KEY" \
  -d '{"table":"earn_rate_kartu","sync_id":"2026-09-16T06:00","rows":[ … 1000 baris … ]}'
curl -s -X POST "$URL" -H "Content-Type: application/json" -H "x-ingest-key: $KEY" \
  -d '{"table":"earn_rate_kartu","sync_id":"2026-09-16T06:00","prune":true,"rows":[ … sisa … ]}'
```

## Di n8n

Node **HTTP Request** di akhir tiap alur: method POST, URL di atas, header `x-ingest-key` dari kredensial *Header Auth* (bukan teks di node), body JSON `{{ { table: "...", rows: $input.all().map(i => i.json) } }}` setelah node yang membuang `id/createdAt/updatedAt`. Kalau balasan `ok` bukan `true`, kirim peringatan lewat hub Telegram.

## Yang sudah diuji (15 Sep 2026)

- tanpa kunci / kunci salah → 401; GET → 405; tabel `accounts` → 400; kolom `saldo_rekening` → 400 dan tidak ada baris tertulis; teks di kolom angka → 400; prune di `promo_bank` → 400
- 3 promo dikirim dua kali → `baru 3` lalu `diperbarui 3`, total tetap 3
- dua baris kunci kembar (13.500 dan 8.060) dikirim dua kali → tersimpan dua, tidak bertambah
- sync A 2 baris lalu sync B 1 baris + prune → `dipangkas 1`
- klien login (anon + RLS) tidak bisa INSERT ke `promo_bank`, tetapi bisa membaca
- isi awal dari n8n: program_miles 20, kartu_miles 57, earn_rate_kartu 319, promo_bank 85, miles_update 10 (sync_id katalog `awal-20260915`)

## Tabel pendamping: pemetaan_kartu

Keputusan Paulus kartu Ryūsei ↔ produk katalog (`account_id` → `kartu_katalog`, `status` `matched` | `not_in_catalog`). Diisi dari tombol **Match cards** di SweetSpot, bukan dari n8n. Nama yang hanya mirip tidak pernah dipetakan otomatis.
