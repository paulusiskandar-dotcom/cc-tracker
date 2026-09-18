// Mobile Receivables (phones only): Reimburse · Loans · History.
//   Reimburse — who owes what; tap to match (the same Match screen Bills uses)
//   Loans     — employee loans, what is left on each; record a repayment or a new loan
//   History   — past matches, read only
// Saving goes through the app's own form (TxVerticalBig) and Receivables' own Match action.
import { useEffect, useMemo, useState } from "react";
import { loanStatus } from "../../lib/loans";
import { Plus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtIDR } from "../../utils";
import { hitungPiutang } from "../../lib/piutang";
import Receivables from "../Receivables";
import LoanSheet from "./LoanSheet";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = s => { if (!s) return ""; const d = new Date(`${String(s).slice(0, 10)}T00:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export default function MobileReceivables(props) {
  const { user, ledger = [], employeeLoans = [], dark } = props;
  const [settlements, setSettlements] = useState([]);
  const [view, setView] = useState(() => lsGet("m.recv.view") || "reimburse");
  const [openLoan, setOpenLoan] = useState(null);
  const [form, setForm] = useState(null); // { type: "collect_loan" | "give_loan", loan }
  useEffect(() => { lsSet("m.recv.view", view); }, [view]);
  // Past matches, loaded the way the desktop page loads them (the app shell only keeps pending ones).
  useEffect(() => {
    if (!user?.id || view !== "history") return;
    supabase.from("reimburse_settlements").select("id,entity,settled_at,settled_date,total_out,total_in").eq("user_id", user.id)
      .order("settled_at", { ascending: false }).limit(60).then(({ data }) => setSettlements(data || []));
  }, [user?.id, view]);

  const owed = useMemo(() => hitungPiutang(ledger).saldoTotal, [ledger]);
  // What is left = amount lent − repayments in the ledger (the rule calcNetWorth uses).
  const loans = useMemo(() => employeeLoans.filter(l => l.status !== "settled").map(l => {
    const st = loanStatus(l, ledger);
    return { ...l, name: l.employee_name || "Loan", pays: [...st.pays].sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date))), paid: st.paid, paidBefore: st.paidBefore, left: st.left };
  }).sort((a, b) => b.left - a.left), [employeeLoans, ledger]);
  const loansLeft = loans.reduce((t, l) => t + l.left, 0);
  const history = settlements;

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

      {(openLoan || form) && <LoanSheet {...props} loanId={openLoan} newLoan={!!form} onClose={() => { setOpenLoan(null); setForm(null); }} />}
    </div>
  );
}
