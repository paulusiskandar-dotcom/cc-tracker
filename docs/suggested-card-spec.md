# Suggested Credit Card + Promo Intelligence — Spec

Tujuan: sebelum bayar, app saranin kartu terbaik (base earn rate + promo aktif).
Promo di-ingest dari grup Telegram (+ email bank) → di-parse Claude → Supabase.

## Prinsip arsitektur
- **1 database** = Supabase cc-tracker yang SAMA (tambah tabel, bukan DB baru) → merge nanti = tempel UI.
- **3 bagian, 1 data**: (a) worker Telegram+parser, (b) Edge Function `suggest-card`, (c) UI prototype.
- Logika "kartu terbaik" taruh di Edge Function → dipakai bareng prototype & cc-tracker (jangan implement 2x).

---

## 1. Skema tabel (Postgres / Supabase)

```sql
-- Kartu yang dimiliki user
create table cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,                 -- "UOB PRVI Miles"
  issuer text,                        -- "UOB","BCA","Mandiri"
  network text,                       -- "Visa","Mastercard","Amex"
  program text,                       -- "KrisFlyer","GarudaMiles","AsiaMiles","cashback"
  point_to_mile numeric default 1,    -- konversi point->mile
  annual_fee numeric default 0,
  fee_waived boolean default false,
  last4 text,
  active boolean default true,
  created_at timestamptz default now()
);

-- Earn rate per kategori (banyak baris per kartu)
create table card_rules (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references cards on delete cascade not null,
  category text not null,             -- dining|ecommerce|transport|groceries|fx|travel|utilities|general
  earn_rate numeric not null,         -- mil per Rp1000 (atau % kalau cashback)
  reward_type text default 'miles',   -- miles|points|cashback
  min_spend numeric,                  -- min transaksi utk dapet rate ini
  monthly_cap numeric,                -- cap reward/bulan (null = unlimited)
  fx_only boolean default false,      -- khusus transaksi mata uang asing
  notes text
);

-- Promo aktif (dari Telegram / email / manual)
create table promos (
  id uuid primary key default gen_random_uuid(),
  source text default 'telegram',     -- telegram|email|manual
  source_msg_id text unique,          -- id pesan (buat DEDUP)
  raw_text text,
  issuer text,                        -- bank/kartu berlaku (kalau spesifik)
  card_name text,                     -- kalau nyebut kartu spesifik
  merchant text,                      -- "Tokopedia","Shopee" (lowercase); null = umum
  category text,                      -- kalau bukan merchant spesifik
  benefit_type text,                  -- discount_pct|discount_flat|bonus_miles|cashback
  benefit_value numeric,              -- 10 (=10%) | 50000 (=Rp50rb) | 5 (=5x poin)
  min_spend numeric,
  max_benefit numeric,
  promo_code text,
  valid_from date,
  valid_until date,
  confidence numeric,                 -- 0..1 dari parser (filter yg ragu)
  status text default 'active',       -- active|expired|review
  created_at timestamptz default now()
);

-- Mapping merchant -> kategori (buat resolve kategori saat suggest)
create table merchant_category (
  merchant text primary key,          -- 'grab' (lowercase, normalized)
  category text not null              -- 'transport'
);

-- transactions: SUDAH ADA. Pastikan ada kolom: merchant, amount, currency, txn_date, card_id_used
```

### RLS
- `cards`, `card_rules`: per-user → `user_id = auth.uid()`.
- `promos`, `merchant_category`: **global** (promo bukan milik 1 user) → public read, write cuma service-role (worker) / admin.
- Filter "promo relevan" dilakukan di query (join ke kartu yg user punya), bukan di RLS.

---

## 2. Edge Function: `suggest-card`

**Input**: `{ merchant?, category?, amount, currency='IDR', date=today }`
**Output**: ranked list kartu + alasan.

```ts
// supabase/functions/suggest-card/index.ts  (Deno)
// Pseudocode inti:
async function suggest({ merchant, category, amount, currency, date }, userId) {
  // 1. resolve kategori
  const cat = category
    ?? (merchant && (await lookupMerchantCategory(merchant)))
    ?? 'general';
  const isFx = currency !== 'IDR';

  // 2. kartu user + rules utk kategori ini (fallback 'general')
  const cards = await getUserCards(userId);          // active only
  const rules = await getRulesFor(cards, isFx ? 'fx' : cat, 'general');

  // 3. promo aktif yg cocok (merchant ATAU kategori) & masih berlaku
  const promos = await getActivePromos({ merchant, category: cat, date });

  // 4. skor tiap kartu
  const scored = cards.map(card => {
    const rule = pickBestRule(rules, card, isFx ? 'fx' : cat);   // spesifik > general
    if (amount < (rule.min_spend ?? 0)) return { card, value: 0, note: 'min spend blm cukup' };
    let baseMiles = (amount/1000) * rule.earn_rate;              // sesuaikan cashback
    baseMiles = applyCap(baseMiles, rule.monthly_cap, card);     // butuh MTD spend dari transactions
    const promo = matchPromo(promos, card);                     // promo yg targetin issuer/kartu ini / umum
    const promoValue = promo ? promoBenefit(promo, amount) : 0;
    return {
      card, rule, promo,
      value: baseMiles /*konversi ke nilai Rp opsional*/ + promoValue,
      reason: buildReason(rule, promo, amount)
    };
  });

  // 5. urutkan desc
  return scored.sort((a,b) => b.value - a.value);
}
```

