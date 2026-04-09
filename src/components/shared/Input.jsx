import { useState } from "react";

// ─── FIELD WRAPPER ────────────────────────────────────────────
export function Field({ label, children, error, hint, style = {} }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, ...style }}>
      {label && (
        <label style={{
          fontSize:      11,
          fontWeight:    700,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color:         "#9ca3af",
          fontFamily:    "Figtree, sans-serif",
        }}>
          {label}
        </label>
      )}
      {children}
      {error && (
        <span style={{ fontSize: 11, color: "#dc2626", fontFamily: "Figtree, sans-serif" }}>
          {error}
        </span>
      )}
      {hint && !error && (
        <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
          {hint}
        </span>
      )}
    </div>
  );
}

// ─── BASE INPUT STYLES ────────────────────────────────────────
const inputBase = (focused, hasError) => ({
  width:          "100%",
  height:         44,
  padding:        "0 14px",
  border:         `1.5px solid ${hasError ? "#dc2626" : focused ? "#3b5bdb" : "#e5e7eb"}`,
  borderRadius:   10,
  fontFamily:     "Figtree, sans-serif",
  fontSize:       14,
  fontWeight:     500,
  color:          "#111827",
  background:     "#ffffff",
  outline:        "none",
  boxSizing:      "border-box",
  transition:     "border-color 0.15s",
  boxShadow:      focused ? "0 0 0 3px #dbeafe" : "none",
});

// ─── INPUT ────────────────────────────────────────────────────
export default function Input({
  label, value, onChange, placeholder, type = "text",
  error, hint, disabled = false, prefix, suffix,
  style = {}, inputStyle = {}, autoFocus = false, ...props
}) {
  const [focused, setFocused] = useState(false);

  const hasWrap = prefix || suffix;

  const input = (
    <input
      type={type}
      value={value ?? ""}
      onChange={onChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      style={{
        ...inputBase(focused, !!error),
        ...(hasWrap ? { border: "none", boxShadow: "none", height: "100%", flex: 1, minWidth: 0, padding: "0 12px" } : {}),
        opacity:    disabled ? 0.55 : 1,
        cursor:     disabled ? "not-allowed" : "text",
        ...inputStyle,
      }}
      {...props}
    />
  );

  const wrapped = hasWrap ? (
    <div style={{
      display:      "flex",
      alignItems:   "center",
      border:       `1.5px solid ${error ? "#dc2626" : focused ? "#3b5bdb" : "#e5e7eb"}`,
      borderRadius: 10,
      background:   "#ffffff",
      boxShadow:    focused ? "0 0 0 3px #dbeafe" : "none",
      transition:   "border-color 0.15s, box-shadow 0.15s",
      height:       44,
      overflow:     "hidden",
    }}>
      {prefix && (
        <span style={{
          padding:    "0 12px 0 14px",
          fontSize:   14,
          fontWeight: 600,
          color:      "#6b7280",
          fontFamily: "Figtree, sans-serif",
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}>
          {prefix}
        </span>
      )}
      {input}
      {suffix && (
        <span style={{
          padding:    "0 14px 0 8px",
          fontSize:   14,
          fontWeight: 600,
          color:      "#6b7280",
          fontFamily: "Figtree, sans-serif",
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}>
          {suffix}
        </span>
      )}
    </div>
  ) : input;

  if (!label && !error && !hint) return <div style={style}>{wrapped}</div>;

  return (
    <Field label={label} error={error} hint={hint} style={style}>
      {wrapped}
    </Field>
  );
}

// ─── TEXTAREA ─────────────────────────────────────────────────
export function Textarea({
  label, value, onChange, placeholder, rows = 3,
  error, hint, style = {}, ...props
}) {
  const [focused, setFocused] = useState(false);

  return (
    <Field label={label} error={error} hint={hint} style={style}>
      <textarea
        value={value ?? ""}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        rows={rows}
        style={{
          width:        "100%",
          padding:      "10px 14px",
          border:       `1.5px solid ${error ? "#dc2626" : focused ? "#3b5bdb" : "#e5e7eb"}`,
          borderRadius: 10,
          fontFamily:   "Figtree, sans-serif",
          fontSize:     14,
          fontWeight:   500,
          color:        "#111827",
          background:   "#ffffff",
          outline:      "none",
          resize:       "vertical",
          boxSizing:    "border-box",
          lineHeight:   1.5,
          boxShadow:    focused ? "0 0 0 3px #dbeafe" : "none",
          transition:   "border-color 0.15s, box-shadow 0.15s",
        }}
        {...props}
      />
    </Field>
  );
}

// ─── AMOUNT INPUT ─────────────────────────────────────────────
// Handles number formatting with dot separators
export function AmountInput({ label, value, onChange, currency = "IDR", error, hint, style = {} }) {
  const [focused, setFocused] = useState(false);

  // Show raw number while focused, formatted otherwise
  const display = focused
    ? (value || "")
    : value
      ? Number(value).toLocaleString("id-ID")
      : "";

  const handleChange = (e) => {
    // Strip everything except digits
    const raw = e.target.value.replace(/\D/g, "");
    onChange(raw ? Number(raw) : "");
  };

  return (
    <Field label={label} error={error} hint={hint} style={style}>
      <div style={{
        display:      "flex",
        alignItems:   "center",
        border:       `1.5px solid ${error ? "#dc2626" : focused ? "#3b5bdb" : "#e5e7eb"}`,
        borderRadius: 10,
        background:   "#ffffff",
        boxShadow:    focused ? "0 0 0 3px #dbeafe" : "none",
        transition:   "border-color 0.15s, box-shadow 0.15s",
        height:       44,
        overflow:     "hidden",
      }}>
        <span style={{
          padding:    "0 12px 0 14px",
          fontSize:   13,
          fontWeight: 700,
          color:      "#6b7280",
          fontFamily: "Figtree, sans-serif",
          flexShrink: 0,
        }}>
          {currency === "IDR" ? "Rp" : currency}
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={display}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="0"
          style={{
            flex:       1,
            minWidth:   0,
            height:     "100%",
            border:     "none",
            outline:    "none",
            padding:    "0 14px 0 0",
            fontFamily: "Figtree, sans-serif",
            fontSize:   15,
            fontWeight: 700,
            color:      "#111827",
            background: "transparent",
          }}
        />
      </div>
    </Field>
  );
}

// ─── TOGGLE ───────────────────────────────────────────────────
export function Toggle({ label, checked, onChange, hint }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
          {label}
        </div>
        {hint && (
          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
            {hint}
          </div>
        )}
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width:        44,
          height:       24,
          borderRadius: 12,
          border:       "none",
          background:   checked ? "#3b5bdb" : "#e5e7eb",
          cursor:       "pointer",
          position:     "relative",
          flexShrink:   0,
          transition:   "background 0.2s",
          padding:      0,
        }}
      >
        <span style={{
          position:   "absolute",
          top:        2,
          left:       checked ? 22 : 2,
          width:      20,
          height:     20,
          borderRadius: "50%",
          background: "#ffffff",
          boxShadow:  "0 1px 3px rgba(0,0,0,0.2)",
          transition: "left 0.2s",
          display:    "block",
        }} />
      </button>
    </div>
  );
}

// ─── FORM ROW (2 equal columns) ───────────────────────────────
export function FormRow({ children, style = {} }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, ...style }}>
      {children}
    </div>
  );
}
