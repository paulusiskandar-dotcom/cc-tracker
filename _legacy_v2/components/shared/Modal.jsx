import { useEffect, useRef } from "react";

const isMobile = () => window.innerWidth < 768;

export default function Modal({ isOpen, onClose, title, children, footer, width = 480 }) {
  const bodyRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      // Scroll body to top on open
      setTimeout(() => bodyRef.current?.scrollTo({ top: 0 }), 0);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const mobile = isMobile();

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position:       "fixed",
        inset:          0,
        zIndex:         1000,
        background:     "rgba(0,0,0,0.45)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display:        "flex",
        alignItems:     mobile ? "flex-end" : "center",
        justifyContent: "center",
        padding:        mobile ? 0 : "16px",
      }}
    >
      <div
        style={{
          background:    "#ffffff",
          width:         "100%",
          maxWidth:      mobile ? "100%" : width,
          maxHeight:     mobile ? "92vh" : "85vh",
          borderRadius:  mobile ? "20px 20px 0 0" : 20,
          display:       "flex",
          flexDirection: "column",
          overflow:      "hidden",
          boxShadow:     "0 8px 40px rgba(0,0,0,0.18)",
        }}
      >
        {/* Drag handle — mobile only */}
        {mobile && (
          <div style={{
            width: 36, height: 4, background: "#e5e7eb",
            borderRadius: 2, margin: "12px auto 0", flexShrink: 0,
          }} />
        )}

        {/* Sticky header */}
        <div style={{
          display:        "flex",
          justifyContent: "space-between",
          alignItems:     "center",
          padding:        "14px 20px",
          borderBottom:   "1px solid #f3f4f6",
          flexShrink:     0,
        }}>
          <div style={{
            fontSize:   16,
            fontWeight: 700,
            color:      "#111827",
            fontFamily: "Figtree, sans-serif",
          }}>
            {title}
          </div>
          <button
            onClick={onClose}
            style={{
              width:           30,
              height:          30,
              borderRadius:    8,
              border:          "1.5px solid #e5e7eb",
              background:      "#f9fafb",
              cursor:          "pointer",
              fontSize:        12,
              color:           "#6b7280",
              display:         "flex",
              alignItems:      "center",
              justifyContent:  "center",
              fontFamily:      "Figtree, sans-serif",
              flexShrink:      0,
              lineHeight:      1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div
          ref={bodyRef}
          style={{
            flex:       1,
            overflowY:  "auto",
            padding:    "20px",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {children}
        </div>

        {/* Sticky footer */}
        {footer && (
          <div style={{
            padding:      "14px 20px",
            borderTop:    "1px solid #f3f4f6",
            flexShrink:   0,
            background:   "#ffffff",
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CONFIRM DIALOG ───────────────────────────────────────────
export function ConfirmModal({ isOpen, onClose, onConfirm, title, message, danger = false, busy = false }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title || "Confirm"}
      footer={
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, height: 44, borderRadius: 10,
              border: "1.5px solid #e5e7eb", background: "#fff",
              color: "#374151", fontSize: 14, fontWeight: 600,
              cursor: "pointer", fontFamily: "Figtree, sans-serif",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              flex: 1, height: 44, borderRadius: 10, border: "none",
              background: danger ? "#fee2e2" : "#111827",
              color:      danger ? "#dc2626" : "#ffffff",
              fontSize: 14, fontWeight: 600, cursor: "pointer",
              fontFamily: "Figtree, sans-serif",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "..." : (danger ? "Delete" : "Confirm")}
          </button>
        </div>
      }
    >
      <p style={{ margin: 0, fontSize: 14, color: "#374151", lineHeight: 1.6, fontFamily: "Figtree, sans-serif" }}>
        {message}
      </p>
    </Modal>
  );
}
