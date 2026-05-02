import { useState, useMemo } from "react";
import { fmtIDR, ym, mlShort } from "../utils";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES_LIST } from "../constants";
import { LIGHT, DARK } from "../theme";
import { SectionHeader, EmptyState } from "./shared/index";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ── Helpers ─────────────────────────────────────────────────────

function last6Months() {
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (5 - i));
    return d.toISOString().slice(0, 7);
  });
}

function navigatePeriod(period, dir) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + dir, 1);
  return d.toISOString().slice(0, 7);
}

function periodLabel(p) {
  const [y, m] = p.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ── Sub-components ───────────────────────────────────────────────

function MetricCard({ label, value, color, sub, T }) {
  return (
    <div style={{
      background: T.sur2, borderRadius: 14, padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 900, color, lineHeight: 1.2, fontFamily: "Figtree, sans-serif" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: T.text3 }}>{sub}</div>}
    </div>
  );
}

function HBar({ label, value, max, color, pct, T }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: T.text2, fontFamily: "Figtree, sans-serif" }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>
          {fmtIDR(value, true)}&nbsp;
          <span style={{ color: T.text3, fontWeight: 400 }}>{pct}%</span>
        </span>
      </div>
      <div style={{ background: T.border, borderRadius: 99, height: 5 }}>
        <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 99, transition: "width .4s" }} />
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────

