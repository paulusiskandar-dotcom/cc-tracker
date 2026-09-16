// ingest-miles-promo — penerima data publik promo bank & miles dari n8n (NAS).
//
// POST { table, rows: [...], sync_id?, prune? }  header x-ingest-key
// Kontrak lengkap: docs/INGEST_MILES_PROMO.md
//
// - Kunci rahasia di secret RYUSEI_INGEST_KEY, pemilik baris di
//   TELEGRAM_AUTHORIZED_USER_ID (Ryūsei satu pengguna).
// - Kolom yang tidak dikenal → seluruh permintaan ditolak, tidak ada yang ditulis.
// - Nilai kosong ("") disimpan NULL; angka dan boolean dikonversi, teks apa adanya.
// - Kolom yang TIDAK dikirim untuk suatu baris dibiarkan apa adanya di database
//   (pembaruan sebagian aman, juga kalau baris dalam satu kiriman berbeda kolom).
// - Nilai "__kosongkan__" = kosongkan kolom itu (n8n tidak mengirim NULL).
// - earn_rate_kartu: `kunci` dari n8n tidak unik (29 kembar per 15 Sep 2026),
//   jadi kunci upsert = `kunci_baris`. Kalau tidak dikirim, diturunkan dari
//   kunci + varian, atau kunci + hash isi baris.
// - Tabel katalog boleh dipangkas: kirim semua batch dengan sync_id sama, batch
//   terakhir prune:true → baris ber-sync_id lain dihapus. Baris sync_id NULL
//   (isian manual) tidak pernah dipangkas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Kind = "text" | "num" | "bool" | "json";
type Spec = { key: string; prunable: boolean; cols: Record<string, Kind> };

const t = (names: string[], kind: Kind = "text") => Object.fromEntries(names.map((n) => [n, kind]));

const TABLES: Record<string, Spec> = {
  program_miles: {
    key: "program_id", prunable: true,
    cols: t(["program_id", "nama", "jenis", "kedaluwarsa_tipe", "kedaluwarsa_bulan", "catatan", "sumber_url",
      "per_tanggal", "status_verifikasi", "asal"]),
  },
  kartu_miles: {
    key: "kartu", prunable: true,
    cols: {
      ...t(["kartu", "bank", "jaringan", "jenis", "program", "iuran_tahunan", "iuran_bisa_dihapus", "hold_dana",
        "welcome_bonus", "fitur", "catatan", "sumber_url", "per_tanggal", "kategori_dikecualikan", "batas_perolehan",
        "batas_konversi", "min_konversi", "biaya_konversi", "masa_berlaku_poin", "konversi_otomatis", "diperkaya_pada",
        "status_pengayaan", "hash_sumber", "pengecualian_utilitas", "pengecualian_cicilan", "pengecualian_asuransi",
        "pengecualian_qris", "pengecualian_pajak", "pengecualian_ewallet_topup", "pengecualian_spbu",
        "pengecualian_pendidikan", "pengecualian_virtual_account", "pengecualian_paper", "pengecualian_emoney_topup",
        "pengecualian_bayar_ewallet", "paper_via_blibli_tokopedia", "batas_perolehan_bulanan", "asal", "kelipatan_hasil",
        "batas_perolehan_bulanan_satuan", "batas_perolehan_bulanan_kategori", "batas_konversi_satuan",
        "batas_konversi_periode", "min_konversi_satuan", "iuran_hapus_status", "iuran_hapus_syarat", "catatan_resmi",
        "asal_resmi", "resmi_per_tanggal"]),
      ...t(["keyakinan", "kelipatan_transaksi_rp", "biaya_konversi_rp", "iuran_tahunan_utama_rp",
        "batas_perolehan_bulanan_angka", "batas_konversi_angka", "min_konversi_angka"], "num"),
      ...t(["pengecualian_kutipan", "angka_kutipan", "sumber_resmi_dibaca"], "json"),
    },
  },
  earn_rate_kartu: {
    key: "kunci_baris", prunable: true,
    cols: {
      ...t(["kunci_baris", "kunci", "varian", "kartu", "bank", "kategori", "program", "min_transaksi", "batas_bulanan",
        "satuan", "catatan", "sumber_url", "per_tanggal", "asal"]),
      ...t(["rupiah_per_mile", "cashback_pct"], "num"),
      perlu_cek: "bool",
    },
  },
  promo_bank: {
    key: "url", prunable: false,
    cols: {
      ...t(["url", "bank", "judul", "kategori", "merchant", "benefit", "minimal_transaksi", "kartu_atau_produk",
        "periode_mulai", "periode_akhir", "kode_promo", "syarat_penting", "ditemukan", "status", "jenis_produk",
        "bank_penerbit_kartu", "jenis_reward", "program", "program_reward", "klasifikasi_oleh"]),
      ...t(["miles_poin", "butuh_status_prioritas", "detail_kosong"], "bool"),
      kartu_berlaku: "json",
    },
  },
  // prunable: renaming a kunci (mis. "Lazada (belanja umum)" → "Lazada|<kartu>|<kategori>")
  // used to leave the old row behind as a duplicate tip in the UI.
  mcc_merchant: {
    key: "kunci", prunable: true,
    cols: t(["kunci", "merchant", "mcc_kode", "kategori_mcc", "kategori_spending", "kartu", "bank", "dampak", "sumber_jenis",
      "sumber_url", "bukti", "status_verifikasi", "bertentangan_dengan", "per_tanggal", "catatan", "asal"]),
  },
  jalur_transaksi_kartu: {
    key: "kunci", prunable: true,
    cols: {
      ...t(["kunci", "topik", "kartu_atau_bank", "kanal", "jenis_transaksi", "dapat_poin", "biaya_admin", "mcc_dilaporkan",
        "detail", "pertama_dilaporkan", "terakhir_dilaporkan", "status_dugaan", "keyakinan", "catatan", "sumber", "per_tanggal"]),
      jumlah_laporan: "num",
      bertentangan_dengan_resmi: "bool",
      ...t(["kartu_katalog", "bukti"], "json"),
    },
  },
  trik_miles: {
    key: "kode", prunable: true,
    cols: {
      ...t(["kode", "kategori", "judul", "ringkasan", "syarat", "manfaat_perkiraan", "risiko", "relevan_paulus",
        "alasan_relevansi", "pertama_dibahas", "terakhir_dibahas", "status_dugaan", "keyakinan", "sumber", "per_tanggal"]),
      skor_manfaat: "num",
      ...t(["langkah", "bukti"], "json"),
    },
  },
  miles_update: {
    key: "url", prunable: false,
    cols: {
      ...t(["url", "judul", "terbit", "jenis", "program", "bank", "kartu", "rate_lama", "rate_baru", "berlaku_mulai",
        "berlaku_akhir", "ringkasan", "aksi", "sumber", "ditemukan", "status"]),
      relevan_miles: "bool",
    },
  },
};

