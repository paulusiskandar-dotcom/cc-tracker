// Rules for classifying ONE line of a credit-card statement. Pure functions, no I/O, so every
// bank's real wording can be tested (stmtRules.test.ts) before anything is deployed.
// Why this file exists (19 Sep 2026): the rules lived inline in gmail-estatement and had only
// ever been exercised on BRI's wording. Mandiri ("012/024"), Maybank (":001/003"), BCA
// ("CICILAN BCA KE 02 DARI 03") and each bank's own fee names fell through to the approval
// queue month after month. A rule is not done until the test has a line from every bank.

export type Instalment = { n: number; tot: number };

const TENORS = new Set([3, 6, 9, 12, 15, 18, 24, 36, 48, 60]);

/** "3/6", "10/ 12", "012/024", ":001/003", "CICILAN BCA KE 02 DARI 03" → { n, tot }. n may be 0
 *  (a conversion credit). Returns null when the text is not an instalment marker. */
export function parseInstalment(desc: string): Instalment | null {
  const s = String(desc || "");
  const w = s.match(/CICILAN\s+(?:BCA\s+)?KE\s+0*(\d{1,2})\s+DARI\s+0*(\d{1,2})/i);
  const m = w || s.match(/(?<![\d.,])0*(\d{1,2})\s*\/\s*0*(\d{1,2})(?![\d.,])/);
  if (!m) return null;
  const n = Number(m[1]), tot = Number(m[2]);
  if (!TENORS.has(tot) || n > tot) return null;     // "12/09" is a date, "5/7" is not a tenor
  return { n, tot };
}

/** Fixed monthly card charges (stamp duty, SMS/e-statement/notification, admin, other-bank
 *  payment fee). Amount-capped so a real purchase can never be swept in. */
const FEE_RE = /BEA\s*METERAI|STAMP\s*DUTY|BIAYA\s+(?:LAYANAN\s+)?NOTIFIKASI|NOTIFICATION\s+CHA?RGE|E-?BILLING|BIAYA\s+(?:E-?|EMAIL\s+)STATEMENT|E-?STATEMENT\s+(?:FEE|CHA?RGE)|ADMINISTRATION\s+FEE|BIAYA\s+ADMIN(?:ISTRASI)?\b|BIAYA\s+PEMBAYARAN\s+BANK\s+LAIN|PAYMENT\s+OTHER\s+BANK\s+FEE/i;
export const FEE_CAP = 25000;
export function isMonthlyFee(desc: string, amount: number): boolean {
  const a = Math.round(Math.abs(Number(amount || 0)));
  return a > 0 && a <= FEE_CAP && FEE_RE.test(String(desc || ""));
}

/** The credit half of an instalment conversion: BRI ": 0/6", BCA "REVERSAL CICILAN BCA …",
 *  Maybank "XM <merchant>", CIMB conversion credit. */
export function isConversionCredit(desc: string): boolean {
  const s = String(desc || "");
  const inst = parseInstalment(s);
  return (inst !== null && inst.n === 0) || /REVERSAL\s+CICILAN|KREDIT\s+KONVERSI|KONVERSI\s+CICILAN|^\s*XM\s+\S/i.test(s);
}

const STOP = new Set(["RETAIL", "IDN", "ID", "JAKARTA", "JAKAR", "PUSAT", "PUSATID", "SELATAN", "BARAT", "UTARA", "TIMUR", "NON", "3DS", "REVERSAL", "CICILAN", "BCA", "XM", "KREDIT", "KONVERSI", "THE", "COM", "WWW"]);
const tokens = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").split(" ").filter((t) => t.length >= 4 && !STOP.has(t) && !/^\d+$/.test(t));

export type Row = { _id: string; date: string; description: string; amount: number; direction?: string };

/** Pairs a conversion credit with the purchase it cancels: same amount (±2), within `days`,
 *  and — unless the credit is BRI's explicit 0/N — sharing a merchant word. Neither row of a
 *  pair is spending; the monthly instalments are. */
export function findWashPairs(rows: Row[], days = 45): { retail: Row; credit: Row }[] {
  const used = new Set<string>(); const out: { retail: Row; credit: Row }[] = [];
  const t = (d: string) => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).getTime();
  for (const c of rows) {
    if ((c.direction || "out") !== "in" || !isConversionCredit(c.description) || used.has(c._id)) continue;
    const cAmt = Math.abs(Number(c.amount || 0)); const cTok = tokens(c.description);
    const explicit = parseInstalment(c.description)?.n === 0;
    const r = rows.find((m) => m !== c && !used.has(m._id) && (m.direction || "out") !== "in"
      && Math.abs(Math.abs(Number(m.amount || 0)) - cAmt) <= 2
      && Math.abs(t(m.date) - t(c.date)) <= days * 86400000
      && parseInstalment(m.description) === null
      && (explicit ? (/retail/i.test(m.description) || tokens(m.description).some((x) => cTok.includes(x))) : tokens(m.description).some((x) => cTok.includes(x))));
    if (r) { used.add(r._id); used.add(c._id); out.push({ retail: r, credit: c }); }
  }
  return out;
}

/** Finalize tolerance (Paulus, 19 Sep 2026): a closing gap of up to Rp 5 is rounding
 *  (CIMB bills in ,33 fractions; Mandiri Bonvoy was Rp 1 off) and counts as matched. */
export const GAP_TOLERANCE = 5;
export const gapIsRounding = (gap: number) => Math.abs(Math.round(Number(gap || 0))) <= GAP_TOLERANCE;

