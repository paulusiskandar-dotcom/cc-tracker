import { useEffect, useState } from "react";
import { undoManager } from "../../lib/undoManager";
import { showToast } from "./index";

const FF = "Figtree, sans-serif";

export default function UndoToast({ onUndone }) {
  const [op,        setOp]        = useState(null);
  const [remaining, setRemaining] = useState(5);

  useEffect(() => {
    const unsub = undoManager.subscribe(newOp => {
      setOp(newOp);
      if (newOp) setRemaining(Math.max(1, Math.ceil((newOp.expiresAt - Date.now()) / 1000)));
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!op) return;
    const iv = setInterval(() => {
      const left = Math.max(0, Math.ceil((op.expiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) clearInterval(iv);
    }, 250);
    return () => clearInterval(iv);
  }, [op]);

  if (!op) return null;

  const handleUndo = async () => {
    try {
      const res = await undoManager.undo();
      showToast(`Undone ${res.undone} item${res.undone !== 1 ? "s" : ""}`);
      onUndone?.();
    } catch (e) {
      showToast("Undo failed: " + e.message, "error");
    }
  };

  return (
    <div style={{
      position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
      background: "#111827", color: "#fff", padding: "10px 16px", borderRadius: 10,
      display: "flex", alignItems: "center", gap: 12, fontFamily: FF, zIndex: 9999,
      boxShadow: "0 6px 20px rgba(0,0,0,0.2)", whiteSpace: "nowrap",
    }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{op.label}</span>
      <button onClick={handleUndo}
        style={{ fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 5, border: "none", background: "#3b5bdb", color: "#fff", cursor: "pointer", fontFamily: FF }}>
        Undo ({remaining}s)
      </button>
    </div>
  );
}
