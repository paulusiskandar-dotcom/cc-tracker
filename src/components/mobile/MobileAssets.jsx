// Mobile Assets (phones only): Assets · Net Worth. Net worth is the app's own
// calcNetWorth() result passed down from App, not recomputed here.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { fmtIDR } from "../../utils";
import Assets from "../Assets";
import { Donut } from "./MobileTransactions";
import "./mobile.css";

const COLORS = ["#111827", "#3b5bdb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#9ca3af"];
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export default function MobileAssets(props) {
  const { assets = [], netWorth = {}, fxRates = {} } = props;
  const [view, setView] = useState(() => lsGet("m.assets.view") || "assets");
  const [full, setFull] = useState(false);
  const [openGroup, setOpenGroup] = useState(null);
  useEffect(() => { lsSet("m.assets.view", view); }, [view]);

  const value = a => Number(a.current_value || a.current_balance || 0) * (a.currency && a.currency !== "IDR" ? (fxRates[a.currency] || 1) : 1);
  const groups = useMemo(() => {
    const m = {};
    assets.filter(a => a.is_active !== false).forEach(a => { const k = a.subtype || "Other"; (m[k] = m[k] || { name: k, total: 0, items: [] }); m[k].total += value(a); m[k].items.push(a); });
    return Object.values(m).sort((a, b) => b.total - a.total).map((g, i) => ({ ...g, color: COLORS[Math.min(i, COLORS.length - 1)], items: g.items.sort((a, b) => value(b) - value(a)) }));
  }, [assets, fxRates]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = groups.reduce((s, g) => s + g.total, 0);

  if (full) {
    return (
      <div className="mw">
        <div className="mw-hdr">
          <button className="mw-round" onClick={() => setFull(false)} aria-label="Back"><ChevronLeft size={22} strokeWidth={1.8} /></button>
          <h2>Manage assets</h2>
        </div>
        <div className="mw-legacy"><Assets {...props} /></div>
      </div>
    );
  }

  const nw = [
    ["Bank", netWorth.bank], ["Cash", netWorth.cash], ["Assets", netWorth.assets],
    ["Receivables", netWorth.receivables], ["Employee loans", netWorth.employeeLoanTotal],
    ["Credit cards", -(netWorth.ccDebt || 0)], ["Loans & installments", -(netWorth.liabilities || 0)],
  ].filter(r => Math.round(Number(r[1] || 0)) !== 0);

  return (
    <div className="mw">
      <div className="mw-hdr"><h1>Assets</h1></div>
      <div className="mw-seg" role="tablist">
        <button role="tab" aria-selected={view === "assets"} className={view === "assets" ? "on" : ""} onClick={() => setView("assets")}>Assets</button>
        <button role="tab" aria-selected={view === "networth"} className={view === "networth" ? "on" : ""} onClick={() => setView("networth")}>Net Worth</button>
      </div>

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
                      <div key={a.id} className="mw-row mw-tx"><span className="mw-row-name">{a.name}</span><span className="mw-row-amt">{fmtIDR(value(a))}</span></div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <button className="mw-row mw-showall" onClick={() => setFull(true)}>Manage assets</button>
          </div>
        </>
      ) : (
        <>
          <div className="mw-tile">
            <div className="mw-tile-l">Net worth</div>
            <div className="mw-tile-n">{fmtIDR(netWorth.total, false, true)}</div>
          </div>
          <div className="mw-list mw-gap">
            {nw.map(([k, v]) => (
              <div key={k} className="mw-row"><span className="mw-row-name">{k}</span><span className={`mw-row-amt${v < 0 ? " hot" : ""}`}>{v < 0 ? "−" : ""}{fmtIDR(Math.abs(v))}</span></div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
