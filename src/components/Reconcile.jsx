// Reconcile.jsx — Command center: account status + draft resume + Gmail PDF queue
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { processReconcilePDF, matchDetectedAccount } from "../lib/reconcilePdfUpload";
import { showToast } from "./shared/index";
import GlobalReconcileButton from "./shared/GlobalReconcileButton";
import ReconcileDraftBanner from "./shared/ReconcileDraftBanner";

const FF = "Figtree, sans-serif";

function daysSince(date) {
  if (!date) return null;
  return Math.floor((new Date() - new Date(date)) / 86400000);
}

function formatDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return iso; }
}

function getCurrentMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export default function Reconcile({
  user,
  accounts,
  reconSessions,
  setTab,
  setPendingReconcileNav,
}) {
  const [queue,      setQueue]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [processing, setProcessing] = useState(null);

  // Fetch pending PDF queue
  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    supabase
      .from("estatement_pdfs")
      .select("id, filename, file_path, status, account_id, ai_raw_result, created_at")
      .eq("user_id", user.id)
      .in("status", ["queued", "extracted", "failed"])
      .order("created_at", { ascending: false })
      .then(({ data }) => { setQueue(data || []); setLoading(false); });
  }, [user?.id]);

  const bankCCAccounts = (accounts || []).filter(a => ["bank", "credit_card"].includes(a.type));

  // Last reconciled per account (from shared reconSessions prop)
  const lastReconciledMap = useMemo(() => {
    const map = {};
    (reconSessions || [])
      .filter(s => s.status === "completed")
      .forEach(s => {
        if (!map[s.account_id] || new Date(s.completed_at) > new Date(map[s.account_id])) {
          map[s.account_id] = s.completed_at;
        }
      });
    return map;
  }, [reconSessions]);

  // Enrich + sort accounts by reconcile status
  const accountStatus = useMemo(() => {
    const targets = (accounts || []).filter(a => a.is_active && (a.type === "bank" || a.type === "credit_card"));
    const enriched = targets.map(a => {
      const last = lastReconciledMap[a.id];
      const days = daysSince(last);
      let statusBadge = "ok";
      if (!last)       statusBadge = "never";
      else if (days > 30) statusBadge = "overdue";
      else if (days > 7)  statusBadge = "stale";
      return { ...a, lastReconciled: last, daysAgo: days, statusBadge };
    });
    const order = { never: 0, overdue: 1, stale: 2, ok: 3 };
    return enriched.sort((a, b) => {
      const d = order[a.statusBadge] - order[b.statusBadge];
      return d !== 0 ? d : (b.daysAgo || 0) - (a.daysAgo || 0);
    });
  }, [accounts, lastReconciledMap]);

  const summary = useMemo(() => {
    const needsAttention = accountStatus.filter(a => a.statusBadge !== "ok").length;
    return { total: accountStatus.length, needsAttention, okCount: accountStatus.length - needsAttention };
  }, [accountStatus]);

  // ── Handlers ─────────────────────────────────────────────────

  // Navigate to statement page for an account with current month pre-loaded
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

  const handleStartReconcile = (acc) => {
    const { from, to } = getCurrentMonthRange();
    setPendingReconcileNav({
      accType: acc.type === "credit_card" ? "credit_card" : "bank",
      acc,
      seeds: { from, to },
    });
    setTab(acc.type === "credit_card" ? "cards" : "bank");
  };

  const handleDraftContinue = (acc, state_json) => {
    const accType = acc.type === "credit_card" ? "credit_card" : "bank";
    setPendingReconcileNav({ accType, acc, seeds: { fullState: state_json } });
    setTab(accType === "credit_card" ? "cards" : "bank");
  };

  // Process PDF from queue (reuse existing extraction or re-download)
  const handleProcess = async (item) => {
    setProcessing(item.id);
    try {
      let txs, detectedAcc, year, month, filename, blobUrl, closingBal, openingBal;

      if (item.status === "extracted" && item.ai_raw_result?.transactions?.length) {
        const r   = item.ai_raw_result;
        txs         = r.transactions;
        filename    = item.filename || "statement.pdf";
        closingBal  = r.closing_balance  ?? null;
        openingBal  = r.opening_balance  ?? null;
        detectedAcc = matchDetectedAccount(r.detected_account, bankCCAccounts);
        year  = r.detected_period?.year  || new Date().getFullYear();
        month = r.detected_period?.month || (new Date().getMonth() + 1);
        blobUrl = null;
      } else {
        if (!item.file_path) throw new Error("No PDF source available");
        const { data: blob, error } = await supabase.storage.from("estatement-pdfs").download(item.file_path);
        if (error || !blob) throw new Error("Could not download PDF");
        const file  = new File([blob], item.filename || "statement.pdf", { type: "application/pdf" });
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

      await supabase.from("estatement_pdfs").update({ status: "done" }).eq("id", item.id);
      setQueue(prev => prev.filter(q => q.id !== item.id));

      const acc = detectedAcc
        || (item.account_id ? (accounts || []).find(a => a.id === item.account_id) : null)
        || bankCCAccounts[0];
      if (!acc) { showToast("Account not matched — open Bank or Cards to reconcile manually", "warning"); return; }
      navigateToAccount(acc, year, month, txs, filename, blobUrl, closingBal, openingBal);
    } catch (e) {
      showToast("Error: " + e.message, "error");
    } finally {
      setProcessing(null);
    }
  };

  const handleDeletePDF = async (id) => {
    await supabase.from("estatement_pdfs").delete().eq("id", id);
    setQueue(prev => prev.filter(r => r.id !== id));
    showToast("Removed");
  };

  // ── Render ────────────────────────────────────────────────────

  return (
    <div style={{ padding: 16, fontFamily: FF, maxWidth: 1100, margin: "0 auto" }}>

      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>Reconcile</h1>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            Match bank statements against your ledger
          </div>
        </div>
        <GlobalReconcileButton
          type="all"
          accounts={bankCCAccounts}
          user={user}
          onNavigate={navigateToAccount}
        />
      </div>

      {/* SUMMARY STATS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <div style={{ padding: "14px 16px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <div style={{ fontSize: 10, color: "#9ca3af", letterSpacing: "0.6px", marginBottom: 4, fontFamily: FF }}>TOTAL ACCOUNTS</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#111827", fontFamily: FF }}>{summary.total}</div>
        </div>
        <div style={{ padding: "14px 16px", background: "#fff", border: "1px solid #fde68a", borderLeft: "3px solid #d97706", borderRadius: 12 }}>
          <div style={{ fontSize: 10, color: "#d97706", letterSpacing: "0.6px", marginBottom: 4, fontFamily: FF }}>NEEDS ATTENTION</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#d97706", fontFamily: FF }}>{summary.needsAttention}</div>
        </div>
        <div style={{ padding: "14px 16px", background: "#fff", border: "1px solid #bbf7d0", borderLeft: "3px solid #059669", borderRadius: 12 }}>
          <div style={{ fontSize: 10, color: "#059669", letterSpacing: "0.6px", marginBottom: 4, fontFamily: FF }}>UP TO DATE</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#059669", fontFamily: FF }}>{summary.okCount}</div>
        </div>
      </div>

      {/* DRAFT BANNER */}
      <ReconcileDraftBanner
        user={user}
        accounts={accounts}
        onContinue={handleDraftContinue}
      />

      {/* ACCOUNT STATUS LIST */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, marginBottom: 16, overflow: "hidden" }}>
        <div style={{
          padding: "14px 16px", borderBottom: "1px solid #e5e7eb",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: FF }}>Account Status</div>
          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF }}>
            {accountStatus.length} account{accountStatus.length !== 1 ? "s" : ""}
          </div>
        </div>
        {accountStatus.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 13, fontFamily: FF }}>
            No active bank or credit card accounts
          </div>
        ) : (
          accountStatus.map((acc, idx) => (
            <AccountStatusRow
              key={acc.id}
              account={acc}
              isLast={idx === accountStatus.length - 1}
              onStart={() => handleStartReconcile(acc)}
            />
          ))
        )}
      </div>

      {/* PENDING GMAIL QUEUE — compact, only shown when non-empty */}
      {(loading || queue.length > 0) && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
          <div style={{
            padding: "12px 16px", borderBottom: "1px solid #e5e7eb",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: FF }}>Pending from Gmail</div>
            <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: FF }}>Auto-detected by Email Sync</div>
          </div>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "#9ca3af", fontSize: 12, fontFamily: FF }}>Loading…</div>
          ) : (
            queue.map((item, idx) => {
              const isProc = processing === item.id;
              const acc    = item.account_id ? (accounts || []).find(a => a.id === item.account_id) : null;
              const badge  = item.status === "extracted"
                ? { label: "Ready",  bg: "#dbeafe", color: "#1d4ed8" }
                : item.status === "failed"
                  ? { label: "Failed", bg: "#fee2e2", color: "#dc2626" }
                  : { label: "Queued", bg: "#f3f4f6", color: "#6b7280" };
              return (
                <div key={item.id} style={{
                  padding: "10px 16px", display: "flex", alignItems: "center", gap: 12,
                  borderBottom: idx < queue.length - 1 ? "1px solid #f3f4f6" : "none",
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: FF }}>
                      {item.filename || "statement.pdf"}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: badge.bg, color: badge.color }}>
                        {badge.label}
                      </span>
                      {acc && <span style={{ fontSize: 11, color: "#374151", fontFamily: FF }}>{acc.name}</span>}
                      {item.created_at && <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF }}>{formatDate(item.created_at)}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => handleProcess(item)}
                    disabled={isProc}
                    style={{
                      background: isProc ? "#e5e7eb" : "#dcfce7",
                      color:      isProc ? "#9ca3af" : "#059669",
                      border: "none", padding: "5px 12px", borderRadius: 6,
                      fontSize: 11, fontWeight: 600, cursor: isProc ? "default" : "pointer",
                      fontFamily: FF, flexShrink: 0,
                    }}
                  >
                    {isProc ? "Processing…" : "Process →"}
                  </button>
                  <button
                    onClick={() => handleDeletePDF(item.id)}
                    style={{ background: "transparent", border: "none", color: "#d1d5db", fontSize: 14, cursor: "pointer", padding: 2, flexShrink: 0, fontFamily: FF }}
                    title="Remove from queue"
                  >
                    ✕
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TIP */}
      <div style={{ padding: "10px 14px", background: "#f9fafb", borderRadius: 8, fontSize: 11, color: "#6b7280", fontFamily: FF }}>
        💡 Klik <strong style={{ color: "#374151" }}>Start →</strong> di akun untuk reconcile bulan ini, atau upload PDF statement via tombol <strong style={{ color: "#374151" }}>Reconcile</strong> di kanan atas.
      </div>

    </div>
  );
}