const MAX_ROWS = 1000;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Bandingkan hash kedua nilai supaya lama pembandingan tidak membocorkan isi kunci.
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0 && a.length > 0;
}

// n8n tidak mengirim nilai kosong (supaya isian lama tak tertimpa), jadi
// pengosongan kolom harus eksplisit dengan penanda ini.
const CLEAR = "__kosongkan__";

function coerce(kind: Kind, v: unknown): { ok: true; value: unknown } | { ok: false } {
  if (v === undefined || v === null || v === CLEAR) return { ok: true, value: null };
  if (typeof v === "string" && v.trim() === "") return { ok: true, value: null };
  switch (kind) {
    case "text":
      return { ok: true, value: typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v) };
    case "num": {
      const n = typeof v === "number" ? v : Number(String(v).trim());
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case "bool": {
      if (typeof v === "boolean") return { ok: true, value: v };
      const s = String(v).trim().toLowerCase();
      if (["true", "1", "ya", "yes"].includes(s)) return { ok: true, value: true };
      if (["false", "0", "tidak", "no"].includes(s)) return { ok: true, value: false };
      return { ok: false };
    }
    case "json": {
      if (typeof v === "object") return { ok: true, value: v };
      try { return { ok: true, value: JSON.parse(String(v)) }; } catch { return { ok: false }; }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Gunakan POST." });

  const INGEST_KEY = Deno.env.get("RYUSEI_INGEST_KEY") ?? "";
  const OWNER = Deno.env.get("TELEGRAM_AUTHORIZED_USER_ID") ?? "";
  if (!INGEST_KEY || !OWNER) return json(500, { ok: false, error: "Server belum dikonfigurasi (secret hilang)." });
  if (!(await sameSecret(req.headers.get("x-ingest-key") ?? "", INGEST_KEY))) {
    return json(401, { ok: false, error: "Header x-ingest-key salah atau tidak ada." });
  }

  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "Body bukan JSON yang valid." }); }

  const table = String(body?.table ?? "");
  const spec = TABLES[table];
  if (!spec) return json(400, { ok: false, error: `Tabel tidak dikenal: "${table}".`, tabel_yang_diterima: Object.keys(TABLES) });
  if (!Array.isArray(body.rows)) return json(400, { ok: false, error: "rows harus berupa array." });
  if (body.rows.length > MAX_ROWS) return json(413, { ok: false, error: `Maksimal ${MAX_ROWS} baris per permintaan; pecah jadi beberapa batch.` });

  const syncId = body.sync_id == null || body.sync_id === "" ? null : String(body.sync_id);
  const prune = body.prune === true;
  if ((syncId || prune) && !spec.prunable) {
    return json(400, { ok: false, error: `sync_id/prune hanya untuk tabel katalog, bukan ${table}.` });
  }
  if (prune && !syncId) return json(400, { ok: false, error: "prune:true wajib disertai sync_id." });

  // 1) kolom tak dikenal → tolak semuanya
  const unknown = new Set<string>();
  body.rows.forEach((r: Record<string, unknown>) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) { unknown.add("(baris bukan objek)"); return; }
    Object.keys(r).forEach((k) => { if (!(k in spec.cols)) unknown.add(k); });
  });
  if (unknown.size) {
    return json(400, { ok: false, error: "Ada kolom yang tidak dikenal; tidak ada baris yang ditulis.", kolom_tidak_dikenal: [...unknown] });
  }

  // 2) konversi tipe + kunci
  const errors: string[] = [];
  let derived = 0;
  const byKey = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < body.rows.length; i++) {
    const src = body.rows[i] as Record<string, unknown>;
    const row: Record<string, unknown> = { user_id: OWNER };
    for (const [col, kind] of Object.entries(spec.cols)) {
      if (!(col in src)) continue;
      const c = coerce(kind, src[col]);
      if (!c.ok) { errors.push(`baris ${i}: kolom ${col} bukan ${kind === "num" ? "angka" : kind === "bool" ? "boolean" : "JSON"} (${JSON.stringify(src[col])})`); continue; }
      row[col] = c.value;
    }
    if (table === "earn_rate_kartu" && !row.kunci_baris) {
      if (!row.kunci && row.kartu && row.kategori && row.program) row.kunci = `${row.kartu}|${row.kategori}|${row.program}`;
      if (row.kunci) {
        row.kunci_baris = row.varian
          ? `${row.kunci}|${row.varian}`
          : `${row.kunci}|h:${(await sha256([row.rupiah_per_mile, row.cashback_pct, row.catatan, row.sumber_url, row.min_transaksi, row.batas_bulanan].map((x) => x ?? "").join("|"))).slice(0, 12)}`;
        derived++;
      }
    }
    if (table === "jalur_transaksi_kartu" && !row.kunci && row.topik && row.kartu_atau_bank && row.kanal) {
      row.kunci = [row.topik, row.kartu_atau_bank, row.kanal, row.jenis_transaksi ?? ""].join("|");
      derived++;
    }
    const k = row[spec.key];
    if (k == null || k === "") { errors.push(`baris ${i}: kunci ${spec.key} kosong`); continue; }
    if (syncId) row.sync_id = syncId;
    row.updated_at = new Date().toISOString();
    byKey.set(String(k), row); // kunci sama di satu batch: baris terakhir menang
  }
  if (errors.length) return json(400, { ok: false, error: "Ada baris yang tidak valid; tidak ada baris yang ditulis.", detail: errors.slice(0, 50) });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const rows = [...byKey.values()];
  const keys = [...byKey.keys()];

  // 3) hitung baru vs diperbarui
  //    Semua kunci milik pemilik dibaca lalu dicocokkan di memori. Filter .in()
  //    salah membaca kunci yang berisi koma/kurung (kunci jalur_transaksi_kartu),
  //    sehingga 15 Sep 2026 baris yang sebenarnya diperbarui terhitung "baru".
  const existing = new Set<string>();
  const wanted = new Set(keys);
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(spec.key).eq("user_id", OWNER).range(from, from + 999);
    if (error) return json(500, { ok: false, error: `Gagal membaca ${table}: ${error.message}` });
    (data ?? []).forEach((d: Record<string, unknown>) => { const k = String(d[spec.key]); if (wanted.has(k)) existing.add(k); });
    if (!data || data.length < 1000) break;
  }

  // 4) upsert — dikelompokkan per susunan kolom. supabase-js memakai gabungan
  //    kolom semua objek dalam satu upsert, jadi baris yang tidak menyebut suatu
  //    kolom akan menimpanya dengan NULL. Kejadian 15 Sep 2026: baris Jenius
  //    (utilitas/cicilan/qris/pajak/min_konversi) + baris Bonvoy (tanpa kolom
  //    itu) dalam satu kiriman → lima kolom Bonvoy jadi NULL. Satu kelompok =
  //    kolom identik, jadi kolom yang tidak dikirim tetap utuh.
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const sig = Object.keys(r).sort().join(",");
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig)!.push(r);
  }
  let written = 0;
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i += 500) {
      const { error } = await sb.from(table).upsert(g.slice(i, i + 500), { onConflict: `user_id,${spec.key}` });
      if (error) return json(500, { ok: false, error: `Gagal menulis ${table}: ${error.message}`, sudah_ditulis_sebelum_gagal: written });
      written += Math.min(500, g.length - i);
    }
  }

  // 5) pangkas baris katalog yang tak ikut sinkronisasi ini
  let pruned = 0;
  if (prune && syncId) {
    const { data, error } = await sb.from(table).delete().eq("user_id", OWNER).not("sync_id", "is", null).neq("sync_id", syncId).select("id");
    if (error) return json(500, { ok: false, error: `Gagal memangkas ${table}: ${error.message}` });
    pruned = data?.length ?? 0;
  }

  return json(200, {
    ok: true, table,
    diterima: body.rows.length,
    unik: rows.length,
    baru: rows.length - existing.size,
    diperbarui: existing.size,
    kunci_diturunkan: derived,
    dipangkas: pruned,
    sync_id: syncId,
  });
});
