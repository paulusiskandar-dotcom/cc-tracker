import Modal from "./Modal";
import { fmtIDR } from "../../utils";

export default function BankPickerSheet({
  isOpen, onClose, onSelect, bankAccounts = [],
  title = "Select Bank Account",
  contextLabel, contextAmount, mode = "default",
}) {
  const filtered = bankAccounts.filter(a => a.subtype !== "cash");

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width={360}>
      <div>
        {contextLabel && (
          <div style={{ marginBottom: 14, padding: "10px 12px", background: "#f9fafb", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2, fontFamily: "Figtree, sans-serif" }}>
              {mode === "credit" ? "Receive into:" : "Pay from:"}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
              {contextLabel}{" "}
              {contextAmount && (
                <span style={{ color: "#dc2626" }}>{contextAmount}</span>
              )}
            </div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
          {filtered.map(b => (
            <div
              key={b.id}
              onClick={() => onSelect?.(b)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                cursor: "pointer",
                background: "#fff",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "#f9fafb";
                e.currentTarget.style.borderColor = "#14532d";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "#fff";
                e.currentTarget.style.borderColor = "#e5e7eb";
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                  {b.name}
                </div>
                {b.bank_name && (
                  <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                    {b.bank_name}
                  </div>
                )}
              </div>
              <div style={{
                fontSize: 12, fontWeight: 600, fontFamily: "Figtree, sans-serif",
                color: (b.current_balance || 0) > 0 ? "#059669" : "#9ca3af",
              }}>
                {fmtIDR(b.current_balance || 0, true)}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ fontSize: 13, color: "#9ca3af", textAlign: "center", padding: "24px 0", fontFamily: "Figtree, sans-serif" }}>
              No bank accounts found
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