// ── Account Status Row ────────────────────────────────────────
function AccountStatusRow({ account, onStart, isLast }) {
  const badgeConfig = {
    never:   { bg: "#fee2e2", color: "#dc2626", label: "Never"   },
    overdue: { bg: "#fef3c7", color: "#d97706", label: "Overdue" },
    stale:   { bg: "#fef9e7", color: "#d97706", label: "Stale"   },
    ok:      { bg: "#dcfce7", color: "#059669", label: "OK"      },
  };
  const badge    = badgeConfig[account.statusBadge] || badgeConfig.ok;
  const lastText = account.lastReconciled
    ? `${account.daysAgo} day${account.daysAgo !== 1 ? "s" : ""} ago · ${formatDate(account.lastReconciled)}`
    : "Never reconciled";
  const isOk     = account.statusBadge === "ok";

  return (
    <div style={{
      padding: "12px 16px",
      borderBottom: isLast ? "none" : "1px solid #f3f4f6",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: account.type === "credit_card" ? "#fef2f2" : "#eff6ff",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
      }}>
        {account.type === "credit_card" ? "💳" : "🏦"}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "Figtree, sans-serif" }}>
          {account.name}
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1, fontFamily: "Figtree, sans-serif" }}>
          {lastText}
        </div>
      </div>

      <div style={{
        background: badge.bg, color: badge.color,
        padding: "3px 8px", borderRadius: 6,
        fontSize: 10, fontWeight: 600, letterSpacing: "0.4px",
        fontFamily: "Figtree, sans-serif", flexShrink: 0,
      }}>
        {badge.label}
      </div>

      <button
        onClick={onStart}
        style={{
          background: isOk ? "#f9fafb" : "#dcfce7",
          color:      isOk ? "#6b7280" : "#059669",
          border:     isOk ? "1px solid #e5e7eb" : "none",
          padding: "6px 12px", borderRadius: 8,
          fontSize: 11, fontWeight: 600,
          cursor: "pointer", fontFamily: "Figtree, sans-serif", flexShrink: 0,
        }}
      >
        {isOk ? "Re-reconcile" : "Start →"}
      </button>
    </div>
  );
}
