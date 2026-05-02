import { fmtIDR } from "../../utils";

const FF     = "Figtree, sans-serif";
const COLORS = ["#D4537E","#7F77DD","#1D9E75","#D85A30","#378ADD","#EF9F27","#888780"];
const C      = 188; // 2 * π * 30 ≈ 188.5

export default function SpendingBreakdown({ ledger }) {
  const now        = new Date();
  const thisMonth  = now.getMonth() + 1;
  const thisYear   = now.getFullYear();

  const expenses = (ledger || []).filter(t => {
    if (t.tx_type !== "expense") return false;
    const d = new Date(t.tx_date + "T00:00:00");
    return d.getFullYear() === thisYear && d.getMonth() + 1 === thisMonth;
  });

  const byCategory = {};
  expenses.forEach(t => {
    const key = t.category_name || "Uncategorized";
    byCategory[key] = (byCategory[key] || 0) + Number(t.amount_idr || 0);
  });

  const total  = Object.values(byCategory).reduce((s, n) => s + n, 0);
  const top5   = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, amount], i) => ({ name, amount, pct: total ? Math.round((amount / total) * 100) : 0, color: COLORS[i] }));
  const otherAmt = total - top5.reduce((s, c) => s + c.amount, 0);
  if (otherAmt > 0) top5.push({ name: "Other", amount: otherAmt, pct: total ? Math.round((otherAmt / total) * 100) : 0, color: "#888780" });

  if (!total) {
    return (
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, fontFamily: FF, textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#111827", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Spending Breakdown</div>
        <div style={{ fontSize: 11, color: "#9ca3af" }}>No expenses this month</div>
      </div>
    );
  }

  // Render donut slices using stroke-dasharray offsets
  let offset = 0;

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, fontFamily: FF }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#111827", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Spending Breakdown
        </span>
        <span style={{ fontSize: 10, color: "#6b7280" }}>{fmtIDR(total)}</span>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <svg viewBox="0 0 80 80" style={{ width: 70, height: 70, flexShrink: 0 }}>
          <circle cx="40" cy="40" r="30" fill="none" stroke="#f3f4f6" strokeWidth="12" />
          {top5.map((c, i) => {
            const len = (c.pct / 100) * C;
            const el  = (
              <circle key={i} cx="40" cy="40" r="30" fill="none"
                stroke={c.color} strokeWidth="12"
                strokeDasharray={`${len} ${C}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 40 40)"
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
          {top5.map(c => (
            <div key={c.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, alignItems: "center" }}>
              <span style={{ display: "flex", alignItems: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                <span style={{ display: "inline-block", width: 7, height: 7, background: c.color, borderRadius: 1, marginRight: 5, flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
              </span>
              <span style={{ color: "#6b7280", flexShrink: 0, marginLeft: 4 }}>{c.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
