export default function PDFViewer({ fileUrl, filename }) {
  if (!fileUrl) return null;
  return (
    <div style={{
      width: "100%", height: "100%", minHeight: 600,
      border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden",
      background: "#f9fafb", display: "flex", flexDirection: "column",
      position: "sticky", top: 12,
    }}>
      <div style={{ padding: "6px 10px", background: "#f3f4f6", fontSize: 11, fontWeight: 600, color: "#374151", fontFamily: "Figtree, sans-serif", borderBottom: "1px solid #e5e7eb" }}>
        📄 {filename}
      </div>
      <iframe
        src={fileUrl}
        style={{ flex: 1, border: "none", width: "100%" }}
        title={filename}
      />
    </div>
  );
}
