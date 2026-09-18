// Mobile Transactions (phones only). History · Inbox on top; History is a month at a
// glance (donut, categories, latest rows). The full list with filters, edit, split and
// delete is the existing Transactions page, opened from "All transactions" or "+".
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import { tagsApi } from "../../api";
import { fmtIDR, fmtCurNative } from "../../utils";
import Transactions from "../Transactions";
import Email from "../Email";
import TxVerticalBig from "../shared/TxVerticalBig";
import Amt from "./Amt";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COLORS = ["var(--ink)", "#3b5bdb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#9ca3af"];
const fmtDate = s => { if (!s) return ""; const d = new Date(`${String(s).slice(0, 10)}T00:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const monthLabel = m => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shiftMonth = (m, by) => { const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const amt = e => Number(e.amount_idr || e.amount || 0);

// Same definition the Dashboard uses for "spending" and "income".
const isExpense = e => (e.tx_type === "expense" || e.tx_type === "pay_liability") && !e.is_reimburse;
const isIncome = e => e.tx_type === "income";

// Search on the phone is one thing: the transaction search. Any screen's magnifier lands here
// (App bumps searchSignal); a signal already acted on is remembered so a later visit is normal.
let seenSearchSignal = 0;

export default function MobileTransactions(props) {
  const { user, ledger = [], accounts = [], categories = [], incomeSrcs = [], pendingSyncs = [] } = props;
  const [view, setView] = useState(() => lsGet("m.tx.view") || "history");   // history | inbox
  const [full, setFull] = useState(false);                                     // the existing full page
  const [legacy, setLegacy] = useState(false);                                 // desktop list: filters, split, bulk
  const [txModal, setTxModal] = useState({ open: false, mode: "add", entry: null }); // the app's own add/edit form
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(60);
  const [tags, setTags] = useState([]);
  const [kind, setKind] = useState("expense");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [trip, setTrip] = useState(null);
  const [trips, setTrips] = useState([]);
  const [openCat, setOpenCat] = useState(null);
  const [showAllCat, setShowAllCat] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => { lsSet("m.tx.view", view); }, [view]);
  useEffect(() => {
    if (!props.searchSignal || props.searchSignal === seenSearchSignal) return;
    seenSearchSignal = props.searchSignal; setLegacy(false); setFull(true);
    setTimeout(() => document.getElementById("m-tx-search")?.focus(), 60);
  }, [props.searchSignal]);
  useEffect(() => {
    if (!user?.id) return;
    tagsApi.list(user.id, { status: "active" }).then(t => { setTags(t || []); setTrips((t || []).filter(x => x.type === "trip")); }).catch(() => {});
  }, [user?.id]);

  // Inbox = what can be approved now. Foreign-currency rows wait for their statement and
  // live on the Email Sync page with the sync settings.
  const pendingCount = pendingSyncs.filter(x => !x.currency || x.currency === "IDR").length;
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

  const modal = (
    <TxVerticalBig open={txModal.open} mode={txModal.mode} initialData={txModal.entry} onSave={() => {}} onDelete={() => {}}
      onClose={() => setTxModal({ open: false, mode: "add", entry: null })}
      user={user} accounts={accounts} setLedger={props.setLedger} categories={categories} fxRates={props.fxRates} allCurrencies={props.CURRENCIES || []}
      bankAccounts={props.bankAccounts} creditCards={props.creditCards} assets={props.assets} liabilities={props.liabilities} receivables={props.receivables}
      incomeSrcs={incomeSrcs} employeeLoans={props.employeeLoans} setEmployeeLoans={props.setEmployeeLoans} recurTemplates={props.recurTemplates}
      tags={tags} setReminders={props.setReminders} onRefresh={props.onRefresh} />
  );
  const detailSheet = detail && <TxDetail e={detail} accName={accName} category={nameOfCat(detail)} trips={trips} onClose={() => setDetail(null)}
    onEdit={() => { const e = detail; setDetail(null); setTxModal({ open: true, mode: "edit", entry: e }); }} />;

  if (legacy) {
    return (
      <div className={`mw${props.dark ? " dark" : ""}`}>
        <div className="mw-hdr">
          <button className="mw-round" onClick={() => setLegacy(false)} aria-label="Back"><ChevronLeft size={22} strokeWidth={1.8} /></button>
          <h2>Filters and bulk actions</h2>
        </div>
        <div className="mw-legacy"><Transactions {...props} /></div>
      </div>
    );
  }

  if (full) {
    const needle = q.trim().toLowerCase();
    const pool = needle
      ? ledger.filter(e => `${e.description || ""} ${e.merchant_name || ""} ${e.notes || ""} ${nameOfCat(e)} ${accName[e.from_id] || ""} ${accName[e.to_id] || ""} ${Math.round(amt(e))}`.toLowerCase().includes(needle))
      : scope;
    const sorted = [...pool].sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date)) || String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const shown = sorted.slice(0, limit);
    const days = []; shown.forEach(e => { const last = days[days.length - 1]; if (last && last.date === e.tx_date) last.items.push(e); else days.push({ date: e.tx_date, items: [e] }); });
    return (
      <div className={`mw${props.dark ? " dark" : ""}`}>
        <div className="mw-hdr">
          <button className="mw-round" onClick={() => { setFull(false); setQ(""); setLimit(60); }} aria-label="Back"><ChevronLeft size={22} strokeWidth={1.8} /></button>
          <h2>All transactions</h2>
          <button className="mw-round" onClick={() => setTxModal({ open: true, mode: "add", entry: null })} aria-label="Add transaction"><Plus size={22} strokeWidth={1.8} /></button>
        </div>
        <div className="mw-search"><Search size={18} /><input id="m-tx-search" value={q} onChange={e => { setQ(e.target.value); setLimit(60); }} placeholder="Search every month" aria-label="Search transactions" />{q && <button onClick={() => setQ("")} aria-label="Clear"><X size={16} /></button>}</div>
        {!needle && (
          <div className="mw-bar2">
            <div className="mw-month">
              <button onClick={() => { setTrip(null); setMonth(m => shiftMonth(m, -1)); setLimit(60); }} aria-label="Previous month"><ChevronLeft size={18} /></button>
              <span>{trip ? trips.find(t => t.id === trip)?.name : monthLabel(month)}</span>
              <button onClick={() => { setTrip(null); setMonth(m => shiftMonth(m, 1)); setLimit(60); }} aria-label="Next month"><ChevronRight size={18} /></button>
            </div>
          </div>
        )}
        {days.map(d => (
          <div key={d.date}>
            <div className="mw-label">{fmtDate(d.date)}</div>
            <div className="mw-list">
              {d.items.map(e => {
                return (
                  <button key={e.id} className="mw-row mw-tx" onClick={() => setDetail(e)}>
                    <span className="mw-row-name">{e.description || e.merchant_name || e.tx_type}</span>
                    <Amt e={e} value={amt(e)} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!sorted.length && <div className="mw-empty">{needle ? "Nothing matches." : "No transactions."}</div>}
        {sorted.length > shown.length && <div className="mw-list mw-gap"><button className="mw-row mw-showall" onClick={() => setLimit(l => l + 100)}>Show more ({sorted.length - shown.length} left)</button></div>}
        <div className="mw-list mw-gap"><button className="mw-row mw-showall" onClick={() => setLegacy(true)}>Filters, split and bulk actions</button></div>
        {detailSheet}{modal}
      </div>
    );
  }

  return (
    <div className={`mw${props.dark ? " dark" : ""}`}>
      <div className="mw-hdr">
        <h1>Transactions</h1>
        <button className="mw-round" onClick={() => { setFull(true); setTimeout(() => document.getElementById("m-tx-search")?.focus(), 60); }} aria-label="Search"><Search size={20} strokeWidth={1.8} /></button>
        <button className="mw-round" onClick={() => setTxModal({ open: true, mode: "add", entry: null })} aria-label="Add transaction"><Plus size={22} strokeWidth={1.8} /></button>
      </div>

      <div className="mw-seg" role="tablist">
        <button role="tab" aria-selected={view === "history"} className={view === "history" ? "on" : ""} onClick={() => setView("history")}>History</button>
        <button role="tab" aria-selected={view === "inbox"} className={view === "inbox" ? "on" : ""} onClick={() => setView("inbox")}>Inbox{pendingCount ? <em>{pendingCount}</em> : null}</button>
      </div>

      {view === "inbox" ? (
        <>
          <Email {...props} mobile embedded initialTab="pending" />
        </>
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
                  return (
                    <button key={e.id} className="mw-row mw-tx" onClick={() => setDetail(e)}>
                      <span className="mw-row-name">{e.description || e.merchant_name || e.tx_type}</span>
                      <Amt e={e} value={amt(e)} />
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

      {detailSheet}{modal}
    </div>
  );
}

export function Donut({ cats, total, label }) {
  const R = 54; const C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="mw-donut">
      <svg viewBox="0 0 140 140" aria-hidden="true">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--sunk)" strokeWidth="14" />
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
        <div className="mw-tile-n"><Amt e={e} value={amt(e)} /></div>
        <div className="mw-list mw-gap mw-list-sunk">
          {rowsOut.map(([k, v]) => <div key={k} className="mw-row mw-kv"><span className="mw-row-name">{k}</span><span className="mw-row-amt mw-wrap">{v}</span></div>)}
        </div>
        <button className="mw-btn" onClick={onEdit}>Edit</button>
      </div>
    </div>
  );
}
