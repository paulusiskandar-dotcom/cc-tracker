import { useState, useMemo } from "react";
import { fmtIDR, mlShort } from "../utils";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES_LIST } from "../constants";
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

function filterByRange(ledger, range) {
  const f = range.from.toISOString().slice(0, 10);
  const t = range.to.toISOString().slice(0, 10);
  return ledger.filter(e => e.tx_date >= f && e.tx_date <= t);
}

function sumType(txs, type) {
  return txs.filter(t => t.tx_type === type).reduce((s, t) => s + Number(t.amount_idr || 0), 0);
}

function last6Months() {
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (5 - i));
    return d.toISOString().slice(0, 7);
  });
}

// Resolve icon+color from DB category list first, then constants fallback.
// Priority: 1) DB by category_id UUID  2) DB by name  3) constants by label  4) default
function resolveCatMeta(categoryId, categoryName, dbList = [], isIncome = false) {
  const constList = isIncome ? INCOME_CATEGORIES_LIST : EXPENSE_CATEGORIES;
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

  // 3. Constants fallback by label match (handles legacy data)
  if (name) {
    const lower = name.toLowerCase().trim();
    const hit = constList.find(c => c.label?.toLowerCase().trim() === lower);
    if (hit?.icon) return { icon: hit.icon, color: hit.color || "#9ca3af" };
  }

  return { icon: isIncome ? "💰" : "📝", color: isIncome ? "#059669" : "#9ca3af" };
}

