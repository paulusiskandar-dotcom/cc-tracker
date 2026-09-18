// Mobile Transactions (phones only). History · Inbox on top; History is a month at a
// glance (donut, categories, latest rows). The full list with filters, edit, split and
// delete is the existing Transactions page, opened from "All transactions" or "+".
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import { tagsApi } from "../../api";
import { fmtIDR, fmtCurNative } from "../../utils";
import Transactions from "../Transactions";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COLORS = ["#111827", "#3b5bdb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#9ca3af"];
const fmtDate = s => { if (!s) return ""; const d = new Date(`${String(s).slice(0, 10)}T00:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const monthLabel = m => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shiftMonth = (m, by) => { const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const amt = e => Number(e.amount_idr || e.amount || 0);

// Same definition the Dashboard uses for "spending" and "income".
const isExpense = e => (e.tx_type === "expense" || e.tx_type === "pay_liability") && !e.is_reimburse;
const isIncome = e => e.tx_type === "income";

export default function MobileTransactions(props) {
  const { user, ledger = [], accounts = [], categories = [], incomeSrcs = [], pendingSyncs = [], openEmail, onSearch } = props;
  const [view, setView] = useState(() => lsGet("m.tx.view") || "history");   // history | inbox
  const [full, setFull] = useState(false);                                     // the existing full page
  const [addSignal, setAddSignal] = useState(0);
  const [kind, setKind] = useState("expense");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [trip, setTrip] = useState(null);
  const [trips, setTrips] = useState([]);
  const [openCat, setOpenCat] = useState(null);
  const [showAllCat, setShowAllCat] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => { lsSet("m.tx.view", view); }, [view]);
  useEffect(() => {
    if (!user?.id) return;
    tagsApi.list(user.id, { status: "active" }).then(t => setTrips((t || []).filter(x => x.type === "trip"))).catch(() => {});
  }, [user?.id]);

  const accName = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a.name])), [accounts]);
  const catName = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c.name])), [categories]);
  const srcName = useMemo(() => Object.fromEntries(incomeSrcs.map(c => [c.id, c.name])), [incomeSrcs]);
  // Paying down a liability counts as money out (same as the Dashboard) but it is not an
  // uncategorised purchase, so it gets its own name.
  const nameOfCat = e => e.category_name || catName[e.category_id] || (e.tx_type === "pay_liability" ? "Loan repayment" : "Uncategorized");

  // A trip covers its own dates, so it replaces the month filter instead of narrowing it.
  const scope = useMemo(() => ledger.filter(e => (trip ? e.tag_id === trip : String(e.tx_date || "").slice(0, 7) === month)), [ledger, month, trip]);
  const rows = useMemo(() => scope.filter(kind === "expense" ? isExpense : isIncome), [scope, kind]);
  const total = rows.reduce((s, e) => s + amt(e), 0);

  const cats = useMemo(() => {
    const m = {};
    rows.forEach(e => { const k = kind === "expense" ? nameOfCat(e) : (srcName[e.from_id] || e.category_name || "Other income"); (m[k] = m[k] || { name: k, total: 0, items: [] }); m[k].total += amt(e); m[k].items.push(e); });
    return Object.values(m).sort((a, b) => b.total - a.total).map((c, i) => ({ ...c, color: COLORS[Math.min(i, COLORS.length - 1)], items: c.items.sort((a, b) => amt(b) - amt(a)) }));
  }, [rows, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const recent = useMemo(() => [...scope].sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date)) || String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 10), [scope]);

  if (full) {
    return (
      <div className="mw">
        <div className="mw-hdr">
          <button className="mw-round" onClick={() => { setFull(false); setAddSignal(0); }} aria-label="Back"><ChevronLeft size={22} strokeWidth={1.8} /></button>
          <h2>All transactions</h2>
        </div>
        <div className="mw-legacy"><Transactions {...props} txAddSignal={addSignal} /></div>
      </div>
    );
  }

  return (
    <div className="mw">
      <div className="mw-hdr">
        <h1>Transactions</h1>
        {onSearch && <button className="mw-round" onClick={onSearch} aria-label="Search"><Search size={20} strokeWidth={1.8} /></button>}
        <button className="mw-round" onClick={() => { setAddSignal(s => s + 1); setFull(true); }} aria-label="Add transaction"><Plus size={22} strokeWidth={1.8} /></button>
      </div>

      <div className="mw-seg" role="tablist">
        <button role="tab" aria-selected={view === "history"} className={view === "history" ? "on" : ""} onClick={() => setView("history")}>History</button>
        <button role="tab" aria-selected={view === "inbox"} className={view === "inbox" ? "on" : ""} onClick={() => setView("inbox")}>Inbox{pendingSyncs.length ? <em>{pendingSyncs.length}</em> : null}</button>
      </div>

      {view === "inbox" ? (
        <Inbox rows={pendingSyncs} openEmail={openEmail} />
      ) : (
        <>
          <div className="mw-bar2">
            <div className="mw-month">
              <button onClick={() => { setTrip(null); setMonth(m => shiftMonth(m, -1)); }} aria-label="Previous month"><ChevronLeft size={18} /></button>
              <span>{trip ? trips.find(t => t.id === trip)?.name : monthLabel(month)}</span>
              <button onClick={() => { setTrip(null); setMonth(m => shiftMonth(m, 1)); }} aria-label="Next month"><ChevronRight size={18} /></button>
            </div>
            <div className="mw-seg mw-seg-sm">
              <button className={kind === "expense" ? "on" : ""} onClick={() => { setKind("expense"); setOpenCat(null); }}>Expense</button>
              <button className={kind === "income" ? "on" : ""} onClick={() => { setKind("income"); setOpenCat(null); }}>Income</button>
            </div>
          </div>

          {trips.length > 0 && (
            <div className="mw-pills">
              {trips.map(t => <button key={t.id} className={trip === t.id ? "on" : ""} onClick={() => { setTrip(trip === t.id ? null : t.id); setOpenCat(null); }}>{t.name}</button>)}
            </div>
          )}

          <Donut cats={cats} total={total} label={kind === "expense" ? "Spent" : "Received"} />

          {cats.length > 0 && (
            <div className="mw-list">
              {(showAllCat ? cats : cats.slice(0, 6)).map(c => (
                <div key={c.name}>
                  <button className="mw-row" onClick={() => setOpenCat(openCat === c.name ? null : c.name)} aria-expanded={openCat === c.name}>
                    <i className="mw-dot" style={{ background: c.color }} />
                    <span className="mw-row-name">{c.name}</span>
                    <span className="mw-row-amt">{fmtIDR(c.total)}</span>
                  </button>
                  {openCat === c.name && (
                    <div className="mw-sub">
                      {c.items.slice(0, 8).map(e => (
                        <button key={e.id} className="mw-row mw-tx" onClick={() => setDetail(e)}>
                          <span className="mw-row-name">{e.description || e.merchant_name || nameOfCat(e)}</span>
                          <span className="mw-row-amt">{fmtIDR(amt(e))}</span>
                        </button>
                      ))}
                      {c.items.length > 8 && <div className="mw-more">and {c.items.length - 8} more</div>}
                    </div>
                  )}
                </div>
              ))}
              {cats.length > 6 && <button className="mw-row mw-showall" onClick={() => setShowAllCat(v => !v)}>{showAllCat ? "Show less" : `Show all ${cats.length} categories`}</button>}
            </div>
          )}

          {recent.length > 0 && (
            <>
              <div className="mw-label">Latest</div>
              <div className="mw-list">
                {recent.map(e => {
                  const inc = e.tx_type === "income" || e.tx_type === "reimburse_in";
                  return (
                    <button key={e.id} className="mw-row mw-tx" onClick={() => setDetail(e)}>
                      <span className="mw-row-name">{e.description || e.merchant_name || e.tx_type}</span>
                      <span className={`mw-row-amt${inc ? " in" : ""}`}>{inc ? "+" : ""}{fmtIDR(amt(e))}</span>
                    </button>
                  );
                })}
                <button className="mw-row mw-showall" onClick={() => setFull(true)}>All transactions</button>
              </div>
            </>
          )}
          {!recent.length && <div className="mw-empty">No transactions in {trip ? "this trip" : monthLabel(month)}.</div>}
        </>
      )}

      {detail && <TxDetail e={detail} accName={accName} category={nameOfCat(detail)} trips={trips} onClose={() => setDetail(null)} onEdit={() => { setDetail(null); setFull(true); }} />}
    </div>
  );
}

export function Donut({ cats, total, label }) {
  const R = 54; const C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="mw-donut">
      <svg viewBox="0 0 140 140" aria-hidden="true">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#eceef2" strokeWidth="14" />
        {total > 0 && cats.map(c => {
          const len = Math.max(0, (c.total / total) * C - 1.5);
          const el = <circle key={c.name} cx="70" cy="70" r={R} fill="none" stroke={c.color} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />;
          off += (c.total / total) * C;
          return len > 0.5 ? el : null;
        })}
      </svg>
      <div className="mw-donut-c"><span>{label}</span><b>{fmtIDR(total)}</b></div>
    </div>
  );
}

function Inbox({ rows, openEmail }) {
  if (!rows.length) return <div className="mw-empty">Nothing waiting.</div>;
  const shown = rows.slice(0, 40);
  return (
    <>
      <div className="mw-list">
        {shown.map(r => (
          <button key={r.id} className="mw-row mw-tx" onClick={() => openEmail && openEmail("pending")}>
            <span className="mw-row-name">{r.notes || r.merchant_name || r.subject || "Transaction"}<small>{fmtDate(r.transaction_date || r.received_at)}</small></span>
            <span className="mw-row-amt">{r.currency && r.currency !== "IDR" ? fmtCurNative(r.amount, r.currency) : fmtIDR(r.amount_idr || r.amount)}</span>
          </button>
        ))}
        <button className="mw-row mw-showall" onClick={() => openEmail && openEmail("pending")}>Review {rows.length > shown.length ? `all ${rows.length}` : ""} in Email Sync</button>
      </div>
    </>
  );
}

function TxDetail({ e, accName, category, trips, onClose, onEdit }) {
  const rowsOut = [
    ["Date", fmtDate(e.tx_date)],
    ["Type", String(e.tx_type || "").replace(/_/g, " ")],
    ["From", accName[e.from_id] || e.from_name || null],
    ["To", accName[e.to_id] || e.to_name || null],
    ["Category", category !== "Uncategorized" ? category : null],
    ["Entity", e.entity && e.entity !== "Personal" ? e.entity : null],
    ["Trip", trips.find(t => t.id === e.tag_id)?.name || null],
    ["Original", e.currency && e.currency !== "IDR" ? fmtCurNative(e.amount, e.currency) : null],
    ["Notes", e.notes || null],
  ].filter(r => r[1]);
  return (
    <div className="mw-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mw-modal-card" onClick={ev => ev.stopPropagation()}>
        <div className="mw-hdr">
          <h2>{e.description || e.merchant_name || "Transaction"}</h2>
          <button className="mw-round mw-round-sunk" onClick={onClose} aria-label="Close"><X size={20} strokeWidth={1.8} /></button>
        </div>
        <div className="mw-tile-n">{fmtIDR(amt(e))}</div>
        <div className="mw-list mw-gap mw-list-sunk">
          {rowsOut.map(([k, v]) => <div key={k} className="mw-row mw-kv"><span className="mw-row-name">{k}</span><span className="mw-row-amt mw-wrap">{v}</span></div>)}
        </div>
        <button className="mw-btn" onClick={onEdit}>Edit in All transactions</button>
      </div>
    </div>
  );
}
