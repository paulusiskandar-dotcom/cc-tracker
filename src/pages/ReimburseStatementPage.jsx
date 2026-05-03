import { useParams, useNavigate } from "react-router-dom";

const VALID = ["Hamasa", "SDC", "Travelio"];
const FF = "Figtree, sans-serif";

export default function ReimburseStatementPage() {
  const { entity } = useParams();
  const navigate   = useNavigate();
  const onBack     = () => navigate(-1);

  if (!VALID.includes(entity)) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: FF }}>
        <div style={{ fontSize: 14, color: "#6b7280" }}>Invalid entity: {entity}</div>
        <button onClick={onBack} style={{ marginTop: 16, fontSize: 13, color: "#3b5bdb", background: "none", border: "none", cursor: "pointer" }}>← Back</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 16px", fontFamily: FF }}>
      <button onClick={onBack} style={{ fontSize: 13, color: "#3b5bdb", background: "none", border: "none", cursor: "pointer", marginBottom: 16, padding: 0 }}>
        ← Back
      </button>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: "0 0 8px" }}>
        {entity} — Reimburse Statement
      </h2>
      <div style={{ fontSize: 13, color: "#9ca3af" }}>
        Coming soon — per-entity reimburse statement view.
      </div>
    </div>
  );
}
