// Mobile Home (phones only): the opening screen, with Assets and Net Worth as its tabs.
// Every figure is one the other screens already compute (calcNetWorth, buildBills,
// piutang.js, the ledger); the charts only draw them.
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { fmtIDR } from "../../utils";
import { hitungPiutang } from "../../lib/piutang";
import { buildBills } from "../Billing";
import { nameInstalments } from "./names";
import MobileAssets from "./MobileAssets";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const isExpense = e => (e.tx_type === "expense" || e.tx_type === "pay_liability") && !e.is_reimburse;
const isAuto = i => /^[il]/.test(String(i.id));
const amt = e => Number(e.amount_idr || e.amount || 0);
const ymOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const LIQUID = /^(stocks?|mutual fund|deposit|deposito)$/i;

export default function MobileHome(props) {
  const { ledger = [], accounts = [], creditCards = [], liabilities = [], recurTemplates = [], installments = [], pendingSyncs = [], netWorth = {}, fxRates = {}, assets = [], dark, setTab, onSearch } = props;
  const [view, setView] = useState(() => lsGet("m.home.view") || "home");
  useEffect(() => { lsSet("m.home.view", view); }, [view]);
  const now = new Date(); const month = ymOf(now);
  const go = (tab, key, val) => { if (key) lsSet(key, val); setTab(tab); };

  // ── This month against last month, day by day (cumulative spending) ──
  const pace = useMemo(() => {
    const prev = ymOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const cur = Array(days).fill(0), old = Array(days).fill(0);
    ledger.forEach(e => {
      if (!isExpense(e)) return; const m = String(e.tx_date || "").slice(0, 7); const d = Number(String(e.tx_date).slice(8, 10)) - 1;
      if (m === month && d < days) cur[d] += amt(e); else if (m === prev) old[Math.min(d, days - 1)] += amt(e);
    });
    const cum = a => a.reduce((r, v, i) => { r.push((r[i - 1] || 0) + v); return r; }, []);
    const today = now.getDate();
    return { cur: cum(cur).slice(0, today), old: cum(old), days, today, prevName: MONTHS[(now.getMonth() + 11) % 12] };
  }, [ledger, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const spent = pace.cur[pace.cur.length - 1] || 0;
  const lastAtToday = pace.old[pace.today - 1] || 0;

  // ── Six months of money in and out ──
  const flow = useMemo(() => {
    const out = [];
    for (let k = 5; k >= 0; k--) { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); out.push({ m: ymOf(d), label: MONTHS[d.getMonth()], spent: 0, got: 0 }); }
    const at = Object.fromEntries(out.map(o => [o.m, o]));
    ledger.forEach(e => { const o = at[String(e.tx_date || "").slice(0, 7)]; if (!o) return; if (isExpense(e)) o.spent += amt(e); else if (e.tx_type === "income") o.got += amt(e); });
    return out;
  }, [ledger, month]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Top categories this month ──
  const cats = useMemo(() => {
    const m = {};
    ledger.forEach(e => { if (String(e.tx_date || "").slice(0, 7) !== month || !isExpense(e)) return; const k = e.category_name || (e.tx_type === "pay_liability" ? "Loan repayment" : "Uncategorized"); m[k] = (m[k] || 0) + amt(e); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [ledger, month]);

  // ── What the net worth is made of ──
  const mix = useMemo(() => {
    let liquidAssets = 0, fixedAssets = 0;
    assets.filter(a => a.is_active !== false).forEach(a => { const v = Number(a.current_value || a.current_balance || 0) * (a.currency && a.currency !== "IDR" ? (fxRates[a.currency] || 1) : 1); if (LIQUID.test(String(a.subtype || "").trim())) liquidAssets += v; else fixedAssets += v; });
    const liquid = Math.max(0, (netWorth.bank || 0) + (netWorth.cash || 0) + liquidAssets);
    const fixed = Math.max(0, fixedAssets + (netWorth.receivables || 0) + (netWorth.employeeLoanTotal || 0));
    const debt = (netWorth.ccDebt || 0) + (netWorth.liabilities || 0);
    return [["Liquid", liquid, "var(--accent)"], ["Non-liquid", fixed, "var(--ink)"], ["Liabilities", debt, "var(--hot)"]];
  }, [assets, netWorth, fxRates]);

  // ── Cards: used against the limit (a shared limit is counted once) ──
  const cards = useMemo(() => {
    const seen = new Set(); let limit = 0, used = 0;
    creditCards.filter(c => c.is_active !== false).forEach(c => {
      used += Number(c.outstanding_amount || 0);
      const g = c.shared_limit_group_id;
      if (g) { if (seen.has(g)) return; seen.add(g); limit += Number(creditCards.find(x => x.shared_limit_group_id === g && x.is_limit_group_master)?.shared_limit || c.shared_limit || c.card_limit || 0); }
      else limit += Number(c.card_limit || 0);
    });
    return { limit, used };
  }, [creditCards]);

  const bills = useMemo(() => { const b = buildBills({ ledger, creditCards, liabilities, recurTemplates, installments }); return { ...b, cicilan: nameInstalments(b.cicilan, ledger, installments) }; }, [ledger, creditCards, liabilities, recurTemplates, installments]);
  const week = useMemo(() => [...bills.cards, ...bills.cicilan, ...bills.rutinManual, ...bills.subs].filter(i => i.dayLeft <= 7 && !(isAuto(i) && i.dayLeft < 0)).sort((a, b) => a.when - b.when), [bills]);
  const weekSum = week.filter(i => i.known).reduce((s, i) => s + i.amount, 0);
  const owed = useMemo(() => hitungPiutang(ledger).saldoTotal, [ledger]);
  const inbox = pendingSyncs.filter(x => !x.currency || x.currency === "IDR").length;
  const expiring = accounts.filter(a => a.type === "credit_card" && Number(a.points_expiring) > 0 && a.points_expiry_date)
    .map(a => ({ a, days: Math.round((new Date(`${a.points_expiry_date}T00:00:00`) - new Date()) / 86400000) }))
    .filter(x => x.days >= 0 && x.days <= 45).sort((x, y) => x.days - y.days);

  return (
    <div className={`mw${dark ? " dark" : ""}`}>
      <div className="mw-hdr">
        <h1>Home</h1>
        {onSearch && <button className="mw-round" onClick={onSearch} aria-label="Search"><Search size={20} strokeWidth={1.8} /></button>}
      </div>
      <div className="mw-seg" role="tablist">
        {[["home", "Home"], ["assets", "Assets"], ["networth", "Net Worth"]].map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? "on" : ""} onClick={() => setView(id)}>{label}</button>)}
      </div>

      {view !== "home" ? <MobileAssets {...props} bare view={view} /> : (
        <>
          <button className="mw-tile mw-tap" onClick={() => setView("networth")}>
            <div className="mw-tile-l">Net worth</div>
            <div className="mw-tile-n">{fmtIDR(netWorth.total, false, true)}</div>
            <MixBar parts={mix} />
          </button>

          <button className="mw-tile mw-tap" onClick={() => go("transactions", "m.tx.view", "history")}>
            <div className="mw-tile-l">Spent in {MONTHS[now.getMonth()]}</div>
            <div className="mw-tile-n">{fmtIDR(spent)}</div>
            <Pace pace={pace} />
            <div className="mw-legend"><span><i style={{ background: "var(--accent)" }} />{MONTHS[now.getMonth()]}</span><span><i style={{ background: "var(--faint)" }} />{pace.prevName} · {fmtIDR(lastAtToday)} by day {pace.today}</span></div>
          </button>

          {cats.length > 0 && (
            <button className="mw-tile mw-tap" onClick={() => go("transactions", "m.tx.view", "history")}>
              <div className="mw-tile-l">Where it went</div>
              <div className="mw-hbars">
                {cats.map(([name, v]) => (
                  <div key={name} className="mw-hbar"><div className="mw-hbar-top"><span>{name}</span><b>{fmtIDR(v)}</b></div><div className="mw-hbar-track"><i style={{ width: `${Math.max(2, (v / cats[0][1]) * 100)}%` }} /></div></div>
                ))}
              </div>
            </button>
          )}

          <div className="mw-tiles">
            <button className="mw-tile mw-tap" onClick={() => go("cards", "m.wallet.seg", "credit")}>
              <div className="mw-tile-l">Cards</div>
              <Ring value={cards.used} max={cards.limit} />
              <div className="mw-tile-s">{fmtIDR(cards.used)} used</div>
            </button>
            <button className="mw-tile mw-tap" onClick={() => go("transactions", "m.tx.view", "inbox")}>
              <div className="mw-tile-l">Inbox</div>
              <div className="mw-big">{inbox}</div>
              <div className="mw-tile-s">{inbox ? "waiting for approval" : "all approved"}</div>
            </button>
          </div>

          <div className="mw-tile">
            <div className="mw-tile-l">Six months</div>
            <Flow rows={flow} />
            <div className="mw-legend"><span><i style={{ background: "var(--ink)" }} />Spent</span><span><i style={{ background: "var(--good)" }} />Received</span></div>
          </div>

          <div className="mw-label mw-label-row"><span>Due this week</span>{week.length > 0 && <b>{fmtIDR(weekSum)}</b>}</div>
          <div className="mw-list">
            {week.slice(0, 5).map(i => (
              <button key={i.id} className="mw-row mw-tx" onClick={() => go("billing", "m.bills.view", "bills")}>
                <span className="mw-row-name">{i.name}<small className={i.dayLeft <= 3 ? "hot" : ""}>{i.when.getDate()} {MONTHS[i.when.getMonth()]} · {i.dayLeft < 0 ? `${-i.dayLeft}d late` : i.dayLeft === 0 ? "today" : `${i.dayLeft}d`}</small></span>
                <span className="mw-row-amt">{i.known ? fmtIDR(i.amount) : "—"}</span>
              </button>
            ))}
            {!week.length && <div className="mw-row"><span className="mw-row-name" style={{ color: "var(--muted)" }}>Nothing due in the next 7 days</span></div>}
            <button className="mw-row mw-showall" onClick={() => go("billing", "m.bills.view", "bills")}>{week.length > 5 ? `All ${week.length} bills` : "Bills"}</button>
          </div>

          <div className="mw-list mw-gap">
            <button className="mw-row" onClick={() => go("billing", "m.bills.view", "reimburse")}>
              <span className="mw-row-name">Owed to you</span><span className="mw-row-amt">{fmtIDR(owed, false, true)}</span><ChevronRight size={16} className="mw-chev" />
            </button>
            {expiring.map(({ a }) => (
              <button key={a.id} className="mw-row" onClick={() => go("cards", "m.wallet.seg", "credit")}>
                <span className="mw-row-name">{a.name} points expiring<small>{`${new Date(`${a.points_expiry_date}T00:00:00`).getDate()} ${MONTHS[new Date(`${a.points_expiry_date}T00:00:00`).getMonth()]}`}</small></span>
                <span className="mw-row-amt hot">{Number(a.points_expiring).toLocaleString("id-ID")}</span><ChevronRight size={16} className="mw-chev" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Assets and what is owed, to one scale: the bar is everything owned, the red part what is owed against it.
function MixBar({ parts }) {
  const owned = parts[0][1] + parts[1][1]; if (!owned) return null;
  return (
    <>
      <div className="mw-mix">{parts.slice(0, 2).map(([k, v, c]) => <i key={k} style={{ width: `${(v / owned) * 100}%`, background: c }} />)}</div>
      <div className="mw-mix mw-mix-thin"><i style={{ width: `${Math.min(100, (parts[2][1] / owned) * 100)}%`, background: parts[2][2] }} /></div>
      <div className="mw-legend">{parts.map(([k, , c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}</div>
    </>
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

function Ring({ value, max }) {
  const R = 30, C = 2 * Math.PI * R; const f = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <svg className="mw-ring" viewBox="0 0 76 76" role="img" aria-label="Card limit used">
      <circle cx="38" cy="38" r={R} fill="none" stroke="var(--sunk)" strokeWidth="9" />
      <circle cx="38" cy="38" r={R} fill="none" stroke="var(--ink)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${f * C} ${C}`} transform="rotate(-90 38 38)" />
    </svg>
  );
}

// Paired bars per month, one scale for both series; month labels under each pair.
function Flow({ rows }) {
  const W = 320, H = 110, B = 18, top = Math.max(1, ...rows.flatMap(r => [r.spent, r.got])); const slot = W / rows.length; const bw = Math.min(16, slot / 3.2);
  const h = v => (v / top) * (H - B - 6);
  return (
    <svg className="mw-trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spent and received, last six months">
      {rows.map((r, i) => {
        const cx = slot * i + slot / 2;
        return (
          <g key={r.m}>
            <rect x={cx - bw - 1.5} y={H - B - h(r.spent)} width={bw} height={Math.max(1, h(r.spent))} rx="3" fill="var(--ink)" />
            <rect x={cx + 1.5} y={H - B - h(r.got)} width={bw} height={Math.max(1, h(r.got))} rx="3" fill="var(--good)" />
            <text x={cx} y={H - 4} textAnchor="middle" fontSize="10.5" fill="var(--faint)">{r.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
