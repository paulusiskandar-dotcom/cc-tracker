// Mobile Home (phones only): the opening screen. Every figure is one the other screens
// already compute (calcNetWorth, buildBills, piutang.js); each block opens its own tab.
import { useMemo } from "react";
import { ChevronRight, Search } from "lucide-react";
import { fmtIDR } from "../../utils";
import { hitungPiutang } from "../../lib/piutang";
import { buildBills } from "../Billing";
import { nameInstalments } from "./names";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const isExpense = e => (e.tx_type === "expense" || e.tx_type === "pay_liability") && !e.is_reimburse;
const isAuto = i => /^[il]/.test(String(i.id));

export default function MobileHome({ ledger = [], accounts = [], creditCards = [], liabilities = [], recurTemplates = [], installments = [], pendingSyncs = [], netWorth = {}, dark, setTab, onSearch }) {
  const month = new Date().toISOString().slice(0, 7);
  const spent = useMemo(() => ledger.filter(e => String(e.tx_date || "").slice(0, 7) === month && isExpense(e)).reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0), [ledger, month]);
  const received = useMemo(() => ledger.filter(e => String(e.tx_date || "").slice(0, 7) === month && e.tx_type === "income").reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0), [ledger, month]);
  const bills = useMemo(() => { const b = buildBills({ ledger, creditCards, liabilities, recurTemplates, installments }); return { ...b, cicilan: nameInstalments(b.cicilan, ledger, installments) }; }, [ledger, creditCards, liabilities, recurTemplates, installments]);
  const week = useMemo(() => [...bills.cards, ...bills.cicilan, ...bills.rutinManual, ...bills.subs].filter(i => i.dayLeft <= 7 && !(isAuto(i) && i.dayLeft < 0)).sort((a, b) => a.when - b.when), [bills]);
  const weekSum = week.filter(i => i.known).reduce((s, i) => s + i.amount, 0);
  const owed = useMemo(() => hitungPiutang(ledger).saldoTotal, [ledger]);
  const inbox = pendingSyncs.filter(x => !x.currency || x.currency === "IDR").length;
  const expiring = accounts.filter(a => a.type === "credit_card" && Number(a.points_expiring) > 0 && a.points_expiry_date)
    .map(a => ({ a, days: Math.round((new Date(`${a.points_expiry_date}T00:00:00`) - new Date()) / 86400000) }))
    .filter(x => x.days >= 0 && x.days <= 45).sort((x, y) => x.days - y.days);
  const go = (tab, key, val) => { if (key) lsSet(key, val); setTab(tab); };
  const now = new Date();

  return (
    <div className={`mw${dark ? " dark" : ""}`}>
      <div className="mw-hdr">
        <h1>Home</h1>
        {onSearch && <button className="mw-round" onClick={onSearch} aria-label="Search"><Search size={20} strokeWidth={1.8} /></button>}
      </div>

      <button className="mw-tile mw-tap" onClick={() => go("assets", "m.assets.view", "networth")}>
        <div className="mw-tile-l">Net worth</div>
        <div className="mw-tile-n">{fmtIDR(netWorth.total, false, true)}</div>
      </button>

      <div className="mw-tiles">
        <button className="mw-tile mw-tap" onClick={() => go("transactions", "m.tx.view", "history")}>
          <div className="mw-tile-l">Spent in {MONTHS[now.getMonth()]}</div>
          <div className="mw-tile-m mw-fit">{fmtIDR(spent)}</div>
          <div className="mw-tile-s">Received {fmtIDR(received)}</div>
        </button>
        <button className="mw-tile mw-tap" onClick={() => go("transactions", "m.tx.view", "inbox")}>
          <div className="mw-tile-l">Inbox</div>
          <div className="mw-tile-m">{inbox}</div>
          <div className="mw-tile-s">{inbox ? "waiting for approval" : "all approved"}</div>
        </button>
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
    </div>
  );
}
