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
const FEE_RE = /BEA\s*METERAI|STAMP\s*DUTY|BIAYA\s+(?:LAYANAN\s+)?NOTIFIKASI|NOTIFICATION\s+CHA?RGE|E-?BILLING|BIAYA\s+(?:E-?|EMAIL\s+)STATEMENT|E-?STATEMENT\s+(?:FEE|CHA?RGE)|ADMINISTRATION\s+FEE|BIAYA\s+ADMIN(?:ISTRASI)?\b|BIAYA\s+PEMBAYARAN\s+BANK\s+LAIN/i;
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
