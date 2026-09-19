// Mobile Reports (phones only): one year at a glance — money in, money out, what is left,
// month by month; tap a month for where it went. The filter-heavy report stays on desktop.
// "Out" uses the same definition as Home and Transactions (expense + loan payments, no reimburse).
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtIDR } from "../../utils";
import { makeSpending } from "../../lib/spending";
import "./mobile.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const amt = e => Number(e.amount_idr || e.amount || 0);
const signed = v => `${v < 0 ? "−" : ""}${fmtIDR(Math.abs(v))}`;

export default function MobileReports({ ledger = [], categories = [], incomeSrcs = [], dark }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [openM, setOpenM] = useState(null);
  const { isIncome, spendOf } = useMemo(() => makeSpending(incomeSrcs), [incomeSrcs]);
  const catName = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c.name])), [categories]);
  const srcName = useMemo(() => Object.fromEntries(incomeSrcs.map(c => [c.id, c.name])), [incomeSrcs]);

  const months = useMemo(() => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ i, got: 0, out: 0, cats: {}, srcs: {} }));
    ledger.forEach(e => {
      const d = String(e.tx_date || ""); if (Number(d.slice(0, 4)) !== year) return; const r = rows[Number(d.slice(5, 7)) - 1]; if (!r) return;
      const v = spendOf(e);
      if (v) { r.out += v; const k = e.category_name || catName[e.category_id] || (e.tx_type === "pay_liability" ? "Loan repayment" : v < 0 ? "Refunds" : "Uncategorized"); r.cats[k] = (r.cats[k] || 0) + v; }
      else if (isIncome(e)) { r.got += amt(e); const k = srcName[e.from_id] || e.category_name || "Other income"; r.srcs[k] = (r.srcs[k] || 0) + amt(e); }
    });
    const last = year === thisYear ? new Date().getMonth() : 11;
    return rows.filter(r => r.i <= last && (r.got || r.out)).reverse();
  }, [ledger, year, thisYear, catName, srcName, spendOf, isIncome]);
  const got = months.reduce((s, r) => s + r.got, 0), out = months.reduce((s, r) => s + r.out, 0);
  const top = Math.max(1, ...months.flatMap(r => [r.got, r.out]));
  const hasEarlier = useMemo(() => ledger.some(e => Number(String(e.tx_date || "").slice(0, 4)) < year), [ledger, year]);

  return (
    <div className={`mw${dark ? " dark" : ""}`}>
      <div className="mw-hdr"><h1>Reports</h1></div>
      <div className="mw-bar2">
        <div className="mw-month">
          <button onClick={() => { setYear(y => y - 1); setOpenM(null); }} disabled={!hasEarlier} aria-label="Previous year"><ChevronLeft size={18} /></button>
          <span>{year}</span>
          <button onClick={() => { setYear(y => Math.min(thisYear, y + 1)); setOpenM(null); }} disabled={year >= thisYear} aria-label="Next year"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="mw-tile">
        <div className="mw-tile-l">{year === thisYear ? "This year so far" : "Whole year"}</div>
        <div className={`mw-tile-n${got - out < 0 ? " mw-neg" : ""}`}>{signed(got - out)}</div>
        <div className="mw-kv2"><span>In</span><b className="in">{fmtIDR(got)}</b></div>
        <div className="mw-kv2"><span>Out</span><b>{fmtIDR(out)}</b></div>
      </div>

      <div className="mw-label">By month</div>
      <div className="mw-list">
        {months.map(r => {
          const open = openM === r.i; const cats = Object.entries(r.cats).sort((a, b) => b[1] - a[1]); const srcs = Object.entries(r.srcs).sort((a, b) => b[1] - a[1]);
          return (
            <div key={r.i}>
              <button className="mw-row mw-rep" onClick={() => setOpenM(open ? null : r.i)} aria-expanded={open}>
                <span className="mw-row-name">{MONTHS[r.i]}
                  <span className="mw-duo"><i className="in" style={{ width: `${(r.got / top) * 100}%` }} /><i style={{ width: `${(r.out / top) * 100}%` }} /></span>
                </span>
                <span className={`mw-row-amt${r.got - r.out < 0 ? " hot" : ""}`}>{signed(r.got - r.out)}</span>
              </button>
              {open && (
                <div className="mw-sub">
                  <div className="mw-row mw-tx"><span className="mw-row-name"><b>In</b></span><span className="mw-row-amt in">{fmtIDR(r.got)}</span></div>
                  {srcs.slice(0, 4).map(([k, v]) => <div key={k} className="mw-row mw-tx"><span className="mw-row-name">{k}</span><span className="mw-row-amt">{fmtIDR(v)}</span></div>)}
                  <div className="mw-row mw-tx"><span className="mw-row-name"><b>Out</b></span><span className="mw-row-amt">{fmtIDR(r.out)}</span></div>
                  {cats.slice(0, 6).map(([k, v]) => <div key={k} className="mw-row mw-tx"><span className="mw-row-name">{k}</span><span className="mw-row-amt">{signed(v)}</span></div>)}
                  {cats.length > 6 && <div className="mw-more">and {cats.length - 6} smaller categories</div>}
                </div>
              )}
            </div>
          );
        })}
        {!months.length && <div className="mw-row"><span className="mw-row-name" style={{ color: "var(--muted)" }}>No transactions in {year}</span></div>}
      </div>
    </div>
  );
}
