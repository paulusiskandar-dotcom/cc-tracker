// One loan, opened in place from wherever loans are listed (Bills › Reimburse, Receivables › Loans):
// what is left, repayments so far, and "Record repayment" through the app's own form.
import { useState } from "react";
import { X } from "lucide-react";
import { fmtIDR } from "../../utils";
import { loanStatus } from "../../lib/loans";
import TxVerticalBig from "../shared/TxVerticalBig";
import Amt from "./Amt";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = s => { if (!s) return ""; const d = new Date(`${String(s).slice(0, 10)}T00:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

// `loanId` opens that loan's sheet; `newLoan` opens the form for a new loan instead.
export default function LoanSheet({ loanId, newLoan = false, onClose, ...props }) {
  const { ledger = [], employeeLoans = [] } = props;
  const [form, setForm] = useState(newLoan ? { type: "give_loan" } : null);
  const raw = employeeLoans.find(l => l.id === loanId);
  const st = raw ? loanStatus(raw, ledger) : null;
  const loan = raw && !form ? { ...raw, name: raw.employee_name || "Loan", pays: [...st.pays].sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date))), paid: st.paid, paidBefore: st.paidBefore, left: st.left } : null;
  const setOpenLoan = () => onClose();
  return (
    <>
      {loan && (
        <div className="mw-modal" role="dialog" aria-modal="true" onClick={() => setOpenLoan(null)}>
          <div className="mw-modal-card" onClick={ev => ev.stopPropagation()}>
            <div className="mw-hdr"><h2>{loan.name}</h2><button className="mw-round mw-round-sunk" onClick={() => setOpenLoan(null)} aria-label="Close"><X size={20} strokeWidth={1.8} /></button></div>
            <div className="mw-tile-l">Left to repay</div>
            <div className="mw-tile-n">{fmtIDR(loan.left)}</div>
            <div className="mw-bar"><i style={{ width: `${Number(loan.total_amount) > 0 ? Math.min(100, (loan.paid / Number(loan.total_amount)) * 100) : 0}%` }} /></div>
            <div className="mw-tile-s">Repaid {fmtIDR(loan.paid)} of {fmtIDR(loan.total_amount)}</div>
            {loan.pays.length > 0 && (
              <>
                <div className="mw-label">Repayments</div>
                <div className="mw-list mw-list-sunk">
                  {loan.pays.slice(0, 12).map(e => <div key={e.id} className="mw-row mw-tx"><span className="mw-row-name">{fmtDate(e.tx_date)}</span><Amt e={e} /></div>)}
                  {loan.pays.length > 12 && <div className="mw-more">and {loan.pays.length - 12} earlier</div>}
                  {loan.paidBefore > 0 && <div className="mw-row mw-tx"><span className="mw-row-name">Before the books began</span><span className="mw-row-amt">{fmtIDR(loan.paidBefore)}</span></div>}
                </div>
              </>
            )}
            <button className="mw-btn" onClick={() => { setForm({ type: "collect_loan", loan: raw }); }}>Record repayment</button>
          </div>
        </div>
      )}

      <TxVerticalBig open={!!form} mode="add" defaultGroup="loan" defaultTxType={form?.type || "collect_loan"}
        defaultAccount={form?.loan ? { from_id: form.loan.id } : undefined}
        onSave={() => { setForm(null); props.onRefresh && props.onRefresh(); onClose(); }} onClose={() => { setForm(null); onClose(); }}
        user={props.user} accounts={props.accounts} setLedger={props.setLedger} categories={props.categories || []} fxRates={props.fxRates} allCurrencies={props.CURRENCIES || []}
        bankAccounts={props.bankAccounts} creditCards={props.creditCards} assets={props.assets} liabilities={props.liabilities} receivables={props.receivables}
        incomeSrcs={props.incomeSrcs} employeeLoans={employeeLoans} setEmployeeLoans={props.setEmployeeLoans} onRefresh={props.onRefresh} />
    </>
  );
}
