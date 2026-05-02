import { fmtIDR } from "../../utils";

const FF = "Figtree, sans-serif";
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function BudgetWidget({ budgets, ledger, onAddBudget }) {
  const now = new Date();
  const currentYear  = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const monthName    = MONTH_NAMES[currentMonth - 1];

  const activeBudgets = (budgets || [])
    .filter(b => b.period_year === currentYear && b.period_month === currentMonth)
    .slice(0, 4);

  const budgetData = activeBudgets.map(b => {
    const spent = (ledger || [])
      .filter(t => t.category_id === b.category_id && t.tx_type === "expense")
      .filter(t => {
        const d = new Date(t.tx_date + "T00:00:00");
        return d.getFullYear() === b.period_year && d.getMonth() + 1 === b.period_month;
      })
      .reduce((s, t) => s + Number(t.amount_idr || 0), 0);
    const pct   = Math.round((spent / b.amount) * 100);
    const color = pct >= 100 ? "#E24B4A" : pct >= 80 ? "#EF9F27" : "#1D9E75";
    return { ...b, spent, pct, color };
  });

  if (!activeBudgets.length) {
    return (
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, fontFamily: FF, textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#111827", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Budget</div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>No budgets set for {monthName}</div>
        {onAddBudget && (
          <button onClick={onAddBudget}
            style={{ fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontFamily: FF }}>
            + Set Budget
          </button>
        )}
      </div>
    );
  }

  const totalBudget = budgetData.reduce((s, b) => s + b.amount, 0);
  const totalSpent  = budgetData.reduce((s, b) => s + b.spent,  0);
  const totalPct    = totalBudget ? Math.round((totalSpent / totalBudget) * 100) : 0;

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, fontFamily: FF }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#111827", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Budget · {monthName}
        </span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>
          {fmtIDR(totalSpent)} / {fmtIDR(totalBudget)} · {totalPct}%
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
        {budgetData.map(b => (
          <div key={b.id}>
            <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {b.category_name}
            </div>
            <div style={{ height: 6, background: "#f3f4f6", borderRadius: 3, overflow: "hidden", marginBottom: 3 }}>
              <div style={{ width: `${Math.min(100, b.pct)}%`, height: "100%", background: b.color, borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 10, color: "#111827" }}>
              {fmtIDR(b.spent)} <span style={{ color: b.pct >= 100 ? "#A32D2D" : "#6b7280" }}>/ {fmtIDR(b.amount)} · {b.pct}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
