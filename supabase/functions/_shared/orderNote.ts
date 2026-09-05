// ── DESKRIPSI BELANJA DARI EMAIL PESANAN ────────────────────────────────────
// Statement kartu cuma menyebut salurannya: "TOKOPEDIA", "Blibli", "LAZADA".
// Apa yang sebenarnya dibeli ada di email pesanan/struk. Modul ini membaca
// email-email itu di jendela waktu yang sama, lalu memetakan NOMINAL → catatan
// singkat, yang nanti ditempelkan ke transaksi dengan nominal sama.
// Sengaja regex, bukan AI: bentuk struknya baku, dan ini jalan tiap sync.
//
// Dipakai DUA jalur, dan itu memang keharusannya:
//   gmail-sync       notifikasi transaksi dari bank
//   gmail-estatement impor statement kartu bulanan
// Sampai 5 Sep 2026 modul ini hanya hidup di gmail-sync, jadi setiap baris yang
// masuk lewat statement berhenti di "TOKOPEDIA JAKARTA ID" — dan itulah kenapa
// 22 baris piutang Tokopedia harus dibongkar manual dari email satu per satu.

function decodeBodyPlain(part: any): string {
  const walk = (p: any): string => {
    if (!p) return "";
    if (p.body?.data) { try { return atob(p.body.data.replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; } }
    if (p.parts) return p.parts.map(walk).join("\n");
    return "";
  };
  // Tanda baris dipertahankan: nama barang dikenali dari posisinya tepat sebelum "Berat:".
  return walk(part).replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ");
}

export const ORDER_DOMAINS = ["tokopedia.com", "receipt.iak.id", "lazada.co.id", "blibli.com", "shopee.co.id"];

const RINGKAS = (s: string, n = 100) => {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

// Nama barang di Tokopedia sering panjang dan penuh kata jualan.
// Dipangkas supaya beberapa barang muat dalam satu catatan.
const PENDEK = (s: string, n = 30) => {
  // Hanya pemisah BERSPASI yang dipotong. Memotong di tiap tanda hubung
  // menghancurkan kode produk: "DS-2CE16D0T-EXLPF - HIKVISION…" jadi "DS".
  const t = (s || "").replace(/\s+/g, " ").trim()
    .replace(/\s+[-–|]\s+.*$/, "")
    .replace(/\s*\(.*$/, "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

export function parseOrderNote(subject: string, body: string): { amount: number; note: string } | null {
  const angka = (t: string) => Number((t || "").replace(/[^\d]/g, "")) || 0;

  // 1. Struk tagihan (PLN / Telkomsel / Biznet) — lewat IAK, dipakai Lazada & Tokopedia
  const totalStruk = body.match(/TOTAL\s+PEMBAYARAN[^\d]{0,40}([\d.,]+)/i);
  if (totalStruk) {
    const nama   = body.match(/NAMA\s+PELANGGAN[^A-Za-z0-9]{0,20}([A-Z][A-Za-z0-9 .'-]{2,40})/i)?.[1];
    const idPel  = body.match(/ID\s+PELANGGAN[^\d]{0,20}(\d{6,20})/i)?.[1];
    const period = body.match(/\b(BL\/TH|PERIODE|BULAN)[^A-Z0-9]{0,10}([A-Z]{3}\s?\d{2,4})/i)?.[2];
    const jenis  = /PLN|LISTRIK/i.test(subject + body) ? "PLN"
                 : /TELKOMSEL|HALO/i.test(subject + body) ? "Telkomsel"
                 : /BIZNET|INDOSAT|INTERNET/i.test(subject + body) ? "Internet" : "Tagihan";
    const bagian = [jenis, nama?.trim(), period].filter(Boolean);
    if (!nama && idPel) bagian.splice(1, 0, idPel);
    return { amount: angka(totalStruk[1]), note: RINGKAS(bagian.join(" · ")) };
  }

  // 2. Bukti Penerimaan Negara (pajak DJP, dibayar lewat marketplace)
  if (/BUKTI PENERIMAAN NEGARA|NTPN/i.test(body)) {
    const npwp = body.match(/NPWP[^\d]{0,20}([\d.\-]{10,25})/i)?.[1];
    const nama = body.match(/NAMA\s*(?:WP)?[^A-Za-z]{0,15}([A-Z][A-Za-z .'-]{3,40})/i)?.[1];
    const tot  = body.match(/(?:JUMLAH SETOR|NOMINAL|TOTAL)[^\d]{0,30}([\d.,]+)/i);
    if (tot) return { amount: angka(tot[1]), note: RINGKAS(["Pajak DJP", nama?.trim() || (npwp ? "NPWP " + npwp.slice(-6) : null)].filter(Boolean).join(" · ")) };
  }

  // 3. Checkout marketplace — "Total Bayar" + nama barang (muncul tepat sebelum "Berat:")
  const totalBayar = body.match(/Total\s+(?:Bayar|Pembayaran|Dibayarkan)[^\d]{0,40}([\d.,]+)/i);
  if (totalBayar) {
    const barang: string[] = [];
    // Antara nama barang dan "Berat:" HANYA boleh spasi/newline. Dengan
    // [\s\S] regex lama melompati baris berisi, sehingga yang tertangkap justru
    // nama toko ("DOSS Camera & Gadget") dan barangnya sendiri terlewat.
    const re = /([^\n\t][^\n]{6,140}?)[ \t]*\n[\s]{0,60}?Berat\s*:/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) && barang.length < 12) {
      const b = m[1].replace(/\s+/g, " ").trim();
      if (b && !/^(toko|no\.|invoice|alamat|rincian|ringkasan)/i.test(b)) barang.push(b);
    }
    if (barang.length) {
      // Sebut tiga barang pertama, bukan satu. Satu nama saja tidak cukup untuk
      // mengenali order berisi campuran barang kantor dan barang pribadi.
      const depan = barang.slice(0, 3).map((b) => PENDEK(b));
      const sisa  = barang.length - depan.length;
      const note  = depan.join(" + ") + (sisa > 0 ? ` +${sisa} barang` : "");
      return { amount: angka(totalBayar[1]), note: RINGKAS(note) };
    }
    // tanpa rincian barang: pakai subjek kalau menyebut nama barang di tanda kutip
    const dariSubjek = subject.match(/[""]([^""]{4,80})/)?.[1];
    if (dariSubjek) return { amount: angka(totalBayar[1]), note: RINGKAS(dariSubjek) };
  }
  return null;
}

// Ambil email pesanan di jendela yang sama, kembalikan peta nominal → catatan.
export async function buildOrderNotes(accessToken: string, afterDate: string, beforeDate?: string | null) {
  const peta = new Map<number, string>();
  try {
    let q = `(${ORDER_DOMAINS.map((d) => `from:${d}`).join(" OR ")}) after:${afterDate}`;
    if (beforeDate) q += ` before:${beforeDate}`;
    const res = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=60`,
      { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return peta;
    const list = (await res.json()).messages || [];
    for (const m of list) {
      const r = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!r.ok) continue;
      const d = await r.json();
      const subj = (d.payload?.headers || []).find((h: any) => h.name === "Subject")?.value || "";
      const body = decodeBodyPlain(d.payload);
      const hasil = parseOrderNote(subj, body);
      if (hasil && hasil.amount > 0 && !peta.has(hasil.amount)) peta.set(hasil.amount, hasil.note);
    }
  } catch (e) {
    console.warn("[orderNote] buildOrderNotes gagal:", (e as any)?.message);
  }
  console.log(`[orderNote] catatan pesanan terkumpul: ${peta.size}`);
  return peta;
}

// Tagihan kartu bisa berbeda ~Rp1.000 dari total struk (biaya saluran pembayaran).
export function cariCatatan(peta: Map<number, string>, amount: number): string | null {
  if (!amount) return null;
  for (const [a, n] of peta) if (Math.abs(a - amount) <= 1500) return n;
  return null;
}
