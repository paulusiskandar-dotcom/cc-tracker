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
  const week = useMemo(() => groups.flatMap(g => g[1]).filter(i => i.dayLeft <= 7).sort((a, b) => a.when - b.when), [bills]); // eslint-disable-line react-hooks/exhaustive-deps
  // Each bill shows once: overdue or due within 7 days under Due soon, days 8–14 under Upcoming.
  // Anything further out is not shown yet, and the sections carry no total (Paulus, 18 Sep 2026).
  const later = useMemo(() => groups.flatMap(g => g[1]).filter(i => i.dayLeft > 7 && i.dayLeft <= 14).sort((a, b) => a.when - b.when), [bills]); // eslint-disable-line react-hooks/exhaustive-deps
  const piutang = useMemo(() => hitungPiutang(ledger), [ledger]);
  const entities = Object.entries(piutang.perEntity).filter(([k]) => k !== "?").sort((a, b) => b[1].saldo - a[1].saldo);
  // Everything still being paid off in instalments: plans on credit cards and financed
  // liabilities (BYD). "4/12" = instalments paid out of the total; left = what is still to come.
  const plans = useMemo(() => {
    const byId = Object.fromEntries(ledger.map(e => [e.id, e])); const accName = Object.fromEntries((props.accounts || []).map(a => [a.id, a.name]));
    const onCards = installments.filter(i => i.status === "active").map(i => {
      const note = byId[i.purchase_ledger_id]?.notes; const total = Number(i.total_months || 0), paid = Number(i.paid_months || 0), monthly = Number(i.monthly_amount || 0);
      return { id: "i" + i.id, name: note && !/^imported from/i.test(note) ? String(note).replace(/\s+\d+\/\d+$/, "") : i.description, where: accName[i.account_id || i.cc_account_id] || "Card", paid, total, monthly, left: Math.max(0, total - paid) * monthly };
    });
    const financed = liabilities.filter(l => l.is_active !== false && Number(l.monthly_installment) > 0 && Number(l.tenor_months) > 0).map(l => {
      const monthly = Number(l.monthly_installment), total = Number(l.tenor_months), left = Number(l.outstanding_amount || 0);
      return { id: "l" + l.id, name: l.name, where: "Loan", paid: Math.max(0, Math.min(total, Math.round((total * monthly - left) / monthly))), total, monthly, left };
    });
    return [...onCards, ...financed].filter(p => p.left > 0).sort((a, b) => b.left - a.left);
  }, [installments, liabilities, ledger, props.accounts]);

  // What the running plans will cost in each coming month: a plan with N payments left falls
  // on the next N months, counted from next month (this month's are already billed or listed
  // under Due soon / Upcoming).
  const ahead = useMemo(() => {
    const now = new Date(); const len = Math.min(36, Math.max(0, ...plans.map(p => p.total - p.paid)));
    return Array.from({ length: len }, (_, k) => {
      const d = new Date(now.getFullYear(), now.getMonth() + 1 + k, 1);
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, short: MONTHS[d.getMonth()], total: plans.reduce((t, p) => t + (p.total - p.paid > k ? p.monthly : 0), 0), n: plans.filter(p => p.total - p.paid > k).length };
    });
  }, [plans]);
  const [allAhead, setAllAhead] = useState(false);

  // Remaining per loan = amount lent − repayments in the ledger (the rule calcNetWorth uses).
  const loans = useMemo(() => employeeLoans.filter(l => l.status !== "settled").map(l => {
    return { id: l.id, name: l.employee_name || l.name || "Loan", left: loanStatus(l, ledger).left, monthly: Number(l.monthly_installment || 0) };
  }).filter(l => l.left > 0).sort((a, b) => b.left - a.left), [employeeLoans, ledger]);

  return (
    <div className={`mw${props.dark ? " dark" : ""}`}>
      <div className="mw-hdr"><h1>Bills</h1></div>
      <div className="mw-seg mw-seg-4" role="tablist">
        {[["bills", "Bills"], ["installments", "Installments"], ["reimburse", "Reimburse"], ["match", "Match"]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={view === id} className={view === id ? "on" : ""} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>

      {view === "bills" && (
        <>
          {week.length > 0 && <BillGroup title="Due soon" items={week} />}
          {later.length > 0 && <BillGroup title="Upcoming" items={later} />}
          {!week.length && !later.length && <div className="mw-empty">Nothing due in the next two weeks.</div>}
        </>
      )}

      {view === "installments" && (
        <>
          <div className="mw-tile" style={{ marginBottom: 16 }}>
            <div className="mw-tile-l">Still to pay</div>
            <div className="mw-tile-n">{fmtIDR(plans.reduce((t, p) => t + p.left, 0))}</div>
            <div className="mw-tile-s">{fmtIDR(plans.reduce((t, p) => t + p.monthly, 0))} a month across {plans.length} plans</div>
          </div>
          {ahead.length > 0 && (
            <>
              <div className="mw-tile" style={{ marginBottom: 16 }}>
                <div className="mw-tile-l">Coming months</div>
                <AheadBars rows={ahead.slice(0, 12)} />
              </div>
              <div className="mw-list" style={{ marginBottom: 16 }}>
                {(allAhead ? ahead : ahead.slice(0, 6)).map(m => (
                  <div key={m.key} className="mw-row mw-tx"><span className="mw-row-name">{m.label}<small>{m.n} plan{m.n === 1 ? "" : "s"}</small></span><span className="mw-row-amt">{fmtIDR(m.total)}</span></div>
                ))}
                {ahead.length > 6 && <button className="mw-row mw-showall" onClick={() => setAllAhead(v => !v)}>{allAhead ? "Show less" : `Show all ${ahead.length} months`}</button>}
              </div>
              <div className="mw-label">Plans</div>
            </>
          )}
          <div className="mw-list">
            {plans.map(p => (
              <div key={p.id} className="mw-row mw-tx">
                <span className="mw-row-name">{p.name}<small>{p.where} · {p.paid}/{p.total} · {p.total - p.paid} more</small></span>
                <span className="mw-row-amt">{fmtIDR(p.left)}<small>{fmtIDR(p.monthly)} a month</small></span>
              </div>
            ))}
            {!plans.length && <div className="mw-row"><span className="mw-row-name" style={{ color: "var(--muted)" }}>No instalments running</span></div>}
          </div>
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

function BillGroup({ title, items }) {
  return (
    <>
      <div className="mw-label">{title}</div>
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

// Monthly instalment load for the next 12 months; one scale, month initials underneath.
function AheadBars({ rows }) {
  const W = 320, H = 96, B = 18, top = Math.max(1, ...rows.map(r => r.total)); const slot = W / rows.length; const bw = Math.min(18, slot * 0.62);
  return (
    <svg className="mw-trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Instalments due in each of the coming months">
      {rows.map((r, i) => { const h = Math.max(2, (r.total / top) * (H - B - 4)); const cx = slot * i + slot / 2;
        return <g key={r.key}><rect x={cx - bw / 2} y={H - B - h} width={bw} height={h} rx="3" fill="var(--ink)" opacity={i === 0 ? 1 : 0.55} /><text x={cx} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--faint)">{r.short}</text></g>; })}
    </svg>
  );
}
