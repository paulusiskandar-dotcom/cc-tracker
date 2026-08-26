import { useState, useMemo } from "react";
import { TrendingUp, TrendingDown, Wallet, PiggyBank, Sparkles, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { fmtIDR, mlShort } from "../utils";
import { LIGHT, DARK } from "../theme";
import { SectionHeader, EmptyState } from "./shared/index";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
} from "recharts";

// ─── PERIOD HELPERS ───────────────────────────────────────────

function getDateRange(key) {
  const now = new Date();
  switch (key) {
    case "3_months":
      return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0), label: "Last 3 Months" };
    case "6_months":
      return { from: new Date(now.getFullYear(), now.getMonth() - 5, 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0), label: "Last 6 Months" };
    case "ytd":
      return { from: new Date(now.getFullYear(), 0, 1), to: now, label: "Year to Date" };
    default: // 'this_month' or 'YYYY-MM' drill-in from chart
      if (/^\d{4}-\d{2}$/.test(key)) {
        const [y, m] = key.split("-").map(Number);
        return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0), label: new Date(y, m - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
      }
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0), label: "This Month" };
  }
}

function getPreviousRange({ from, to }) {
  const dur = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - dur - 86400000), to: new Date(from.getTime() - 1) };
}

// Local-date YYYY-MM-DD. NOT toISOString(), which is UTC: at WIB (UTC+7) local
// midnight converts to the PREVIOUS day, so "This Month" leaked the last day of
// the prior month in and dropped the last day of the current month out.
const ymdLocal = (d) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

function filterByRange(ledger, range) {
  const f = ymdLocal(range.from);
  const t = ymdLocal(range.to);
  return ledger.filter(e => e.tx_date >= f && e.tx_date <= t);
}

function sumType(txs, type) {
  return txs.filter(t => t.tx_type === type).reduce((s, t) => s + Number(t.amount_idr || 0), 0);
}

// Expense view = every rupiah that leaves and does not come back:
//   "expense" rows (including Reimbursable Loss) + "pay_liability" rows
//   (loan/leasing installments, e.g. BYD Seal). Excluded on purpose:
//   reimburse_out (comes back at settlement), pay_cc (transfer — card spend is
//   already counted per charge), buy_asset (asset swap), transfers.
//   (Paulus, 2026-08-26: "semua expense masuk termasuk BYD dan reimbursable
//   expense; yang tidak masuk hanya reimburse out")
const isExpenseRow = (t) => t.tx_type === "expense" || t.tx_type === "pay_liability";

// CC refunds/reversals (income rows credited INTO a credit card — annual-fee
// reversals, merchant refunds; flagged _ccRefund by the Reports root) are not
// income: they are expense REDUCTIONS. The original charge sits in expenses,
// so counting the credit as income inflated BOTH totals (net was untouched).
const isIncomeRow = (t) => t.tx_type === "income" && !t._ccRefund;

function sumIncome(txs) {
  return txs.filter(isIncomeRow).reduce((s, t) => s + Number(t.amount_idr || 0), 0);
}

function sumExpense(txs) {
  const gross = txs.filter(isExpenseRow).reduce((s, t) => s + Number(t.amount_idr || 0), 0);
  const refunds = txs.filter(t => t._ccRefund).reduce((s, t) => s + Number(t.amount_idr || 0), 0);
  return gross - refunds;
}

// ── SALARY ATTRIBUTION ────────────────────────────────────────
// Fixed income is paid on two schedules (Paulus, 2026-08-26): the month-end
// batch (template day >= 25) is salary for the FOLLOWING month, while SDC
// (day <= 5) pays the PREVIOUS month on the 1st. Cash-basis monthly income
// therefore sawtooths (every month "drops 70%" until its pre-paid salary is
// counted). Reports re-date those rows to their attributed month — identified
// via the active income templates' match_rules — so a month shows the income
// that belongs to it. tx_date is shifted for grouping; _cashDate keeps the
// real arrival date for display. Everything else stays cash-basis.
export function attributeFixedIncome(ledger, recurTemplates) {
  const tpls = (recurTemplates || []).filter(t =>
    t.tx_type === "income" && t.is_active && t.frequency === "monthly" && t.match_rule);
  if (!tpls.length) return ledger;
  const shift = (ymd, delta) => {
    const [y, m] = ymd.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  return (ledger || []).map(row => {
    if (row.tx_type !== "income" || !row.tx_date) return row;
    const amt = Number(row.amount_idr || row.amount || 0);
    const desc = (row.description || "").toLowerCase();
    const t = tpls.find(tp => {
      const r = tp.match_rule || {};
      const base = Number(r.amount || tp.amount || 0);
      const tol = Number(r.amount_tol || 0) || base * 0.02;
      if (base > 0 && Math.abs(amt - base) > tol) return false;
      const kws = (r.keywords || []).map(k => String(k).toLowerCase());
      if (kws.length && !kws.some(k => desc.includes(k))) return false;
      return true;
    });
    if (!t) return row;
    const day = Number(String(row.tx_date).slice(8, 10));
    const advance = Number(t.day_of_month || 30) >= 25;
    // advance batch landing >=25 belongs to next month; landing early (1-10,
    // e.g. Lieche on the 1st) already sits in its month. Arrears (SDC) landing
    // 1-10 belongs to the previous month.
    let delta = 0;
    if (advance && day >= 25) delta = 1;
    else if (!advance && day <= 10) delta = -1;
    if (!delta) return row;
    const ym2 = shift(String(row.tx_date).slice(0, 10), delta);
    return { ...row, tx_date: `${ym2}-01`, _cashDate: row.tx_date, _attributed: true };
  });
}

function last6Months() {
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (5 - i));
    return ymdLocal(d).slice(0, 7); // local month — toISOString() shifts to UTC
  });
}

