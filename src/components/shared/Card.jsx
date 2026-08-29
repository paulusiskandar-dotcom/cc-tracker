import { useState, useEffect } from "react";
import { Inbox } from "lucide-react";
import { fmtIDR } from "../../utils";

// ─── BASE CARD ────────────────────────────────────────────────
export default function Card({ children, style = {}, onClick, bg }) {
  return (
    <div
      onClick={onClick}
      style={{
        background:   bg || "#ffffff",
        borderRadius: 16,
        padding:      20,
        cursor:       onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── BENTO CARD ───────────────────────────────────────────────
// Standard bento tile: icon + label + value + sub + optional badge
export function BentoCard({
  icon, label, value, sub, badge,
  bg = "#ffffff", iconBg, iconColor = "#6b7280",
  onClick, style = {}, children,
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background:    bg,
        borderRadius:  16,
        padding:       "18px 18px 16px",
        position:      "relative",
        cursor:        onClick ? "pointer" : "default",
        overflow:      "hidden",
        ...style,
      }}
    >
      {/* Badge top-right */}
      {badge != null && (
        <div style={{
          position:     "absolute",
          top:          14,
          right:        14,
          fontSize:     10,
          fontWeight:   700,
          fontFamily:   "Figtree, sans-serif",
          background:   "rgba(0,0,0,0.07)",
          color:        iconColor,
          padding:      "2px 7px",
          borderRadius: 20,
        }}>
          {badge}
        </div>
      )}

      {/* Icon */}
      {icon && (
        <div style={{
          width:           36,
          height:          36,
          borderRadius:    10,
          background:      iconBg || "rgba(0,0,0,0.07)",
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          fontSize:        18,
          marginBottom:    12,
          flexShrink:      0,
        }}>
          {icon}
        </div>
      )}

      {/* Label */}
      {label && (
        <div style={{
          fontSize:      11,
          fontWeight:    600,
          color:         iconColor,
          textTransform: "uppercase",
          letterSpacing: "0.4px",
          marginBottom:  4,
          fontFamily:    "Figtree, sans-serif",
          opacity:       0.75,
        }}>
          {label}
        </div>
      )}

      {/* Value */}
      {value != null && (
        <div style={{
          fontSize:     22,
          fontWeight:   800,
          color:        "#111827",
          fontFamily:   "Figtree, sans-serif",
          lineHeight:   1.2,
          marginBottom: sub ? 4 : 0,
        }}>
          {value}
        </div>
      )}

      {/* Sub text */}
      {sub && (
        <div style={{
          fontSize:   12,
          fontWeight: 500,
          color:      "#6b7280",
          fontFamily: "Figtree, sans-serif",
          lineHeight: 1.4,
        }}>
          {sub}
        </div>
      )}

      {children}
    </div>
  );
}

// ─── DARK HERO CARD ───────────────────────────────────────────
// Net worth card — dark bg, white text
export function HeroCard({ label, value, change, changePositive, stats = [], style = {} }) {
  return (
    <div style={{
      background:   "#111827",
      borderRadius: 16,
      padding:      "22px 22px 18px",
      color:        "#ffffff",
      ...style,
    }}>
      <div style={{
        fontSize:      11, fontWeight: 600, color: "rgba(255,255,255,0.5)",
        textTransform: "uppercase", letterSpacing: "0.4px",
        fontFamily:    "Figtree, sans-serif", marginBottom: 6,
      }}>
        {label}
      </div>

      <div style={{
        fontSize:   28, fontWeight: 900, color: "#ffffff",
        fontFamily: "Figtree, sans-serif", lineHeight: 1.15, marginBottom: 6,
      }}>
        {value}
      </div>

      {change && (
        <div style={{
          fontSize:   12, fontWeight: 600,
          color:      changePositive ? "#4ade80" : "#f87171",
          fontFamily: "Figtree, sans-serif", marginBottom: 16,
        }}>
          {changePositive ? "↑" : "↓"} {change} this month
        </div>
      )}

      {stats.length > 0 && (
        <div style={{
          display:             "grid",
          gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
          gap:                 8,
          paddingTop:          12,
          borderTop:           "1px solid rgba(255,255,255,0.1)",
        }}>
          {stats.map((s, i) => (
            <div key={i}>
              <div style={{
                fontSize:      10, fontWeight: 600,
                color:         "rgba(255,255,255,0.4)",
                textTransform: "uppercase", letterSpacing: "0.3px",
                fontFamily:    "Figtree, sans-serif", marginBottom: 2,
              }}>
                {s.label}
              </div>
              <div style={{
                fontSize:   13, fontWeight: 700,
                color:      s.color || "rgba(255,255,255,0.85)",
                fontFamily: "Figtree, sans-serif",
              }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── STAT ROW ─────────────────────────────────────────────────
export function StatRow({ items = [], style = {} }) {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", ...style }}>
      {items.map((item, i) => (
        <div key={i} style={{ minWidth: 0 }}>
          <div style={{
            fontSize:      10, fontWeight: 600, color: "#9ca3af",
            textTransform: "uppercase", letterSpacing: "0.4px",
            fontFamily:    "Figtree, sans-serif", marginBottom: 2,
          }}>
            {item.label}
          </div>
          <div style={{
            fontSize:   14, fontWeight: 700,
            color:      item.color || "#111827",
            fontFamily: "Figtree, sans-serif",
          }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── BADGE ────────────────────────────────────────────────────
export function Badge({ children, color = "#3b5bdb", bg, style = {} }) {
  return (
    <span style={{
      display:      "inline-flex",
      alignItems:   "center",
      padding:      "2px 8px",
      borderRadius: 20,
      fontSize:     11,
      fontWeight:   700,
      fontFamily:   "Figtree, sans-serif",
      color:        color,
      background:   bg || color + "1a",
      whiteSpace:   "nowrap",
      ...style,
    }}>
      {children}
    </span>
  );
}

// ─── SECTION HEADER ───────────────────────────────────────────
export function SectionHeader({ title, action, style = {} }) {
  return (
    <div style={{
      display:        "flex",
      alignItems:     "center",
      justifyContent: "space-between",
      marginBottom:   12,
      ...style,
    }}>
      <div style={{
        fontSize:   13,
        fontWeight: 700,
        color:      "#111827",
        fontFamily: "Figtree, sans-serif",
      }}>
        {title}
      </div>
      {action}
    </div>
  );
}

// ─── EMPTY STATE ──────────────────────────────────────────────
export function EmptyState({ icon = "", title, message, action }) {
  return (
    <div style={{
      display:        "flex",
      flexDirection:  "column",
      alignItems:     "center",
      justifyContent: "center",
      padding:        "40px 20px",
      gap:            8,
      textAlign:      "center",
    }}>
      {icon
        ? <div style={{ fontSize: 36, marginBottom: 4 }}>{icon}</div>
        : <Inbox size={34} strokeWidth={1.5} color="#d1d5db" style={{ marginBottom: 4 }} />}
      {title && (
        <div style={{
          fontSize:   15, fontWeight: 700, color: "#111827",
          fontFamily: "Figtree, sans-serif",
        }}>
          {title}
        </div>
      )}
      {message && (
        <div style={{
          fontSize:   13, color: "#9ca3af", maxWidth: 280,
          fontFamily: "Figtree, sans-serif", lineHeight: 1.5,
        }}>
          {message}
        </div>
      )}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

// ─── SPINNER ──────────────────────────────────────────────────
export function Spinner({ size = 24, color = "#3b5bdb" }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      style={{ animation: "spin 0.7s linear infinite", display: "block" }}
    >
      <circle cx="12" cy="12" r="10" strokeOpacity={0.2} />
      <path d="M12 2a10 10 0 0 1 10 10" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

// ─── TOAST ────────────────────────────────────────────────────
let _toastFn = null;
export const showToast = (msg, type = "success") => _toastFn?.(msg, type);

const NADA_TOAST = {
  error:   { bg: "#fee2e2", fg: "#b91c1c", br: "#fecaca" },
  warning: { bg: "#fef3c7", fg: "#b45309", br: "#fde68a" },
  info:    { bg: "#e0edff", fg: "#1d4ed8", br: "#bfdbfe" },
  success: { bg: "#dcfce7", fg: "#047857", br: "#bbf7d0" },
};

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  // Dipasang di efek, bukan di badan render: React boleh menjalankan render
  // dua kali, dan menugaskan _toastFn di sana membuat pesan datang ke salinan
  // komponen yang sudah dibuang.
  useEffect(() => {
    _toastFn = (msg, type) => {
      const id = Date.now() + Math.random();
      setToasts(prev => [...prev, { id, msg, type }]);
      // Pesan galat biasanya satu kalimat penuh — tiga detik tidak cukup dibaca.
      const umur = type === "error" ? 8000 : type === "warning" ? 6000 : 3500;
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), umur);
    };
    return () => { _toastFn = null; };
  }, []);

  if (!toasts.length) return null;

  return (
    <div style={{
      position:       "fixed",
      bottom:         24,
      left:           "50%",
      transform:      "translateX(-50%)",
      zIndex:         9999,
      display:        "flex",
      flexDirection:  "column",
      alignItems:     "center",
      gap:            8,
      width:          "min(560px, calc(100vw - 32px))",
      pointerEvents:  "none",
    }}>
      {toasts.map(t => {
        const n = NADA_TOAST[t.type] || NADA_TOAST.success;
        return (
          <div key={t.id} style={{
            background:   n.bg,
            color:        n.fg,
            border:       `1px solid ${n.br}`,
            borderRadius: 10,
            padding:      "10px 16px",
            fontSize:     13,
            fontWeight:   600,
            fontFamily:   "Figtree, sans-serif",
            // Kalimat panjang dibungkus jadi blok terbaca, bukan pita selebar
            // halaman yang menutupi daftar di belakangnya.
            lineHeight:   1.45,
            maxWidth:     "100%",
            textAlign:    "center",
            boxShadow:    "0 4px 16px rgba(0,0,0,0.12)",
          }}>
            {t.msg}
          </div>
        );
      })}
    </div>
  );
}
