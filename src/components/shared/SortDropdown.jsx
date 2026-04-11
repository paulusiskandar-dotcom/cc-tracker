// ─── SORT DROPDOWN BUTTON ────────────────────────────────────
// Single button that opens a dropdown with all sort options.
// Props:
//   storageKey  — localStorage key, e.g. "sort_bank"
//   options     — [{ key, label, defaultDir: "asc"|"desc" }, ...]
//   value       — current sort value, e.g. "balance_desc" or "name_asc"
//   onChange    — called with new value string, e.g. "balance_asc"
//
// Button label: "Sort: [Label] ↑/↓"
// Clicking active option  → toggles ↑ ↔ ↓ direction, closes dropdown
// Clicking inactive option → activates with defaultDir, closes dropdown
// Click outside           → closes dropdown

import { useState, useRef, useEffect } from "react";

export default function SortDropdown({ options = [], value = "", onChange, storageKey }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Parse "balance_desc" → key="balance", dir="desc"
  const lastUs   = value.lastIndexOf("_");
  const activeKey = lastUs > 0 ? value.slice(0, lastUs) : value;
  const activeDir = lastUs > 0 ? value.slice(lastUs + 1) : "";

  const activeOpt = options.find(o => o.key === activeKey) || options[0];
  const arrow     = activeDir === "asc" ? "↑" : "↓";

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (opt) => {
    let newValue;
    if (activeKey === opt.key) {
      const newDir = activeDir === "asc" ? "desc" : "asc";
      newValue = `${opt.key}_${newDir}`;
    } else {
      newValue = `${opt.key}_${opt.defaultDir}`;
    }
    if (storageKey) localStorage.setItem(storageKey, newValue);
    onChange(newValue);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          height: 30, padding: "0 12px", borderRadius: 20,
          border: `1.5px solid ${open ? "#111827" : "#e5e7eb"}`,
          background: open ? "#111827" : "#fff",
          color: open ? "#fff" : "#6b7280",
          fontSize: 12, fontWeight: 500,
          cursor: "pointer", fontFamily: "Figtree, sans-serif",
          display: "flex", alignItems: "center", gap: 4,
          whiteSpace: "nowrap", lineHeight: 1,
        }}
      >
        <span style={{ color: open ? "#9ca3af" : "#9ca3af", fontSize: 11 }}>Sort:</span>
        <span style={{ fontWeight: 700, color: open ? "#fff" : "#111827" }}>
          {activeOpt?.label}
        </span>
        <span style={{ fontSize: 11, color: open ? "#d1d5db" : "#6b7280" }}>{arrow}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 999,
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 4px 20px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)",
          border: "1px solid #f3f4f6",
          minWidth: 180,
          overflow: "hidden",
        }}>
          {options.map(opt => {
            const isActive = activeKey === opt.key;
            const optArrow = isActive ? (activeDir === "asc" ? "↑" : "↓") : (opt.defaultDir === "asc" ? "↑" : "↓");
            return (
              <button
                key={opt.key}
                onClick={() => handleSelect(opt)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", padding: "10px 16px",
                  border: "none", background: "transparent",
                  cursor: "pointer", textAlign: "left",
                  fontFamily: "Figtree, sans-serif",
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 400,
                  color: isActive ? "#111827" : "#374151",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "#f9fafb"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ width: 16, fontSize: 12, color: "#059669", flexShrink: 0 }}>
                  {isActive ? "✓" : ""}
                </span>
                <span style={{ flex: 1 }}>{opt.label}</span>
                <span style={{ fontSize: 11, color: isActive ? "#6b7280" : "#d1d5db", flexShrink: 0 }}>
                  {optArrow}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
