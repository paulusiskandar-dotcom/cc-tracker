// Reconcile.jsx — Global reconcile page: PDF queue from Gmail + manual upload
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { processReconcilePDF, matchDetectedAccount } from "../lib/reconcilePdfUpload";
import { showToast } from "./shared/Card";
import GlobalReconcileButton from "./shared/GlobalReconcileButton";

const FF = "Figtree, sans-serif";

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso || ""; }
};

export default function Reconcile({ user, accounts, setTab, setPendingReconcileNav }) {
  const [queue,      setQueue]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [processing, setProcessing] = useState(null); // id of item in flight

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    supabase.from("estatement_pdfs")
      .select("id, filename, file_path, status, account_id, ai_raw_result, created_at")
      .eq("user_id", user.id)
      .in("status", ["queued", "extracted", "failed"])
      .order("created_at", { ascending: false })
      .then(({ data }) => { setQueue(data || []); setLoading(false); });
  }, [user?.id]);

  const bankCCAccounts = accounts.filter(a => ["bank", "credit_card"].includes(a.type));

  const navigateToAccount = (acc, year, month, txs, filename, blobUrl, closingBal, openingBal) => {
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const to   = new Date(year, month, 0).toISOString().slice(0, 10);
    setPendingReconcileNav({
      accType: acc.type === "credit_card" ? "credit_card" : "bank",
      acc,
      seeds: { from, to, txs, filename, blobUrl, closingBal, openingBal },
    });
    setTab(acc.type === "credit_card" ? "cards" : "bank");
  };

  const handleProcess = async (item) => {
    setProcessing(item.id);
    try {
      let txs, detectedAcc, year, month, filename, blobUrl, closingBal, openingBal;

      if (item.status === "extracted" && item.ai_raw_result?.transactions?.length) {
        // Reuse saved extraction result — no need to re-process
        const r = item.ai_raw_result;
        txs         = r.transactions;
        filename    = item.filename || "statement.pdf";
        closingBal  = r.closing_balance  ?? null;
        openingBal  = r.opening_balance  ?? null;
        detectedAcc = matchDetectedAccount(r.detected_account, bankCCAccounts);
        year  = r.detected_period?.year  || new Date().getFullYear();
        month = r.detected_period?.month || (new Date().getMonth() + 1);
        blobUrl = null;
      } else {
        // Download from Storage + re-process
        if (!item.file_path) throw new Error("No PDF source available");
        const { data: blob, error } = await supabase.storage
          .from("estatement-pdfs").download(item.file_path);
        if (error || !blob) throw new Error("Could not download PDF");
        const file   = new File([blob], item.filename || "statement.pdf", { type: "application/pdf" });
        const result = await processReconcilePDF(file, user.id);
        if (result.error) { showToast(result.error, "error"); return; }
        txs         = result.transactions;
        filename    = result.filename;
        blobUrl     = result.blobUrl;
        closingBal  = result.closing_balance  ?? null;
        openingBal  = result.opening_balance  ?? null;
        detectedAcc = matchDetectedAccount(result.detected_account, bankCCAccounts);
        year  = result.detected_period?.year  || new Date().getFullYear();
        month = result.detected_period?.month || (new Date().getMonth() + 1);
      }

      // Mark as done — handed off to reconcile
      await supabase.from("estatement_pdfs").update({ status: "done" }).eq("id", item.id);
      setQueue(prev => prev.filter(q => q.id !== item.id));

      const acc = detectedAcc
        || (item.account_id ? accounts.find(a => a.id === item.account_id) : null)
        || bankCCAccounts[0];
      if (!acc) {
        showToast("Account not matched — open Bank or Cards to reconcile manually", "warning");
        return;
      }
      navigateToAccount(acc, year, month, txs, filename, blobUrl, closingBal, openingBal);
    } catch (e) {
      showToast("Error: " + e.message, "error");
    } finally {
      setProcessing(null);
    }
  };

  const handleDelete = async (id) => {
    await supabase.from("estatement_pdfs").delete().eq("id", id);
    setQueue(prev => prev.filter(q => q.id !== id));
    showToast("Removed");
  };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 16px", fontFamily: FF }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#111827", margin: 0 }}>Reconcile</h1>
          <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0 0" }}>
            Match bank statements against your ledger
          </p>
        </div>
        <GlobalReconcileButton
          type="all"
          accounts={bankCCAccounts}
          user={user}
          onNavigate={navigateToAccount}
        />
      </div>

      {/* ── Pending PDFs from Gmail ── */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ padding: "13px 18px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
            Pending from Gmail
          </span>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>
            Auto-detected by Email Sync
          </span>
        </div>

        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
            Loading…
          </div>
        ) : queue.length === 0 ? (
          <div style={{ padding: "32px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 13, color: "#9ca3af" }}>No pending statements</div>
            <div style={{ fontSize: 12, color: "#d1d5db", marginTop: 4 }}>
              Enable Email Sync in Settings → Email to auto-detect statements
            </div>
          </div>
        ) : (
          <div>
            {queue.map((item, idx) => {
              const isProc = processing === item.id;
              const acc    = item.account_id ? accounts.find(a => a.id === item.account_id) : null;
              const badge  = item.status === "extracted"
                ? { label: "Ready",  bg: "#dbeafe", color: "#1d4ed8" }
                : item.status === "failed"
                  ? { label: "Failed", bg: "#fee2e2", color: "#dc2626" }
                  : { label: "Queued", bg: "#f3f4f6", color: "#6b7280" };
              return (
                <div key={item.id} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 18px",
                  borderBottom: idx < queue.length - 1 ? "1px solid #f3f4f6" : "none",
                }}>
                  <span style={{ fontSize: 22, flexShrink: 0 }}>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.filename || "statement.pdf"}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: badge.bg, color: badge.color }}>
                        {badge.label}
                      </span>
                      {acc && <span style={{ fontSize: 11, color: "#374151" }}>{acc.name}</span>}
                      {item.created_at && <span style={{ fontSize: 11, color: "#9ca3af" }}>{fmtDate(item.created_at)}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => handleProcess(item)}
                    disabled={isProc}
                    style={{
                      fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 8,
                      border: "none",
                      background: isProc ? "#e5e7eb" : "#3b5bdb",
                      color:      isProc ? "#9ca3af" : "#fff",
                      cursor: isProc ? "default" : "pointer", flexShrink: 0,
                    }}>
                    {isProc ? "Processing…" : "Reconcile →"}
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    style={{ fontSize: 14, color: "#d1d5db", background: "none", border: "none", cursor: "pointer", padding: 2, flexShrink: 0 }}
                    title="Remove from queue">
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Tip ── */}
      <div style={{ padding: "12px 16px", background: "#f9fafb", border: "1px solid #f3f4f6", borderRadius: 12, fontSize: 12, color: "#6b7280" }}>
        <strong style={{ color: "#374151" }}>Tip:</strong>{" "}
        You can also reconcile per account — open Bank or Credit Cards and click{" "}
        <span style={{ fontWeight: 700 }}>☑ Reconcile</span> in the statement toolbar.
      </div>
    </div>
  );
}
