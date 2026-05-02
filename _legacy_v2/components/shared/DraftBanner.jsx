const FF = "Figtree, sans-serif";

export default function DraftBanner({ draftInfo, onResume, onDiscard }) {
  if (!draftInfo) return null;
  const ago = Math.round((Date.now() - new Date(draftInfo.updatedAt).getTime()) / 60000);
  const timeText = ago < 1 ? "just now" : ago < 60 ? `${ago} min ago` : `${Math.round(ago / 60)}h ago`;

  return (
    <div style={{
      background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10,
      padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 8, fontFamily: FF, marginBottom: 10,
    }}>
      <div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8" }}>Resume previous session?</span>
        <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 8 }}>
          {draftInfo.rowCount} rows · {timeText}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={onDiscard}
          style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer", fontFamily: FF }}>
          Discard
        </button>
        <button onClick={onResume}
          style={{ fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 5, border: "none", background: "#3b5bdb", color: "#fff", cursor: "pointer", fontFamily: FF }}>
          Resume
        </button>
      </div>
    </div>
  );
}
