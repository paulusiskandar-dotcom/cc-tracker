import { useState } from "react";
import { ENTITIES } from "../../constants";
import { TX_HORIZONTAL_TYPES } from "./TxHorizontal";
import { showToast } from "./Card";

const FF = "Figtree, sans-serif";

// Types that don't use a category field (mirrors TxHorizontal NO_CAT_TYPES)
const NO_CAT_TYPES = new Set([
  "transfer","pay_cc","give_loan","collect_loan","fx_exchange",
  "reimburse_in","reimburse_out","buy_asset","sell_asset","pay_liability","cc_installment",
]);

const SEL = {
  width: "100%", padding: "9px 12px", border: "1.5px solid #e5e7eb",
  borderRadius: 8, fontSize: 13, fontFamily: FF, color: "#111827",
  background: "#fff", cursor: "pointer", appearance: "none",
};

function FieldRow({ label, active, onToggle, disabled, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <label style={{
        display: "flex", alignItems: "center", gap: 7, cursor: disabled ? "default" : "pointer",
        width: 88, flexShrink: 0,
      }}>
        <input
          type="checkbox" checked={active} onChange={onToggle} disabled={disabled}
          style={{ accentColor: "#3b5bdb", width: 15, height: 15, cursor: disabled ? "default" : "pointer" }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: disabled ? "#c4c4c4" : "#374151", fontFamily: FF }}>
          {label}
        </span>
      </label>
      <div style={{ flex: 1, opacity: active && !disabled ? 1 : 0.3, pointerEvents: active && !disabled ? "auto" : "none" }}>
        {children}
      </div>
    </div>
  );
}

