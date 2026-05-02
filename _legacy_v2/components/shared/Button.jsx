// ─── BUTTON ───────────────────────────────────────────────────
// variant: "primary" | "secondary" | "danger" | "ghost"
// size:    "sm" | "md" | "lg"

const BASE = {
  display:        "inline-flex",
  alignItems:     "center",
  justifyContent: "center",
  gap:            6,
  fontFamily:     "Figtree, sans-serif",
  fontWeight:     600,
  border:         "none",
  cursor:         "pointer",
  transition:     "opacity 0.15s, background 0.15s",
  whiteSpace:     "nowrap",
  lineHeight:     1,
};

const VARIANTS = {
  primary: {
    background: "#111827",
    color:      "#ffffff",
    border:     "none",
  },
  secondary: {
    background: "#ffffff",
    color:      "#374151",
    border:     "1.5px solid #e5e7eb",
  },
  danger: {
    background: "#fee2e2",
    color:      "#dc2626",
    border:     "1.5px solid #fecaca",
  },
  ghost: {
    background: "transparent",
    color:      "#6b7280",
    border:     "none",
  },
  accent: {
    background: "#3b5bdb",
    color:      "#ffffff",
    border:     "none",
  },
};

const SIZES = {
  sm: { height: 32, padding: "0 12px", fontSize: 12, borderRadius: 8 },
  md: { height: 44, padding: "0 18px", fontSize: 14, borderRadius: 10 },
  lg: { height: 50, padding: "0 24px", fontSize: 15, borderRadius: 12 },
};

export default function Button({
  children,
  onClick,
  variant = "primary",
  size    = "md",
  disabled = false,
  busy     = false,
  fullWidth = false,
  style    = {},
  type     = "button",
  ...props
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const s = SIZES[size]       || SIZES.md;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      style={{
        ...BASE,
        ...v,
        ...s,
        width:   fullWidth ? "100%" : undefined,
        opacity: (disabled || busy) ? 0.55 : 1,
        ...style,
      }}
      {...props}
    >
      {busy ? <Spinner size={14} color={v.color} /> : children}
    </button>
  );
}

// Inline spinner for button busy state
function Spinner({ size = 14, color = "#fff" }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      style={{ animation: "spin 0.7s linear infinite" }}
    >
      <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
      <path d="M12 2a10 10 0 0 1 10 10" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

// Icon button — square, just an icon
export function IconButton({ icon, onClick, size = 32, style = {}, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width:           size,
        height:          size,
        borderRadius:    size * 0.28,
        border:          "1.5px solid #e5e7eb",
        background:      "#f9fafb",
        cursor:          "pointer",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        fontSize:        size * 0.42,
        color:           "#6b7280",
        flexShrink:      0,
        fontFamily:      "Figtree, sans-serif",
        ...style,
      }}
    >
      {icon}
    </button>
  );
}
