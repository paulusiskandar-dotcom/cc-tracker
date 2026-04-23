// GlobalReconcileButton — upload PDF statements, auto-detect account + period, navigate to the right statement page in reconcile mode
import { useState, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { Button, showToast } from "./index";
import Modal from "./Modal";

const EDGE_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-estatement`;
const FF = "Figtree, sans-serif";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function GlobalReconcileButton({ accounts, type, onNavigate, user }) {
  const [showUpload, setShowUpload] = useState(false);
  const [stagedFiles, setStagedFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerAcc,  setPickerAcc]  = useState("");
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const [pickerMonth, setPickerMonth] = useState(new Date().getMonth() + 1);
  const [pendingTxs,        setPendingTxs]        = useState([]);
  const [pendingFile,       setPendingFile]       = useState("");
  const [pendingBlobUrl,    setPendingBlobUrl]    = useState(null);
  const [pendingClosingBal, setPendingClosingBal] = useState(null);
  const [pendingOpeningBal, setPendingOpeningBal] = useState(null);
  const fileRef = useRef(null);

  const filteredAccounts = type === "cc"
    ? accounts.filter(a => a.type === "credit_card")
    : type === "all"
      ? accounts.filter(a => ["bank", "credit_card"].includes(a.type))
      : accounts.filter(a => a.type === "bank");

  const processFile = async (file) => {
    const base64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = () => res(reader.result.split(",")[1]);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
    const r = await fetch(EDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ action: "process_upload", user_id: user.id, pdf_base64: base64 }),
    });
    return await r.json();
  };

  const handleProcess = async () => {
    if (!stagedFiles.length) return;
    setProcessing(true);
    try {
      const aggregatedTxs = [];
      let firstData = null, firstBlobUrl = null, firstFilename = "";

      for (let i = 0; i < stagedFiles.length; i++) {
        const file = stagedFiles[i];
        setProcessProgress({ current: i + 1, total: stagedFiles.length });
        try {
          const data = await processFile(file);
          if (data.needs_password || data.encrypted) {
            showToast(`${file.name}: PDF terenkripsi. Silakan hapus password terlebih dahulu.`, "error");
            continue;
          }
          if (!data.transactions?.length) {
            showToast(`${file.name}: ${data.error || "No transactions found"}`, "error");
            continue;
          }
          const tagged = data.transactions.map((t, idx) => ({
            ...t,
            _id: t._id || `stmt-${Date.now()}-${idx}`,
            _sourceFile: file.name,
          }));
          aggregatedTxs.push(...tagged);
          if (!firstData) {
            firstData = data;
            firstBlobUrl = URL.createObjectURL(file);
            firstFilename = file.name;
          }
        } catch (e) {
          showToast(`${file.name}: ${e.message}`, "error");
        }
      }

      setProcessProgress(null);
      if (!aggregatedTxs.length) return;

      const det = firstData.detected_account;
      const per = firstData.detected_period;
      const closingBal = firstData.closing_balance != null ? Number(firstData.closing_balance) : null;
      const openingBal = firstData.opening_balance != null ? Number(firstData.opening_balance) : null;

      let matchedAcc = null;
      if (det?.last4) {
        matchedAcc = filteredAccounts.find(a =>
          String(a.card_last4 || a.last4 || "") === String(det.last4)
        );
      }
      if (!matchedAcc && det?.account_no) {
        matchedAcc = filteredAccounts.find(a =>
          String(a.account_no || "").includes(det.account_no) ||
          String(det.account_no).includes(String(a.account_no || "").slice(-6))
        );
      }

      const year  = per?.year  || new Date().getFullYear();
      const month = per?.month || (new Date().getMonth() + 1);

      if (matchedAcc && per?.year && per?.month) {
        setShowUpload(false); setStagedFiles([]);
        onNavigate(matchedAcc, year, month, aggregatedTxs, firstFilename, firstBlobUrl, closingBal, openingBal);
      } else {
        setPendingTxs(aggregatedTxs);
        setPendingFile(firstFilename);
        setPendingBlobUrl(firstBlobUrl);
        setPendingClosingBal(closingBal);
        setPendingOpeningBal(openingBal);
        setPickerAcc(matchedAcc?.id || filteredAccounts[0]?.id || "");
        setPickerYear(year);
        setPickerMonth(month);
        setShowUpload(false); setStagedFiles([]);
        setShowPicker(true);
      }
    } catch (e) {
      showToast("Error: " + e.message, "error");
    } finally {
      setProcessing(false);
      setProcessProgress(null);
    }
  };

  const handlePickerConfirm = () => {
    const acc = filteredAccounts.find(a => a.id === pickerAcc);
    if (!acc) { showToast("Please select an account", "error"); return; }
    setShowPicker(false);
    onNavigate(acc, pickerYear, pickerMonth, pendingTxs, pendingFile, pendingBlobUrl, pendingClosingBal, pendingOpeningBal);
    setPendingTxs([]); setPendingFile(""); setPendingBlobUrl(null); setPendingClosingBal(null); setPendingOpeningBal(null);
  };

  const clearPicker = () => {
    setShowPicker(false); setPendingTxs([]); setPendingFile("");
    if (pendingBlobUrl) URL.revokeObjectURL(pendingBlobUrl);
    setPendingBlobUrl(null); setPendingClosingBal(null); setPendingOpeningBal(null);
  };

  const addFiles = (files) => {
    const pdfs = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length) setStagedFiles(prev => [...prev, ...pdfs]);
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setShowUpload(true)}>
        Reconcile
      </Button>

      {/* ── Upload modal ── */}
      <Modal isOpen={showUpload} onClose={() => { setShowUpload(false); setStagedFiles([]); }} title="Reconcile from PDF" width={520}>
        {stagedFiles.length > 0 ? (
          <div style={{ padding: "20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
              {stagedFiles.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#f9fafb", borderRadius: 6, fontSize: 11, fontFamily: FF }}>
                  <span>📄 {f.name} · {Math.round(f.size / 1024)} KB</span>
                  <button onClick={() => setStagedFiles(prev => prev.filter((_, idx) => idx !== i))}
                    style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</button>
                </div>
              ))}
            </div>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
              style={{ border: "1px dashed #e5e7eb", borderRadius: 8, padding: "8px 12px", textAlign: "center", cursor: "pointer", fontSize: 11, color: "#9ca3af", fontFamily: FF, marginBottom: 16 }}>
              + Add more PDFs
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button onClick={() => setStagedFiles([])} disabled={processing}
                style={{ fontSize: 12, padding: "8px 16px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", cursor: "pointer", fontFamily: FF }}>
                Back
              </button>
              <button onClick={handleProcess} disabled={processing}
                style={{ fontSize: 12, fontWeight: 700, padding: "8px 18px", borderRadius: 6, border: "none", background: "#3b5bdb", color: "#fff", cursor: processing ? "default" : "pointer", fontFamily: FF, opacity: processing ? 0.6 : 1 }}>
                {processProgress
                  ? `Processing ${processProgress.current}/${processProgress.total}…`
                  : `Process${stagedFiles.length > 1 ? ` (${stagedFiles.length})` : ""}`}
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
            style={{ border: "2px dashed #e5e7eb", borderRadius: 16, padding: "28px 24px", textAlign: "center", cursor: "pointer", background: "#fafafa" }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: FF, marginBottom: 4 }}>Drop PDF here or click to browse</div>
            <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: FF }}>Bank or credit card statement (PDF) — multiple files supported</div>
            <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: "none" }}
              onChange={e => { addFiles(e.target.files || []); e.target.value = ""; }} />
            <div style={{ marginTop: 12 }}>
              <Button variant="primary" size="sm">Choose File</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Manual picker modal (when auto-detect fails) ── */}
      <Modal isOpen={showPicker} onClose={clearPicker} title="Select Account & Period" width={400}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
          <div style={{ fontSize: 12, color: "#6b7280", fontFamily: FF }}>
            Account or period could not be auto-detected. Please confirm:
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", fontFamily: FF, display: "block", marginBottom: 4 }}>Account</label>
            <select value={pickerAcc} onChange={e => setPickerAcc(e.target.value)}
              style={{ width: "100%", fontSize: 13, padding: "6px 8px", border: "1px solid #e5e7eb", borderRadius: 6, fontFamily: FF }}>
              <option value="">Select account…</option>
              {filteredAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}{a.card_last4 ? ` ···${a.card_last4}` : ""}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", fontFamily: FF, display: "block", marginBottom: 4 }}>Year</label>
              <input type="number" value={pickerYear} min={2020} max={2030}
                onChange={e => setPickerYear(Number(e.target.value))}
                style={{ width: "100%", fontSize: 13, padding: "6px 8px", border: "1px solid #e5e7eb", borderRadius: 6, fontFamily: FF }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", fontFamily: FF, display: "block", marginBottom: 4 }}>Month</label>
              <select value={pickerMonth} onChange={e => setPickerMonth(Number(e.target.value))}
                style={{ width: "100%", fontSize: 13, padding: "6px 8px", border: "1px solid #e5e7eb", borderRadius: 6, fontFamily: FF }}>
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button onClick={clearPicker}
              style={{ fontSize: 12, padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", color: "#6b7280", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
              Cancel
            </button>
            <button onClick={handlePickerConfirm}
              style={{ fontSize: 12, padding: "8px 16px", borderRadius: 8, border: "none", background: "#3b5bdb", color: "#fff", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
              Open Statement
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
