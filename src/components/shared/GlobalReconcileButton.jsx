// GlobalReconcileButton — upload a PDF statement, auto-detect account + period, navigate to the right statement page in reconcile mode
import { useState, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { Button, showToast } from "./index";
import Modal from "./Modal";

const EDGE_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-estatement`;
const FF = "Figtree, sans-serif";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function GlobalReconcileButton({ accounts, type, onNavigate, user }) {
  const [showUpload, setShowUpload] = useState(false);
  const [stagedFile, setStagedFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerAcc,  setPickerAcc]  = useState("");
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const [pickerMonth, setPickerMonth] = useState(new Date().getMonth() + 1);
  const [pendingTxs,  setPendingTxs]  = useState([]);
  const [pendingFile, setPendingFile] = useState("");
  const fileRef = useRef(null);

  const filteredAccounts = (type === "cc"
    ? accounts.filter(a => a.type === "credit_card")
    : accounts.filter(a => a.type === "bank")
  );

  const handleProcess = async () => {
    if (!stagedFile) return;
    setProcessing(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise((res, rej) => {
        reader.onload  = () => res(reader.result.split(",")[1]);
        reader.onerror = rej;
        reader.readAsDataURL(stagedFile);
      });

      const resp = await fetch(EDGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: "process_upload", user_id: user.id, pdf_base64: base64 }),
      });
      const data = await resp.json();

      if (data.needs_password || data.encrypted) {
        showToast("PDF terenkripsi. Silakan hapus password terlebih dahulu.", "error");
        return;
      }
      if (!data.transactions?.length) {
        showToast(data.error || "No transactions found", "error");
        return;
      }

      const txs = data.transactions.map((t, i) => ({ ...t, _id: t._id || `stmt-${i}` }));
      const det = data.detected_account;
      const per = data.detected_period;
      const filename = stagedFile.name;

      // Try to match account
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
        // Auto-navigate — account and period both detected
        setShowUpload(false); setStagedFile(null);
        onNavigate(matchedAcc, year, month, txs, filename);
      } else {
        // Show manual picker
        setPendingTxs(txs);
        setPendingFile(filename);
        setPickerAcc(matchedAcc?.id || filteredAccounts[0]?.id || "");
        setPickerYear(year);
        setPickerMonth(month);
        setShowUpload(false); setStagedFile(null);
        setShowPicker(true);
      }
    } catch (e) {
      showToast("Error: " + e.message, "error");
    } finally {
      setProcessing(false);
    }
  };

  const handlePickerConfirm = () => {
    const acc = filteredAccounts.find(a => a.id === pickerAcc);
    if (!acc) { showToast("Please select an account", "error"); return; }
    setShowPicker(false);
    onNavigate(acc, pickerYear, pickerMonth, pendingTxs, pendingFile);
    setPendingTxs([]); setPendingFile("");
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setShowUpload(true)}>
        ☑ Reconcile
      </Button>

      {/* ── Upload modal ── */}
      <Modal isOpen={showUpload} onClose={() => { setShowUpload(false); setStagedFile(null); }} title="Reconcile from PDF" width={520}>
        {stagedFile ? (
          <div style={{ textAlign: "center", padding: "20px" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: FF, marginBottom: 4 }}>
              {stagedFile.name}
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: FF, marginBottom: 20 }}>
              {stagedFile.size > 1048576
                ? `${(stagedFile.size / 1048576).toFixed(1)} MB`
                : `${(stagedFile.size / 1024).toFixed(0)} KB`}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button onClick={() => setStagedFile(null)} disabled={processing}
                style={{ fontSize: 12, padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", color: "#6b7280", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
                Back
              </button>
              <button onClick={handleProcess} disabled={processing}
                style={{ fontSize: 12, padding: "8px 16px", borderRadius: 8, border: "none", background: "#3b5bdb", color: "#fff", cursor: "pointer", fontFamily: FF, fontWeight: 600, opacity: processing ? 0.6 : 1 }}>
                {processing ? "Processing…" : "Process with AI"}
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setStagedFile(f); }}
            style={{ border: "2px dashed #e5e7eb", borderRadius: 16, padding: "28px 24px", textAlign: "center", cursor: "pointer", background: "#fafafa" }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: FF, marginBottom: 4 }}>Drop PDF here or click to browse</div>
            <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: FF }}>Bank or credit card statement (PDF)</div>
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) setStagedFile(f); e.target.value = ""; }} />
            <div style={{ marginTop: 12 }}>
              <Button variant="primary" size="sm">Choose File</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Manual picker modal (when auto-detect fails) ── */}
      <Modal isOpen={showPicker} onClose={() => { setShowPicker(false); setPendingTxs([]); }} title="Select Account & Period" width={400}>
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
            <button onClick={() => { setShowPicker(false); setPendingTxs([]); }}
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
