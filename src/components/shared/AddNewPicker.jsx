import { useState } from "react";
import { supabase } from "../../lib/supabase";

const FF = "Figtree, sans-serif";

const ASSET_SUBTYPES = ["Property", "Vehicle", "Investment", "Electronics", "Deposito", "Other"];

/**
 * Dropdown picker with inline "+ Add New" to create a new account of the given type.
 *
 * Props:
 *   kind         "receivable" | "asset"   — account type to create
 *   value        string                   — selected account id
 *   onChange     (newId) => void
 *   options      [{id, name}, ...]        — existing accounts to show
 *   onItemCreated (newAccount) => void    — called after successful creation
 *   user         { id }
 *   defaultAmount number (optional)       — pre-fill initial value
 *   placeholder  string
 *   style        object (optional)        — extra styles on the select
 *   T            theme object (optional)  — for border/bg colours
 */
export default function AddNewPicker({
  kind,
  value,
  onChange,
  options = [],
  onItemCreated,
  user,
  defaultAmount,
  placeholder = "Select…",
  style = {},
  T,
}) {
  const [showForm, setShowForm]   = useState(false);
  const [name,     setName]       = useState("");
  const [amount,   setAmount]     = useState(defaultAmount ?? "");
  const [subtype,  setSubtype]    = useState("Other");
  const [saving,   setSaving]     = useState(false);
  const [err,      setErr]        = useState("");

  const openForm = () => {
    setShowForm(true);
    setName("");
    setAmount(defaultAmount ?? "");
    setSubtype("Other");
    setErr("");
  };

  const handleChange = (e) => {
    if (e.target.value === "__add_new__") openForm();
    else onChange(e.target.value);
  };

  const save = async () => {
    if (!name.trim()) { setErr("Name is required"); return; }
    setSaving(true);
    setErr("");
    try {
      let payload;
      if (kind === "receivable") {
        // Loan borrowers are stored as receivable accounts in the accounts table
        payload = {
          user_id:                user.id,
          name:                   name.trim(),
          type:                   "receivable",
          is_active:              true,
          receivable_outstanding: Number(amount) || 0,
          include_networth:       true,
        };
      } else {
        // Assets are stored as asset accounts in the accounts table
        payload = {
          user_id:        user.id,
          name:           name.trim(),
          type:           "asset",
          subtype:        subtype || null,
          is_active:      true,
          current_value:  Number(amount) || 0,
          purchase_price: Number(amount) || 0,
          include_networth: true,
        };
      }

      const { data, error } = await supabase
        .from("accounts")
        .insert([payload])
        .select()
        .single();
      if (error) throw error;

      onItemCreated?.(data);
      onChange(data.id);
      setShowForm(false);
    } catch (e) {
      setErr(e.message || "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const labelKind = kind === "receivable" ? "Borrower" : "Asset";

  // ── Inline mini-form ──────────────────────────────────────────
  if (showForm) return (
    <div style={{
      border: "1px solid #c7d2fe", borderRadius: 6, padding: 8,
      background: "#eef2ff", display: "flex", flexDirection: "column",
      gap: 5, fontFamily: FF,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#3730a3", textTransform: "uppercase" }}>
        New {labelKind}
      </div>

      <input
        autoFocus
        type="text"
        placeholder={`${labelKind} name`}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setShowForm(false); }}
        style={{
          fontSize: 12, padding: "3px 8px", borderRadius: 4,
          border: "1px solid #c7d2fe", fontFamily: FF, outline: "none",
        }}
      />

      {kind === "asset" && (
        <select
          value={subtype}
          onChange={e => setSubtype(e.target.value)}
          style={{
            fontSize: 12, padding: "3px 8px", borderRadius: 4,
            border: "1px solid #c7d2fe", fontFamily: FF,
          }}
        >
          {ASSET_SUBTYPES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      )}

      <input
        type="number"
        placeholder={kind === "receivable" ? "Loan amount (IDR)" : "Asset value (IDR)"}
        value={amount}
        onChange={e => setAmount(e.target.value)}
        style={{
          fontSize: 12, padding: "3px 8px", borderRadius: 4,
          border: "1px solid #c7d2fe", fontFamily: FF,
        }}
      />

      {err && <div style={{ fontSize: 11, color: "#b91c1c" }}>{err}</div>}

      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button
          onClick={() => setShowForm(false)}
          disabled={saving}
          style={{
            fontSize: 11, padding: "3px 10px", borderRadius: 4,
            border: "1px solid #c7d2fe", background: "#fff",
            cursor: "pointer", fontFamily: FF,
          }}
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || !name.trim()}
          style={{
            fontSize: 11, fontWeight: 700, padding: "3px 12px",
            borderRadius: 4, border: "none",
            background: saving ? "#9ca3af" : "#3b5bdb",
            color: "#fff",
            cursor: saving || !name.trim() ? "default" : "pointer",
            fontFamily: FF,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );

  // ── Normal select with "+ Add New" option ─────────────────────
  const borderColor = T?.border || "#d1d5db";
  const bg          = T?.surface || "#fff";
  const color       = T?.text    || "#111827";

  return (
    <select
      value={value ?? ""}
      onChange={handleChange}
      style={{
        fontSize: 11, padding: "3px 4px", borderRadius: 5,
        border: `1px solid ${borderColor}`,
        background: bg, color,
        fontFamily: FF, cursor: "pointer",
        boxSizing: "border-box",
        ...style,
      }}
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
      <option value="__add_new__" style={{ fontWeight: 700, color: "#3b5bdb" }}>
        + Add New {labelKind}
      </option>
    </select>
  );
}
