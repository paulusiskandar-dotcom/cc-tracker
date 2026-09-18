// Mobile Bills (phones only): Bills · Reimburse · Match. The bill figures come from the
// same buildBills() the desktop Bills page uses; receivables from src/lib/piutang.js.
import { useEffect, useMemo, useState } from "react";
import { loanStatus } from "../../lib/loans";
import { ChevronRight, Plus } from "lucide-react";
import { fmtIDR } from "../../utils";
import { hitungPiutang } from "../../lib/piutang";
import { buildBills } from "../Billing";
import { nameInstalments } from "./names";
import LoanSheet from "./LoanSheet";
import Receivables from "../Receivables";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const dueText = i => `${i.when.getDate()} ${MONTHS[i.when.getMonth()]} · ${i.dayLeft < 0 ? `${-i.dayLeft}d late` : i.dayLeft === 0 ? "today" : `${i.dayLeft}d`}`;

export default function MobileBills(props) {
  const { ledger = [], creditCards = [], liabilities = [], recurTemplates = [], installments = [], reconSessions = [], employeeLoans = [] } = props;
  const [view, setView] = useState(() => lsGet("m.bills.view") || "bills");
  const [openLoan, setOpenLoan] = useState(null);
  const [newLoan, setNewLoan] = useState(false);
  useEffect(() => { lsSet("m.bills.view", view); }, [view]);

  const bills = useMemo(() => { const b = buildBills({ ledger, creditCards, liabilities, recurTemplates, installments, reconSessions, actionable: true }); return { ...b, cicilan: nameInstalments(b.cicilan, ledger, installments) }; }, [ledger, creditCards, liabilities, recurTemplates, installments, reconSessions]);
  const groups = [["Cards", bills.cards], ["Bills", bills.rutinManual], ["Loans", bills.cicilan]];
  const week = useMemo(() => groups.flatMap(g => g[1]).filter(i => i.dayLeft <= 14).sort((a, b) => a.when - b.when), [bills]); // eslint-disable-line react-hooks/exhaustive-deps
  // Each bill shows once: due within 14 days (or overdue) under To pay, everything else under Later.
  const later = useMemo(() => groups.flatMap(g => g[1]).filter(i => i.dayLeft > 14).sort((a, b) => a.when - b.when), [bills]); // eslint-disable-line react-hooks/exhaustive-deps
  const piutang = useMemo(() => hitungPiutang(ledger), [ledger]);
  const entities = Object.entries(piutang.perEntity).filter(([k]) => k !== "?").sort((a, b) => b[1].saldo - a[1].saldo);
  // Remaining per loan = amount lent − repayments in the ledger (the rule calcNetWorth uses).
  const loans = useMemo(() => employeeLoans.filter(l => l.status !== "settled").map(l => {
    return { id: l.id, name: l.employee_name || l.name || "Loan", left: loanStatus(l, ledger).left, monthly: Number(l.monthly_installment || 0) };
  }).filter(l => l.left > 0).sort((a, b) => b.left - a.left), [employeeLoans, ledger]);

  return (
    <div className={`mw${props.dark ? " dark" : ""}`}>
      <div className="mw-hdr"><h1>Bills</h1></div>
      <div className="mw-seg" role="tablist">
        {[["bills", "Bills"], ["reimburse", "Reimburse"], ["match", "Match"]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={view === id} className={view === id ? "on" : ""} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>

      {view === "bills" && (
        <>
          {week.length > 0 && <BillGroup title="To pay" items={week} total />}
          {later.length > 0 && <BillGroup title="Later" items={later} />}
          {!week.length && !later.length && <div className="mw-empty">Nothing left to pay this month.</div>}
        </>
      )}

      {view === "reimburse" && (
        <>
          <div className="mw-tile">
            <div className="mw-tile-l">Owed to you</div>
            <div className="mw-tile-n">{fmtIDR(piutang.saldoTotal, false, true)}</div>
          </div>
          <div className="mw-list mw-gap">
            {entities.map(([name, p]) => (
              <button key={name} className="mw-row" onClick={() => setView("match")}>
                <span className="mw-row-name">{name}</span>
                <span className={`mw-row-amt${p.saldo < 0 ? " hot" : ""}`}>{fmtIDR(p.saldo, false, true)}</span>
                <ChevronRight size={16} className="mw-chev" />
              </button>
            ))}
          </div>
          {(
            <>
              <div className="mw-label mw-label-row"><span>Employee loans</span>
                <span className="mw-label-act"><b>{fmtIDR(loans.reduce((t, l) => t + l.left, 0))}</b><button className="mw-mini" onClick={() => setNewLoan(true)} aria-label="New loan"><Plus size={16} strokeWidth={2} /></button></span></div>
              <div className="mw-list">
                {!loans.length && <div className="mw-row"><span className="mw-row-name" style={{ color: "var(--muted)" }}>No loans outstanding</span></div>}
                {loans.map(l => (
                  <button key={l.id} className="mw-row mw-tx" onClick={() => setOpenLoan(l.id)}>
                    <span className="mw-row-name">{l.name}{l.monthly > 0 && <small>{fmtIDR(l.monthly)} a month</small>}</span>
                    <span className="mw-row-amt">{fmtIDR(l.left)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {view === "match" && <Receivables {...props} mobile matchOnly />}
      {(openLoan || newLoan) && <LoanSheet {...props} loanId={openLoan} newLoan={newLoan} onClose={() => { setOpenLoan(null); setNewLoan(false); }} />}
    </div>
  );
}

function BillGroup({ title, items, total }) {
  const sum = items.filter(i => i.known).reduce((s, i) => s + i.amount, 0);
  return (
    <>
      <div className="mw-label mw-label-row"><span>{title}</span>{total && <b>{fmtIDR(sum)}</b>}</div>
      <div className="mw-list">
        {items.map(i => (
          <div key={i.id} className="mw-row mw-tx">
            <span className="mw-row-name">{i.name}<small className={i.dayLeft <= 3 ? "hot" : ""}>{dueText(i)}</small></span>
            <span className="mw-row-amt">{i.known ? fmtIDR(i.amount) : "—"}</span>
          </div>
        ))}
      </div>
    </>
  );
}