// Resolve icon+color from DB category list first, then constants fallback.
// Priority: 1) DB by category_id UUID  2) DB by name  3) constants by label  4) default
function resolveCatMeta(categoryId, categoryName, dbList = [], isIncome = false) {
  const name = categoryName || "";

  // 1. DB match by UUID
  if (categoryId) {
    const hit = dbList.find(c => c.id === categoryId);
    if (hit?.icon) return { icon: hit.icon, color: hit.color || "#9ca3af" };
  }

  // 2. DB match by name (case-insensitive)
  if (name) {
    const lower = name.toLowerCase().trim();
    const hit = dbList.find(c => c.name?.toLowerCase().trim() === lower);
    if (hit?.icon) return { icon: hit.icon, color: hit.color || "#9ca3af" };
  }

  return { icon: null, color: isIncome ? "#059669" : "#9ca3af" };
}

function groupByCategory(txs, type = "expense", dbCategories = []) {
  const map = {};
  const isIncome = type === "income";
  txs.filter(t => (type === "expense" ? isExpenseRow(t) : t.tx_type === type)).forEach(t => {
    const isLoan = t.tx_type === "pay_liability";
    const key  = t.category_id || t.category_name || (isLoan ? "loan_installment" : "other");
    // Resolve the display name from the LIVE category list first — the row-level
    // category_name is denormalized and some import paths leave it NULL, which
    // made properly-categorized rows show up as separate "Other" groups.
    const dbHit = t.category_id ? dbCategories.find(c => c.id === t.category_id) : null;
    const name = dbHit?.name || t.category_name || (isLoan ? "Loan Installments" : "Other");
    if (!map[key]) {
      const meta = resolveCatMeta(t.category_id, name, dbCategories, isIncome);
      map[key] = { id: key, name, ...meta, total: 0, count: 0, txs: [] };
    }
    map[key].total += Number(t.amount_idr || 0);
    map[key].count++;
    map[key].txs.push(t);
  });
  const total = Object.values(map).reduce((s, g) => s + g.total, 0);
  return Object.values(map)
    .map(g => ({ ...g, pct: total > 0 ? (g.total / total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);
}

function groupByMerchant(txs) {
  const map = {};
  txs.filter(t => isExpenseRow(t) && !t.is_reimburse).forEach(t => {
    const key  = (t.merchant_name || t.description || "Unknown").trim();
    if (!key) return;
    if (!map[key]) { map[key] = { name: key, category_name: t.category_name || "", total: 0, count: 0, txs: [] }; }
    map[key].total += Number(t.amount_idr || 0);
    map[key].count++;
    map[key].txs.push(t);
  });
  return Object.values(map).sort((a, b) => b.total - a.total);
}

function groupByIncomeSource(txs, incomeSrcs) {
  const map = {};
  txs.filter(isIncomeRow).forEach(t => {
    const srcId = t.from_id || t.category_id || "unknown";
    const src   = incomeSrcs.find(s => s.id === srcId);
    const name  = src?.name || t.category_name || "Other Income";
    const icon  = null;
    const color = src?.color || "#059669";
    if (!map[srcId]) { map[srcId] = { id: srcId, name, icon, color, total: 0, count: 0, txs: [] }; }
    map[srcId].total += Number(t.amount_idr || 0);
    map[srcId].count++;
    map[srcId].txs.push(t);
  });
  return Object.values(map).sort((a, b) => b.total - a.total);
}

function exportCSV(txs, label = "export") {
  const headers = ["Date", "Type", "Merchant", "Category", "Amount IDR", "Currency", "Notes"];
  const rows = txs.map(t => [
    t.tx_date, t.tx_type,
    (t.merchant_name || t.description || "").replace(/,/g, ";"),
    (t.category_name || "").replace(/,/g, ";"),
    Math.round(t.amount_idr || 0),
    t.currency || "IDR",
    (t.notes || "").replace(/,/g, ";"),
  ]);
  const csv  = [headers, ...rows].map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = `${label}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

const TREND_MONTHS = last6Months();

const PERIOD_PILLS = [
  { key: "this_month", label: "This Month" },
  { key: "3_months",   label: "3M" },
  { key: "6_months",   label: "6M" },
  { key: "ytd",        label: "YTD" },
];

// ─── SHARED SUB-COMPONENTS ────────────────────────────────────

// Last 18 months, newest first, as {key: "YYYY-MM", label: "August 2026"}
function monthOptions() {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 18; i++) {
    out.push({ key: ymdLocal(d).slice(0, 7), label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function PeriodFilter({ period, setPeriod }) {
  const months  = useMemo(monthOptions, []);
  const isMonth = /^\d{4}-\d{2}$/.test(period);
  // Where the stepper stands: the picked month, or the current month as origin.
  const curKey  = isMonth ? period : months[0].key;
  const idx     = months.findIndex(m => m.key === curKey);
  const older   = idx >= 0 && idx < months.length - 1 ? months[idx + 1].key : null;
  const newer   = isMonth && idx > 0 ? months[idx - 1].key : null;

  const stepBtn = (disabled) => ({
    width: 30, height: 30, borderRadius: 20, padding: 0,
    border: "1.5px solid #e5e7eb", background: "#fff",
    color: disabled ? "#d1d5db" : "#6b7280",
    cursor: disabled ? "default" : "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
  });

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
      {PERIOD_PILLS.map(p => {
        const active = period === p.key || (!isMonth && !PERIOD_PILLS.find(x => x.key === period) && p.key === "this_month");
        return (
          <button key={p.key} onClick={() => setPeriod(p.key)} style={{
            height: 30, padding: "0 12px", borderRadius: 20,
            border: `1.5px solid ${active ? "#111827" : "#e5e7eb"}`,
            background: active ? "#111827" : "#fff",
            color: active ? "#fff" : "#6b7280",
            fontSize: 12, fontWeight: active ? 700 : 500,
            cursor: "pointer", fontFamily: "Figtree, sans-serif",
          }}>{p.label}</button>
        );
      })}

      {/* Month picker: chevrons step, dropdown jumps straight to a month */}
      <div style={{ display: "inline-flex", gap: 4, alignItems: "center", marginLeft: 4 }}>
        <button aria-label="Previous month" disabled={!older} onClick={() => older && setPeriod(older)} style={stepBtn(!older)}>
          <ChevronLeft size={15} />
        </button>
        <select
          value={isMonth ? period : ""}
          onChange={e => setPeriod(e.target.value || "this_month")}
          style={{
            height: 30, padding: "0 10px", borderRadius: 20,
            border: `1.5px solid ${isMonth ? "#111827" : "#e5e7eb"}`,
            background: isMonth ? "#111827" : "#fff",
            color: isMonth ? "#fff" : "#6b7280",
            fontSize: 12, fontWeight: isMonth ? 700 : 500,
            cursor: "pointer", fontFamily: "Figtree, sans-serif",
            appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
            textAlign: "center",
          }}
        >
          <option value="">Pick a month</option>
          {months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <button aria-label="Next month" disabled={!newer} onClick={() => newer && setPeriod(newer)} style={stepBtn(!newer)}>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

// "1 Aug – 31 Aug 2026 · 26 of 31 days" — the exact window being reported, so
// the period filter is verifiable at a glance. The FULL range is always shown
// (a picked month means the whole month); when today falls inside it, the day
// counter shows progress instead of silently clipping the end date. Date-only
// math — mixing in time-of-day made the count off by one.
function RangeLabel({ range }) {
  const day0 = (d) => { const t = new Date(d); t.setHours(0, 0, 0, 0); return t; };
  const from = day0(range.from), to = day0(range.to), today = day0(new Date());
  const totalDays = Math.max(1, Math.round((to - from) / 86400000) + 1);
  const elapsed   = Math.min(totalDays, Math.max(0, Math.round((today - from) / 86400000) + 1));
  const ongoing   = today >= from && today < to;
  const f = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
      <CalendarDays size={13} />
      {f(from)} – {f(to)} {to.getFullYear()} · {ongoing ? `${elapsed} of ${totalDays} days` : `${totalDays} days`}
    </div>
  );
}

function MetricCard({ label, value, valueColor, delta, deltaGoodWhenNeg = false, prevText, icon: Icon, iconBg, iconColor, sub }) {
  const good = delta !== null && delta !== 0 && (deltaGoodWhenNeg ? delta < 0 : delta > 0);
  const deltaColor = delta === null || delta === 0 ? "#9ca3af" : good ? "#059669" : "#dc2626";
  const deltaBg    = delta === null || delta === 0 ? "#f3f4f6" : good ? "#dcfce7" : "#fee2e2";
  const Arrow = delta !== null && delta !== 0 ? (delta > 0 ? TrendingUp : TrendingDown) : null;
  return (
    <div style={{
      background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 6, minWidth: 0,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {label}
        </div>
        {Icon && (
          <div style={{ width: 24, height: 24, borderRadius: 8, background: iconBg || "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon size={13} color={iconColor || "#6b7280"} />
          </div>
        )}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: valueColor, lineHeight: 1.2, fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {value}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 18, flexWrap: "wrap" }}>
        {delta !== null && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 7px", borderRadius: 99,
            background: deltaBg, color: deltaColor, fontSize: 10, fontWeight: 700, fontFamily: "Figtree, sans-serif",
          }}>
            {Arrow && <Arrow size={10} strokeWidth={2.5} />}
            {Math.abs(delta).toFixed(0)}%
          </span>
        )}
        <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {prevText || sub || (delta === null ? "no prev data" : "vs prev period")}
        </span>
      </div>
    </div>
  );
}

function HBar({ label, value, max, color, pct, count, onClick }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div onClick={onClick} style={{ marginBottom: 10, cursor: onClick ? "pointer" : "default" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
        <span style={{ fontSize: 12, color: "#374151", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {label}{count ? <span style={{ color: "#c4c8cf" }}> · {count} tx</span> : null}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif", flexShrink: 0 }}>
          {fmtIDR(value)}&nbsp;
          <span style={{ color: "#9ca3af", fontWeight: 400 }}>{pct}%</span>
        </span>
      </div>
      <div style={{ background: "#f3f4f6", borderRadius: 99, height: 5 }}>
        <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 99, transition: "width .4s" }} />
      </div>
    </div>
  );
}

function DrillDownModal({ open, onClose, title, transactions }) {
  if (!open) return null;
  const total = transactions.reduce((s, t) => s + Number(t.amount_idr || 0), 0);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16, padding: 24,
          maxWidth: 560, width: "90%", maxHeight: "80vh", overflow: "auto",
          fontFamily: "Figtree, sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#9ca3af" }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14 }}>
          {transactions.length} transactions · {fmtIDR(total)}
        </div>
        {transactions.length === 0
          ? <EmptyState icon="" message="No transactions." />
          : transactions
              .slice()
              .sort((a, b) => (b.tx_date || "").localeCompare(a.tx_date || ""))
              .map(t => (
                <div key={t.id || t._id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                  padding: "10px 0", borderBottom: "1px solid #f3f4f6",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.merchant_name || t.description || "—"}
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                      {t._cashDate || t.tx_date} · {t.category_name || "Uncategorized"}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#dc2626", flexShrink: 0, marginLeft: 12 }}>
                    {fmtIDR(Number(t.amount_idr || 0))}
                  </div>
                </div>
              ))
        }
      </div>
    </div>
  );
}

// ─── TAB 1: OVERVIEW ─────────────────────────────────────────

function OverviewTab({ ledger, accounts, categories, incomeSrcs, period, setPeriod, dark }) {
  const T = dark ? DARK : LIGHT;

  const [drill, setDrill] = useState(null); // { title, transactions }

  const range     = useMemo(() => getDateRange(period), [period]);
  const prevRange = useMemo(() => getPreviousRange(range), [range]);

  const txs      = useMemo(() => filterByRange(ledger, range), [ledger, range]);
  const prevTxs  = useMemo(() => filterByRange(ledger, prevRange), [ledger, prevRange]);

  const totalExp  = sumExpense(txs);
  const totalInc  = sumIncome(txs);
  const netSurp   = totalInc - totalExp;
  const savRate   = totalInc > 0 ? Math.round((netSurp / totalInc) * 100) : null;

  const prevExp   = sumExpense(prevTxs);
  const prevInc   = sumIncome(prevTxs);
  const prevNet   = prevInc - prevExp;

  const expDelta  = prevExp  > 0 ? ((totalExp - prevExp) / prevExp) * 100 : null;
  const incDelta  = prevInc  > 0 ? ((totalInc - prevInc) / prevInc) * 100 : null;
  const netDelta  = prevNet !== 0 ? ((netSurp - prevNet) / Math.abs(prevNet)) * 100 : null;
  const prevSav   = prevInc > 0 ? Math.round(((prevInc - prevExp) / prevInc) * 100) : null;
  const savDelta  = prevSav !== null && savRate !== null ? savRate - prevSav : null;

  const catBreak  = useMemo(() => groupByCategory(txs, "expense", categories), [txs, categories]);
  const merchants = useMemo(() => groupByMerchant(txs), [txs]);
  const catTotal  = catBreak.reduce((s, c) => s + c.total, 0);

  // 6-month trend
  const trendData = useMemo(() => TREND_MONTHS.map(mo => {
    const moTxs   = ledger.filter(e => e.tx_date?.slice(0, 7) === mo);
    const income  = sumIncome(moTxs);
    const expense = sumExpense(moTxs);
    return { month: mlShort(mo), mo, income, expense, surplus: income - expense };
  }), [ledger]);

  const tooltipStyle = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 11, fontFamily: "Figtree, sans-serif" };
  const card = { background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: "16px 18px" };

  // Insights: top category, largest tx, biggest category increase vs prev period
  const expTxs     = txs.filter(t => isExpenseRow(t) && !t.is_reimburse);
  // Top-spend insight highlights the top SPENDING category — the fixed BYD
  // leg (Loan Installments) would head the line every month (same treatment
  // as the Dashboard Top Category card). It still appears in the lists.
  const topCat     = catBreak.find(c => c.name !== "Loan Installments") || catBreak[0];
  const largestTx  = expTxs.slice().sort((a, b) => Number(b.amount_idr) - Number(a.amount_idr))[0];
  const prevCatMap = useMemo(() => {
    const m = {};
    prevTxs.filter(isExpenseRow).forEach(t => {
      const k = t.category_id || t.category_name || "other";
      m[k] = (m[k] || 0) + Number(t.amount_idr || 0);
    });
    return m;
  }, [prevTxs]);
  const biggestRise = useMemo(() => catBreak
    .map(c => ({ ...c, rise: c.total - (prevCatMap[c.id] || 0) }))
    .filter(c => c.rise > 0)
    .sort((a, b) => b.rise - a.rise)[0] || null, [catBreak, prevCatMap]);

  const insights = [];
  if (topCat)      insights.push(<span key="top">Top spend: <strong>{topCat.name}</strong> — {fmtIDR(topCat.total)} ({topCat.pct.toFixed(0)}%)</span>);
  if (largestTx)   insights.push(<span key="big">Largest tx: <strong>{largestTx.merchant_name || largestTx.description}</strong> — {fmtIDR(Number(largestTx.amount_idr || 0))}</span>);
  if (biggestRise) insights.push(<span key="rise">Biggest increase: <strong>{biggestRise.name}</strong> +{fmtIDR(biggestRise.rise)} vs prev</span>);

  const legendDot = (color) => ({ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: color, marginRight: 5 });
  const merchantsTop = merchants.slice(0, 8);
  const merchantMax  = merchantsTop[0]?.total || 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Metric cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
        <MetricCard label="Total Expenses" value={fmtIDR(totalExp)} valueColor="#dc2626" delta={expDelta} deltaGoodWhenNeg
          prevText={prevExp > 0 ? `prev ${fmtIDR(prevExp)}` : undefined}
          icon={Wallet} iconBg="#fee2e2" iconColor="#dc2626" />
        <MetricCard label="Total Income" value={fmtIDR(totalInc)} valueColor="#059669" delta={incDelta}
          prevText={prevInc > 0 ? `prev ${fmtIDR(prevInc)}` : undefined}
          icon={TrendingUp} iconBg="#dcfce7" iconColor="#059669" />
        <MetricCard label="Net Surplus" value={(netSurp >= 0 ? "+" : "\u2212") + fmtIDR(Math.abs(netSurp))} valueColor={netSurp >= 0 ? "#3b5bdb" : "#dc2626"} delta={netDelta}
          prevText={prevNet !== 0 ? `prev ${(prevNet >= 0 ? "+" : "\u2212") + fmtIDR(Math.abs(prevNet))}` : undefined}
          icon={PiggyBank} iconBg="#dbeafe" iconColor="#3b5bdb" />
        <MetricCard
          label="Savings Rate"
          value={savRate !== null ? `${savRate}%` : "—"}
          valueColor={savRate !== null && savRate >= 20 ? "#059669" : savRate !== null && savRate < 0 ? "#dc2626" : "#d97706"}
          delta={savDelta}
          prevText={prevSav !== null ? `prev ${prevSav}%` : undefined}
          icon={PiggyBank} iconBg="#fef3c7" iconColor="#d97706"
        />
      </div>

      {/* Insight strip */}
      {insights.length > 0 && (
        <div style={{
          background: "#fffbeb", border: "0.5px solid #fde68a", borderRadius: 12,
          padding: "10px 16px", display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "#78350f",
        }}>
          <Sparkles size={15} style={{ flexShrink: 0, marginTop: 1 }} color="#d97706" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", lineHeight: 1.6 }}>
            {insights}
          </div>
        </div>
      )}

      {/* 6-Month Trend */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <div>
            <SectionHeader title="6-Month Trend" />
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>Click a bar to drill into that month</div>
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#6b7280", fontFamily: "Figtree, sans-serif", alignItems: "center" }}>
            <span><i style={legendDot("#059669")} />Income</span>
            <span><i style={legendDot("#dc2626")} />Expense</span>
            <span><i style={{ ...legendDot("#9ca3af"), borderRadius: 99 }} />Net below</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={trendData}
            barSize={10} barGap={2}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            onClick={d => d?.activePayload?.[0]?.payload?.mo && setPeriod(d.activePayload[0].payload.mo)}
            style={{ cursor: "pointer" }}
          >
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#9ca3af", fontFamily: "Figtree, sans-serif" }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name) => [fmtIDR(v), name]}
              labelFormatter={(label, payload) => {
                const p = payload?.[0]?.payload;
                return p ? `${label} · net ${(p.surplus >= 0 ? "+" : "")}${fmtIDR(p.surplus)}` : label;
              }}
              cursor={{ fill: "rgba(0,0,0,0.04)" }}
            />
            <Bar dataKey="income"  name="Income"  fill="#059669" radius={[3, 3, 0, 0]}>
              {trendData.map(d => <Cell key={d.mo} fill={d.mo === period ? "#059669" : "#05996966"} />)}
            </Bar>
            <Bar dataKey="expense" name="Expense" fill="#dc2626" radius={[3, 3, 0, 0]}>
              {trendData.map(d => <Cell key={d.mo} fill={d.mo === period ? "#dc2626" : "#dc262666"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", justifyContent: "space-around", marginTop: 6, borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
          {trendData.map(d => (
            <div
              key={d.mo}
              onClick={() => setPeriod(d.mo)}
              title={`${d.month}: income ${fmtIDR(d.income)} − expense ${fmtIDR(d.expense)}`}
              style={{ textAlign: "center", flex: 1, fontSize: 9, fontWeight: 700, cursor: "pointer", color: d.surplus >= 0 ? "#059669" : "#dc2626", fontFamily: "Figtree, sans-serif" }}
            >
              {d.surplus >= 0 ? "+" : ""}{fmtIDR(d.surplus, true)}
            </div>
          ))}
        </div>
      </div>

      {/* 2-col: Expense by Category | Top Merchants */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        <div style={card}>
          <div style={{ marginBottom: 12 }}>
            <SectionHeader title="Expense by Category" />
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>Total: <strong style={{ color: "#111827" }}>{fmtIDR(catTotal)}</strong> · {catBreak.length} categories · click to drill in</div>
          </div>
          {catBreak.length === 0
            ? <EmptyState icon="" message="No expenses in this period." />
            : catBreak.map(c => (
                <HBar
                  key={c.id}
                  label={c.name}
                  count={c.count}
                  value={c.total}
                  max={catTotal}
                  color={c.color}
                  pct={(catTotal > 0 ? (c.total / catTotal) * 100 : 0).toFixed(1)}
                  onClick={() => setDrill({ title: c.name, transactions: c.txs })}
                />
              ))
          }
        </div>

        <div style={card}>
          <div style={{ marginBottom: 12 }}>
            <SectionHeader title="Top Merchants" />
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>By total spend in this period</div>
          </div>
          {merchantsTop.length === 0
            ? <EmptyState icon="" message="No merchant data." />
            : merchantsTop.map((m, i) => (
                <div
                  key={m.name}
                  onClick={() => setDrill({ title: m.name, transactions: m.txs })}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: 8, background: i === 0 ? "#111827" : "#f3f4f6",
                    color: i === 0 ? "#fff" : "#6b7280", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700, flexShrink: 0, fontFamily: "Figtree, sans-serif",
                  }}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", flexShrink: 0 }}>{fmtIDR(m.total)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                      <div style={{ flex: 1, background: "#f3f4f6", borderRadius: 99, height: 3 }}>
                        <div style={{ width: `${merchantMax > 0 ? (m.total / merchantMax) * 100 : 0}%`, height: "100%", background: "#fca5a5", borderRadius: 99 }} />
                      </div>
                      <span style={{ fontSize: 10, color: "#9ca3af", flexShrink: 0 }}>{m.category_name || "Other"} · {m.count} tx</span>
                    </div>
                  </div>
                </div>
              ))
          }
        </div>
      </div>

      <DrillDownModal
        open={!!drill}
        onClose={() => setDrill(null)}
        title={drill?.title || ""}
        transactions={drill?.transactions || []}
      />
    </div>
  );
}

// ─── TAB 2: EXPENSE ────────────────────────────────────────────

const PIE_COLORS = ["#dc2626","#d97706","#3b5bdb","#059669","#7c3aed","#0891b2","#e11d48","#ca8a04","#16a34a","#1d4ed8"];

function ExpenseTab({ ledger, categories = [], period, dark }) {
  const T = dark ? DARK : LIGHT;
  const range   = useMemo(() => getDateRange(period), [period]);
  const txs     = useMemo(() => filterByRange(ledger, range).filter(t => isExpenseRow(t) && !t.is_reimburse), [ledger, range]);
  const cats    = useMemo(() => groupByCategory(txs, "expense", categories), [txs, categories]);
  const [search, setSearch] = useState("");
  const [drill,  setDrill]  = useState(null);
  const catTotal = cats.reduce((s, c) => s + c.total, 0);

  const filtered = useMemo(() => {
    if (!search) return txs.slice().sort((a, b) => (b.tx_date || "").localeCompare(a.tx_date || ""));
    const q = search.toLowerCase();
    return txs.filter(t => (t.merchant_name || t.description || "").toLowerCase().includes(q)).slice().sort((a, b) => (b.tx_date || "").localeCompare(a.tx_date || ""));
  }, [txs, search]);

  const card = { background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: "16px 18px" };
  const tooltipStyle = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 11, fontFamily: "Figtree, sans-serif" };

  const pieData = cats.slice(0, 8).map((c, i) => ({ name: c.name, value: c.total, color: PIE_COLORS[i % PIE_COLORS.length] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Donut + legend */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
        <div style={card}>
          <SectionHeader title="Expense Distribution" />
          {cats.length === 0
            ? <EmptyState icon="" message="No expenses." />
            : (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                <PieChart width={220} height={220}>
                  <Pie data={pieData} cx={110} cy={110} innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                    {pieData.map((e, i) => <Cell key={e.name} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={v => fmtIDR(v)} />
                </PieChart>
              </div>
            )
          }
        </div>
        <div style={card}>
          <div style={{ marginBottom: 10 }}>
            <SectionHeader title="By Category" />
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>Total: <strong style={{ color: "#111827" }}>{fmtIDR(catTotal)}</strong></div>
          </div>
          {cats.length === 0
            ? <EmptyState icon="" message="No expenses." />
            : cats.map((c, i) => (
                <div
                  key={c.id}
                  onClick={() => setDrill({ title: c.name, transactions: c.txs })}
                  style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer", padding: "4px 0" }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "#374151" }}>{c.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{fmtIDR(c.total)}</span>
                    </div>
                    <div style={{ background: "#f3f4f6", borderRadius: 3, height: 3, marginTop: 3 }}>
                      <div style={{ width: `${c.pct}%`, height: "100%", background: PIE_COLORS[i % PIE_COLORS.length], borderRadius: 3 }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: "#9ca3af", flexShrink: 0 }}>{c.count} tx</span>
                </div>
              ))
          }
        </div>
      </div>

      {/* Search + transaction list */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <SectionHeader title="Transactions" />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search merchant…"
              style={{
                height: 32, padding: "0 10px", borderRadius: 8, border: "1px solid #e5e7eb",
                fontSize: 12, fontFamily: "Figtree, sans-serif", color: "#111827", background: "#fff", outline: "none",
              }}
            />
            <button
              onClick={() => exportCSV(txs, "expense")}
              style={{
                height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid #e5e7eb",
                background: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "Figtree, sans-serif", color: "#374151",
              }}
            >Export CSV</button>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>{filtered.length} transactions · {fmtIDR(filtered.reduce((s, t) => s + Number(t.amount_idr || 0), 0))}</div>
        {filtered.length === 0
          ? <EmptyState icon="" message="No transactions found." />
          : filtered.slice(0, 50).map(t => (
              <div key={t.id || t._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid #f3f4f6" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.merchant_name || t.description || "—"}</div>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{t._cashDate || t.tx_date} · {t.category_name || "—"}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", flexShrink: 0, marginLeft: 12 }}>{fmtIDR(Number(t.amount_idr || 0))}</div>
              </div>
            ))
        }
        {filtered.length > 50 && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 8, textAlign: "center" }}>Showing 50 of {filtered.length} — export CSV for full list</div>}
      </div>

      <DrillDownModal open={!!drill} onClose={() => setDrill(null)} title={drill?.title || ""} transactions={drill?.transactions || []} />
    </div>
  );
}

// ─── TAB 3: INCOME ────────────────────────────────────────────

function IncomeTab({ ledger, incomeSrcs, period, dark }) {
  const T = dark ? DARK : LIGHT;
  const range  = useMemo(() => getDateRange(period), [period]);
  const txs    = useMemo(() => filterByRange(ledger, range).filter(isIncomeRow), [ledger, range]);
  const srcs   = useMemo(() => groupByIncomeSource(txs, incomeSrcs), [txs, incomeSrcs]);
  const [drill, setDrill] = useState(null);
  const total  = srcs.reduce((s, c) => s + c.total, 0);

  const card = { background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: "16px 18px" };
  const tooltipStyle = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 11, fontFamily: "Figtree, sans-serif" };
  const INC_COLORS = ["#059669","#3b5bdb","#d97706","#7c3aed","#0891b2","#16a34a","#1d4ed8","#ca8a04"];
  const pieData = srcs.map((s, i) => ({ name: s.name, value: s.total, color: INC_COLORS[i % INC_COLORS.length] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
        <div style={card}>
          <SectionHeader title="Income Distribution" />
          {srcs.length === 0
            ? <EmptyState icon="" message="No income." />
            : (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                <PieChart width={220} height={220}>
                  <Pie data={pieData} cx={110} cy={110} innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                    {pieData.map((e, i) => <Cell key={e.name} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={v => fmtIDR(v)} />
                </PieChart>
              </div>
            )
          }
        </div>
        <div style={card}>
          <div style={{ marginBottom: 10 }}>
            <SectionHeader title="Income Sources" />
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>Total: <strong style={{ color: "#111827" }}>{fmtIDR(total)}</strong></div>
          </div>
          {srcs.length === 0
            ? <EmptyState icon="" message="No income." />
            : srcs.map((s, i) => (
                <div
                  key={s.id}
                  onClick={() => setDrill({ title: s.name, transactions: s.txs })}
                  style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer", padding: "4px 0" }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: INC_COLORS[i % INC_COLORS.length], flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "#374151" }}>{s.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{fmtIDR(s.total, true)}</span>
                    </div>
                    <div style={{ background: "#f3f4f6", borderRadius: 3, height: 3, marginTop: 3 }}>
                      <div style={{ width: `${total > 0 ? (s.total / total) * 100 : 0}%`, height: "100%", background: INC_COLORS[i % INC_COLORS.length], borderRadius: 3 }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: "#9ca3af", flexShrink: 0 }}>{s.count} tx</span>
                </div>
              ))
          }
        </div>
      </div>

      {/* Recent income transactions */}
      <div style={card}>
        <div style={{ marginBottom: 12 }}><SectionHeader title="Recent Income Transactions" /></div>
        {txs.length === 0
          ? <EmptyState icon="" message="No income transactions." />
          : [...txs].sort((a, b) => (b.tx_date || "").localeCompare(a.tx_date || "")).slice(0, 30).map(t => (
              <div key={t.id || t._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid #f3f4f6" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{t.description || t.merchant_name || "—"}</div>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{t._cashDate || t.tx_date} · {t.category_name || "—"}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#059669", flexShrink: 0, marginLeft: 12 }}>{fmtIDR(Number(t.amount_idr || 0))}</div>
              </div>
            ))
        }
        <div style={{ marginTop: 10 }}>
          <button onClick={() => exportCSV(txs, "income")} style={{ height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "Figtree, sans-serif", color: "#374151" }}>
            Export CSV
          </button>
        </div>
      </div>

      <DrillDownModal open={!!drill} onClose={() => setDrill(null)} title={drill?.title || ""} transactions={drill?.transactions || []} />
    </div>
  );
}

// ─── TAB 4: COMPARISON ────────────────────────────────────────

function ComparisonCard({ label, thisVal, prevVal, format = "idr", inverse = false }) {
  const diff    = thisVal - prevVal;
  const diffPct = prevVal !== 0 ? (diff / Math.abs(prevVal)) * 100 : null;
  const good    = inverse ? diff < 0 : diff > 0;
  const color   = diffPct === null ? "#9ca3af" : good ? "#059669" : diff === 0 ? "#9ca3af" : "#dc2626";
  const fmt     = v => format === "pct" ? `${v}%` : fmtIDR(v);
  return (
    <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 2 }}>This Period</div>
          <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "Figtree, sans-serif" }}>{fmt(thisVal)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 2 }}>Previous</div>
          <div style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{fmt(prevVal)}</div>
        </div>
      </div>
      {diffPct !== null && (
        <div style={{ marginTop: 6, fontSize: 10, color }}>
          {diff > 0 ? "▲" : "▼"} {Math.abs(diffPct).toFixed(0)}% {diff > 0 ? "higher" : "lower"}
        </div>
      )}
    </div>
  );
}

function ComparisonTab({ ledger, categories = [], period, dark }) {
  const T = dark ? DARK : LIGHT;
  const range     = useMemo(() => getDateRange(period), [period]);
  const prevRange = useMemo(() => getPreviousRange(range), [range]);
  const txs       = useMemo(() => filterByRange(ledger, range), [ledger, range]);
  const prevTxs   = useMemo(() => filterByRange(ledger, prevRange), [ledger, prevRange]);

  const thisExp  = sumExpense(txs);
  const thisInc  = sumIncome(txs);
  const thisNet  = thisInc - thisExp;
  const thisSav  = thisInc > 0 ? Math.round((thisNet / thisInc) * 100) : 0;

  const prevExp  = sumExpense(prevTxs);
  const prevInc  = sumIncome(prevTxs);
  const prevNet  = prevInc - prevExp;
  const prevSav  = prevInc > 0 ? Math.round((prevNet / prevInc) * 100) : 0;

  const thisCats = useMemo(() => groupByCategory(txs, "expense", categories), [txs, categories]);
  const prevCats = useMemo(() => groupByCategory(prevTxs, "expense", categories), [prevTxs, categories]);

  // Merge categories
  const allCatNames = [...new Set([...thisCats.map(c => c.name), ...prevCats.map(c => c.name)])];

  const fmtDateRange = r => {
    if (!r?.from || !r?.to) return "";
    const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(r.from)} – ${fmt(r.to)}`;
  };

  const card = { background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: "16px 18px" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Period labels */}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ ...card, flex: 1, padding: "10px 14px", background: "#f0fdf4", border: "0.5px solid #bbf7d0" }}>
          <div style={{ fontSize: 10, color: "#059669", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>This Period</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", marginTop: 2 }}>{range.label} · {fmtDateRange(range)}</div>
        </div>
        <div style={{ ...card, flex: 1, padding: "10px 14px", background: "#f9fafb", border: "0.5px solid #e5e7eb" }}>
          <div style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Previous Period</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginTop: 2 }}>{fmtDateRange(prevRange)}</div>
        </div>
      </div>

      {/* 4 comparison cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <ComparisonCard label="Total Expenses" thisVal={thisExp} prevVal={prevExp} inverse />
        <ComparisonCard label="Total Income"   thisVal={thisInc} prevVal={prevInc} />
        <ComparisonCard label="Net Surplus"    thisVal={thisNet} prevVal={prevNet} />
        <ComparisonCard label="Savings Rate"   thisVal={thisSav} prevVal={prevSav} format="pct" />
      </div>

      {/* Category comparison table */}
      <div style={card}>
        <div style={{ marginBottom: 12 }}><SectionHeader title="Expense by Category" /></div>
        {allCatNames.length === 0
          ? <EmptyState icon="" message="No expense data." />
          : (
            <>
              {/* Header row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px 70px", gap: 8, fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                <span>Category</span>
                <span style={{ textAlign: "right" }}>This Period</span>
                <span style={{ textAlign: "right" }}>Previous</span>
                <span style={{ textAlign: "right" }}>Δ</span>
              </div>
              {allCatNames.map(name => {
                const tc = thisCats.find(c => c.name === name);
                const pc = prevCats.find(c => c.name === name);
                const tv = tc?.total || 0;
                const pv = pc?.total || 0;
                const diff = tv - pv;
                const diffColor = diff < 0 ? "#059669" : diff > 0 ? "#dc2626" : "#9ca3af";
                return (
                  <div key={name} style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px 70px", gap: 8, fontSize: 12, padding: "8px 0", borderBottom: "1px solid #f3f4f6", alignItems: "center" }}>
                    <span style={{ color: "#374151" }}>{name}</span>
                    <span style={{ textAlign: "right", fontWeight: 600 }}>{fmtIDR(tv, true)}</span>
                    <span style={{ textAlign: "right", color: "#9ca3af" }}>{fmtIDR(pv, true)}</span>
                    <span style={{ textAlign: "right", color: diffColor, fontSize: 11 }}>
                      {diff === 0 ? "—" : `${diff > 0 ? "+" : ""}${fmtIDR(diff, true)}`}
                    </span>
                  </div>
                );
              })}
            </>
          )
        }
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────

const TABS = [
  { id: "overview",    label: "Overview" },
  { id: "expense",     label: "Expense" },
  { id: "income",      label: "Income" },
  { id: "comparison",  label: "Comparison" },
];

export default function Reports({ user, ledger = [], accounts = [], categories = [], incomeSrcs = [], recurTemplates = [], dark }) {
  const T = dark ? DARK : LIGHT;
  const [period,    setPeriod]    = useState("this_month");
  const [activeTab, setActiveTab] = useState("overview");
  // Salary re-dated to its attributed month (see attributeFixedIncome), and
  // income credited into a credit card flagged as _ccRefund (expense offset).
  const rLedger = useMemo(() => {
    const ccIds = new Set((accounts || []).filter(a => a.type === "credit_card").map(a => a.id));
    return attributeFixedIncome(ledger, recurTemplates).map(r =>
      r.tx_type === "income" && ccIds.has(r.to_id) ? { ...r, _ccRefund: true } : r);
  }, [ledger, recurTemplates, accounts]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Period Filter ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <PeriodFilter period={period} setPeriod={setPeriod} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 12, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
          <span>{getDateRange(period).label}</span>
          <RangeLabel range={getDateRange(period)} />
          {/^\d{4}-\d{2}$/.test(period) && (
            <button
              onClick={() => setPeriod("this_month")}
              style={{ fontSize: 11, color: "#3b5bdb", background: "none", border: "none", cursor: "pointer", fontFamily: "Figtree, sans-serif" }}
            >
              Back
            </button>
          )}
        </div>
      </div>

      {/* ── Tab Strip ── */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #e5e7eb" }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: "10px 16px",
              fontSize: 13,
              fontWeight: activeTab === t.id ? 600 : 400,
              color:     activeTab === t.id ? "#111827" : "#6b7280",
              borderBottom: activeTab === t.id ? "2px solid #111827" : "2px solid transparent",
              marginBottom: -1,
              cursor: "pointer",
              background: "none",
              border: "none",
              borderBottomStyle: "solid",
              borderBottomWidth: 2,
              borderBottomColor: activeTab === t.id ? "#111827" : "transparent",
              fontFamily: "Figtree, sans-serif",
              transition: "color 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      {activeTab === "overview" && (
        <OverviewTab
          ledger={rLedger} accounts={accounts} categories={categories}
          incomeSrcs={incomeSrcs} period={period} setPeriod={setPeriod} dark={dark}
        />
      )}
      {activeTab === "expense" && (
        <ExpenseTab ledger={rLedger} categories={categories} period={period} dark={dark} />
      )}
      {activeTab === "income" && (
        <IncomeTab ledger={rLedger} incomeSrcs={incomeSrcs} period={period} dark={dark} />
      )}
      {activeTab === "comparison" && (
        <ComparisonTab ledger={rLedger} categories={categories} period={period} dark={dark} />
      )}
    </div>
  );
}
