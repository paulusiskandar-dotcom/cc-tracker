// Mobile Assets (phones only): Assets · Net Worth. Net worth is the app's own
// calcNetWorth() result passed down from App, not recomputed here.
import { useEffect, useMemo, useState } from "react";
import LegacyFrame from "./LegacyFrame";
import { ChevronLeft, ChevronDown, X } from "lucide-react";
import { updateAssetValue } from "../../lib/assetValue";
import { supabase } from "../../lib/supabase";
import { fmtIDR } from "../../utils";
import Assets from "../Assets";
import { Donut } from "./MobileTransactions";
import "./mobile.css";

const COLORS = ["var(--ink)", "#3b5bdb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#9ca3af"];

export default function MobileAssets(props) {
  // `bare` + `view`: rendered inside Home, which owns the header and the tabs.
  const { user, assets = [], netWorth = {}, fxRates = {}, bare = false, view: forcedView } = props;
  const [snaps, setSnaps] = useState([]);
  const [openNw, setOpenNw] = useState(null);
  const view = forcedView || "assets"; // net worth and its make-up now live on Home
  const [full, setFull] = useState(false);
  const [openGroup, setOpenGroup] = useState(null);
  const [editing, setEditing] = useState(null);
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("net_worth_snapshots").select("month,total").order("month").then(({ data }) => setSnaps(data || []));
  }, [user?.id]);

  const value = a => Number(a.current_value != null ? a.current_value : (a.current_balance || 0)) * (a.currency && a.currency !== "IDR" ? (fxRates[a.currency] || 1) : 1);
  const groups = useMemo(() => {
    const m = {};
    assets.filter(a => a.is_active !== false).forEach(a => { const raw = String(a.subtype || "Other").trim(); const k = raw.toLowerCase(); // "deposit" and "Deposit" are one group
      (m[k] = m[k] || { name: raw.charAt(0).toUpperCase() + raw.slice(1), total: 0, items: [] }); m[k].total += value(a); m[k].items.push(a); });
    return Object.values(m).sort((a, b) => b.total - a.total).map((g, i) => ({ ...g, color: COLORS[Math.min(i, COLORS.length - 1)], items: g.items.sort((a, b) => value(b) - value(a)) }));
  }, [assets, fxRates]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = groups.reduce((s, g) => s + g.total, 0);

  if (full) {
    return (
      <div className={bare ? undefined : `mw${props.dark ? " dark" : ""}`}>
        <div className="mw-hdr">
          <button className="mw-round" onClick={() => setFull(false)} aria-label="Back"><ChevronLeft size={22} strokeWidth={1.8} /></button>
          <h2>Manage assets</h2>
        </div>
        <LegacyFrame><Assets {...props} /></LegacyFrame>
      </div>
    );
  }

  // Liquid = can be turned into cash within days. The split is by asset type:
  const LIQUID = /^(stocks?|mutual fund|deposit|deposito)$/i;
  const liquidAssets = groups.filter(g => LIQUID.test(g.name));
  const fixedAssets = groups.filter(g => !LIQUID.test(g.name));
  const sum = l => l.reduce((t, r) => t + Number(r[1] || 0), 0);
  const keep = l => l.filter(r => Math.round(Number(r[1] || 0)) !== 0);
  const liquid = keep([["Bank", netWorth.bank], ["Cash", netWorth.cash], ...liquidAssets.map(g => [g.name, g.total])]);
  const fixed = keep([...fixedAssets.map(g => [g.name, g.total]), ["Receivables", netWorth.receivables], ["Employee loans", netWorth.employeeLoanTotal]]);
  const debts = keep([["Credit cards", -(netWorth.ccDebt || 0)], ["Loans & installments", -(netWorth.liabilities || 0)]]);
  const nwGroups = [["Liquid assets", liquid], ["Non-liquid assets", fixed], ["Liabilities", debts]];
  // The stored row for this month can lag the live figure by a few seconds; show the live one.
  const curMonth = new Date().toISOString().slice(0, 7);
  const series = [...snaps.filter(p => p.month !== curMonth), { month: curMonth, total: netWorth.total }].filter(p => Number.isFinite(Number(p.total)));

  return (
    <div className={bare ? undefined : `mw${props.dark ? " dark" : ""}`}>
      {!bare && <div className="mw-hdr"><h1>Assets</h1></div>}

      {view === "assets" ? (
        <>
          <Donut cats={groups} total={total} label="Total" />
          <div className="mw-list">
            {groups.map(g => (
              <div key={g.name}>
                <button className="mw-row" onClick={() => setOpenGroup(openGroup === g.name ? null : g.name)} aria-expanded={openGroup === g.name}>
                  <i className="mw-dot" style={{ background: g.color }} />
                  <span className="mw-row-name">{g.name}</span>
                  <span className="mw-row-amt">{fmtIDR(g.total)}</span>
                </button>
                {openGroup === g.name && (
                  <div className="mw-sub">
                    {g.items.map(a => (
                      <button key={a.id} className="mw-row mw-tx" onClick={() => setEditing(a)}><span className="mw-row-name">{a.name}</span><span className="mw-row-amt">{fmtIDR(value(a))}</span></button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <button className="mw-row mw-showall" onClick={() => setFull(true)}>Manage assets</button>
          </div>
          {editing && <ValueSheet asset={editing} userId={user?.id} onClose={() => setEditing(null)}
            onSaved={v => { props.setAccounts && props.setAccounts(p => p.map(a => (a.id === editing.id ? { ...a, current_value: v } : a))); setEditing(null); props.onRefresh && props.onRefresh(); }} />}
        </>
      ) : (
        <>
          <div className="mw-tile">
            <div className="mw-tile-l">Net worth</div>
            <div className="mw-tile-n">{fmtIDR(netWorth.total, false, true)}</div>
            {series.length >= 2 ? <Trend series={series} /> : <div className="mw-tile-s">The trend starts this month and adds one point per month.</div>}
          </div>
          <div className="mw-list mw-gap">
            {nwGroups.map(([name, rows]) => rows.length > 0 && (
              <div key={name}>
                <button className="mw-row" onClick={() => setOpenNw(openNw === name ? null : name)} aria-expanded={openNw === name}>
                  <span className="mw-row-name">{name}</span>
                  <span className={`mw-row-amt${sum(rows) < 0 ? " hot" : ""}`}>{sum(rows) < 0 ? "−" : ""}{fmtIDR(Math.abs(sum(rows)))}</span>
                  <ChevronDown size={16} className="mw-chev" style={{ transform: openNw === name ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                </button>
                {openNw === name && (
                  <div className="mw-sub">
                    {rows.map(([k, v]) => <div key={k} className="mw-row mw-tx"><span className="mw-row-name">{k}</span><span className={`mw-row-amt${v < 0 ? " hot" : ""}`}>{v < 0 ? "−" : ""}{fmtIDR(Math.abs(v))}</span></div>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Net worth by month. One scale places the line, the area and the month labels.
export function Trend({ series }) {
  const pts = series.slice(-12); const W = 320, H = 130, L = 8, R = 8, T = 10, B = 22;
  const vals = pts.map(p => Number(p.total)); const lo = Math.min(...vals), hi = Math.max(...vals); const span = hi - lo || 1;
  const x = i => L + (i * (W - L - R)) / (pts.length - 1); const y = v => T + (1 - (v - lo) / span) * (H - T - B);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(Number(p.total)).toFixed(1)}`).join(" ");
  const last = pts.length - 1;
  return (
    <svg className="mw-trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Net worth by month">
      <path d={`${line} L${x(last)} ${H - B} L${x(0)} ${H - B} Z`} fill="var(--accent)" opacity="0.12" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(vals[last])} r="4" fill="var(--accent)" />
      {pts.map((p, i) => (pts.length <= 6 || i % 2 === last % 2) && <text key={p.month} x={x(i)} y={H - 5} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} fontSize="10.5" fill="var(--faint)">{MONTHS[Number(p.month.slice(5, 7)) - 1]}</text>)}
    </svg>
  );
}

// Revalue one asset. Same write as the desktop timeline (src/lib/assetValue.js).
function ValueSheet({ asset, userId, onClose, onSaved }) {
  const [val, setVal] = useState(String(Math.round(Number(asset.current_value || 0))));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const foreign = asset.currency && asset.currency !== "IDR";
  const save = async () => {
    const n = Number(String(val).replace(/[^\d.-]/g, ""));
    if (!String(val).trim() || !Number.isFinite(n) || n < 0) { setErr("Enter the new value as a number."); return; }
    setBusy(true); setErr("");
    try { await updateAssetValue({ userId, assetId: asset.id, value: n, notes }); onSaved(n); }
    catch (e) { setErr(`Could not save: ${e.message}`); setBusy(false); }
  };
  return (
    <div className="mw-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mw-modal-card" onClick={ev => ev.stopPropagation()}>
        <div className="mw-hdr"><h2>{asset.name}</h2><button className="mw-round mw-round-sunk" onClick={onClose} aria-label="Close"><X size={20} strokeWidth={1.8} /></button></div>
        <div className="mw-tile-s">{asset.subtype || "Asset"} · now {foreign ? `${asset.currency} ` : ""}{foreign ? Number(asset.current_value || 0).toLocaleString("id-ID") : fmtIDR(asset.current_value)}</div>
        <div className="mw-fields">
          <label htmlFor="av-val">New value{foreign ? ` (${asset.currency})` : ""}<input id="av-val" inputMode="decimal" value={val} onChange={e => setVal(e.target.value)} /></label>
          <label htmlFor="av-notes">Notes<input id="av-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Why it changed" /></label>
        </div>
        {err && <div className="mw-err">{err}</div>}
        <div className="mw-form-act"><button className="mw-btn mw-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="mw-btn" onClick={save} disabled={busy}>{busy ? "Saving" : "Update value"}</button></div>
      </div>
    </div>
  );
}
