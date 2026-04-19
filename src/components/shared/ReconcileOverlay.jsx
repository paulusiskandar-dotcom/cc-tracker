// ReconcileOverlay — shared reconcile mode for Bank & CC statements
// Provides: upload modal, matching logic, status column renderer, and reconcile bar
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { reconcileApi, ledgerApi, getTxFromToTypes } from "../../api";
import { supabase } from "../../lib/supabase";
import { fmtIDR, todayStr, resolveCategoryIds } from "../../utils";
import { Button, showToast, TransactionReviewList } from "./index";
import { LIGHT, DARK } from "../../theme";
import Modal from "./Modal";
import TransactionModal from "./TransactionModal";

const EDGE_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-estatement`;
const FF = "Figtree, sans-serif";

// ── Matching ─────────────────────────────────────────────────
function wordSimilarity(a, b) {
  if (!a || !b) return 0;
  const wa = a.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const wb = b.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  if (!wa.length || !wb.length) return 0;
  const setB = new Set(wb);
  return wa.filter(w => setB.has(w)).length / Math.max(wa.length, wb.length);
}

function matchRows(stmtRows, ledgerRows) {
  const usedL = new Set();
  const matched = new Map(); // ledgerId → stmtRow

  for (const s of stmtRows) {
    let bestIdx = -1, bestScore = 0;
    for (let li = 0; li < ledgerRows.length; li++) {
      if (usedL.has(li)) continue;
      const l = ledgerRows[li];
      const amtDiff = Math.abs(Math.abs(Number(s.amount || 0)) - Math.abs(Number(l.amount_idr || l.amount || 0)));
      if (amtDiff > 100) continue;
      const dayDiff = Math.abs((new Date((s.date || "") + "T00:00:00") - new Date((l.tx_date || "") + "T00:00:00")) / 86400000);
      const sim = wordSimilarity(s.description || s.merchant || "", l.description || "");
      let score = 0;
      if (dayDiff <= 3 && sim >= 0.6) score = 3 + sim + (amtDiff < 1 ? 1 : 0);
      else if (sim >= 0.8 && dayDiff <= 7) score = 2 + sim;
      else if (dayDiff <= 3 && amtDiff < 1) score = 2;
      if (score > bestScore) { bestScore = score; bestIdx = li; }
    }
    if (bestIdx >= 0 && bestScore >= 2) {
      matched.set(ledgerRows[bestIdx].id, s);
      usedL.add(bestIdx);
    }
  }

  // Unmatched stmt rows = missing
  const matchedStmtIds = new Set([...matched.values()].map(s => s._id));
  const missing = stmtRows.filter(s => !matchedStmtIds.has(s._id));
  // Unmatched ledger rows = extra
  const extraIds = new Set(ledgerRows.filter((_, i) => !usedL.has(i)).map(l => l.id));

  return { matched, missing, extraIds };
}

// ── Status badge renderer ────────────────────────────────────
export function ReconcileStatusBadge({ type }) {
  const cfg = {
    match:   { bg: "#dcfce7", color: "#059669", label: "✓" },
    missing: { bg: "#fef3c7", color: "#d97706", label: "!" },
    extra:   { bg: "#fee2e2", color: "#dc2626", label: "?" },
    kept:    { bg: "#e5e7eb", color: "#6b7280", label: "◦" },
    ignored: { bg: "#f3f4f6", color: "#9ca3af", label: "–" },
    reconciled: { bg: "#dcfce7", color: "#059669", label: "✓" },
  }[type];
  if (!cfg) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 22, height: 22, borderRadius: 6,
      background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 800,
    }}>{cfg.label}</span>
  );
}

// ── Main hook ────────────────────────────────────────────────
export function useReconcile({ user, accountId, fromDate, toDate, ledgerRows }) {
  const [active,     setActive]     = useState(false);
  const [stmtRows,   setStmtRows]   = useState([]);
  const [processing, setProcessing] = useState(false);
  const [keptIds,    setKeptIds]    = useState(() => new Set());
  const [ignoredIds, setIgnoredIds] = useState(() => new Set());
  const [sessionId,  setSessionId]  = useState(null);
  const [pdfSource,  setPdfSource]  = useState("");
  const fileRef = useRef(null);

  const { matched, missing, extraIds } = useMemo(() => {
    if (!active || !stmtRows.length) return { matched: new Map(), missing: [], extraIds: new Set() };
    return matchRows(stmtRows, ledgerRows);
  }, [active, stmtRows, ledgerRows]);

  // Status for a ledger row
  const getStatus = useCallback((ledgerId) => {
    if (!active) {
      // Check if previously reconciled
      const tx = ledgerRows.find(e => e.id === ledgerId);
      return tx?.reconciled_at ? "reconciled" : null;
    }
    if (matched.has(ledgerId)) return "match";
    if (keptIds.has(ledgerId)) return "kept";
    if (extraIds.has(ledgerId)) return "extra";
    return "match"; // in ledger, not flagged
  }, [active, matched, keptIds, extraIds, ledgerRows]);

  const missingFiltered = useMemo(() =>
    missing.filter(s => !ignoredIds.has(s._id)),
  [missing, ignoredIds]);

  const stats = useMemo(() => ({
    match: matched.size,
    missing: missingFiltered.length,
    extra: [...extraIds].filter(id => !keptIds.has(id)).length,
    ignored: ignoredIds.size,
    kept: keptIds.size,
  }), [matched, missingFiltered, extraIds, keptIds, ignoredIds]);

  // Upload handler
  const stageAndProcess = useCallback(async (file) => {
    if (!file) return;
    setPdfSource(file.name);
    setProcessing(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise((res, rej) => { reader.onload = () => res(reader.result.split(",")[1]); reader.onerror = rej; reader.readAsDataURL(file); });
      const r = await fetch(EDGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: "process_upload", user_id: user.id, pdf_base64: base64 }),
      });
      const data = await r.json();
      if (data.needs_password || data.encrypted) {
        showToast("PDF terenkripsi. Silakan hapus password terlebih dahulu.", "error");
      } else if (data.transactions?.length) {
        setStmtRows(data.transactions.map((t, i) => ({ ...t, _id: `stmt-${i}` })));
        showToast(`${data.transactions.length} transactions extracted`);
      } else {
        showToast(data.error || "No transactions found", "error");
      }
    } catch (e) { showToast(`Error: ${e.message}`, "error"); }
    finally { setProcessing(false); }
  }, [user]);

  const markKept = useCallback((id) => setKeptIds(p => { const n = new Set(p); n.add(id); return n; }), []);
  const markIgnored = useCallback((id) => setIgnoredIds(p => { const n = new Set(p); n.add(id); return n; }), []);

  const startReconcile = useCallback(() => setActive(true), []);
  const exitReconcile = useCallback(async () => {
    if (user && accountId && stmtRows.length) {
      try {
        const [y, m] = (fromDate || "").split("-").map(Number);
        await reconcileApi.create(user.id, {
          account_id: accountId,
          period_year: y || new Date().getFullYear(),
          period_month: m || new Date().getMonth() + 1,
          status: "completed",
          pdf_filename: pdfSource,
          total_statement: stmtRows.length,
          total_match: stats.match,
          total_missing: stats.missing,
          total_extra: stats.extra,
          completed_at: new Date().toISOString(),
        });
      } catch (e) { console.error("[reconcile] save session error:", e); }
    }
    setActive(false); setStmtRows([]); setKeptIds(new Set()); setIgnoredIds(new Set()); setPdfSource("");
    showToast("Reconcile completed");
  }, [user, accountId, fromDate, stmtRows, stats, pdfSource]);

  return {
    active, stmtRows, processing, stats, pdfSource, fileRef,
    matched, missing: missingFiltered, extraIds, keptIds, ignoredIds,
    getStatus, markKept, markIgnored,
    stageAndProcess, startReconcile, exitReconcile,
  };
}

// ── Reconcile bar + upload modal ─────────────────────────────
export function ReconcileBar({ reconcile, onRefresh }) {
  const { active, stats, processing, pdfSource, fileRef, stageAndProcess, exitReconcile } = reconcile;
  const [showUpload, setShowUpload] = useState(false);

  if (!active) return null;

  return (
    <>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12,
        padding: "10px 16px", flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8", fontFamily: FF }}>Reconcile Mode</span>
          {pdfSource && (
            <>
              <span style={{ fontSize: 9, fontWeight: 700, background: "#dcfce7", color: "#059669", padding: "2px 8px", borderRadius: 10 }}>✓ {stats.match}</span>
              <span style={{ fontSize: 9, fontWeight: 700, background: "#fef3c7", color: "#d97706", padding: "2px 8px", borderRadius: 10 }}>! {stats.missing}</span>
              <span style={{ fontSize: 9, fontWeight: 700, background: "#fee2e2", color: "#dc2626", padding: "2px 8px", borderRadius: 10 }}>? {stats.extra}</span>
            </>
          )}
          {pdfSource && <span style={{ fontSize: 10, color: "#6b7280", fontFamily: FF }}>{pdfSource}</span>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {!pdfSource && (
            <button onClick={() => setShowUpload(true)}
              style={{ fontSize: 11, fontWeight: 700, padding: "5px 14px", borderRadius: 8, border: "none", background: "#3b5bdb", color: "#fff", cursor: "pointer", fontFamily: FF }}>
              {processing ? "Processing…" : "Upload PDF"}
            </button>
          )}
          <button onClick={() => { exitReconcile(); onRefresh?.(); }}
            style={{ fontSize: 11, fontWeight: 700, padding: "5px 14px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontFamily: FF }}>
            Selesai Reconcile
          </button>
        </div>
      </div>

      {/* Upload modal */}
      <Modal isOpen={showUpload} onClose={() => setShowUpload(false)} title="Upload Statement PDF" width={520}>
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { stageAndProcess(f); setShowUpload(false); } }}
          style={{ border: "2px dashed #e5e7eb", borderRadius: 16, padding: "28px 24px", textAlign: "center", cursor: "pointer", background: "#fafafa" }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: FF, marginBottom: 4 }}>Drop PDF here or click to browse</div>
          <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: FF }}>Bank or credit card statement (PDF)</div>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) { stageAndProcess(f); setShowUpload(false); } e.target.value = ""; }} />
          <div style={{ marginTop: 12 }}><Button variant="primary" size="sm">Choose File</Button></div>
        </div>
      </Modal>
    </>
  );
}

// ── Missing rows section ─────────────────────────────────────
export function ReconcileMissingRows({ reconcile, accounts, categories, user, onRefresh, dark }) {
  const { missing, markIgnored, stageAndProcess } = reconcile;
  const T = dark ? DARK : LIGHT;

  if (!reconcile.active || missing.length === 0) return null;

  return (
    <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "12px 16px", marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#d97706", fontFamily: FF, marginBottom: 8 }}>
        Missing from Ledger ({missing.length})
      </div>
      {missing.map(s => (
        <div key={s._id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #fef3c7", fontSize: 11, fontFamily: FF }}>
          <span style={{ width: 60, color: "#6b7280", flexShrink: 0 }}>{(s.date || "").slice(5)}</span>
          <span style={{ flex: 1, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.description || s.merchant || "—"}</span>
          <span style={{ width: 80, textAlign: "right", fontWeight: 600, color: "#A32D2D" }}>{fmtIDR(Math.abs(Number(s.amount || 0)))}</span>
          <ReconcileStatusBadge type="missing" />
          <button onClick={() => markIgnored(s._id)}
            style={{ fontSize: 9, fontWeight: 700, color: "#6b7280", background: "none", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 6px", cursor: "pointer", fontFamily: FF }}>
            Ignore
          </button>
        </div>
      ))}
    </div>
  );
}