// ── Auto-booking a statement line whose merchant is already well known ──────────────────────
// Paulus, 19 Sep 2026: "langsung" — Skorcard has no e-mail alerts, so ±30 GoPay/Grab lines a
// month reached the approval queue from the statement. A line is booked without asking only when
// the ledger's own history makes the answer unambiguous:
//   · the merchant is not a marketplace, payment channel or bank (those carry reimburse and
//     instalment purchases — Tokopedia is "Health" in the mapping table yet mostly Hamasa's),
//   · it has at least 5 earlier rows, ≥ 95 % of them plain expenses (never reimburse),
//   · one category covers ≥ 80 % of them,
//   · and the amount is at most AUTOBOOK_CAP.
export type MerchantStat = { name: string; n: number; expense: number; topCategoryId: string | null; topCategoryName: string | null; topShare: number };
export const AUTOBOOK_CAP = 1_000_000;
const CHANNELS = /tokopedia|tkpd|lazada|shopee|blibli|paper|bukalapak|tiktok|xendit|midtrans|doku|\bbca\b|mandiri|maybank|cimb|ocbc|\buob\b|\bbri\b|\bbni\b|jenius|danamon|\bbank\b|transfer|payment|pembayaran/i;
export const normMerchant = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The longest known merchant name (≥ 4 letters) contained in the statement text. */
export function findMerchant(desc: string, names: string[]): string | null {
  const d = normMerchant(desc); let best: string | null = null;
  for (const n of names) { const k = normMerchant(n); if (k.length >= 4 && d.includes(k) && (!best || k.length > normMerchant(best).length)) best = n; }
  return best;
}

export function merchantStat(name: string, history: { text: string; tx_type: string; is_reimburse?: boolean; category_id?: string | null; category_name?: string | null }[]): MerchantStat {
  const k = normMerchant(name); const rows = history.filter((h) => normMerchant(h.text).includes(k));
  const cats = new Map<string, { n: number; name: string | null }>(); let expense = 0;
  for (const r of rows) {
    if (r.tx_type === "expense" && !r.is_reimburse) { expense++; const id = r.category_id || ""; const c = cats.get(id) || { n: 0, name: r.category_name || null }; c.n++; cats.set(id, c); }
  }
  const top = [...cats.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  return { name, n: rows.length, expense, topCategoryId: top && top[0] ? top[0] : null, topCategoryName: top ? top[1].name : null, topShare: expense ? (top ? top[1].n / expense : 0) : 0 };
}

export function canAutoBook(stat: MerchantStat | null, amount: number): boolean {
  const a = Math.round(Math.abs(Number(amount || 0)));
  return !!stat && !CHANNELS.test(stat.name) && stat.n >= 5 && stat.expense / stat.n >= 0.95 && stat.topShare >= 0.8 && !!stat.topCategoryId && a > 0 && a <= AUTOBOOK_CAP;
}

// ── PEMBAYARAN YANG DIPECAH PER NOMOR KARTU ─────────────────────────────────
// BCA mencetak SATU pembayaran sebagai beberapa baris kredit — satu per nomor kartu
// dalam tagihan yang sama (Krisflyer Sep 2026: 988.900 + 19.011.100 = 20.000.000).
// Di buku pembayaran itu satu baris, jadi pencocok satu-lawan-satu gagal dan empat
// baris masuk antrean sebagai "income". Aturan: baris kredit bertanggal & berketerangan
// sama, yang JUMLAHNYA tepat sama dengan satu pembayaran di buku (±1, ±3 hari),
// digabung jadi satu baris. Tanpa pasangan di buku → tidak disentuh (tidak menebak).
export function mergeSplitPayments<T extends { _id: string; date?: string; description?: string; amount?: number | string; direction?: string }>(
  rows: T[],
  payments: { tx_date: string; amount: number }[],
): T[] {
  const dayMs = 86400000;
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    if (r.direction !== "in" || !r.date) continue;
    const k = `${r.date}|${String(r.description || "").trim().toUpperCase()}`;
    (groups.get(k) || groups.set(k, []).get(k)!).push(r);
  }
  const drop = new Set<string>();
  const replace = new Map<string, T>();
  const used = new Set<number>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const amts = g.map((r) => Math.abs(Number(r.amount || 0)));
    const sum = amts.reduce((a, b) => a + b, 0);
    const d0 = new Date(g[0].date + "T00:00:00").getTime();
    const near = (p: { tx_date: string }) => Math.abs((new Date(p.tx_date + "T00:00:00").getTime() - d0) / dayMs) <= 3;
    // Kalau tiap pecahan punya pasangannya sendiri di buku, itu memang pembayaran terpisah.
    if (amts.every((a) => payments.some((p) => near(p) && Math.abs(p.amount - a) <= 1))) continue;
    const i = payments.findIndex((p, idx) => !used.has(idx) && near(p) && Math.abs(p.amount - sum) <= 1);
    if (i < 0) continue;
    used.add(i);
    replace.set(g[0]._id, { ...g[0], amount: sum, _mergedFrom: g.map((r) => r._id), _mergedParts: amts } as T);
    for (const r of g.slice(1)) drop.add(r._id);
  }
  return rows.filter((r) => !drop.has(r._id)).map((r) => replace.get(r._id) || r);
}

// Baris kredit yang berbunyi pembayaran adalah pelunasan kartu, bukan pemasukan.
export const PAYMENT_RE = /\b(PEMBAYARAN|PAYMENT|PYMT|BAYAR)\b/i;
