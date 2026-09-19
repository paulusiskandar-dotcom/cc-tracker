// One definition of "spent" and "received" for the reports (Paulus, 19 Sep 2026):
// a refund is money coming back for something bought, so it REDUCES spending — it is not income.
// Until now every credit to a card (real refunds, instalment-conversion credits, reversals) was
// booked as income from the source "Refund": Rp 172,8 jt in Jan–Aug 2026 showed up as income while
// the purchases it cancelled stayed in expenses. No row is rewritten; the rows are read this way.
//
// What a credit does depends on the purchase it answers (same account, same amount ±2, up to
// 90 days earlier):
//   purchase booked as an expense        → the credit reduces spending (category of the purchase)
//   purchase booked as something else    → neutral (Blibli 50 jt was a loan to Lieche, not spending)
//   no purchase found, conversion credit → neutral (the purchase was never booked; legs are the spending)
//   no purchase found, ordinary refund   → reduces spending under "Refunds"
const nilai = e => Number(e.amount_idr || e.amount || 0);
const CONVERSION_TEXT = /reversal\s+cicilan|kredit konversi|konversi cicilan|(?<!\d)0+\s*\/\s*\d{1,2}(?!\d)|^\s*XM\s/i;
const DAY = 86400000;
const t = d => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).getTime();

// Which rows are refunds is the rule desktop Reports has used since 27 Aug 2026: income from the
// source named "Refund", or a sourceless credit landing on a credit card. NOT "anything credited
// to a card" — cashback lands there too and is real income.
export function makeSpending(incomeSrcs = [], ledger = [], accounts = []) {
  const refundSrc = new Set(incomeSrcs.filter(s => String(s.name || "").trim().toLowerCase() === "refund").map(s => s.id));
  const ccIds = new Set(accounts.filter(a => a.type === "credit_card").map(a => a.id));
  const isCredit = e => e.tx_type === "income" && (refundSrc.has(e.from_id) || (!e.from_id && ccIds.has(e.to_id)));
  const isExpense = e => (e.tx_type === "expense" || e.tx_type === "pay_liability") && !e.is_reimburse;

  // Link each credit to its purchase once.
  const byAccount = {};
  ledger.forEach(e => { if (e.from_id && e.from_type === "account") (byAccount[e.from_id] = byAccount[e.from_id] || []).push(e); });
  const effect = new Map(); // credit id → { sign: -1 | 0, category }
  const taken = new Set();
  ledger.filter(isCredit).forEach(c => {
    const a = nilai(c), when = t(c.tx_date);
    const p = (byAccount[c.to_id] || []).filter(x => !taken.has(x.id) && Math.abs(nilai(x) - a) <= 2 && t(x.tx_date) <= when + 3 * DAY && when - t(x.tx_date) <= 90 * DAY)
      .sort((x, y) => t(y.tx_date) - t(x.tx_date))[0];
    if (p) { taken.add(p.id); effect.set(c.id, isExpense(p) ? { sign: -1, category: p.category_name || null } : { sign: 0 }); }
    else effect.set(c.id, CONVERSION_TEXT.test(c.description || "") ? { sign: 0 } : { sign: -1, category: c.category_name || null });
  });

  const isRefund = e => isCredit(e);
  const isIncome = e => e.tx_type === "income" && !isCredit(e);
  // Signed contribution to spending: +amount for an expense, −amount for a refund of an expense, else 0.
  const spendOf = e => (isExpense(e) ? nilai(e) : isCredit(e) ? (effect.get(e.id)?.sign || 0) * nilai(e) : 0);
  // Category a refund belongs to (its purchase's), for the per-category views.
  const refundCategory = e => effect.get(e.id)?.category || null;
  return { isRefund, isExpense, isIncome, spendOf, refundCategory };
}
