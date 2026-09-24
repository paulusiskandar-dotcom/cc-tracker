// A liability instalment paid through a marketplace (BYD Seal via Blibli, from BCA IDR) arrives
// as ONE bank debit: instalment + the marketplace's admin fee (9.500 in Jun/Aug 2026, 11.000 in Jul).
// Paulus books it as two rows: pay_liability for the instalment, expense (Bank & Card Fees) for the
// fee. This recognises that debit so the queue row is pre-shaped and approving it books both.
export type LiabSplit = { liability_id: string; liability_name: string; pokok: number; fee: number };

const FEE_MAX = 25000;

export function findLiabSplit(
  tx: { amount?: number | string; amount_idr?: number | string; merchant_name?: string; description?: string; from_account_id?: string | null; date?: string },
  liabilities: { id: string; name: string; monthly_installment?: number | string | null; pay_from_id?: string | null; pay_via?: string | null }[],
): LiabSplit | null {
  const amt = Math.round(Number(tx.amount_idr || tx.amount || 0));
  if (!amt) return null;
  const text = `${tx.merchant_name || ""} ${tx.description || ""}`.toLowerCase();
  for (const l of liabilities) {
    const pokok = Math.round(Number(l.monthly_installment || 0));
    if (!pokok) continue;
    if (l.pay_via && !text.includes(String(l.pay_via).toLowerCase())) continue;
    if (l.pay_from_id && tx.from_account_id && tx.from_account_id !== l.pay_from_id) continue;
    const fee = amt - pokok;
    if (fee < 0 || fee > FEE_MAX) continue;
    return { liability_id: l.id, liability_name: l.name, pokok, fee };
  }
  return null;
}
