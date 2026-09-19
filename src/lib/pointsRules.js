// Earn rules per card, applied to the STATEMENT'S own lines for a cycle (points_history.stmt_rows).
// Numbers come from the n8n catalogue (kartu_miles / earn_rate_kartu) and were checked against four
// BCA KrisFlyer statements on 20 Sep 2026: Jul 2.221,73 → 2.222 printed, Sep 1.805,46 → 1.806 printed.
// Whether one purchase earns is decided by the bank from its MCC, which a statement does not print —
// so this module never claims a purchase "should" have earned. It states what the rule gives, the
// difference, and which lines add up to that difference.
export const POINT_RULES = {
  "BCA Krisflyer": { per: 13500, perFx: 13500, instalments: false, bonus: { min: 20000000, points: 1000 }, unit: "KrisFlyer Miles",
    lessons: [
      "Rp 13.500 per mile holds for everything retail, including insurance, Paper.id and foreign currency. Proven on the Jul and Sep 2026 statements.",
      "Spend Rp 20 million in a cycle and 1.000 bonus miles are added. At exactly that level the card costs about Rp 8.060 per mile.",
      "Monthly instalment charges earn nothing. The original purchase does.",
      "Tax and government bills paid through Tokopedia earn nothing (Jun 2026, 269 miles short).",
      "Paying through DANA is a coin toss, and a DANA top-up earns nothing (Aug 2026, 119 miles short). Swipe the card at the merchant when you can.",
    ] },
  "OCBC 90N":      { per: 12000, perFx: 10000, instalments: false, bonus: null, unit: "Travel Miles",
    lessons: [
      "Rp 12.000 per Travel Mile, and Paper.id earns in full. Jul, Aug and Sep 2026 match the rule to within one mile.",
      "Miles expire one year after they are earned. The statement prints what lapses next month.",
      "What the card can earn in a cycle is capped at its credit limit.",
    ] },
  "HSBC":          { per: 1500,  perFx: 1500,  instalments: false, bonus: null, unit: "Poin Rewards",
    lessons: [
      "22.797 points expired on 1 Jul 2026, unused. Points on this card last about two years.",
      "This card's points cannot be moved to airline miles.",
    ] },
};

const FEE_RE = /METERAI|STAMP DUTY|ANNUAL|IURAN|BIAYA|\bFEE\b|CHARGE|BUNGA|INTEREST|DENDA|LATE/i;
const INST_RE = /CICILAN|INSTAL?LMENT|\b\d{1,2}\s*\/\s*\d{1,2}\b|KE \d+ DARI \d+/i;
const FX_RE = /\((USD|SGD|JPY|EUR|GBP|AUD|HKD|CNY|MYR|THB|KRW|CHF)\s/i;

export function classify(row) {
  const d = String(row.description || "");
  if (row.direction !== "out") return "credit";
  if (FEE_RE.test(d)) return "fee";
  if (INST_RE.test(d)) return "instalment";
  return FX_RE.test(d) ? "fx" : "retail";
}

export function applyRule(ruleName, rows = []) {
  const rule = POINT_RULES[ruleName];
  if (!rule) return null;
  const lines = rows.map(r => ({ ...r, amount: Math.abs(Number(r.amount || 0)), kind: classify(r) }));
  const earning = lines.filter(l => l.kind === "retail" || l.kind === "fx" || (l.kind === "instalment" && rule.instalments));
  const spend = earning.reduce((s, l) => s + l.amount, 0);
  const exact = earning.reduce((s, l) => s + l.amount / (l.kind === "fx" ? rule.perFx : rule.per), 0);
  const bonus = rule.bonus && spend >= rule.bonus.min ? rule.bonus.points : 0;
  return { rule, spend, points: Math.ceil(exact - 1e-9), exact, bonus, earning, skipped: lines.filter(l => !earning.includes(l) && l.kind !== "credit") };
}

// How much spend the shortfall stands for. Which lines did not earn is NOT derived: on real data
// (Aug 2026) several different sets of lines add up to the same shortfall, so naming one would be a guess.
export function shortfall(result, printed) {
  if (!result || printed == null) return null;
  const diff = Number(printed) - result.points;
  return { diff, rupiah: diff < -1 ? Math.round(-diff * result.rule.per) : 0, ok: Math.abs(diff) <= 1 };
}

// Merchant key: the description without per-purchase noise (date codes after "*", the FX bracket, the city).
export function merchantKey(desc) {
  return String(desc || "").toUpperCase().replace(/\(.*$/, "").replace(/\*\d{6}\w*/, "*")
    .replace(/\s+(JAKARTA|SINGAPORE|AMSTERDAM|TANGERANG|BEKASI|SURABAYA|BANDUNG)\b.*$/, "").replace(/\s+/g, " ").trim();
}

// Which lines earned nothing — answered ONLY as far as the evidence goes: merchants that earned in a
// month the rule reproduced exactly are cleared; among the rest, every set of lines that explains the
// shortfall is found (the bank's rounding is not known for sure, so rounding up and to-nearest both count).
// sure = lines present in EVERY explanation; maybe = lines present in only some. Too many explanations → nothing.
export function likelyNotEarning(months, target) {
  const none = { sure: [], maybe: [] };
  if (!target?.check || !target.sf || target.sf.ok || target.sf.diff >= 0) return none;
  const proven = new Set();
  for (const m of months) if (m.check && m.sf?.ok) for (const l of m.check.earning) proven.add(merchantKey(l.description));
  const per = l => (l.kind === "fx" ? target.check.rule.perFx : target.check.rule.per);
  const C = target.check.earning.filter(l => !proven.has(merchantKey(l.description)));
  if (!C.length || C.length > 16) return none;
  const printed = Number(target.shown);
  const hits = [];
  for (let m = 1; m < (1 << C.length); m++) {
    let p = 0;
    for (let i = 0; i < C.length; i++) if (m & (1 << i)) p += C[i].amount / per(C[i]);
    const left = target.check.exact - p;
    if (Math.ceil(left - 1e-9) === printed || Math.round(left) === printed) hits.push(m);
    if (hits.length > 4) return none;
  }
  if (!hits.length) return none;
  const all = hits.reduce((a, b) => a & b), any = hits.reduce((a, b) => a | b);
  return { sure: C.filter((_, i) => all & (1 << i)), maybe: C.filter((_, i) => (any & ~all) & (1 << i)) };
}
