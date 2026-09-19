// Earn rules per card, applied to the STATEMENT'S own lines for a cycle (points_history.stmt_rows).
// Numbers come from the n8n catalogue (kartu_miles / earn_rate_kartu) and were checked against four
// BCA KrisFlyer statements on 20 Sep 2026: Jul 2.221,73 → 2.222 printed, Sep 1.805,46 → 1.806 printed.
// Whether one purchase earns is decided by the bank from its MCC, which a statement does not print —
// so this module never claims a purchase "should" have earned. It states what the rule gives, the
// difference, and which lines add up to that difference.
export const POINT_RULES = {
  "BCA Krisflyer": { per: 13500, perFx: 13500, instalments: false, bonus: { min: 20000000, points: 1000 }, unit: "KrisFlyer Miles" },
  "OCBC 90N":      { per: 12000, perFx: 10000, instalments: false, bonus: null, unit: "Travel Miles" },
  "HSBC":          { per: 1500,  perFx: 1500,  instalments: false, bonus: null, unit: "Poin Rewards" },
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
