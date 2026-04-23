import { useReconcileDrafts } from "../../lib/useReconcileDrafts";
import { importDrafts } from "../../lib/importDrafts";

const FF = "Figtree, sans-serif";

export default function ReconcileDraftBanner({ user, accounts, filterType, onContinue }) {
  const { drafts, reload } = useReconcileDrafts(user?.id);
  if (!drafts.length) return null;

  const visible = drafts.filter(d => {
    const acc = accounts.find(a => a.id === d.account_id);
    if (!acc) return false;
    if (filterType && acc.type !== filterType) return false;
    return true;
  });
  if (!visible.length) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
      {visible.map(d => {
        const acc = accounts.find(a => a.id === d.account_id);
        const rowCount = d.state_json?.stmtRows?.length || 0;
        const ago = Math.round((Date.now() - new Date(d.updated_at).getTime()) / 60000);
        const timeText = ago < 1 ? "just now" : ago < 60 ? `${ago} min ago` : `${Math.round(ago / 60)}h ago`;
        return (
          <div key={d.id} style={{
            background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10,
            padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 8, fontFamily: FF,
          }}>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8" }}>
                Resume reconcile for {acc.name}?
              </span>
              <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 8 }}>
                {rowCount} rows · {timeText}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={async () => {
                  await importDrafts.clear(user.id, "reconcile", d.account_id);
                  await reload();
                }}
                style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer", fontFamily: FF }}>
                Discard
              </button>
              <button
                onClick={() => onContinue(acc, d.state_json)}
                style={{ fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 5, border: "none", background: "#3b5bdb", color: "#fff", cursor: "pointer", fontFamily: FF }}>
                Continue
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
