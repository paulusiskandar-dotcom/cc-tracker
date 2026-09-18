// Mobile Bills (phones only): Bills · Reimburse · Match. The bill figures come from the
// same buildBills() the desktop Bills page uses; receivables from src/lib/piutang.js.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtIDR } from "../../utils";
import { hitungPiutang } from "../../lib/piutang";
import { buildBills } from "../Billing";
import { nameInstalments } from "./names";
import Receivables from "../Receivables";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
// Instalments and loan payments are charged automatically on their date (there is no
// "paid" check for them), so a past date means billed, not late.
const isAuto = i => /^[il]/.test(String(i.id));
const dueText = i => `${i.when.getDate()} ${MONTHS[i.when.getMonth()]} · ${i.dayLeft < 0 ? (isAuto(i) ? "billed" : `${-i.dayLeft}d late`) : i.dayLeft === 0 ? "today" : `${i.dayLeft}d`}`;

export default function MobileBills(props) {
  const { ledger = [], creditCards = [], liabilities = [], recurTemplates = [], installments = [], employeeLoans = [], netWorth = {} } = props;
  const [view, setView] = useState(() => lsGet("m.bills.view") || "bills");
  const [full, setFull] = useState(false);
  const [openEnt, setOpenEnt] = useState(null);
  useEffect(() => { lsSet("m.bills.view", view); }, [view]);

  const bills = useMemo(() => { const b = buildBills({ ledger, creditCards, liabilities, recurTemplates, installments }); return { ...b, cicilan: nameInstalments(b.cicilan, ledger, installments) }; }, [ledger, creditCards, liabilities, recurTemplates, installments]);
  const groups = [["Cards", bills.cards], ["Installments", bills.cicilan], ["Recurring", bills.rutinManual], ["Subscriptions", bills.subs]];
  const week = useMemo(() => groups.flatMap(g => g[1]).filter(i => i.dayLeft <= 7 && !(isAuto(i) && i.dayLeft < 0)).sort((a, b) => a.when - b.when), [bills]); // eslint-disable-line react-hooks/exhaustive-deps
  const piutang = useMemo(() => hitungPiutang(ledger), [ledger]);
  const entities = Object.entries(piutang.perEntity).filter(([k]) => k !== "?").sort((a, b) => b[1].saldo - a[1].saldo);
  // Open items = reimburse rows not yet matched into a settlement (same test piutang.js uses).
  const openItems = useMemo(() => {
    const m = {};
    ledger.forEach(e => { if ((e.tx_type === "reimburse_out" || e.tx_type === "reimburse_in") && !e.reimburse_settlement_id) (m[e.entity || "?"] = m[e.entity || "?"] || []).push(e); });
    Object.values(m).forEach(l => l.sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date))));
    return m;
  }, [ledger]);
  const activeLoans = employeeLoans.filter(l => l.status !== "settled").length;

  if (full) {
    return (
      <div className={`mw${props.dark ? " dark" : ""}`}>
        <div className="mw-hdr">
          <button className="mw-round" onClick={() => setFull(false)} aria-label="Back"><ChevronLeft size={22} strokeWidth={1.8} /></button>
          <h2>Receivables</h2>
        </div>
        <div className="mw-legacy"><Receivables {...props} /></div>
      </div>
    );
  }

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
          {week.length > 0 && <BillGroup title="Due this week" items={week} total />}
          {groups.map(([title, items]) => items.length > 0 && <BillGroup key={title} title={title} items={items} />)}
          {!groups.some(g => g[1].length) && <div className="mw-empty">Nothing left to pay this month.</div>}
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
              <button key={name} className="mw-row" onClick={() => setFull(true)}>
                <span className="mw-row-name">{name}</span>
                <span className={`mw-row-amt${p.saldo < 0 ? " hot" : ""}`}>{fmtIDR(p.saldo, false, true)}</span>
                <ChevronRight size={16} className="mw-chev" />
              </button>
            ))}
          </div>
          {activeLoans > 0 && (
            <>
              <div className="mw-label">Employee loans</div>
              <div className="mw-list">
                <button className="mw-row" onClick={() => setFull(true)}>
                  <span className="mw-row-name">{activeLoans} active</span>
                  <span className="mw-row-amt">{fmtIDR(netWorth.employeeLoanTotal || 0)}</span>
                  <ChevronRight size={16} className="mw-chev" />
                </button>
              </div>
            </>
          )}
        </>
      )}

      {view === "match" && (
        <>
          <div className="mw-list">
            {entities.map(([name, p]) => {
              const items = openItems[name] || [];
              return (
                <div key={name}>
                  <button className="mw-row" onClick={() => setOpenEnt(openEnt === name ? null : name)} aria-expanded={openEnt === name}>
                    <span className="mw-row-name">{name}<small>{items.length} open item{items.length === 1 ? "" : "s"}</small></span>
                    <span className="mw-row-amt">{fmtIDR(p.openNet, false, true)}</span>
                  </button>
                  {openEnt === name && (
                    <div className="mw-sub">
                      {items.slice(0, 40).map(e => {
                        const back = e.tx_type === "reimburse_in";
                        return (
                          <div key={e.id} className="mw-row mw-tx">
                            <span className="mw-row-name">{e.notes && !/^imported from/i.test(e.notes) ? e.notes : (e.description || "Reimburse")}<small>{`${new Date(`${e.tx_date}T00:00:00`).getDate()} ${MONTHS[new Date(`${e.tx_date}T00:00:00`).getMonth()]}`}</small></span>
                            <span className={`mw-row-amt${back ? " in" : ""}`}>{back ? "+" : ""}{fmtIDR(e.amount_idr || e.amount)}</span>
                          </div>
                        );
                      })}
                      {items.length > 40 && <div className="mw-more">and {items.length - 40} more</div>}
                      {!items.length && <div className="mw-more">Everything is matched.</div>}
                    </div>
                  )}
                </div>
              );
            })}
            <button className="mw-row mw-showall" onClick={() => setFull(true)}>Match in Receivables</button>
          </div>
        </>
      )}
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
            <span className="mw-row-name">{i.name}<small className={i.dayLeft <= 3 && !(isAuto(i) && i.dayLeft < 0) ? "hot" : ""}>{dueText(i)}</small></span>
            <span className="mw-row-amt">{i.known ? fmtIDR(i.amount) : "—"}</span>
          </div>
        ))}
      </div>
    </>
  );
}
