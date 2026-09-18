// Mobile Receivables (phones only): Reimburse · Loans · History.
//   Reimburse — who owes what; tap to match (the same Match screen Bills uses)
//   Loans     — employee loans, what is left on each; record a repayment or a new loan
//   History   — past matches, read only
// Saving goes through the app's own form (TxVerticalBig) and Receivables' own Match action.
import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { fmtIDR } from "../../utils";
import { hitungPiutang } from "../../lib/piutang";
import Receivables from "../Receivables";
import TxVerticalBig from "../shared/TxVerticalBig";
import Amt from "./Amt";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = s => { if (!s) return ""; const d = new Date(`${String(s).slice(0, 10)}T00:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export default function MobileReceivables(props) {
  const { ledger = [], employeeLoans = [], reimburseSettlements = [], dark } = props;
  const [view, setView] = useState(() => lsGet("m.recv.view") || "reimburse");
  const [openLoan, setOpenLoan] = useState(null);
  const [form, setForm] = useState(null); // { type: "collect_loan" | "give_loan", loan }
  useEffect(() => { lsSet("m.recv.view", view); }, [view]);

  const owed = useMemo(() => hitungPiutang(ledger).saldoTotal, [ledger]);
  // What is left = amount lent − repayments in the ledger (the rule calcNetWorth uses).
  const loans = useMemo(() => employeeLoans.filter(l => l.status !== "settled").map(l => {
    const pays = ledger.filter(e => e.employee_loan_id === l.id && e.tx_type === "collect_loan").sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date)));
    const paid = pays.reduce((t, e) => t + Number(e.amount_idr || e.amount || 0), 0);
    return { ...l, name: l.employee_name || "Loan", pays, paid, left: Math.max(0, Number(l.total_amount || 0) - paid) };
  }).sort((a, b) => b.left - a.left), [employeeLoans, ledger]);
  const loansLeft = loans.reduce((t, l) => t + l.left, 0);
  const history = useMemo(() => [...reimburseSettlements].sort((a, b) => String(b.settled_at || b.settled_date || "").localeCompare(String(a.settled_at || a.settled_date || ""))).slice(0, 40), [reimburseSettlements]);
  const loan = openLoan && loans.find(l => l.id === openLoan);

  return (
    <div className={`mw${dark ? " dark" : ""}`}>
      <div className="mw-hdr">
        <h1>Receivables</h1>
        {view === "loans" && <button className="mw-round" onClick={() => setForm({ type: "give_loan" })} aria-label="New loan"><Plus size={22} strokeWidth={1.8} /></button>}
      </div>
      <div className="mw-seg" role="tablist">
        {[["reimburse", "Reimburse"], ["loans", "Loans"], ["history", "History"]].map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? "on" : ""} onClick={() => setView(id)}>{label}</button>)}
      </div>

      {view === "reimburse" && (
        <>
          <div className="mw-tile" style={{ marginBottom: 16 }}><div className="mw-tile-l">Owed to you</div><div className="mw-tile-n">{fmtIDR(owed, false, true)}</div></div>
          <Receivables {...props} mobile matchOnly />
        </>
      )}

      {view === "loans" && (
        <>
          <div className="mw-tile" style={{ marginBottom: 16 }}><div className="mw-tile-l">Still out on loan</div><div className="mw-tile-n">{fmtIDR(loansLeft)}</div></div>
          <div className="mw-list">
            {loans.map(l => (
              <button key={l.id} className="mw-row mw-tx" onClick={() => setOpenLoan(l.id)}>
                <span className="mw-row-name">{l.name}{Number(l.monthly_installment) > 0 && <small>{fmtIDR(l.monthly_installment)} a month</small>}</span>
                <span className="mw-row-amt">{fmtIDR(l.left)}</span>
              </button>
            ))}
            {!loans.length && <div className="mw-row"><span className="mw-row-name" style={{ color: "var(--muted)" }}>No loans outstanding</span></div>}
          </div>
        </>
      )}

      {view === "history" && (
        <div className="mw-list">
          {history.map(h => (
            <div key={h.id} className="mw-row mw-tx">
              <span className="mw-row-name">{h.entity}<small>{fmtDate(h.settled_at || h.settled_date)}</small></span>
              <span className="mw-row-amt">{fmtIDR(h.total_in || h.total_out)}</span>
            </div>
          ))}
          {!history.length && <div className="mw-row"><span className="mw-row-name" style={{ color: "var(--muted)" }}>Nothing matched yet</span></div>}
        </div>
      )}

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
                </div>
              </>
            )}
            <button className="mw-btn" onClick={() => { setForm({ type: "collect_loan", loan }); setOpenLoan(null); }}>Record repayment</button>
          </div>
        </div>
      )}

      <TxVerticalBig open={!!form} mode="add" defaultGroup="loan" defaultTxType={form?.type || "collect_loan"}
        defaultAccount={form?.loan ? { from_id: form.loan.id } : undefined}
        onSave={() => { setForm(null); props.onRefresh && props.onRefresh(); }} onClose={() => setForm(null)}
        user={props.user} accounts={props.accounts} setLedger={props.setLedger} categories={props.categories || []} fxRates={props.fxRates} allCurrencies={props.CURRENCIES || []}
        bankAccounts={props.bankAccounts} creditCards={props.creditCards} assets={props.assets} liabilities={props.liabilities} receivables={props.receivables}
        incomeSrcs={props.incomeSrcs} employeeLoans={employeeLoans} setEmployeeLoans={props.setEmployeeLoans} onRefresh={props.onRefresh} />
    </div>
  );
}