function groupByCategory(txs, type = "expense", dbCategories = []) {
  const map = {};
  const isIncome = type === "income";
  txs.filter(t => t.tx_type === type).forEach(t => {
    const key  = t.category_id || t.category_name || "other";
    const name = t.category_name || "Other";
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
  txs.filter(t => t.tx_type === "expense").forEach(t => {
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
  txs.filter(t => t.tx_type === "income").forEach(t => {
    const srcId = t.from_id || t.category_id || "unknown";
    const src   = incomeSrcs.find(s => s.id === srcId);
    const name  = src?.name || t.category_name || "Other Income";
    const icon  = src?.icon || "💰";
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

function PeriodFilter({ period, setPeriod }) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {PERIOD_PILLS.map(p => {
        const active = period === p.key || (!PERIOD_PILLS.find(x => x.key === period) && p.key === "this_month");
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
      {/^\d{4}-\d{2}$/.test(period) && (
        <button style={{
          height: 30, padding: "0 12px", borderRadius: 20,
          border: "1.5px solid #111827", background: "#111827",
          color: "#fff", fontSize: 12, fontWeight: 700,
          cursor: "pointer", fontFamily: "Figtree, sans-serif",
        }}>
          {getDateRange(period).label} ✕
        </button>
      )}
    </div>
  );
}

function MetricCard({ label, value, valueColor, delta, deltaGoodWhenNeg = false }) {
  const deltaColor = delta === null ? "#9ca3af" :
    delta === 0 ? "#9ca3af" :
    (deltaGoodWhenNeg ? delta < 0 : delta > 0) ? "#059669" : "#dc2626";
  const deltaArrow = delta !== null && delta !== 0 ? (delta > 0 ? "▲" : "▼") : "";
  return (
    <div style={{
      background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: valueColor, lineHeight: 1.2, fontFamily: "Figtree, sans-serif", marginBottom: 4 }}>
        {value}
      </div>
      {delta !== null ? (
        <div style={{ fontSize: 10, color: deltaColor, fontFamily: "Figtree, sans-serif" }}>
          {deltaArrow} {Math.abs(delta).toFixed(0)}% vs prev period
        </div>
      ) : (
        <div style={{ fontSize: 10, color: "#9ca3af" }}>—</div>
      )}
    </div>
  );
}

function HBar({ label, value, max, color, pct, onClick }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div onClick={onClick} style={{ marginBottom: 10, cursor: onClick ? "pointer" : "default" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "#374151", fontFamily: "Figtree, sans-serif" }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
          {fmtIDR(value, true)}&nbsp;
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
          ? <EmptyState icon="📋" message="No transactions." />
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
                      {t.tx_date} · {t.category_name || "Uncategorized"}
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

  const totalExp  = sumType(txs, "expense");
  const totalInc  = sumType(txs, "income");
  const netSurp   = totalInc - totalExp;
  const savRate   = totalInc > 0 ? Math.round((netSurp / totalInc) * 100) : null;

  const prevExp   = sumType(prevTxs, "expense");
  const prevInc   = sumType(prevTxs, "income");
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
    const income  = sumType(moTxs, "income");
    const expense = sumType(moTxs, "expense");
    return { month: mlShort(mo), mo, income, expense, surplus: income - expense };
  }), [ledger]);

  const tooltipStyle = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 11, fontFamily: "Figtree, sans-serif" };
  const card = { background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: "16px 18px" };

  // Insight
  const topCat     = catBreak[0];
  const largestTx  = txs.filter(t => t.tx_type === "expense").sort((a, b) => Number(b.amount_idr) - Number(a.amount_idr))[0];
  const showInsight = topCat && largestTx;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Metric cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        <MetricCard label="Total Expenses" value={fmtIDR(totalExp)} valueColor="#dc2626" delta={expDelta} deltaGoodWhenNeg />
        <MetricCard label="Total Income"   value={fmtIDR(totalInc)} valueColor="#059669" delta={incDelta} />
        <MetricCard label="Net Surplus"    value={(netSurp >= 0 ? "+" : "") + fmtIDR(netSurp)} valueColor={netSurp >= 0 ? "#3b5bdb" : "#dc2626"} delta={netDelta} />
        <MetricCard
          label="Savings Rate"
          value={savRate !== null ? `${savRate}%` : "—"}
          valueColor={savRate !== null && savRate >= 20 ? "#059669" : savRate !== null && savRate < 0 ? "#dc2626" : "#d97706"}
          delta={savDelta}
        />
      </div>

      {/* Insight bar */}
      {showInsight && (
        <div style={{
          background: "#fef3c7", border: "0.5px solid #fde68a", borderRadius: 12,
          padding: "12px 16px", display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "#78350f",
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>💡</span>
          <div>
            Top spend: <strong>{topCat.name} ({fmtIDR(topCat.total, true)}, {topCat.pct.toFixed(0)}%)</strong>.{" "}
            Largest tx: <strong>{largestTx.merchant_name || largestTx.description} — {fmtIDR(Number(largestTx.amount_idr || 0), true)}</strong>
            {largestTx.category_name ? ` (${largestTx.category_name})` : ""}.
          </div>
        </div>
      )}

      {/* 6-Month Trend */}
      <div style={card}>
        <div style={{ marginBottom: 14 }}>
          <SectionHeader title="6-Month Trend" />
          <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>Click a bar to drill into that month</div>
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
            <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [fmtIDR(v, true), name]} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
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
            <div key={d.mo} style={{ textAlign: "center", flex: 1, fontSize: 9, fontWeight: 700, color: d.surplus >= 0 ? "#059669" : "#dc2626", fontFamily: "Figtree, sans-serif" }}>
              {d.surplus >= 0 ? "+" : ""}{fmtIDR(d.surplus, true)}
            </div>
          ))}
        </div>
      </div>

      {/* 2-col: Expense by Category | Top Merchants */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={card}>
          <div style={{ marginBottom: 12 }}>
            <SectionHeader title="Expense by Category" />
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>Total: <strong style={{ color: "#111827" }}>{fmtIDR(catTotal)}</strong></div>
          </div>
          {catBreak.length === 0
            ? <EmptyState icon="📊" message="No expenses." />
            : catBreak.map(c => (
                <HBar
                  key={c.id}
                  label={`${c.icon} ${c.name}`}
                  value={c.total}
                  max={catTotal}
                  color={c.color}
                  pct={(catTotal > 0 ? (c.total / catTotal) * 100 : 0).toFixed(1)}
                  onClick={() => setDrill({ title: `${c.icon} ${c.name}`, transactions: c.txs })}
                />
              ))
          }
        </div>

        <div style={card}>
          <div style={{ marginBottom: 12 }}>
            <SectionHeader title="Top Merchants" />
          </div>
          {merchants.length === 0
            ? <EmptyState icon="🏪" message="No merchant data." />
            : merchants.slice(0, 8).map(m => (
                <div
                  key={m.name}
                  onClick={() => setDrill({ title: m.name, transactions: m.txs })}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                    <div style={{ fontSize: 10, color: "#9ca3af" }}>{m.category_name || "Other"} · {m.count} tx</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", flexShrink: 0, marginLeft: 12 }}>{fmtIDR(m.total, true)}</div>
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
  const txs     = useMemo(() => filterByRange(ledger, range).filter(t => t.tx_type === "expense"), [ledger, range]);
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
            ? <EmptyState icon="📊" message="No expenses." />
            : (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                <PieChart width={220} height={220}>
                  <Pie data={pieData} cx={110} cy={110} innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                    {pieData.map((e, i) => <Cell key={e.name} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={v => fmtIDR(v, true)} />
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
            ? <EmptyState icon="📊" message="No expenses." />
            : cats.map((c, i) => (
                <div
                  key={c.id}
                  onClick={() => setDrill({ title: `${c.icon} ${c.name}`, transactions: c.txs })}
                  style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer", padding: "4px 0" }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "#374151" }}>{c.icon} {c.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{fmtIDR(c.total, true)}</span>
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
            >📥 Export CSV</button>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>{filtered.length} transactions · {fmtIDR(filtered.reduce((s, t) => s + Number(t.amount_idr || 0), 0))}</div>
        {filtered.length === 0
          ? <EmptyState icon="📋" message="No transactions found." />
          : filtered.slice(0, 50).map(t => (
              <div key={t.id || t._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid #f3f4f6" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.merchant_name || t.description || "—"}</div>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{t.tx_date} · {t.category_name || "—"}</div>
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
  const txs    = useMemo(() => filterByRange(ledger, range).filter(t => t.tx_type === "income"), [ledger, range]);
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
            ? <EmptyState icon="💰" message="No income." />
            : (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                <PieChart width={220} height={220}>
                  <Pie data={pieData} cx={110} cy={110} innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                    {pieData.map((e, i) => <Cell key={e.name} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={v => fmtIDR(v, true)} />
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
            ? <EmptyState icon="💰" message="No income." />
            : srcs.map((s, i) => (
                <div
                  key={s.id}
                  onClick={() => setDrill({ title: s.name, transactions: s.txs })}
                  style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer", padding: "4px 0" }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: INC_COLORS[i % INC_COLORS.length], flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "#374151" }}>{s.icon} {s.name}</span>
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
          ? <EmptyState icon="💸" message="No income transactions." />
          : [...txs].sort((a, b) => (b.tx_date || "").localeCompare(a.tx_date || "")).slice(0, 30).map(t => (
              <div key={t.id || t._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid #f3f4f6" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{t.description || t.merchant_name || "—"}</div>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{t.tx_date} · {t.category_name || "—"}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#059669", flexShrink: 0, marginLeft: 12 }}>{fmtIDR(Number(t.amount_idr || 0))}</div>
              </div>
            ))
        }
        <div style={{ marginTop: 10 }}>
          <button onClick={() => exportCSV(txs, "income")} style={{ height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "Figtree, sans-serif", color: "#374151" }}>
            📥 Export CSV
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

  const thisExp  = sumType(txs, "expense");
  const thisInc  = sumType(txs, "income");
  const thisNet  = thisInc - thisExp;
  const thisSav  = thisInc > 0 ? Math.round((thisNet / thisInc) * 100) : 0;

  const prevExp  = sumType(prevTxs, "expense");
  const prevInc  = sumType(prevTxs, "income");
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
          ? <EmptyState icon="📊" message="No expense data." />
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
                    <span style={{ color: "#374151" }}>{tc?.icon || pc?.icon || "❓"} {name}</span>
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

export default function Reports({ user, ledger = [], accounts = [], categories = [], incomeSrcs = [], dark }) {
  const T = dark ? DARK : LIGHT;
  const [period,    setPeriod]    = useState("this_month");
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Period Filter ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <PeriodFilter period={period} setPeriod={setPeriod} />
        <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
          {getDateRange(period).label}
          {/^\d{4}-\d{2}$/.test(period) && (
            <button
              onClick={() => setPeriod("this_month")}
              style={{ marginLeft: 8, fontSize: 11, color: "#3b5bdb", background: "none", border: "none", cursor: "pointer", fontFamily: "Figtree, sans-serif" }}
            >
              ← Back
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
          ledger={ledger} accounts={accounts} categories={categories}
          incomeSrcs={incomeSrcs} period={period} setPeriod={setPeriod} dark={dark}
        />
      )}
      {activeTab === "expense" && (
        <ExpenseTab ledger={ledger} categories={categories} period={period} dark={dark} />
      )}
      {activeTab === "income" && (
        <IncomeTab ledger={ledger} incomeSrcs={incomeSrcs} period={period} dark={dark} />
      )}
      {activeTab === "comparison" && (
        <ComparisonTab ledger={ledger} categories={categories} period={period} dark={dark} />
      )}
    </div>
  );
}
