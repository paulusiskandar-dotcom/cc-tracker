import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, PiggyBank, AlertTriangle } from "lucide-react";
import { budgetsApi } from "../api";
import { fmtIDR } from "../utils";

const FF = "Figtree, sans-serif";

const MONTHS_FULL_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function pctColor(pct, hasBudget) {
  if (!hasBudget) return "#9ca3af";
  if (pct >= 100) return "#991b1b";
  if (pct >= 90)  return "#dc2626";
  if (pct >= 70)  return "#d97706";
  return "#059669";
}

export default function Budget({
  user, ledger = [], categories = [], budgets = [], setBudgets, onRefresh,
}) {
  const today = new Date();
  const [year,      setYear]      = useState(today.getFullYear());
  const [month,     setMonth]     = useState(today.getMonth() + 1);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [saving,    setSaving]    = useState(false);

  // Active expense categories, excluding Reimbursable Loss (display_order 999)
  const budgetableCategories = useMemo(() =>
    (categories || [])
      .filter(c => c.is_active !== false && c.display_order !== 999)
      .sort((a, b) => (a.display_order ?? 99) - (b.display_order ?? 99)),
    [categories]
  );

  // Spending per category_id for selected month
  const spendingMap = useMemo(() => {
    const target = `${year}-${String(month).padStart(2, "0")}`;
    const map = {};
    for (const e of ledger) {
      if (e.tx_type !== "expense") continue;
      if (!e.tx_date || e.tx_date.slice(0, 7) !== target) continue;
      const cid = e.category_id || "uncategorized";
      map[cid] = (map[cid] || 0) + Number(e.amount_idr || e.amount || 0);
    }
    return map;
  }, [ledger, year, month]);

  // Build per-category rows: budget from budgets table, fallback monthly_target
  const rows = useMemo(() => {
    return budgetableCategories.map(cat => {
      const existing = (budgets || []).find(
        b => b.category_id === cat.id && b.period_year === year && b.period_month === month
      );
      const amount   = existing ? Number(existing.amount) : Number(cat.monthly_target) || 0;
      const spent    = spendingMap[cat.id] || 0;
      const pct      = amount > 0 ? (spent / amount) * 100 : 0;
      const color    = pctColor(pct, amount > 0);
      return {
        cat,
        budgetId:  existing?.id || null,
        amount,
        spent,
        pct,
        color,
        remaining: amount - spent,
        fromDefault: !existing && amount > 0,
      };
    });
  }, [budgetableCategories, budgets, spendingMap, year, month]);

  const totalBudget = rows.reduce((s, r) => s + r.amount, 0);
  const totalSpent  = rows.reduce((s, r) => s + r.spent,  0);
  const overallPct  = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const overCount   = rows.filter(r => r.amount > 0 && r.pct >= 100).length;

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;

  const prevMonth = () => month === 1  ? (setMonth(12), setYear(y => y - 1)) : setMonth(m => m - 1);
  const nextMonth = () => month === 12 ? (setMonth(1),  setYear(y => y + 1)) : setMonth(m => m + 1);

  const startEdit = (row) => {
    setEditingId(row.cat.id);
    setEditValue(row.amount > 0 ? String(Math.round(row.amount)) : "");
  };

  const saveEdit = async (row) => {
    const newAmount = Number(String(editValue).replace(/[^\d.]/g, "")) || 0;
    if (newAmount === row.amount) { setEditingId(null); return; }
    setSaving(true);
    try {
      const saved = await budgetsApi.upsert(user.id, {
        category_id:   row.cat.id,
        category_name: row.cat.name,
        amount:        newAmount,
        period_year:   year,
        period_month:  month,
      });
      if (typeof setBudgets === "function") {
        setBudgets(prev => {
          const idx = prev.findIndex(b => b.id === saved.id);
          if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
          return [...prev, saved];
        });
      } else {
        onRefresh?.();
      }
    } catch (err) {
      alert("Gagal save budget: " + err.message);
    } finally {
      setSaving(false);
      setEditingId(null);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "8px 16px 80px", fontFamily: FF }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <PiggyBank size={22} strokeWidth={1.5} color="#3b5bdb" />
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>Budget</h1>
      </div>

      {/* ── Month selector ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12,
        padding: "10px 16px", marginBottom: 14,
      }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 6, display: "flex" }}>
          <ChevronLeft size={18} color="#6b7280" />
        </button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>
            {MONTHS_FULL_ID[month - 1]} {year}
          </div>
          {isCurrentMonth && (
            <div style={{ fontSize: 11, color: "#3b5bdb", marginTop: 1 }}>Bulan ini</div>
          )}
        </div>
        <button onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 6, display: "flex" }}>
          <ChevronRight size={18} color="#6b7280" />
        </button>
      </div>

      {/* ── Summary card ── */}
      <div style={{
        background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16,
        padding: "14px 16px", marginBottom: 14,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 3 }}>Total Spent</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: overallPct >= 100 ? "#991b1b" : "#111827" }}>
              {fmtIDR(totalSpent)}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 3 }}>Total Budget</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#374151" }}>{fmtIDR(totalBudget)}</div>
          </div>
        </div>
        <div style={{ height: 5, background: "#f3f4f6", borderRadius: 3, overflow: "hidden", marginBottom: 7 }}>
          <div style={{
            width: `${Math.min(100, overallPct)}%`, height: "100%",
            background: pctColor(overallPct, totalBudget > 0),
            transition: "width 0.3s",
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6b7280" }}>
          <span>{overallPct.toFixed(1)}% used</span>
          {overCount > 0 && (
            <span style={{ color: "#dc2626", display: "flex", alignItems: "center", gap: 4 }}>
              <AlertTriangle size={11} /> {overCount} kategori over budget
            </span>
          )}
        </div>
      </div>

      {/* ── Category rows ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map(row => {
          const isEditing = editingId === row.cat.id;
          return (
            <div key={row.cat.id} style={{
              background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12, padding: "12px 14px",
            }}>
              {/* Top: icon + name + spent / budget */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: row.amount > 0 ? 8 : 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 17 }}>{row.cat.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{row.cat.name}</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: row.color }}>
                    {fmtIDR(row.spent, true)}
                  </span>
                  <span style={{ fontSize: 11, color: "#d1d5db" }}>/</span>

                  {isEditing ? (
                    <input
                      type="number"
                      autoFocus
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => saveEdit(row)}
                      onKeyDown={e => {
                        if (e.key === "Enter")  e.target.blur();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      placeholder="0"
                      disabled={saving}
                      style={{
                        width: 110, padding: "3px 8px",
                        border: "1px solid #3b5bdb", borderRadius: 6,
                        fontSize: 12, fontFamily: FF, outline: "none",
                      }}
                    />
                  ) : (
                    <button
                      onClick={() => startEdit(row)}
                      title="Click to edit budget"
                      style={{
                        background: "none",
                        border: "1px dashed transparent",
                        padding: "2px 6px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 12,
                        color: row.amount > 0 ? "#374151" : "#9ca3af",
                        fontFamily: FF,
                        transition: "border-color 0.15s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = "#d1d5db"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "transparent"}
                    >
                      {row.amount > 0 ? fmtIDR(row.amount, true) : "Set budget"}
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar + status */}
              {row.amount > 0 && (
                <>
                  <div style={{ height: 4, background: "#f3f4f6", borderRadius: 3, overflow: "hidden", marginBottom: 5 }}>
                    <div style={{
                      width: `${Math.min(100, row.pct)}%`, height: "100%",
                      background: row.color, transition: "width 0.3s",
                    }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9ca3af" }}>
                    <span>{row.pct.toFixed(0)}% used{row.fromDefault ? " · default" : ""}</span>
                    <span style={{ color: row.remaining < 0 ? "#dc2626" : "#9ca3af" }}>
                      {row.remaining >= 0
                        ? `${fmtIDR(row.remaining, true)} sisa`
                        : `${fmtIDR(Math.abs(row.remaining), true)} over`}
                    </span>
                  </div>
                </>
              )}

              {/* No budget but has spending */}
              {row.amount === 0 && row.spent > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#d97706" }}>
                  <AlertTriangle size={11} />
                  Belum di-budget · spent {fmtIDR(row.spent, true)}
                </div>
              )}
            </div>
          );
        })}

        {rows.length === 0 && (
          <div style={{
            padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 13,
            background: "#f9fafb", borderRadius: 12, border: "1px solid #e5e7eb",
          }}>
            Belum ada kategori expense aktif.
          </div>
        )}
      </div>
    </div>
  );
}
