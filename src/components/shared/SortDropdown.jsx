// ─── SORT DROPDOWN ────────────────────────────────────────────
// Controlled select with localStorage persistence.
// Usage:
//   const [sort, setSort] = useState(() => localStorage.getItem("sort_bank") || "balance_desc");
//   <SortDropdown storageKey="sort_bank" options={OPTS} value={sort}
//     onChange={v => { setSort(v); localStorage.setItem("sort_bank", v); }} />

export default function SortDropdown({ options = [], value, onChange, storageKey }) {
  const handleChange = (e) => {
    const v = e.target.value;
    if (storageKey) localStorage.setItem(storageKey, v);
    onChange(v);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{
        fontSize: 11, color: "#9ca3af",
        fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap",
      }}>
        Sort by
      </span>
      <select
        value={value}
        onChange={handleChange}
        style={{
          fontSize: 12, padding: "5px 8px",
          border: "1px solid #e5e7eb",
          borderRadius: 8, background: "#fff",
          color: "#374151",
          fontFamily: "Figtree, sans-serif",
          cursor: "pointer", outline: "none",
          appearance: "auto",
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
