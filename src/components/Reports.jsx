import { useState, useMemo } from "react";
import { fmtIDR, ym, mlShort } from "../utils";
import { EXPENSE_CATEGORIES, ENTITIES } from "../constants";
import { LIGHT, DARK } from "../theme";
import { SectionHeader, EmptyState, showToast } from "./shared/index";
import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const SUBTABS = [
  { id: "cashflow",  label: "Cash Flow"    },
  { id: "expenses",  label: "Expenses"     },
  { id: "networth",  label: "Net Worth"    },
  { id: "aging",     label: "Receivables"  },
];

const MONTHS_BACK = 12;

function monthRange(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (n - 1 - i));
    return d.toISOString().slice(0, 7);
  });
}

// ── Pure-div horizontal bar ─────────────────────────────────────
function HBar({ value, max, color, label, pct }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: "#374151" }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#111827" }}>
          {fmtIDR(value, true)} <span style={{ color: "#9ca3af", fontWeight: 400 }}>({pct}%)</span>
        </span>
      </div>
      <div style={{ background: "#e5e7eb", borderRadius: 99, height: 6 }}>
        <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 99, transition: "width .4s" }} />
      </div>
    </div>
  );
}

export default function Reports({ user, ledger, accounts, dark }) {
  const T = dark ? DARK : LIGHT;

  const [subTab, setSubTab]         = useState("cashflow");
  const [entityFilter, setEntityFilter] = useState("All");
  const [months] = useState(() => monthRange(MONTHS_BACK));

  // ── Cash Flow ───────────────────────────────────────────────
  const cashFlowData = useMemo(() => months.map(mo => {
    const entries = ledger.filter(e => e.date?.slice(0, 7) === mo);
    const filt    = entityFilter === "All" ? entries : entries.filter(e => e.entity === entityFilter);
    const income  = filt.filter(e => e.type === "income").reduce((s, e) => s + Number(e.amount_idr || 0), 0);
    const expense = filt.filter(e => e.type === "expense").reduce((s, e) => s + Number(e.amount_idr || 0), 0);
    return { month: mlShort(mo), income, expense, surplus: income - expense };
  }), [ledger, months, entityFilter]);

  const totalIncome  = cashFlowData.reduce((s, r) => s + r.income, 0);
  const totalExpense = cashFlowData.reduce((s, r) => s + r.expense, 0);
  const totalSurplus = totalIncome - totalExpense;
  const avgMonthly   = totalExpense / MONTHS_BACK;

  // ── Expense by category ─────────────────────────────────────
  const catData = useMemo(() => {
    const filtered = entityFilter === "All" ? ledger : ledger.filter(e => e.entity === entityFilter);
    const expEntries = filtered.filter(e => e.type === "expense");
    const map = {};
    expEntries.forEach(e => {
      const cat = e.category || "other";
      map[cat] = (map[cat] || 0) + Number(e.amount_idr || 0);
    });
    return Object.entries(map).map(([id, value]) => {
      const def = EXPENSE_CATEGORIES.find(c => c.id === id) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
      return { id, name: def?.label || id, value, color: def?.color || "#9ca3af", icon: def?.icon || "❓" };
    }).sort((a, b) => b.value - a.value);
  }, [ledger, entityFilter]);

  const catTotal = catData.reduce((s, c) => s + c.value, 0);

  // ── Net worth trend ─────────────────────────────────────────
  const netWorthData = useMemo(() => {
    const bankNow  = accounts.filter(a => a.type === "bank").reduce((s, a) => s + Number(a.current_balance || 0), 0);
    const assetNow = accounts.filter(a => a.type === "asset").reduce((s, a) => s + Number(a.current_value || 0), 0);
    const ccNow    = accounts.filter(a => a.type === "credit_card").reduce((s, a) => s + Number(a.current_balance || 0), 0);
    const liabNow  = accounts.filter(a => a.type === "liability").reduce((s, a) => s + Number(a.outstanding_amount || 0), 0);
    const recvNow  = accounts.filter(a => a.type === "receivable").reduce((s, a) => s + Number(a.outstanding_amount || 0), 0);

    return months.map(mo => {
      const futureEntries = ledger.filter(e => e.date?.slice(0, 7) > mo);
      let bankAdj = 0, ccAdj = 0;
      futureEntries.forEach(e => {
        const amt = Number(e.amount_idr || 0);
        if (e.type === "income")  bankAdj -= amt;
        if (e.type === "expense") bankAdj += amt;
        if (e.type === "pay_cc")  { bankAdj += amt; ccAdj += amt; }
      });
      const net = (bankNow + bankAdj) + assetNow + recvNow - Math.max(0, ccNow + ccAdj) - liabNow;
      return { month: mlShort(mo), net: Math.max(0, net) };
    });
  }, [accounts, ledger, months]);

  // ── Receivables aging ───────────────────────────────────────
  const agingData = useMemo(() => {
    const recvAccts = accounts.filter(a => a.type === "receivable" && Number(a.outstanding_amount || 0) > 0);
    return recvAccts.map(r => {
      const lastEntry = ledger.filter(e =>
        (e.from_account_id === r.id || e.to_account_id === r.id) &&
        ["reimburse_out", "give_loan"].includes(e.type)
      ).sort((a, b) => b.date.localeCompare(a.date))[0];
      const daysSince = lastEntry
        ? Math.floor((Date.now() - new Date(lastEntry.date).getTime()) / 86400000)
        : null;
      return { ...r, daysSince, lastDate: lastEntry?.date };
    }).sort((a, b) => Number(b.outstanding_amount || 0) - Number(a.outstanding_amount || 0));
  }, [accounts, ledger]);

  const totalReceivable = agingData.reduce((s, r) => s + Number(r.outstanding_amount || 0), 0);

  // ── CSV Export ──────────────────────────────────────────────
  const exportCSV = (type) => {
    let csv = "";
    if (type === "cashflow") {
      csv = "Month,Income,Expense,Surplus\n";
      cashFlowData.forEach(r => { csv += `${r.month},${r.income},${r.expense},${r.surplus}\n`; });
    } else if (type === "expenses") {
      csv = "Category,Amount,% of Total\n";
      catData.forEach(c => { csv += `${c.name},${c.value},${catTotal > 0 ? ((c.value / catTotal) * 100).toFixed(1) : 0}%\n`; });
    } else {
      csv = "Date,Type,Description,Category,Entity,Amount IDR,Currency\n";
      const src = entityFilter === "All" ? ledger : ledger.filter(e => e.entity === entityFilter);
      src.forEach(e => {
        csv += `${e.date},${e.type},"${(e.description || "").replace(/"/g, '""')}",${e.category || ""},${e.entity || ""},${e.amount_idr || e.amount || 0},${e.currency || "IDR"}\n`;
      });
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `paulus-finance-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${type} CSV`);
  };

  // ── Styles ──────────────────────────────────────────────────
  const card = {
    background: T.surface, border: `1px solid ${T.border}`,
    borderRadius: 16, padding: "16px 18px",
  };
  const tooltipStyle = {
    background: T.surface, border: `1px solid ${T.border}`,
    borderRadius: 8, fontSize: 11,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── HEADER ─────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => exportCSV("transactions")}
          style={{
            padding: "6px 14px", borderRadius: 8, border: `1px solid ${T.border}`,
            background: T.surface, color: T.text2, fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: "Figtree, sans-serif",
          }}
        >
          ⬇ Export CSV
        </button>
      </div>

      {/* ── SUB-TABS ─────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {SUBTABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              padding: "7px 16px", borderRadius: 99, border: "none",
              cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "Figtree, sans-serif",
              background: subTab === t.id ? T.text    : T.sur2,
              color:      subTab === t.id ? T.darkText : T.text2,
              transition: "background .15s, color .15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Entity filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {["All", ...ENTITIES].map(e => (
          <button
            key={e}
            onClick={() => setEntityFilter(e)}
            style={{
              padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
              cursor: "pointer", fontFamily: "Figtree, sans-serif",
              background:  entityFilter === e ? T.ac    : "transparent",
              color:       entityFilter === e ? "#fff"  : T.text3,
              border:      `1px solid ${entityFilter === e ? T.ac : T.border}`,
            }}
          >
            {e}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* ── CASH FLOW ────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "cashflow" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {[
              { label: "Total Income",  value: totalIncome,  color: "#059669" },
              { label: "Total Expense", value: totalExpense, color: "#dc2626" },
              { label: "Net Surplus",   value: totalSurplus, color: totalSurplus >= 0 ? "#059669" : "#dc2626" },
            ].map(s => (
              <div key={s.label} style={{ ...card, background: T.sur2, border: "none" }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: T.text3, letterSpacing: "0.05em" }}>
                  {s.label.toUpperCase()}
                </div>
                <div style={{ fontSize: 14, fontWeight: 900, color: s.color, marginTop: 4 }}>
                  {fmtIDR(Math.abs(s.value), true)}
                </div>
              </div>
            ))}
          </div>

          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <SectionHeader title="12-Month Cash Flow" />
              <button onClick={() => exportCSV("cashflow")} style={{
                background: "none", border: `1px solid ${T.border}`, borderRadius: 6,
                padding: "3px 8px", fontSize: 10, color: T.text3, cursor: "pointer",
                fontFamily: "Figtree, sans-serif",
              }}>CSV</button>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={cashFlowData} barSize={7} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: T.text3 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={tooltipStyle} formatter={v => fmtIDR(v, true)} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="income"  name="Income"  fill="#059669" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" name="Expense" fill="#dc2626" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ ...card, overflowX: "auto" }}>
            <SectionHeader title="Monthly Detail" />
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 10 }}>
              <thead>
                <tr>
                  {["Month", "Income", "Expense", "Surplus"].map(h => (
                    <th key={h} style={{
                      textAlign: h === "Month" ? "left" : "right",
                      padding: "5px 8px", color: T.text3, fontWeight: 600,
                      borderBottom: `1px solid ${T.border}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...cashFlowData].reverse().map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: "5px 8px", color: T.text }}>{r.month}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: "#059669", fontWeight: 700 }}>{fmtIDR(r.income, true)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: "#dc2626", fontWeight: 700 }}>{fmtIDR(r.expense, true)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: r.surplus >= 0 ? "#059669" : "#dc2626", fontWeight: 800 }}>
                      {r.surplus >= 0 ? "+" : ""}{fmtIDR(r.surplus, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${T.border}` }}>
                  <td style={{ padding: "6px 8px", color: T.text, fontWeight: 800 }}>Total</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: "#059669", fontWeight: 800 }}>{fmtIDR(totalIncome, true)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: "#dc2626", fontWeight: 800 }}>{fmtIDR(totalExpense, true)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: totalSurplus >= 0 ? "#059669" : "#dc2626", fontWeight: 800 }}>
                    {totalSurplus >= 0 ? "+" : ""}{fmtIDR(totalSurplus, true)}
                  </td>
                </tr>
              </tfoot>
            </table>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 8 }}>
              Monthly avg expense: <span style={{ color: T.text, fontWeight: 700 }}>{fmtIDR(avgMonthly, true)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── EXPENSES ─────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "expenses" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {catData.length === 0 ? (
            <EmptyState icon="📊" message="No expense data yet." />
          ) : (
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <SectionHeader title="Expense by Category" />
                <button onClick={() => exportCSV("expenses")} style={{
                  background: "none", border: `1px solid ${T.border}`, borderRadius: 6,
                  padding: "3px 8px", fontSize: 10, color: T.text3, cursor: "pointer",
                  fontFamily: "Figtree, sans-serif",
                }}>CSV</button>
              </div>
              <div style={{ fontSize: 11, color: T.text3, marginBottom: 10 }}>
                Total: <span style={{ color: T.text, fontWeight: 700 }}>{fmtIDR(catTotal, true)}</span>
              </div>
              {catData.map(c => (
                <HBar
                  key={c.id}
                  label={`${c.icon} ${c.name}`}
                  value={c.value}
                  max={catTotal}
                  color={c.color}
                  pct={catTotal > 0 ? ((c.value / catTotal) * 100).toFixed(1) : 0}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── NET WORTH ────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "networth" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={card}>
            <SectionHeader title="Net Worth Trend (12 months)" />
            {netWorthData.every(d => d.net === 0) ? (
              <EmptyState icon="📈" message="Not enough data to show trend." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={netWorthData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b5bdb" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b5bdb" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: T.text3 }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip contentStyle={tooltipStyle} formatter={v => fmtIDR(v, true)} />
                  <Area type="monotone" dataKey="net" name="Net Worth" stroke="#3b5bdb" strokeWidth={2} fill="url(#netGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div style={card}>
            <SectionHeader title="Current Portfolio Breakdown" />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {[
                { label: "Bank Accounts", value: accounts.filter(a => a.type === "bank").reduce((s, a) => s + Number(a.current_balance || 0), 0), color: "#3b5bdb" },
                { label: "Assets",        value: accounts.filter(a => a.type === "asset").reduce((s, a) => s + Number(a.current_value || 0), 0), color: "#059669" },
                { label: "Receivables",   value: accounts.filter(a => a.type === "receivable").reduce((s, a) => s + Number(a.outstanding_amount || 0), 0), color: "#0891b2" },
                { label: "CC Debt",       value: -accounts.filter(a => a.type === "credit_card").reduce((s, a) => s + Math.max(0, Number(a.current_balance || 0)), 0), color: "#e67700" },
                { label: "Liabilities",   value: -accounts.filter(a => a.type === "liability").reduce((s, a) => s + Number(a.outstanding_amount || 0), 0), color: "#dc2626" },
              ].map((item, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 12px", background: T.sur2, borderRadius: 10,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: item.color }} />
                    <span style={{ fontSize: 12, color: T.text2 }}>{item.label}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: item.value >= 0 ? T.text : "#dc2626" }}>
                    {item.value < 0 ? "−" : ""}{fmtIDR(Math.abs(item.value), true)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── RECEIVABLES AGING ────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "aging" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <SectionHeader title="Receivables Aging" />
              <span style={{ fontSize: 13, fontWeight: 800, color: "#e67700" }}>{fmtIDR(totalReceivable, true)}</span>
            </div>
            {agingData.length === 0 ? (
              <EmptyState icon="📋" message="No outstanding receivables." />
            ) : (
              agingData.map(r => {
                const days = r.daysSince;
                const agingColor = days == null ? T.text3 : days > 90 ? "#dc2626" : days > 30 ? "#e67700" : "#059669";
                return (
                  <div key={r.id} style={{
                    padding: "12px 14px", background: T.sur2, borderRadius: 10, marginBottom: 8,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                          {r.entity !== "Personal" && r.entity} {r.subtype && ` · ${r.subtype}`}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#e67700" }}>
                          {fmtIDR(Number(r.outstanding_amount || 0), true)}
                        </div>
                        {days != null && (
                          <div style={{ fontSize: 10, color: agingColor, fontWeight: 700, marginTop: 2 }}>
                            {days === 0 ? "Today" : `${days}d ago`}
                            {days > 90 ? " ⚠️ Overdue" : days > 30 ? " ⚡ Follow up" : ""}
                          </div>
                        )}
                      </div>
                    </div>
                    {r.lastDate && <div style={{ fontSize: 10, color: T.text3, marginTop: 6 }}>Last: {r.lastDate}</div>}
                  </div>
                );
              })
            )}
          </div>

          {/* Aging buckets */}
          {agingData.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "< 30 days",  color: "#059669", filter: r => (r.daysSince || 0) <= 30 },
                { label: "30–60 days", color: "#e67700", filter: r => (r.daysSince || 0) > 30 && (r.daysSince || 0) <= 60 },
                { label: "60–90 days", color: "#dc2626", filter: r => (r.daysSince || 0) > 60 && (r.daysSince || 0) <= 90 },
                { label: "> 90 days",  color: "#9f1239", filter: r => (r.daysSince || 0) > 90 },
              ].map((b, i) => {
                const items = agingData.filter(b.filter);
                const total = items.reduce((s, r) => s + Number(r.outstanding_amount || 0), 0);
                return (
                  <div key={i} style={{ ...card, background: T.sur2, border: "none", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: T.text3, marginBottom: 4 }}>{b.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: b.color }}>{fmtIDR(total, true)}</div>
                    <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{items.length} items</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
