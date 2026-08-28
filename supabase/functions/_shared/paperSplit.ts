// ── Pemecah fee Paper.id (dipakai gmail-sync DAN gmail-estatement) ──────────
//
// Pembayaran vendor lewat Paper.id ditagihkan ke kartu sebagai SATU baris, padahal
// isinya dua hal berbeda:
//   - Total harga      = uang yang sampai ke vendor → diganti Hamasa/SDC → PIUTANG
//   - Biaya admin + platform = fee Paper → ditanggung Paulus → BUKAN piutang
// Email Blibli "Transaksi Berhasil: E-invoicing" memuat rinciannya dalam teks polos,
// jadi pemecahan tidak perlu ditebak.
//
// ⚠️ JANGAN hitung mundur dari tarif: 1,5122% (2023) → 1,5689% (2025) → 1,55% (2026).
// Tanpa email pemecah, baris dibiarkan utuh dan ditandai.

export type PaperSplit = { kirim: number; fee: number; total: number; ke: string; ref: string };

const RINGKAS = (s: string, n = 40) => {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

function decodeBodyPlain(part: any): string {
  const walk = (p: any): string => {
    if (!p) return "";
    if (p.body?.data) { try { return atob(p.body.data.replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; } }
    if (p.parts) return p.parts.map(walk).join("\n");
    return "";
  };
  return walk(part).replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ");
}

export function parsePaperSplit(subject: string, rawBody: string): PaperSplit | null {
  // Blibli mengirim DUA email per pesanan: "Menunggu Pembayaran" lalu "Transaksi
  // Berhasil". Hanya percayai yang berhasil — pesanan batal tak boleh jadi dasar.
  if (/Menunggu Pembayaran/i.test(subject || "")) return null;
  // Badan email bertabel: label & nominal terpisah pipa + baris baru
  // ("Total harga | | Rp47.205.000"). Tanpa diratakan, regex tak pernah kena.
  const body = (rawBody || "").replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ");
  // HANYA e-invoicing Paper. Blibli juga mengirim "Angsuran Kredit" (cicilan BYD
  // ~11,1jt) berformat nyaris sama — kalau ikut terpecah, cicilan mobil jadi
  // piutang Hamasa. Penjaga ini wajib.
  if (!/Penyedia\s*Paper/i.test(body)) return null;
  const angka = (s: string) => Number(String(s).replace(/[^\d]/g, "")) || 0;
  const ambil = (label: string) => {
    const m = body.match(new RegExp(label + String.raw`\s*Rp\s*([\d.,]+)`, "i"));
    return m ? angka(m[1]) : 0;
  };
  const kirim = ambil("Total harga");
  const total = ambil("Total pembayaran");
  if (!kirim || !total || total <= kirim) return null;
  // fee = SELISIH, bukan penjumlahan komponen: "Total pembayaran" yang tercetak =
  // nominal tagihan kartu sesungguhnya, kadang 1 rupiah di bawah penjumlahan
  // (18.279.999 · 43.556.047 — dua-duanya cocok dengan statement).
  const fee = total - kirim;
  const ref = (body.match(/Nomor pembayaran\s*([A-Z0-9]+)/i) || [])[1] || "";
  const ke  = RINGKAS(((body.match(/Nama\s+([A-Za-z*][^|]*?)\s+Detail pembayaran/i) || [])[1] || "").trim());
  return { kirim, fee, total, ke, ref };
}

export async function buildPaperSplits(accessToken: string, afterDate: string, beforeDate?: string) {
  const peta = new Map<number, PaperSplit>();
  try {
    // ⚠️ Email Blibli datang saat pembayaran DIBUAT; tagihan kartunya bisa muncul
    // BERHARI-HARI kemudian (terbukti: bayar 1 Agu, tagihan CIMB 10 Agu). Jendela
    // disamakan dengan jendela sync → pecahan tak pernah ketemu. Mundurkan 60 hari;
    // kunci peta = nominal, jadi entri berlebih tidak berbahaya.
    const mundur = (d: string, n: number) => {
      const x = new Date(String(d).replace(/\//g, "-") + "T00:00:00Z");
      if (isNaN(+x)) return d;
      x.setUTCDate(x.getUTCDate() - n);
      return x.toISOString().slice(0, 10).replace(/-/g, "/");
    };
    let q = `from:blibli.com subject:(E-invoicing) after:${mundur(afterDate, 60)}`;
    if (beforeDate) q += ` before:${beforeDate}`;
    const res = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=60`,
      { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return peta;
    for (const m of ((await res.json()).messages || [])) {
      const r = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!r.ok) continue;
      const d = await r.json();
      const subj = (d.payload?.headers || []).find((h: any) => h.name === "Subject")?.value || "";
      const hasil = parsePaperSplit(subj, decodeBodyPlain(d.payload));
      if (hasil && !peta.has(hasil.total)) peta.set(hasil.total, hasil);
    }
  } catch (e) {
    console.warn("[paperSplit] buildPaperSplits gagal:", e);
  }
  console.log(`[paperSplit] pecahan Paper terkumpul: ${peta.size}`);
  return peta;
}

// Dicocokkan lewat Total pembayaran = nominal tagihan kartu. Toleransi sempit
// (Rp2) — beda sedikit berarti transaksi lain, dan salah pecah = piutang salah.
export function cariPecahan(peta: Map<number, PaperSplit>, amount: number): PaperSplit | null {
  if (!amount) return null;
  for (const [a, p] of peta) if (Math.abs(a - amount) <= 2) return p;
  return null;
}
