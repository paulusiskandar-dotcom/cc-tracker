import { useEffect, useState } from "react";
import { supabase } from "./supabase";
// One formula for what is left on an employee loan, used by net worth, Receivables
// (desktop and phone) and Bills:
//   left = total_amount − paid_before_books − Σ collect_loan rows in the ledger
// The ledger is the record for everything since the books began; paid_before_books is the
// explicit figure for instalments that predate it (they have no ledger row to count).
const nilai = e => Number(e.amount_idr || e.amount || 0);

export function loanStatus(loan, ledger = []) {
  const pays = ledger.filter(e => e.employee_loan_id === loan.id && e.tx_type === "collect_loan");
  const paidLedger = pays.reduce((s, e) => s + nilai(e), 0);
  const paidBefore = Number(loan.paid_before_books || 0);
  const paid = paidLedger + paidBefore;
  return { pays, paidLedger, paidBefore, paid, left: Math.max(0, Number(loan.total_amount || 0) - paid) };
}

// For places that have no ledger in hand (the transaction editors' borrower pickers):
// one light query for the collect_loan rows, then the same formula as loanStatus().

export function useLoanPaid() {
  const [paid, setPaid] = useState(null);
  useEffect(() => {
    let on = true;
    supabase.from("ledger").select("employee_loan_id, amount, amount_idr").eq("tx_type", "collect_loan").not("employee_loan_id", "is", null)
      .then(({ data }) => {
        if (!on) return;
        const m = {};
        for (const e of (data || [])) m[e.employee_loan_id] = (m[e.employee_loan_id] || 0) + nilai(e);
        setPaid(m);
      });
    return () => { on = false; };
  }, []);
  return paid;
}
export const loanLeft = (loan, paidMap) =>
  Math.max(0, Number(loan.total_amount || 0) - Number(loan.paid_before_books || 0) - Number((paidMap || {})[loan.id] || 0));
