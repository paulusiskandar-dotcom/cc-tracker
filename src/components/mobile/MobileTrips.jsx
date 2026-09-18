// Mobile Trips (phones only): each trip tag, what it has cost, and where it went.
// A trip is a tag of type "trip"; its rows are the ledger rows carrying that tag.
// Spending = expense rows and money fronted for others is left out (reimburse), same as Home.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { tagsApi } from "../../api";
import { fmtIDR } from "../../utils";
import Amt from "./Amt";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = s => { if (!s) return ""; const d = new Date(`${String(s).slice(0, 10)}T00:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const isSpend = e => (e.tx_type === "expense" || e.tx_type === "pay_liability") && !e.is_reimburse;
const amt = e => Number(e.amount_idr || e.amount || 0);

export default function MobileTrips({ user, ledger = [], categories = [], dark }) {
  const [tags, setTags] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [openCat, setOpenCat] = useState(null);
  useEffect(() => { if (user?.id) tagsApi.list(user.id, {}).then(t => setTags(t || [])).catch(() => setTags([])); }, [user?.id]);
  const catName = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c.name])), [categories]);

  const trips = useMemo(() => (tags || []).map(t => {
    const rows = ledger.filter(e => e.tag_id === t.id);
    return { ...t, rows, spent: rows.filter(isSpend).reduce((s, e) => s + amt(e), 0) };
  }).filter(t => t.type === "trip" || t.rows.length > 0)
    .sort((a, b) => String(b.start_date || b.created_at || "").localeCompare(String(a.start_date || a.created_at || ""))), [tags, ledger]);

  const trip = openId && trips.find(t => t.id === openId);
  if (trip) {
    const m = {};
    trip.rows.filter(isSpend).forEach(e => { const k = e.category_name || catName[e.category_id] || "Uncategorized"; (m[k] = m[k] || { name: k, total: 0, items: [] }); m[k].total += amt(e); m[k].items.push(e); });
    const cats = Object.values(m).sort((a, b) => b.total - a.total);
    const other = trip.rows.filter(e => !isSpend(e)).sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date)));
    return (
      <div className={`mw${dark ? " dark" : ""}`}>
        <div className="mw-hdr"><button className="mw-round" onClick={() => { setOpenId(null); setOpenCat(null); }} aria-label="Back"><ChevronLeft size={22} strokeWidth={1.8} /></button><h2>{trip.name}</h2></div>
        <div className="mw-tile">
          <div className="mw-tile-l">Spent</div>
          <div className="mw-tile-n">{fmtIDR(trip.spent)}</div>
          {(trip.start_date || trip.end_date) && <div className="mw-tile-s">{fmtDate(trip.start_date)}{trip.end_date ? ` – ${fmtDate(trip.end_date)}` : ""}</div>}
        </div>
        {cats.length > 0 && (
          <div className="mw-list mw-gap">
            {cats.map(c => (
              <div key={c.name}>
                <button className="mw-row" onClick={() => setOpenCat(openCat === c.name ? null : c.name)} aria-expanded={openCat === c.name}>
                  <span className="mw-row-name">{c.name}</span><span className="mw-row-amt">{fmtIDR(c.total)}</span>
                </button>
                {openCat === c.name && <div className="mw-sub">{c.items.sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date))).map(e => (
                  <div key={e.id} className="mw-row mw-tx"><span className="mw-row-name">{e.notes && !/^imported from/i.test(e.notes) ? e.notes : (e.description || e.merchant_name)}<small>{fmtDate(e.tx_date)}</small></span><span className="mw-row-amt">{fmtIDR(amt(e))}</span></div>
                ))}</div>}
              </div>
            ))}
          </div>
        )}
        {other.length > 0 && (
          <>
            <div className="mw-label">Not counted as spending</div>
            <div className="mw-list">{other.map(e => <div key={e.id} className="mw-row mw-tx"><span className="mw-row-name">{e.description || e.merchant_name || e.tx_type}<small>{fmtDate(e.tx_date)}</small></span><Amt e={e} /></div>)}</div>
          </>
        )}
        {!trip.rows.length && <div className="mw-empty">No transactions tagged with this trip yet.</div>}
      </div>
    );
  }

  return (
    <div className={`mw${dark ? " dark" : ""}`}>
      <div className="mw-hdr"><h1>Trips</h1></div>
      <div className="mw-list">
        {trips.map(t => (
          <button key={t.id} className="mw-row mw-tx" onClick={() => setOpenId(t.id)}>
            <span className="mw-row-name">{t.name}<small>{t.rows.length} transaction{t.rows.length === 1 ? "" : "s"}{t.status && t.status !== "active" ? ` · ${t.status}` : ""}</small></span>
            <span className="mw-row-amt">{fmtIDR(t.spent)}</span>
          </button>
        ))}
        {tags && !trips.length && <div className="mw-row"><span className="mw-row-name" style={{ color: "var(--muted)" }}>No trips yet</span></div>}
      </div>
    </div>
  );
}
