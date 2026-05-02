import { useState, useRef, useEffect } from "react";
import { Field } from "./Input";

// ─── NATIVE SELECT (styled) ───────────────────────────────────
export default function Select({
  label, value, onChange, options = [], placeholder,
  error, hint, disabled = false, style = {}, inputStyle = {},
}) {
  const [focused, setFocused] = useState(false);

  return (
    <Field label={label} error={error} hint={hint} style={style}>
      <div style={{ position: "relative" }}>
        <select
          value={value ?? ""}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          style={{
            width:            "100%",
            height:           44,
            padding:          "0 36px 0 14px",
            border:           `1.5px solid ${error ? "#dc2626" : focused ? "#3b5bdb" : "#e5e7eb"}`,
            borderRadius:     10,
            fontFamily:       "Figtree, sans-serif",
            fontSize:         14,
            fontWeight:       500,
            color:            value ? "#111827" : "#9ca3af",
            background:       "#ffffff",
            outline:          "none",
            boxSizing:        "border-box",
            appearance:       "none",
            WebkitAppearance: "none",
            cursor:           disabled ? "not-allowed" : "pointer",
            opacity:          disabled ? 0.55 : 1,
            boxShadow:        focused ? "0 0 0 3px #dbeafe" : "none",
            transition:       "border-color 0.15s, box-shadow 0.15s",
            ...inputStyle,
          }}
        >
          {placeholder && (
            <option value="" disabled>{placeholder}</option>
          )}
          {options.map((opt) => {
            const val   = typeof opt === "string" ? opt : opt.value ?? opt.id;
            const label = typeof opt === "string" ? opt : opt.label ?? opt.name ?? opt.value;
            return (
              <option key={val} value={val}>{label}</option>
            );
          })}
        </select>
        {/* Custom chevron */}
        <span style={{
          position:       "absolute",
          right:          12,
          top:            "50%",
          transform:      "translateY(-50%)",
          pointerEvents:  "none",
          fontSize:       10,
          color:          "#9ca3af",
        }}>
          ▾
        </span>
      </div>
    </Field>
  );
}

// ─── SEGMENTED CONTROL ────────────────────────────────────────
// For small sets of mutually exclusive options (2–4 items)
export function SegmentedControl({ value, onChange, options = [], style = {} }) {
  return (
    <div style={{
      display:      "flex",
      background:   "#f3f4f6",
      borderRadius: 10,
      padding:      3,
      gap:          2,
      ...style,
    }}>
      {options.map((opt) => {
        const val   = typeof opt === "string" ? opt : opt.value;
        const label = typeof opt === "string" ? opt : opt.label;
        const active = value === val;
        return (
          <button
            key={val}
            onClick={() => onChange(val)}
            style={{
              flex:         1,
              height:       34,
              borderRadius: 8,
              border:       "none",
              background:   active ? "#ffffff" : "transparent",
              color:        active ? "#111827" : "#6b7280",
              fontSize:     13,
              fontWeight:   active ? 700 : 500,
              cursor:       "pointer",
              fontFamily:   "Figtree, sans-serif",
              boxShadow:    active ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
              transition:   "all 0.15s",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ─── PILL SELECTOR ────────────────────────────────────────────
// Multi-row pill buttons for selecting from a set (e.g. entity, category)
export function PillSelector({ value, onChange, options = [], style = {} }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, ...style }}>
      {options.map((opt) => {
        const val    = typeof opt === "string" ? opt : opt.value ?? opt.id;
        const label  = typeof opt === "string" ? opt : opt.label ?? opt.name ?? val;
        const icon   = typeof opt === "object" ? opt.icon : null;
        const color  = typeof opt === "object" ? opt.color : null;
        const active = value === val;
        return (
          <button
            key={val}
            onClick={() => onChange(val)}
            style={{
              height:       32,
              padding:      "0 12px",
              borderRadius: 20,
              border:       `1.5px solid ${active ? (color || "#3b5bdb") : "#e5e7eb"}`,
              background:   active ? (color ? color + "22" : "#dbeafe") : "#ffffff",
              color:        active ? (color || "#3b5bdb") : "#374151",
              fontSize:     12,
              fontWeight:   active ? 700 : 500,
              cursor:       "pointer",
              fontFamily:   "Figtree, sans-serif",
              display:      "flex",
              alignItems:   "center",
              gap:          4,
              transition:   "all 0.15s",
            }}
          >
            {icon && <span>{icon}</span>}
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ─── TX TYPE GRID ─────────────────────────────────────────────
// 2×4 grid of transaction type buttons for step 1 of add transaction
export function TxTypeGrid({ value, onChange, types = [] }) {
  return (
    <div style={{
      display:             "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap:                 8,
    }}>
      {types.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              padding:        "14px 8px",
              borderRadius:   12,
              border:         `1.5px solid ${active ? t.color : "#e5e7eb"}`,
              background:     active ? t.color + "18" : "#f9fafb",
              color:          active ? t.color : "#374151",
              fontSize:       12,
              fontWeight:     active ? 700 : 500,
              cursor:         "pointer",
              fontFamily:     "Figtree, sans-serif",
              display:        "flex",
              flexDirection:  "column",
              alignItems:     "center",
              gap:            6,
              transition:     "all 0.15s",
            }}
          >
            <span style={{ fontSize: 20 }}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── NATIVE ACCOUNT SELECT ───────────────────────────────────────
// Native <select> with 3 optgroups: BANK / CASH / CREDIT CARDS
// Each group sorted A-Z. Pass showCC=true to include credit card group.
export function NativeAccountSelect({
  accounts = [], value, onChange, placeholder = "— Account —",
  style = {}, showCC = false,
}) {
  const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
  const banks  = accounts.filter(a => a.type === "bank" && a.subtype !== "cash").sort(byName);
  const cash   = accounts.filter(a => a.type === "bank" && a.subtype === "cash").sort(byName);
  const cards  = showCC ? accounts.filter(a => a.type === "credit_card").sort(byName) : [];
  return (
    <select value={value || ""} onChange={onChange} style={style}>
      <option value="">{placeholder}</option>
      {banks.length > 0 && (
        <optgroup label="BANK">
          {banks.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </optgroup>
      )}
      {cash.length > 0 && (
        <optgroup label="CASH">
          {cash.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </optgroup>
      )}
      {cards.length > 0 && (
        <optgroup label="CREDIT CARDS">
          {cards.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}{(a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : ""}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

// ─── ACCOUNT SELECT ───────────────────────────────────────────
// Styled select that shows account name + balance
export function AccountSelect({ label, value, onChange, accounts = [], placeholder, error, style = {} }) {
  const options = accounts.map(a => ({
    value: a.id,
    label: a.name + (a.bank_name ? ` · ${a.bank_name}` : ""),
  }));
  return (
    <Select
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder || "Select account"}
      error={error}
      style={style}
    />
  );
}