export default function Reports({ user, ledger, accounts, dark }) {
  const T = dark ? DARK : LIGHT;

  const [period, setPeriod]         = useState(() => new Date().toISOString().slice(0, 7));
  const [accountFilter, setAccountFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [personalOnly, setPersonalOnly] = useState(false);

  const TREND_MONTHS = useMemo(() => last6Months(), []);
  const bankCashAccounts = useMemo(
    () => accounts.filter(a => ["bank", "cash"].includes(a.type)),
    [accounts]
  );

  // ── Period-filtered ledger ────────────────────────────────────
  const periodLedger = useMemo(() => ledger.filter(e => {
    if (e.tx_date?.slice(0, 7) !== period) return false;
    if (personalOnly && e.entity !== "Personal") return false;
    if (accountFilter !== "all" && e.from_id !== accountFilter && e.to_id !== accountFilter) return false;
    return true;
  }), [ledger, period, personalOnly, accountFilter]);

  // ── Expense/income for period ─────────────────────────────────
  const periodExpenses = useMemo(() => periodLedger.filter(e =>
    e.tx_type === "expense" &&
    (categoryFilter === "all" || e.category === categoryFilter)
  ), [periodLedger, categoryFilter]);

  const periodIncome = useMemo(() =>
    periodLedger.filter(e => e.tx_type === "income"),
    [periodLedger]
  );

  // ── Metrics ───────────────────────────────────────────────────
  const totalExpense = periodExpenses.reduce((s, e) => s + Number(e.amount_idr || 0), 0);
  const totalIncome  = periodIncome.reduce((s, e) => s + Number(e.amount_idr || 0), 0);
  const netSurplus   = totalIncome - totalExpense;
  const savingsRate  = totalIncome > 0 ? Math.round((netSurplus / totalIncome) * 100) : null;

  // ── 6-month trend ─────────────────────────────────────────────
  const trendData = useMemo(() => TREND_MONTHS.map(mo => {
    const moEntries = ledger.filter(e => {
      if (e.tx_date?.slice(0, 7) !== mo) return false;
      if (personalOnly && e.entity !== "Personal") return false;
      return true;
    });
    const income  = moEntries.filter(e => e.tx_type === "income").reduce((s, e) => s + Number(e.amount_idr || 0), 0);
    const expense = moEntries.filter(e => e.tx_type === "expense").reduce((s, e) => s + Number(e.amount_idr || 0), 0);
    return { month: mlShort(mo), mo, income, expense, surplus: income - expense };
  }), [ledger, TREND_MONTHS, personalOnly]);

  // ── Category breakdown ────────────────────────────────────────
  const catBreakdown = useMemo(() => {
    const map = {};
    periodExpenses.forEach(e => {
      const cat = e.category || "other";
      map[cat] = (map[cat] || 0) + Number(e.amount_idr || 0);
    });
    return Object.entries(map).map(([id, value]) => {
      const def = EXPENSE_CATEGORIES.find(c => c.id === id) || { label: id, icon: "❓", color: "#9ca3af" };
      return { id, label: def.label, icon: def.icon, color: def.color, value };
    }).sort((a, b) => b.value - a.value);
  }, [periodExpenses]);

  const catTotal = catBreakdown.reduce((s, c) => s + c.value, 0);

  // ── Income breakdown ─────────────────────────────────────────
  const incomeBreakdown = useMemo(() => {
    const map = {};
    periodIncome.forEach(e => {
      const cat = e.category || "other_income";
      map[cat] = (map[cat] || 0) + Number(e.amount_idr || 0);
    });
    return Object.entries(map).map(([id, value]) => {
      const def = INCOME_CATEGORIES_LIST.find(c => c.id === id) || { label: id, icon: "💰", color: "#059669" };
      return { id, label: def.label, icon: def.icon, color: def.color, value };
    }).sort((a, b) => b.value - a.value);
  }, [periodIncome]);

  // ── Top merchants ─────────────────────────────────────────────
  const topMerchants = useMemo(() => {
    const map = {};
    periodExpenses.forEach(e => {
      const name = (e.merchant_name || e.description || "Unknown").trim();
      if (!name) return;
      map[name] = (map[name] || 0) + Number(e.amount_idr || 0);
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [periodExpenses]);

  const topMerchantMax = topMerchants[0]?.value || 1;

  // ── Styles ────────────────────────────────────────────────────
  const card = {
    background: T.surface, border: `1px solid ${T.border}`,
    borderRadius: 16, padding: "16px 18px",
  };
  const tooltipStyle = {
    background: T.surface, border: `1px solid ${T.border}`,
    borderRadius: 8, fontSize: 11, fontFamily: "Figtree, sans-serif",
  };
  const filterLabel = {
    fontSize: 11, fontWeight: 600, color: T.text3,
    fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap",
  };
  const filterSelect = {
    fontSize: 12, padding: "5px 8px", borderRadius: 8,
    border: `1px solid ${T.border}`, background: T.surface,
    color: T.text, fontFamily: "Figtree, sans-serif", cursor: "pointer", height: 32,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── FILTERS ──────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "12px 14px", borderRadius: 12, background: T.sur2,
      }}>
        {/* Period picker */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => setPeriod(p => navigatePeriod(p, -1))}
            style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, width: 28, height: 28, cursor: "pointer", color: T.text2, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}
          >‹</button>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text, minWidth: 80, textAlign: "center", fontFamily: "Figtree, sans-serif" }}>
            {periodLabel(period)}
          </span>
          <button
            onClick={() => setPeriod(p => navigatePeriod(p, +1))}
            style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, width: 28, height: 28, cursor: "pointer", color: T.text2, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}
          >›</button>
        </div>

        <div style={{ width: 1, height: 20, background: T.border }} />

        {/* Account filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={filterLabel}>Account</span>
          <select value={accountFilter} onChange={e => setAccountFilter(e.target.value)} style={filterSelect}>
            <option value="all">All</option>
            {bankCashAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {/* Category filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={filterLabel}>Category</span>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={filterSelect}>
            <option value="all">All</option>
            {EXPENSE_CATEGORIES.map(c => (
              <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
            ))}
          </select>
        </div>

        <div style={{ width: 1, height: 20, background: T.border }} />

        {/* Personal only toggle */}
        <button
          onClick={() => setPersonalOnly(v => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 10px", borderRadius: 8, cursor: "pointer",
            border: `1px solid ${personalOnly ? "#3b5bdb" : T.border}`,
            background: personalOnly ? "#3b5bdb" : "transparent",
            color: personalOnly ? "#fff" : T.text2,
            fontSize: 11, fontWeight: 600, fontFamily: "Figtree, sans-serif",
            transition: "all .15s",
          }}
        >
          <span style={{ fontSize: 13 }}>👤</span> Personal only
        </button>
      </div>

      {/* ── METRIC CARDS ─────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
        <MetricCard
          T={T}
          label="Total Expenses"
          value={fmtIDR(totalExpense, true)}
          color="#E24B4A"
          sub={`${periodExpenses.length} transactions`}
        />
        <MetricCard
          T={T}
          label="Total Income"
          value={fmtIDR(totalIncome, true)}
          color="#1D9E75"
          sub={`${periodIncome.length} transactions`}
        />
        <MetricCard
          T={T}
          label="Net Surplus"
          value={(netSurplus >= 0 ? "+" : "") + fmtIDR(netSurplus, true)}
          color={netSurplus >= 0 ? "#3b5bdb" : "#E24B4A"}
        />
        <MetricCard
          T={T}
          label="Savings Rate"
          value={savingsRate !== null ? `${savingsRate}%` : "—"}
          color={savingsRate !== null && savingsRate >= 20 ? "#1D9E75" : savingsRate !== null && savingsRate < 0 ? "#E24B4A" : "#d97706"}
          sub={savingsRate === null ? "No income this month" : savingsRate >= 20 ? "Great!" : savingsRate < 0 ? "Overspending" : "Keep saving"}
        />
      </div>

      {/* ── 6-MONTH TREND ────────────────────────────────────── */}
      <div style={card}>
        <div style={{ marginBottom: 14 }}>
          <SectionHeader title="6-Month Trend" />
          <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>Click a month to view details</div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={trendData}
            barSize={10}
            barGap={2}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            onClick={d => d?.activePayload?.[0]?.payload?.mo && setPeriod(d.activePayload[0].payload.mo)}
            style={{ cursor: "pointer" }}
          >
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: T.text3, fontFamily: "Figtree, sans-serif" }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name) => [fmtIDR(v, true), name]}
              cursor={{ fill: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
            />
            <Bar dataKey="income" name="Income" fill="#1D9E75" radius={[3, 3, 0, 0]}>
              {trendData.map(d => (
                <Cell key={d.mo} fill={d.mo === period ? "#1D9E75" : "#1D9E7566"} />
              ))}
            </Bar>
            <Bar dataKey="expense" name="Expense" fill="#E24B4A" radius={[3, 3, 0, 0]}>
              {trendData.map(d => (
                <Cell key={d.mo} fill={d.mo === period ? "#E24B4A" : "#E24B4A66"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* Surplus row below chart */}
        <div style={{ display: "flex", justifyContent: "space-around", marginTop: 6, borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
          {trendData.map(d => (
            <div key={d.mo} style={{ textAlign: "center", flex: 1 }}>
              <div style={{
                fontSize: 9, fontWeight: 700,
                color: d.surplus >= 0 ? "#1D9E75" : "#E24B4A",
                fontFamily: "Figtree, sans-serif",
              }}>
                {d.surplus >= 0 ? "+" : ""}{fmtIDR(d.surplus, true)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── EXPENSE BY CATEGORY + TOP MERCHANTS ──────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

        {/* Expense by category */}
        <div style={card}>
          <div style={{ marginBottom: 12 }}>
            <SectionHeader title="Expense by Category" />
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
              Total: <span style={{ color: T.text, fontWeight: 700 }}>{fmtIDR(catTotal, true)}</span>
            </div>
          </div>
          {catBreakdown.length === 0 ? (
            <EmptyState icon="📊" message="No expenses this month." />
          ) : (
            catBreakdown.map(c => (
              <HBar
                key={c.id}
                T={T}
                label={`${c.icon} ${c.label}`}
                value={c.value}
                max={catTotal}
                color={c.color}
                pct={catTotal > 0 ? ((c.value / catTotal) * 100).toFixed(1) : "0"}
              />
            ))
          )}
        </div>

        {/* Right column: top merchants + income breakdown */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Top merchants */}
          <div style={card}>
            <div style={{ marginBottom: 12 }}>
              <SectionHeader title="Top Merchants" />
            </div>
            {topMerchants.length === 0 ? (
              <EmptyState icon="🏪" message="No merchant data." />
            ) : (
              topMerchants.map((m, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <span style={{
                      fontSize: 11, color: T.text2, fontFamily: "Figtree, sans-serif",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%",
                    }} title={m.name}>
                      {m.name}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>
                      {fmtIDR(m.value, true)}
                    </span>
                  </div>
                  <div style={{ background: T.border, borderRadius: 99, height: 4 }}>
                    <div style={{
                      width: `${Math.min(100, (m.value / topMerchantMax) * 100)}%`,
                      height: "100%", background: "#E24B4A", borderRadius: 99, transition: "width .4s",
                    }} />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Income by category */}
          {incomeBreakdown.length > 0 && (
            <div style={card}>
              <div style={{ marginBottom: 12 }}>
                <SectionHeader title="Income Sources" />
              </div>
              {incomeBreakdown.map(c => (
                <HBar
                  key={c.id}
                  T={T}
                  label={`${c.icon} ${c.label}`}
                  value={c.value}
                  max={totalIncome}
                  color={c.color}
                  pct={totalIncome > 0 ? ((c.value / totalIncome) * 100).toFixed(1) : "0"}
                />
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