// Props:
//   open        bool
//   onClose     () => void
//   onApply     (patch: object) => void
//   count       int   — number of rows that will be updated
//   mode        "selected" | "all"
//   accounts    Account[]
//   categories  Category[]
//   incomeSrcs  IncomeSource[]
//   txTypes     {value, label, color}[]  — caller-filtered list
export default function BulkEditModal({
  open, onClose, onApply,
  count = 0, mode = "selected",
  accounts = [], categories = [], incomeSrcs = [],
  txTypes,
}) {
  const [typeOn,    setTypeOn]    = useState(false);
  const [catOn,     setCatOn]     = useState(false);
  const [accountOn, setAccountOn] = useState(false);
  const [entityOn,  setEntityOn]  = useState(false);
  const [type,      setType]      = useState("");
  const [cat,       setCat]       = useState("");
  const [account,   setAccount]   = useState("");
  const [entity,    setEntity]    = useState("");

  if (!open) return null;

  const effectiveTypes = txTypes || TX_HORIZONTAL_TYPES.filter(t => t.value !== "cc_installment");
  const catDisabled    = typeOn && !!type && NO_CAT_TYPES.has(type);
  const isIncome       = type === "income";
  const catOptions     = isIncome ? incomeSrcs : categories;
  const spendAccounts  = accounts.filter(a => ["bank","cash","credit_card"].includes(a.type));

  const handleTypeChange = (v) => {
    setType(v);
    if (cat && v && NO_CAT_TYPES.has(v)) { setCat(""); return; }
    if (cat && v) {
      const inIncome  = incomeSrcs.some(c => c.id === cat);
      const inExpense = categories.some(c => c.id === cat);
      const toIncome  = v === "income";
      const toExpense = ["expense","reimburse_out"].includes(v);
      if ((toIncome && !inIncome) || (toExpense && !inExpense)) setCat("");
    }
  };

  // Build preview
  const changedFields = [];
  if (typeOn && type)               changedFields.push("type");
  if (catOn && cat && !catDisabled) changedFields.push("category");
  if (accountOn && account)         changedFields.push("account");
  if (entityOn && entity)           changedFields.push("entity");

  const rowLabel = mode === "all"
    ? `all ${count} pending row${count !== 1 ? "s" : ""}`
    : `${count} row${count !== 1 ? "s" : ""}`;

  const handleApply = () => {
    const patch = {};
    if (typeOn && type) patch.tx_type = type;
    if (catOn && cat && !catDisabled) {
      patch.category_id   = cat;
      const found = [...categories, ...incomeSrcs].find(c => c.id === cat);
      patch.category_name = found?.label || found?.name || "";
    }
    if (accountOn && account) patch.from_id = account;
    if (entityOn && entity)   patch.entity  = entity;

    if (!Object.keys(patch).length) {
      showToast("Toggle at least one field on", "warning");
      return;
    }
    onApply(patch);
    handleReset();
    onClose();
  };

  const handleReset = () => {
    setTypeOn(false); setCatOn(false); setAccountOn(false); setEntityOn(false);
    setType(""); setCat(""); setAccount(""); setEntity("");
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16, padding: 28,
          width: "min(520px, 92vw)", display: "flex", flexDirection: "column", gap: 20,
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, fontFamily: FF }}>Bulk Edit</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#111827", fontFamily: FF, marginTop: 2 }}>
              {mode === "all" ? `Apply to all ${count} rows` : `Edit ${count} selected`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#9ca3af", lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        {mode === "all" && (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#92400e", fontFamily: FF }}>
            Will apply to all {count} pending rows (reconcile view has no row selection).
          </div>
        )}

        {/* Field rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Type */}
          <FieldRow label="Type" active={typeOn} onToggle={() => setTypeOn(v => !v)}>
            <select style={SEL} value={type} onChange={e => handleTypeChange(e.target.value)}>
              <option value="">Select type…</option>
              {effectiveTypes.map(t => (
                <option key={t.value} value={t.value} style={{ color: t.color, fontWeight: 600 }}>
                  {t.label}
                </option>
              ))}
            </select>
          </FieldRow>

          {/* Category / Source */}
          <FieldRow
            label={isIncome ? "Source" : "Category"}
            active={catOn && !catDisabled}
            disabled={catDisabled}
            onToggle={() => { if (!catDisabled) setCatOn(v => !v); }}
          >
            {catDisabled ? (
              <div style={{ ...SEL, color: "#9ca3af", background: "#f3f4f6", display: "flex", alignItems: "center", pointerEvents: "none" }}>
                N/A for {effectiveTypes.find(t => t.value === type)?.label || type}
              </div>
            ) : !typeOn || !type ? (
              <select style={SEL} value={cat} onChange={e => setCat(e.target.value)}>
                <option value="">Select category…</option>
                <optgroup label="Expense Categories">
                  {categories.map(c => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ${c.label || c.name}` : (c.label || c.name)}</option>)}
                </optgroup>
                <optgroup label="Income Sources">
                  {incomeSrcs.map(c => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ${c.name}` : c.name}</option>)}
                </optgroup>
              </select>
            ) : (
              <select style={SEL} value={cat} onChange={e => setCat(e.target.value)}>
                <option value="">Select {isIncome ? "source" : "category"}…</option>
                {catOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ${c.label || c.name}` : (c.label || c.name)}</option>
                ))}
              </select>
            )}
          </FieldRow>

          {/* Account */}
          <FieldRow label="Account" active={accountOn} onToggle={() => setAccountOn(v => !v)}>
            <select style={SEL} value={account} onChange={e => setAccount(e.target.value)}>
              <option value="">Select account…</option>
              {spendAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </FieldRow>

          {/* Entity */}
          <FieldRow label="Entity" active={entityOn} onToggle={() => setEntityOn(v => !v)}>
            <select style={SEL} value={entity} onChange={e => setEntity(e.target.value)}>
              <option value="">Select entity…</option>
              {ENTITIES.map(en => <option key={en} value={en}>{en}</option>)}
            </select>
          </FieldRow>

        </div>

        {/* Preview */}
        <div style={{
          background: changedFields.length ? "#eff6ff" : "#f9fafb",
          border: `1px solid ${changedFields.length ? "#bfdbfe" : "#e5e7eb"}`,
          borderRadius: 8, padding: "10px 14px", fontSize: 12,
          color: changedFields.length ? "#1d4ed8" : "#9ca3af", fontFamily: FF, fontWeight: changedFields.length ? 600 : 400,
        }}>
          {changedFields.length
            ? `Will update ${rowLabel}: ${changedFields.join(", ")}`
            : "Toggle at least one field to enable apply"}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
          <button
            onClick={handleReset}
            style={{ fontSize: 12, padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", color: "#6b7280", fontFamily: FF }}
          >
            Reset
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{ fontSize: 13, padding: "10px 18px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontFamily: FF, color: "#374151" }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!changedFields.length}
              style={{
                fontSize: 13, fontWeight: 700, padding: "10px 22px", borderRadius: 8, border: "none",
                background: changedFields.length ? "#3b5bdb" : "#e5e7eb",
                color: changedFields.length ? "#fff" : "#9ca3af",
                cursor: changedFields.length ? "pointer" : "default",
                fontFamily: FF,
              }}
            >
              Apply to {rowLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
