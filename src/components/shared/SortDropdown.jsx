// ─── SORT PILLS ──────────────────────────────────────────────
// Toggle-style pill buttons matching the existing filter tab style.
// Props:
//   storageKey  — localStorage key, e.g. "sort_bank"
//   options     — [{ key, label, defaultDir: "asc"|"desc" }, ...]
//   value       — current sort value, e.g. "balance_desc" or "name_asc"
//   onChange    — called with new value string, e.g. "balance_asc"
//
// Clicking an inactive pill → activates with defaultDir.
// Clicking the active pill  → toggles direction (↑ ↔ ↓).
// Active pill shows ↑ (asc) or ↓ (desc) after label text.

export default function SortDropdown({ options = [], value = "", onChange, storageKey }) {
  // Parse "balance_desc" → key="balance", dir="desc"
  const lastUs   = value.lastIndexOf("_");
  const activeKey = lastUs > 0 ? value.slice(0, lastUs)      : value;
  const activeDir = lastUs > 0 ? value.slice(lastUs + 1)     : "";

  const handleClick = (opt) => {
    let newValue;
    if (activeKey === opt.key) {
      const newDir = activeDir === "asc" ? "desc" : "asc";
      newValue = `${opt.key}_${newDir}`;
    } else {
      newValue = `${opt.key}_${opt.defaultDir}`;
    }
    if (storageKey) localStorage.setItem(storageKey, newValue);
    onChange(newValue);
  };

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
      {options.map(opt => {
        const isActive = activeKey === opt.key;
        const arrow    = isActive ? (activeDir === "asc" ? " ↑" : " ↓") : "";
        return (
          <button
            key={opt.key}
            onClick={() => handleClick(opt)}
            style={{
              height: 30, padding: "0 12px", borderRadius: 20,
              border: `1.5px solid ${isActive ? "#111827" : "#e5e7eb"}`,
              background: isActive ? "#111827" : "#fff",
              color: isActive ? "#fff" : "#6b7280",
              fontSize: 12, fontWeight: isActive ? 700 : 500,
              cursor: "pointer", fontFamily: "Figtree, sans-serif",
              display: "flex", alignItems: "center",
              whiteSpace: "nowrap", lineHeight: 1,
            }}
          >
            {opt.label}{arrow}
          </button>
        );
      })}
    </div>
  );
}
