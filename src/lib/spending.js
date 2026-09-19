// One definition of "spent" and "received" for the reports (Paulus, 19 Sep 2026):
// a refund is money coming back for something bought, so it REDUCES spending — it is not income.
// Until now every credit to a card (real refunds, instalment-conversion credits, reversals) was
// booked as income from the source "Refund": Rp 172,8 jt in Jan–Aug 2026 showed up as income while
// the purchases it cancelled stayed in expenses. No row is rewritten; the rows are read this way.
const nilai = e => Number(e.amount_idr || e.amount || 0);
const REFUND_TEXT = /refund|reversal|kredit konversi|konversi cicilan|\(CR\)/i;

export function makeSpending(incomeSrcs = []) {
  const refundSrc = new Set(incomeSrcs.filter(s => /refund/i.test(s.name || "")).map(s => s.id));
  const isRefund = e => e.tx_type === "income" && (refundSrc.has(e.from_id) || REFUND_TEXT.test(e.description || ""));
  const isExpense = e => (e.tx_type === "expense" || e.tx_type === "pay_liability") && !e.is_reimburse;
  const isIncome = e => e.tx_type === "income" && !isRefund(e);
  // Signed contribution of a row to spending: +amount for an expense, −amount for a refund, else 0.
  const spendOf = e => (isExpense(e) ? nilai(e) : isRefund(e) ? -nilai(e) : 0);
  return { isRefund, isExpense, isIncome, spendOf };
}
