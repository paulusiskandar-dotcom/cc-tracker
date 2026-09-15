// ingest-miles-promo — penerima data publik promo bank & miles dari n8n (NAS).
//
// POST { table, rows: [...], sync_id?, prune? }  header x-ingest-key
// Kontrak lengkap: docs/INGEST_MILES_PROMO.md
//
// - Kunci rahasia di secret RYUSEI_INGEST_KEY, pemilik baris di
//   TELEGRAM_AUTHORIZED_USER_ID (Ryūsei satu pengguna).
// - Kolom yang tidak dikenal → seluruh permintaan ditolak, tidak ada yang ditulis.
// - Nilai kosong ("") disimpan NULL; angka dan boolean dikonversi, teks apa adanya.
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
        "pengecualian_pendidikan", "pengecualian_virtual_account", "batas_perolehan_bulanan", "asal"]),
      ...t(["keyakinan", "kelipatan_transaksi_rp", "biaya_konversi_rp", "iuran_tahunan_utama_rp"], "num"),
      pengecualian_kutipan: "json",
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
        "bank_penerbit_kartu", "jenis_reward", "program"]),
      ...t(["miles_poin", "butuh_status_prioritas", "detail_kosong"], "bool"),
      kartu_berlaku: "json",
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

function coerce(kind: Kind, v: unknown): { ok: true; value: unknown } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, value: null };
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
  const existing = new Set<string>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await sb.from(table).select(spec.key).eq("user_id", OWNER).in(spec.key, keys.slice(i, i + 200));
    if (error) return json(500, { ok: false, error: `Gagal membaca ${table}: ${error.message}` });
    (data ?? []).forEach((d: Record<string, unknown>) => existing.add(String(d[spec.key])));
  }

  // 4) upsert
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict: `user_id,${spec.key}` });
    if (error) return json(500, { ok: false, error: `Gagal menulis ${table}: ${error.message}`, sudah_ditulis_sebelum_gagal: i });
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
