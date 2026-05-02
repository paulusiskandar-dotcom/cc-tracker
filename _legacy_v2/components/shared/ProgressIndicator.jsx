// Shared progress indicator — AI Scan, E-Statement, Gmail, Reconcile
const FF = "Figtree, sans-serif";

/**
 * Props:
 *   total     — total items in the batch
 *   processed — items completed (saved / ignored / skipped)
 *   pending   — items still needing action
 *   matched   — (Reconcile only) items auto-matched from PDF
 *   label     — context label e.g. "Review" | "Email Sync" | "Reconcile"
 */
export default function ProgressIndicator({ total, processed, pending, matched, label = "Progress" }) {
  if (!total) return null;
  const pct    = Math.min(100, Math.round((processed / total) * 100));
  const isDone = processed >= total;

  return (
    <div style={{
      background: isDone ? "#f0fdf4" : "#eff6ff",
      border: `1px solid ${isDone ? "#bbf7d0" : "#bfdbfe"}`,
      borderRadius: 10, padding: "8px 14px", fontFamily: FF,
    }}>
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: isDone ? "#059669" : "#1d4ed8" }}>
            {label}
          </span>
          <span style={{ fontSize: 11, color: "#6b7280" }}>
            {processed} / {total}
          </span>
          {isDone && <span style={{ fontSize: 10, fontWeight: 700, color: "#059669" }}>✓ All done</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {matched != null && matched > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", background: "#dcfce7", padding: "2px 6px", borderRadius: 4 }}>
              {matched} matched
            </span>
          )}
          {pending > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "#d97706", background: "#fef3c7", padding: "2px 6px", borderRadius: 4 }}>
              {pending} pending
            </span>
          )}
          <span style={{ fontSize: 11, fontWeight: 800, color: isDone ? "#059669" : "#1d4ed8" }}>
            {pct}%
          </span>
        </div>
      </div>

      {/* Bar */}
      <div style={{ height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%",
          background: isDone ? "#10b981" : "#3b5bdb",
          transition: "width 0.3s ease",
        }} />
      </div>
    </div>
  );
}
