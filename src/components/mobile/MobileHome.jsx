// Mobile Home (phones only): the opening screen. Three things, in order:
//   1. where I stand  — net worth, and what it is made of (tap a row to open it)
//   2. this month     — spending so far against last month, one chart
//   3. what needs me  — approvals, bills due within 7 days, money owed, points about to expire
// Every figure is one another screen already computes; nothing is recalculated differently here.
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtIDR } from "../../utils";
import { hitungPiutang } from "../../lib/piutang";
import { buildBills } from "../Billing";
import { makeSpending } from "../../lib/spending";
import MobileAssets, { Trend } from "./MobileAssets";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const ymOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const LIQUID = /^(stocks?|mutual fund|deposit|deposito)$/i;
const signed = v => `${v < 0 ? "−" : ""}${fmtIDR(Math.abs(v))}`;

export default function MobileHome(props) {
  const { spendOf } = useMemo(() => makeSpending(props.incomeSrcs || []), [props.incomeSrcs]);
  const { user, reconSessions = [], ledger = [], accounts = [], creditCards = [], liabilities = [], recurTemplates = [], installments = [], pendingSyncs = [], netWorth = {}, fxRates = {}, assets = [], dark, setTab, onSearch } = props;
  const [view, setView] = useState(() => lsGet("m.home.view") === "assets" ? "assets" : "overview");
  useEffect(() => { lsSet("m.home.view", view); }, [view]);
  const [openGroup, setOpenGroup] = useState(null);
  const [snaps, setSnaps] = useState([]);
  useEffect(() => { if (user?.id) supabase.from("net_worth_snapshots").select("month,total").order("month").then(({ data }) => setSnaps(data || [])); }, [user?.id]);
  const now = new Date(); const month = ymOf(now);
  const go = (tab, key, val) => { if (key) lsSet(key, val); setTab(tab); };

  // 1 ── what the net worth is made of
  const groups = useMemo(() => {
    const byType = {};
    assets.filter(a => a.is_active !== false).forEach(a => {
      const raw = String(a.subtype || "Other").trim(); const k = raw.toLowerCase();
      const v = Number(a.current_value != null ? a.current_value : (a.current_balance || 0)) * (a.currency && a.currency !== "IDR" ? (fxRates[a.currency] || 1) : 1);
      (byType[k] = byType[k] || [raw.charAt(0).toUpperCase() + raw.slice(1), 0])[1] += v;
    });
    const types = Object.values(byType).sort((a, b) => b[1] - a[1]);
    const keep = l => l.filter(r => Math.round(Number(r[1] || 0)) !== 0);
    const sum = l => l.reduce((t, r) => t + Number(r[1] || 0), 0);
    const liquid = keep([["Bank", netWorth.bank], ["Cash", netWorth.cash], ...types.filter(t => LIQUID.test(t[0]))]);
    const fixed = keep([...types.filter(t => !LIQUID.test(t[0])), ["Receivables", netWorth.receivables], ["Employee loans", netWorth.employeeLoanTotal]]);
    const debts = keep([["Credit cards", -(netWorth.ccDebt || 0)], ["Loans & installments", -(netWorth.liabilities || 0)]]);
    return [["Liquid assets", liquid, "var(--accent)"], ["Non-liquid assets", fixed, "var(--ink)"], ["Liabilities", debts, "var(--hot)"]].map(([n, rows, c]) => ({ name: n, rows, color: c, total: sum(rows) }));
  }, [assets, netWorth, fxRates]);
  const series = [...snaps.filter(p => p.month !== month), { month, total: netWorth.total }].filter(p => Number.isFinite(Number(p.total)));

  // 2 ── this month against last month, day by day (cumulative)
  const pace = useMemo(() => {
    const prev = ymOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const cur = Array(days).fill(0), old = Array(days).fill(0);
    ledger.forEach(e => {
      const v = spendOf(e); if (!v) return; const m = String(e.tx_date || "").slice(0, 7); const d = Number(String(e.tx_date).slice(8, 10)) - 1;
      if (m === month && d < days) cur[d] += v; else if (m === prev) old[Math.min(d, days - 1)] += v;
    });
    const cum = a => a.reduce((r, v, i) => { r.push((r[i - 1] || 0) + v); return r; }, []);
    return { cur: cum(cur).slice(0, now.getDate()), old: cum(old), days, today: now.getDate(), prevName: MONTHS[(now.getMonth() + 11) % 12] };
  }, [ledger, month, spendOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const spent = pace.cur[pace.cur.length - 1] || 0;
  const lastAtToday = pace.old[pace.today - 1] || 0;

  // 3 ── what needs attention
  const week = useMemo(() => {
    const b = buildBills({ ledger, creditCards, liabilities, recurTemplates, installments, reconSessions, actionable: true });
    return [...b.cards, ...b.cicilan, ...b.rutinManual, ...b.subs].filter(i => i.dayLeft <= 7);
  }, [ledger, creditCards, liabilities, recurTemplates, installments, reconSessions]);
  const weekSum = week.filter(i => i.known).reduce((s, i) => s + i.amount, 0);
  const owed = useMemo(() => hitungPiutang(ledger).saldoTotal, [ledger]);
  const inbox = pendingSyncs.filter(x => !x.currency || x.currency === "IDR").length;
  const expiring = accounts.filter(a => a.type === "credit_card" && Number(a.points_expiring) > 0 && a.points_expiry_date)
    .map(a => ({ a, days: Math.round((new Date(`${a.points_expiry_date}T00:00:00`) - new Date()) / 86400000) }))
    .filter(x => x.days >= 0 && x.days <= 45).sort((x, y) => x.days - y.days);
  const needs = [
    inbox > 0 && { key: "inbox", name: "To approve", sub: `${inbox} transaction${inbox === 1 ? "" : "s"} from email`, value: String(inbox), on: () => go("transactions", "m.tx.view", "inbox") },
    week.length > 0 && { key: "bills", name: "Due soon", sub: `${week.length} bill${week.length === 1 ? "" : "s"}`, value: fmtIDR(weekSum), on: () => go("billing", "m.bills.view", "bills") },
    Math.round(owed) !== 0 && { key: "owed", name: "Owed to you", sub: "Reimbursements not yet repaid", value: signed(owed), on: () => go("billing", "m.bills.view", "reimburse") },
    ...expiring.map(({ a }) => ({ key: a.id, name: `${a.name} points expire`, sub: `${new Date(`${a.points_expiry_date}T00:00:00`).getDate()} ${MONTHS[new Date(`${a.points_expiry_date}T00:00:00`).getMonth()]}`, value: Number(a.points_expiring).toLocaleString("id-ID"), hot: true, on: () => go("cards", "m.wallet.seg", "credit") })),
  ].filter(Boolean);

  return (
    <div className={`mw${dark ? " dark" : ""}`}>
      <div className="mw-hdr">
        <h1>Home</h1>
        {/* Small switch at the right of the title: the overview, or the assets behind the net worth. */}
        <div className="mw-seg mw-seg-hdr" role="tablist">
          <button role="tab" aria-selected={view === "overview"} className={view === "overview" ? "on" : ""} onClick={() => setView("overview")}>Overview</button>
          <button role="tab" aria-selected={view === "assets"} className={view === "assets" ? "on" : ""} onClick={() => setView("assets")}>Assets</button>
        </div>
        {onSearch && <button className="mw-round" onClick={onSearch} aria-label="Search"><Search size={20} strokeWidth={1.8} /></button>}
      </div>
      {view === "assets" && <MobileAssets {...props} bare view="assets" />}
      {view === "overview" && <>

      <div className="mw-tile mw-hero">
        <div className="mw-tile-l">Net worth</div>
        <div className="mw-hero-n">{signed(Number(netWorth.total || 0))}</div>
        {series.length >= 2 && <Trend series={series} />}
      </div>
      <div className="mw-list mw-gap">
        {groups.map(g => g.rows.length > 0 && (
          <div key={g.name}>
            <button className="mw-row" onClick={() => setOpenGroup(openGroup === g.name ? null : g.name)} aria-expanded={openGroup === g.name}>
              <i className="mw-dot" style={{ background: g.color }} />
              <span className="mw-row-name">{g.name}</span>
              <span className="mw-row-amt">{signed(g.total)}</span>
              <ChevronDown size={16} className="mw-chev" style={{ transform: openGroup === g.name ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            </button>
            {openGroup === g.name && <div className="mw-sub">{g.rows.map(([k, v]) => <div key={k} className="mw-row mw-tx"><span className="mw-row-name">{k}</span><span className={`mw-row-amt${v < 0 && g.name !== "Liabilities" ? " hot" : ""}`}>{signed(v)}</span></div>)}</div>}
          </div>
        ))}
      </div>

      <button className="mw-tile mw-tap mw-gap" onClick={() => go("transactions", "m.tx.view", "history")}>
        <div className="mw-tile-l">Spent in {MONTHS[now.getMonth()]}</div>
        <div className="mw-tile-n">{fmtIDR(spent)}</div>
        <Pace pace={pace} />
        <div className="mw-legend"><span><i style={{ background: "var(--accent)" }} />{MONTHS[now.getMonth()]}</span><span><i style={{ background: "var(--faint)" }} />{pace.prevName} · {fmtIDR(lastAtToday)} by day {pace.today}</span></div>
      </button>

      {needs.length > 0 && (
        <>
          <div className="mw-label">Needs you</div>
          <div className="mw-list">
            {needs.map(n => (
              <button key={n.key} className="mw-row mw-tx" onClick={n.on}>
                <span className="mw-row-name">{n.name}<small>{n.sub}</small></span>
                <span className={`mw-row-amt${n.hot ? " hot" : ""}`}>{n.value}</span>
                <ChevronRight size={16} className="mw-chev" />
              </button>
            ))}
          </div>
        </>
      )}
      </>}
    </div>
  );
}

// Cumulative spending: this month (to today) over the whole of last month, one y scale.
function Pace({ pace }) {
  const W = 320, H = 96, P = 4; const top = Math.max(pace.old[pace.old.length - 1] || 0, pace.cur[pace.cur.length - 1] || 0, 1);
  const x = i => P + (i * (W - 2 * P)) / Math.max(1, pace.days - 1); const y = v => H - P - (v / top) * (H - 2 * P);
  const path = a => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = pace.cur.length - 1;
  return (
    <svg className="mw-trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spending this month against last month">
      <path d={path(pace.old)} fill="none" stroke="var(--faint)" strokeWidth="1.8" strokeDasharray="3 4" strokeLinecap="round" />
      {last >= 0 && <path d={`${path(pace.cur)} L${x(last)} ${H - P} L${x(0)} ${H - P} Z`} fill="var(--accent)" opacity="0.12" />}
      {last >= 0 && <path d={path(pace.cur)} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />}
      {last >= 0 && <circle cx={x(last)} cy={y(pace.cur[last])} r="4" fill="var(--accent)" />}
    </svg>
  );
}
