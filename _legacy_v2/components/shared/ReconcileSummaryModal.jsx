import Modal from "./Modal";
import { fmtIDR } from "../../utils";

const FF = "Figtree, sans-serif";

export default function ReconcileSummaryModal({
  open, onClose, onProceed, onRecheck,
  stats, pdfFilename, account, period,
  stmtClosingBalance, ledgerClosingBalance,
  addedCount,
}) {
  if (!open) return null;

  const diff = stmtClosingBalance != null && ledgerClosingBalance != null
    ? Math.round(stmtClosingBalance - ledgerClosingBalance)
    : null;
  const balanceMatch = diff === 0;
  const hasBalance = stmtClosingBalance != null && ledgerClosingBalance != null;

  return (
    <Modal isOpen={open} onClose={onClose} title="Reconcile Summary" width={560}>
      <div style={{ padding: "12px 4px", fontFamily: FF, display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Header */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{account?.name}</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            {period} · {pdfFilename || "(no PDF)"}
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <StatCard label="Matched"  value={stats?.match   || 0} color="#059669" bg="#dcfce7" />
          <StatCard label="Added"    value={addedCount      || 0} color="#1d4ed8" bg="#dbeafe" />
          <StatCard label="Missing"  value={stats?.missing || 0} color="#d97706" bg="#fef3c7" />
          <StatCard label="Extra"    value={stats?.extra   || 0} color="#dc2626" bg="#fee2e2" />
        </div>

        {/* Closing balance check */}
        {hasBalance && (
          <div style={{
            background: balanceMatch ? "#f0fdf4" : "#fff7ed",
            border: `1px solid ${balanceMatch ? "#bbf7d0" : "#fed7aa"}`,
            borderRadius: 8, padding: 10,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: balanceMatch ? "#059669" : "#c2410c", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
              {balanceMatch ? "✓ Closing Balance Matches" : "⚠ Closing Balance Mismatch"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11, color: "#374151" }}>
              <div>Statement PDF: <b>{fmtIDR(stmtClosingBalance)}</b></div>
              <div>Ledger: <b>{fmtIDR(ledgerClosingBalance)}</b></div>
              {!balanceMatch && diff != null && (
                <div style={{ gridColumn: "1 / -1", color: "#c2410c", fontWeight: 600 }}>
                  Difference: {diff > 0 ? "+" : ""}{fmtIDR(Math.abs(diff))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
          <button onClick={onRecheck}
            style={{ fontSize: 12, fontWeight: 600, padding: "8px 16px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", cursor: "pointer", fontFamily: FF }}>
            Recheck
          </button>
          <button onClick={onProceed}
            style={{ fontSize: 12, fontWeight: 700, padding: "8px 18px", borderRadius: 6, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontFamily: FF }}>
            Proceed
          </button>
        </div>
      </div>
    </Modal>
  );
}

function StatCard({ label, value, color, bg }) {
  return (
    <div style={{ background: bg, borderRadius: 8, padding: "10px 12px", fontFamily: FF }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}