Detail:
- `pickBestRule`: kategori spesifik menang atas `general`; kalau FX, pakai rule `fx`.
- `applyCap`: butuh MTD (month-to-date) spend per kartu → query `transactions` sum bulan ini.
- `matchPromo`: promo `card_name`/`issuer` cocok kartu → boost; promo umum → apply ke semua.
- Balikin juga **"default vs terbaik"** biar UI bisa nunjukin selisih mil (buat missed-rewards report).

---

## 3. Worker Telegram + Parser Claude

### Ambil pesan
- **Grup kamu sendiri / bisa admin** → **Bot API** (tambah bot, `getUpdates`/webhook). Paling simpel. Bisa jalan sebagai Vercel cron/webhook.
- **Cuma member** → **userbot MTProto (Telethon, Python)**, baca sebagai akunmu. Perlu worker selalu-on → **jalan di NAS** (cron tiap 10–15 mnt).

### Alur
```
tiap N menit:
  msgs = ambil pesan baru grup (since last_id)
  for m in msgs:
     if sudah ada promos.source_msg_id == m.id: skip   # dedup
     hasil = claudeParse(m.text)                         # array promo (0..n)
     for p in hasil:
        if p.confidence < 0.5: p.status='review'
        insert into promos (…p, source='telegram', source_msg_id=m.id, raw_text=m.text)
  simpan last_id
```

### Prompt parser (Claude)
```
Kamu ekstraktor promo kartu kredit Indonesia. Dari pesan chat di bawah,
keluarkan HANYA JSON array promo (0 atau lebih objek). Bukan promo (obrolan
biasa/tanya-jawab) => kembalikan [].

Tiap objek:
{
 "issuer": string|null,            // bank: "BCA","UOB","Mandiri",...
 "card_name": string|null,         // kalau nyebut kartu spesifik
 "merchant": string|null,          // lowercase, mis "tokopedia","shopee"
 "category": string|null,          // dining|ecommerce|transport|groceries|fx|travel|utilities kalau bukan merchant spesifik
 "benefit_type": "discount_pct"|"discount_flat"|"bonus_miles"|"cashback"|null,
 "benefit_value": number|null,     // 10 (=10%) | 50000 (=Rp) | 5 (=5x)
 "min_spend": number|null,
 "max_benefit": number|null,
 "promo_code": string|null,
 "valid_from": "YYYY-MM-DD"|null,
 "valid_until": "YYYY-MM-DD"|null,
 "confidence": number              // 0..1 seberapa yakin ini promo valid
}

Aturan: JANGAN mengarang. Field yg tidak disebut => null. Tahun default 2026
kalau cuma ada tanggal-bulan. Output JSON saja, tanpa penjelasan.

Pesan:
"""{{TEXT}}"""
```
> Reuse pipeline Claude yang udah dipakai buat Gmail-sync.

---

## 4. UI prototype (repo/deploy sendiri, Supabase sama)
- Layar cepat **"Kartu apa?"**: input merchant + nominal → panggil `suggest-card` → tampilkan ranking + alasan.
- (Opsional elegan) **Telegram bot pribadi**: chat "shopee 500k" → bot panggil `suggest-card` → balas. Interface pre-payment di lapangan, share Supabase yg sama.
- Halaman **Promos**: list promo aktif, filter otomatis ke kartu yang user punya, + antrian `status='review'` buat verifikasi manual.

## 5. Urutan bangun
1. Tabel `cards` + `card_rules` + seed kartu kamu (rules manual dulu).
2. Edge Function `suggest-card` (base rate saja) + UI "Kartu apa?".
3. `merchant_category` (Claude bantu klasifikasi nama merchant otomatis).
4. Worker Telegram + parser → isi `promos`.
5. Gabungin promo ke `suggest-card` → saran jadi pinter.
6. Merge ke cc-tracker: import komponen + route (data & fungsi udah shared).

## Merge nanti (kenapa murah)
Karena Supabase & Edge Function udah dipakai bareng dari awal → merge = pindahin
komponen/route UI ke repo cc-tracker. NOL migrasi data.
