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
