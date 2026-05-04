// ReconcileOverlay — shared reconcile mode for Bank & CC statements
// Provides: upload modal, matching logic, status column renderer, and reconcile bar
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { reconcileApi, ledgerApi, installmentsApi, loanPaymentsApi } from "../../api";
import { merchantRules } from "../../lib/merchantRules";
import { detectDuplicate } from "../../lib/duplicateDetection";
import { detectTransferPairs } from "../../lib/transferDetection";
import { supabase } from "../../lib/supabase";
import { processReconcilePDF } from "../../lib/reconcilePdfUpload";
import { fmtIDR, todayStr } from "../../utils";
import { Button, showToast, TxHorizontal, TX_HORIZONTAL_TYPES } from "./index";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES_LIST } from "../../constants";
import { LIGHT } from "../../theme";
import Modal from "./Modal";
import ReconcileSummaryModal from "./ReconcileSummaryModal";

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
    match:      { bg: "#dcfce7", color: "#059669", label: "✓" },
    missing:    { bg: "#fef3c7", color: "#d97706", label: "!" },
    extra:      { bg: "#fee2e2", color: "#dc2626", label: "?" },
    kept:       { bg: "#e5e7eb", color: "#6b7280", label: "◦" },
    ignored:    { bg: "#f3f4f6", color: "#9ca3af", label: "–" },
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
export function useReconcile({ user, accountId, fromDate, toDate, ledgerRows, currentAccountId, accounts = [], merchantMaps = [] }) {
  const [active,       setActive]       = useState(false);
  const [stmtRows,     setStmtRows]     = useState([]);
  const [processing,   setProcessing]   = useState(false);
  const [keptIds,      setKeptIds]      = useState(() => new Set());
  const [ignoredIds,   setIgnoredIds]   = useState(() => new Set());
  const [sessionId,    setSessionId]    = useState(null); // eslint-disable-line no-unused-vars
  const [pdfSource,         setPdfSource]         = useState("");
  const [pdfBlobUrl,        setPdfBlobUrl]        = useState(null);
  const [stmtClosingBalance, setStmtClosingBalance] = useState(null);
  const [stmtOpeningBalance, setStmtOpeningBalance] = useState(null);
  const [expandedIds,        setExpandedIds]        = useState(() => new Set());
  const [pendingRows,        setPendingRows]        = useState({});
  const [allLedger,          setAllLedger]          = useState([]);
  const [manuallyUnmatched,  setManuallyUnmatched]  = useState(() => new Set());
  const fileRef = useRef(null);

  useEffect(() => () => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); }, [pdfBlobUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active || !user?.id) return;
    supabase
      .from("ledger")
      .select("id, tx_date, description, merchant_name, amount_idr, amount, from_id, to_id")
      .eq("user_id", user.id)
      .order("tx_date", { ascending: false })
      .limit(5000)
      .then(({ data }) => setAllLedger(data || []));
  }, [active, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { matched, missing, extraIds } = useMemo(() => {
    if (!active || !stmtRows.length) return { matched: new Map(), missing: [], extraIds: new Set() };
    const raw = matchRows(stmtRows, ledgerRows);
    if (!manuallyUnmatched.size) return raw;

    const adjustedMatched = new Map(raw.matched);
    const releasedStmtRows = [];
    for (const ledgerId of manuallyUnmatched) {
      if (adjustedMatched.has(ledgerId)) {
        releasedStmtRows.push(adjustedMatched.get(ledgerId));
        adjustedMatched.delete(ledgerId);
      }
    }
    return {
      matched:  adjustedMatched,
      missing:  [...raw.missing, ...releasedStmtRows],
      extraIds: new Set([...raw.extraIds, ...manuallyUnmatched]),
    };
  }, [active, stmtRows, ledgerRows, manuallyUnmatched]);

  // Status for a ledger row
  const getStatus = useCallback((ledgerId) => {
    if (!active) {
      const tx = ledgerRows.find(e => e.id === ledgerId);
      return tx?.reconciled_at ? "reconciled" : null;
    }
    if (!stmtRows.length) {
      const tx = ledgerRows.find(e => e.id === ledgerId);
      return tx?.reconciled_at ? "reconciled" : null;
    }
    if (manuallyUnmatched.has(ledgerId)) return "extra";
    if (matched.has(ledgerId)) return "match";
    if (keptIds.has(ledgerId)) return "kept";
    if (extraIds.has(ledgerId)) return "extra";
    return "match";
  }, [active, stmtRows, matched, keptIds, extraIds, ledgerRows, manuallyUnmatched]);

  const missingFiltered = useMemo(() =>
    missing.filter(s => !ignoredIds.has(s._id)),
  [missing, ignoredIds]);

  const missingEnriched = useMemo(() => {
    const dupEnriched = missingFiltered.map(s => {
      const dup = detectDuplicate(
        { tx_date: s.date, amount_idr: s.amount, amount: s.amount, description: s.description, merchant_name: s.merchant },
        allLedger,
        { sameAccountId: currentAccountId },
      );
      if (!dup) return s;
      return { ...s, _dupEntry: dup.dupEntry, _dupReasons: dup.reasons, _dupLevel: dup.level };
    });
    const pairs = detectTransferPairs(dupEnriched, accounts, allLedger);
    return dupEnriched.map(s => {
      const p = pairs.find(x => x.rowId === s._id || x.partnerRowId === s._id);
      return p ? { ...s, _transferPair: p } : s;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingFiltered, allLedger, currentAccountId]);

  const stats = useMemo(() => ({
    match: matched.size,
    missing: missingFiltered.length,
    extra: [...extraIds].filter(id => !keptIds.has(id)).length,
    ignored: ignoredIds.size,
    kept: keptIds.size,
  }), [matched, missingFiltered, extraIds, keptIds, ignoredIds]);

  // Upload handler
  const stageAndProcess = useCallback(async (file, { append = false } = {}) => {
    if (!file) return;
    setProcessing(true);
    const result = await processReconcilePDF(file, user.id);
    setProcessing(false);

    if (result.error) {
      showToast(result.error, "error");
      return;
    }

    if (append) {
      setStmtRows(prev => [...prev, ...result.transactions]);
      setPdfSource(prev => prev ? `${prev}, ${result.filename}` : result.filename);
      URL.revokeObjectURL(result.blobUrl); // keep first file's preview
    } else {
      setStmtRows(result.transactions);
      setPdfSource(result.filename);
      setPdfBlobUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return result.blobUrl;
      });
      if (result.closing_balance != null) setStmtClosingBalance(Number(result.closing_balance));
      if (result.opening_balance != null) setStmtOpeningBalance(Number(result.opening_balance));
    }

    setActive(true);
    showToast(`${result.transactions.length} transactions extracted`);
  }, [user]);

  const markKept    = useCallback((id) => setKeptIds(p => { const n = new Set(p); n.add(id); return n; }), []);
  const markIgnored = useCallback((id) => setIgnoredIds(p => { const n = new Set(p); n.add(id); return n; }), []);
  const unmatchLedgerRow = useCallback((id) => setManuallyUnmatched(p => { const n = new Set(p); n.add(id); return n; }), []);
  const rematchLedgerRow = useCallback((id) => setManuallyUnmatched(p => { const n = new Set(p); n.delete(id); return n; }), []);

  const mergeTransferPair = useCallback((stmtRowId) => {
    const row = missingEnriched.find(s => s._id === stmtRowId);
    if (!row?._transferPair) return;
    const { partnerRowId, fromId, toId } = row._transferPair;
    if (partnerRowId) markIgnored(partnerRowId);
    setPendingRows(p => ({
      ...p,
      [stmtRowId]: {
        ...(p[stmtRowId] || {}),
        tx_type: "transfer",
        from_id: fromId || "",
        to_id:   toId   || "",
        category_id: null,
      },
    }));
  }, [missingEnriched, markIgnored]);

  const toggleExpanded = useCallback((id) => setExpandedIds(p => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  }), []);
  const expandAll  = useCallback(() => setExpandedIds(new Set(missingFiltered.map(m => m._id))), [missingFiltered]);
  const collapseAll = useCallback(() => setExpandedIds(new Set()), []);

  const updatePendingRow = useCallback((stmtRowId, row) => {
    setPendingRows(p => ({ ...p, [stmtRowId]: row }));
  }, []);
  const removePendingRow = useCallback((stmtRowId) => {
    setPendingRows(p => { const n = { ...p }; delete n[stmtRowId]; return n; });
  }, []);

  const seedStmtRows = useCallback((txs, filename = "", opts = {}) => {
    setStmtRows(txs.map((t, i) => ({ ...t, _id: t._id || `stmt-${i}` })));
    setPdfSource(filename);
    if (opts.blobUrl) {
      setPdfBlobUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return opts.blobUrl;
      });
    }
    if (opts.closingBal != null) setStmtClosingBalance(Number(opts.closingBal));
    if (opts.openingBal != null) setStmtOpeningBalance(Number(opts.openingBal));
    setActive(true);
  }, []);

  const seedFullState = useCallback((s) => {
    if (s.stmtRows?.length) {
      setStmtRows(s.stmtRows);
      setPdfSource(s.pdfSource || "");
      setActive(true);
    }
    if (s.ignoredIds) setIgnoredIds(new Set(s.ignoredIds));
    if (s.pendingRows) setPendingRows(s.pendingRows);
    if (s.stmtClosingBalance != null) setStmtClosingBalance(s.stmtClosingBalance);
    if (s.stmtOpeningBalance != null) setStmtOpeningBalance(s.stmtOpeningBalance);
  }, []);

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
    if (matched.size > 0) {
      try {
        const matchedIds = [...matched.keys()];
        const nowIso = new Date().toISOString();
        const { error } = await supabase
          .from("ledger")
          .update({ reconciled_at: nowIso })
          .in("id", matchedIds)
          .eq("user_id", user.id);
        if (error) throw error;
      } catch (e) { console.error("[reconcile] update reconciled_at error:", e); }
    }
    if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null); }
    setActive(false); setStmtRows([]); setKeptIds(new Set()); setIgnoredIds(new Set()); setPdfSource("");
    setExpandedIds(new Set()); setPendingRows({}); setStmtClosingBalance(null); setStmtOpeningBalance(null);
    setManuallyUnmatched(new Set());
    showToast("Reconcile completed");
  }, [user, accountId, fromDate, stmtRows, stats, pdfSource, matched]);

  return {
    active, stmtRows, processing, stats, pdfSource, pdfBlobUrl,
    stmtClosingBalance, stmtOpeningBalance, fileRef,
    matched, missing: missingEnriched, extraIds, keptIds, ignoredIds,
    getStatus, markKept, markIgnored, unmatchLedgerRow, rematchLedgerRow,
    seedStmtRows, seedFullState,
    stageAndProcess, startReconcile, exitReconcile,
    currentAccountId,
    expandedIds, toggleExpanded, expandAll, collapseAll,
    pendingRows, updatePendingRow, removePendingRow,
    merchantMaps, allLedger, mergeTransferPair,
  };
}

// ── Reconcile bar + upload modal ─────────────────────────────
export function ReconcileBar({ reconcile, onRefresh, onClearDraft, currentAccount, periodLabel, ledgerClosingBalance, showPdfPanel, onTogglePdfPanel }) {
  const { active, stats, processing, pdfSource, pdfBlobUrl, fileRef, stageAndProcess, exitReconcile, stmtClosingBalance } = reconcile;
  const [showUpload,   setShowUpload]   = useState(false);
  const [stagedFiles,  setStagedFiles]  = useState([]);
  const [processProgress, setProcessProgress] = useState(null);
  const [showSummary,  setShowSummary]  = useState(false);

  if (!active) return null;

  const hasMismatch = stmtClosingBalance != null && ledgerClosingBalance != null &&
    Math.round(stmtClosingBalance) !== Math.round(ledgerClosingBalance);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12,
          padding: "10px 16px", flexWrap: "wrap", gap: 8,
        }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8", fontFamily: FF }}>Reconcile Mode</span>
            {pdfSource && (
              <>
                <span title="Matched — In both ledger and statement"
                  style={{ fontSize: 9, fontWeight: 700, background: "#dcfce7", color: "#059669", padding: "2px 8px", borderRadius: 10, cursor: "help" }}>
                  ✓ {stats.match}
                </span>
                <span title="Missing — In statement, not in ledger"
                  style={{ fontSize: 9, fontWeight: 700, background: "#fef3c7", color: "#d97706", padding: "2px 8px", borderRadius: 10, cursor: "help" }}>
                  ! {stats.missing}
                </span>
                <span title="Extra — In ledger, not in statement"
                  style={{ fontSize: 9, fontWeight: 700, background: "#fee2e2", color: "#dc2626", padding: "2px 8px", borderRadius: 10, cursor: "help" }}>
                  ? {stats.extra}
                </span>
              </>
            )}
            {processProgress && (
              <span style={{ fontSize: 10, color: "#1d4ed8", fontFamily: FF }}>
                Processing {processProgress.current}/{processProgress.total}…
              </span>
            )}
            {pdfSource && !processProgress && <span style={{ fontSize: 10, color: "#6b7280", fontFamily: FF }}>{pdfSource}</span>}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {!pdfSource && (
              <button onClick={() => setShowUpload(true)}
                style={{ fontSize: 11, fontWeight: 700, padding: "5px 14px", borderRadius: 8, border: "none", background: "#3b5bdb", color: "#fff", cursor: "pointer", fontFamily: FF }}>
                {processing ? "Processing…" : "Upload PDF"}
              </button>
            )}
            {pdfBlobUrl && onTogglePdfPanel && (
              <button onClick={onTogglePdfPanel}
                style={{ fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 8, border: "1px solid #bfdbfe", background: showPdfPanel ? "#dbeafe" : "#fff", color: "#1d4ed8", cursor: "pointer", fontFamily: FF }}>
                {showPdfPanel ? "Hide PDF" : "Show PDF"}
              </button>
            )}
            <button onClick={() => setShowSummary(true)}
              style={{ fontSize: 11, fontWeight: 700, padding: "5px 14px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontFamily: FF }}>
              Done
            </button>
          </div>
        </div>

        {/* Persistent mismatch warning */}
        {hasMismatch && (
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "6px 12px", fontSize: 11, color: "#c2410c", fontFamily: FF }}>
            ⚠ Closing balance mismatch: {fmtIDR(Math.abs(stmtClosingBalance - ledgerClosingBalance))} difference
          </div>
        )}
      </div>

      {/* Upload modal */}
      <Modal isOpen={showUpload} onClose={() => { setShowUpload(false); setStagedFiles([]); }} title="Upload Statement PDF" width={520}>
        {stagedFiles.length > 0 ? (
          /* Staging UI — list of files */
          <div style={{ padding: "8px 0" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {stagedFiles.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
                  <span style={{ fontSize: 20 }}>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: FF, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                    <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF }}>
                      {f.size / 1024 > 1024 ? `${(f.size / (1024 * 1024)).toFixed(1)} MB` : `${(f.size / 1024).toFixed(0)} KB`}
                    </div>
                  </div>
                  <button onClick={() => setStagedFiles(prev => prev.filter((_, idx) => idx !== i))}
                    style={{ fontSize: 11, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: "2px 6px", borderRadius: 4, fontFamily: FF }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setStagedFiles([])}
                style={{ fontSize: 12, padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", color: "#6b7280", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
                Cancel
              </button>
              <button
                onClick={async () => {
                  const files = stagedFiles;
                  setStagedFiles([]);
                  setShowUpload(false);
                  for (let i = 0; i < files.length; i++) {
                    setProcessProgress({ current: i + 1, total: files.length });
                    await stageAndProcess(files[i], { append: i > 0 });
                  }
                  setProcessProgress(null);
                }}
                style={{ fontSize: 12, padding: "8px 16px", borderRadius: 8, border: "none", background: "#3b5bdb", color: "#fff", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
                Process{stagedFiles.length > 1 ? ` (${stagedFiles.length} files)` : ""}
              </button>
            </div>
          </div>
        ) : (
          /* Drop zone */
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith(".pdf"));
              if (files.length) setStagedFiles(files);
            }}
            style={{ border: "2px dashed #e5e7eb", borderRadius: 16, padding: "28px 24px", textAlign: "center", cursor: "pointer", background: "#fafafa" }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: FF, marginBottom: 4 }}>Drop PDF(s) here or click to browse</div>
            <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: FF }}>Bank or credit card statement — one or multiple PDFs</div>
            <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: "none" }}
              onChange={e => {
                const files = Array.from(e.target.files || []).filter(f => f.name.toLowerCase().endsWith(".pdf"));
                if (files.length) setStagedFiles(files);
                e.target.value = "";
              }} />
            <div style={{ marginTop: 12 }}><Button variant="primary" size="sm">Choose File(s)</Button></div>
          </div>
        )}
      </Modal>

      {/* Summary modal */}
      <ReconcileSummaryModal
        open={showSummary}
        onClose={() => setShowSummary(false)}
        onRecheck={() => setShowSummary(false)}
        onProceed={async () => {
          setShowSummary(false);
          await exitReconcile();
          onClearDraft?.();
          onRefresh?.();
        }}
        stats={stats}
        pdfFilename={pdfSource}
        account={currentAccount}
        period={periodLabel}
        stmtClosingBalance={stmtClosingBalance}
        ledgerClosingBalance={ledgerClosingBalance}
        addedCount={0}
      />
    </>
  );
}

// ── Helper function to get missing rows by date ──────────────
export function getMissingRowsMap(missing) {
  const map = new Map();
  missing.forEach(row => {
    const date = row.date || "";
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(row);
  });
  return map;
}

// ── Missing rows summary bar ─────────────────────────────────
export function ReconcileMissingBar({ reconcile, accounts, onExpandAll, expandedCount, totalMissing, onSaveAll, saving }) {
  const [bulkType,     setBulkType]     = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkAccount,  setBulkAccount]  = useState("");
  const [bulkEntity,   setBulkEntity]   = useState("");

  if (!reconcile.active || totalMissing === 0) return null;

  const allExpanded = expandedCount === totalMissing;

  const applyBulkToAll = (field, value, extra = {}) => {
    if (!value) return;
    const pending = reconcile.pendingRows || {};
    const ids = Object.keys(pending);
    if (!ids.length) {
      reconcile.expandAll();
      showToast("Expanding all rows — click bulk again after they load", "info");
      return;
    }
    ids.forEach(id => {
      reconcile.updatePendingRow(id, { ...pending[id], [field]: value, ...extra });
    });
    showToast(`Applied to ${ids.length} rows`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 14px", marginBottom: 8 }}>
      {/* Top row: count + action buttons */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e", fontFamily: FF }}>
          {totalMissing} missing transaction{totalMissing > 1 ? "s" : ""} from PDF
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onExpandAll}
            style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 6, border: "1px solid #fbbf24", background: "#fff", color: "#92400e", cursor: "pointer", fontFamily: FF }}>
            {allExpanded ? "Collapse All" : `Expand All (${totalMissing})`}
          </button>
          {expandedCount > 0 && (
            <button onClick={onSaveAll} disabled={saving}
              style={{ fontSize: 11, fontWeight: 700, padding: "5px 14px", borderRadius: 6, border: "none", background: "#3b5bdb", color: "#fff", cursor: saving ? "default" : "pointer", fontFamily: FF, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : `Save All (${expandedCount})`}
            </button>
          )}
        </div>
      </div>

      {/* Bulk edit row — only visible when at least 1 panel is expanded */}
      {expandedCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", paddingTop: 6, borderTop: "1px solid #fde68a" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", fontFamily: FF, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Bulk Edit:
          </span>

          <select value={bulkType}
            onChange={e => {
              const newType = e.target.value;
              setBulkType(newType);
              applyBulkToAll("tx_type", newType);
              const isIncomeType  = ["income","collect_loan","sell_asset","reimburse_in"].includes(newType);
              const isExpenseType = ["expense","reimburse_out"].includes(newType);
              if (bulkCategory) {
                const inIncome  = INCOME_CATEGORIES_LIST.some(c => c.id === bulkCategory);
                const inExpense = EXPENSE_CATEGORIES.some(c => c.id === bulkCategory);
                if ((isIncomeType && !inIncome) || (isExpenseType && !inExpense)) setBulkCategory("");
              }
            }}
            style={{ fontSize: 11, padding: "3px 6px", borderRadius: 5, border: "1px solid #fbbf24", background: "#fff", fontFamily: FF, cursor: "pointer" }}>
            <option value="">Type…</option>
            {TX_HORIZONTAL_TYPES.filter(t => t.value !== "cc_installment").map(t => (
              <option key={t.value} value={t.value} style={{ color: t.color }}>{t.label}</option>
            ))}
          </select>

          <select value={bulkCategory}
            onChange={e => {
              const cat = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES_LIST].find(c => c.id === e.target.value);
              setBulkCategory(e.target.value);
              applyBulkToAll("category_id", e.target.value, { category_name: cat?.label || "" });
            }}
            style={{ fontSize: 11, padding: "3px 6px", borderRadius: 5, border: "1px solid #fbbf24", background: "#fff", fontFamily: FF, cursor: "pointer" }}>
            <option value="">Category…</option>
            {(() => {
              const isIncomeType  = ["income","collect_loan","sell_asset","reimburse_in"].includes(bulkType);
              const isExpenseType = ["expense","reimburse_out"].includes(bulkType);
              if (isIncomeType)  return INCOME_CATEGORIES_LIST.map(c => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ${c.label}` : c.label}</option>);
              if (isExpenseType) return EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ${c.label}` : c.label}</option>);
              return (
                <>
                  <optgroup label="Expense">
                    {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ${c.label}` : c.label}</option>)}
                  </optgroup>
                  <optgroup label="Income">
                    {INCOME_CATEGORIES_LIST.map(c => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ${c.label}` : c.label}</option>)}
                  </optgroup>
                </>
              );
            })()}
          </select>

          <select value={bulkAccount}
            onChange={e => { setBulkAccount(e.target.value); applyBulkToAll("from_id", e.target.value); }}
            style={{ fontSize: 11, padding: "3px 6px", borderRadius: 5, border: "1px solid #fbbf24", background: "#fff", fontFamily: FF, cursor: "pointer" }}>
            <option value="">Account…</option>
            {(accounts || []).filter(a => ["bank","cash","credit_card"].includes(a.type)).map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <select value={bulkEntity}
            onChange={e => { setBulkEntity(e.target.value); applyBulkToAll("entity", e.target.value); }}
            style={{ fontSize: 11, padding: "3px 6px", borderRadius: 5, border: "1px solid #fbbf24", background: "#fff", fontFamily: FF, cursor: "pointer" }}>
            <option value="">Entity…</option>
            <option value="Personal">Personal</option>
            <option value="Hamasa">Hamasa</option>
            <option value="SDC">SDC</option>
            <option value="Travelio">Travelio</option>
          </select>
        </div>
      )}
    </div>
  );
}

// ── Add panel — TxHorizontal inline form ─────────────────────
function buildRow(stmtRow, currentAccountId, merchantMapsArg = []) {
  const desc = stmtRow.description || stmtRow.merchant || "";
  const suggestion = merchantMapsArg.length > 0
    ? merchantRules.apply(desc, desc, merchantMapsArg)
    : null;
  const dupLevel = stmtRow._dupLevel || 0;
  return {
    _id: `reconcile-${stmtRow._id}`,
    tx_date: stmtRow.date || todayStr(),
    description: desc,
    amount: Math.abs(Number(stmtRow.amount || 0)),
    amount_idr: Math.abs(Number(stmtRow.amount || 0)),
    currency: stmtRow.currency || "IDR",
    tx_type: "expense",
    from_id: currentAccountId || "",
    from_type: "account",
    to_id: null,
    to_type: "expense_category",
    category_id: suggestion?.confidence >= 2 ? suggestion.category_id : null,
    category_name: suggestion?.confidence >= 2 ? (suggestion.category_name || null) : null,
    entity: "",
    notes: "",
    status: dupLevel === 3 ? "duplicate" : dupLevel === 2 ? "possible_duplicate" : dupLevel === 1 ? "review" : "pending",
    _dupEntry: stmtRow._dupEntry || null,
    _dupReasons: stmtRow._dupReasons || [],
    _transferPair: stmtRow._transferPair || undefined,
    learned_cat: suggestion || undefined,
  };
}

export function ReconcileAddPanel({ stmtRow, reconcile, accounts, employeeLoans, user, onRefresh, onClose, onAccountCreated, categories = [], incomeSrcs = [] }) {
  const T = LIGHT;
  const [rows, setRows] = useState(() => [buildRow(stmtRow, reconcile.currentAccountId, reconcile.merchantMaps || [])]);
  const [selected, setSelected] = useState(() => {
    const r = buildRow(stmtRow, reconcile.currentAccountId, reconcile.merchantMaps || []);
    return { [r._id]: (stmtRow._dupLevel || 0) <= 1 };
  });

  // Register initial row in pendingRows on mount; clean up on unmount
  useEffect(() => {
    if (rows[0]) reconcile.updatePendingRow(stmtRow._id, rows[0]);
    return () => reconcile.removePendingRow(stmtRow._id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external pendingRows changes (e.g. from bulk edit) into local rows
  useEffect(() => {
    const external = reconcile.pendingRows[stmtRow._id];
    if (!external) return;
    setRows(prev => {
      const current = prev[0];
      if (!current) return prev;
      const changedFields = {};
      ["tx_type", "category_id", "category_name", "from_id", "to_id", "entity", "from_type", "to_type"].forEach(f => {
        if (external[f] !== current[f]) changedFields[f] = external[f];
      });
      if (!Object.keys(changedFields).length) return prev;
      return [{ ...current, ...changedFields }];
    });
  }, [ // eslint-disable-line react-hooks/exhaustive-deps
    reconcile.pendingRows[stmtRow._id]?.tx_type,
    reconcile.pendingRows[stmtRow._id]?.category_id,
    reconcile.pendingRows[stmtRow._id]?.from_id,
    reconcile.pendingRows[stmtRow._id]?.entity,
    reconcile.pendingRows[stmtRow._id]?.to_id,
  ]);

  // Apply merchant rules when merchantMaps changes (loaded after panel mounts)
  useEffect(() => {
    if (!reconcile.merchantMaps?.length) return;
    setRows(prev => prev.map(r => {
      if (r.learned_cat) return r;
      const suggestion = merchantRules.apply(r.description, r.description, reconcile.merchantMaps);
      if (!suggestion) return r;
      const updated = {
        ...r,
        learned_cat:   suggestion,
        category_id:   suggestion.category_id   || r.category_id,
        category_name: suggestion.category_name || r.category_name,
      };
      reconcile.updatePendingRow(stmtRow._id, updated);
      return updated;
    }));
  }, [reconcile.merchantMaps]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRow = (id, patch) => setRows(prev => {
    const next = prev.map(r => r._id === id ? { ...r, ...patch } : r);
    // Keep pendingRows in sync — store the first (and only) row
    if (next[0]) reconcile.updatePendingRow(stmtRow._id, next[0]);
    return next;
  });

  const confirmRow = async (r) => {
    try {
      const entry = {
        tx_date: r.tx_date,
        tx_type: r.tx_type,
        description: r.description,
        amount: Number(r.amount || r.amount_idr || 0),
        amount_idr: Number(r.amount_idr || r.amount || 0),
        currency: r.currency || "IDR",
        fx_rate_used: Number(r.fx_rate || 1),
        from_id: r.from_id,
        from_type: r.from_type,
        to_id: r.to_id,
        to_type: r.to_type,
        category_id: r.category_id || null,
        category_name: r.category_name || null,
        entity: r.entity || null,
        is_reimburse: ["reimburse_in", "reimburse_out"].includes(r.tx_type),
        notes: r.notes || null,
      };
      const created = await ledgerApi.create(user.id, entry, accounts);

      // Cicilan support
      if (r._cicilan && r._cicilanMonths >= 2 && created?.id) {
        try {
          await installmentsApi.createFromImport(user.id, {
            ledgerId: created.id, description: r.description || "", accountId: r.from_id,
            amount: Number(r.amount_idr || r.amount || 0), totalMonths: r._cicilanMonths,
            paidMonths: r._cicilanKe || 1,
            currency: r.currency || "IDR", txDate: r.tx_date, categoryId: r.category_id || null,
          });
        } catch (e) {
          console.error("[cicilan]", e);
          showToast(`Cicilan tidak tersimpan: ${e.message || "Unknown error"}`, "error");
        }
      }

      // Collect loan support (skip UUID-based accounts — not employee_loans rows)
      const loanRef = r.employee_loan_id || r.from_id;
      if (r.tx_type === "collect_loan" && loanRef && !String(loanRef).includes("-")) {
        loanPaymentsApi.recordAndIncrement(user.id, {
          loanId: loanRef, payDate: r.tx_date,
          amount: Number(r.amount_idr || r.amount || 0),
          notes: r.description || "Added via reconcile",
        }).catch(e => console.error("[collect_loan]", e));
      }

      showToast("Transaction added");
      reconcile.removePendingRow(stmtRow._id);
      onClose();
      onRefresh?.();
    } catch (e) { showToast("Error: " + e.message, "error"); }
  };

  return (
    <div style={{ background: "#fffbeb", borderLeft: "3px solid #fbbf24", borderBottom: "1px solid #fde68a", padding: "8px 12px 10px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#92400e", fontFamily: FF }}>Add to Ledger</span>
        <button onClick={onClose}
          style={{ fontSize: 11, color: "#6b7280", background: "none", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: FF }}>
          Cancel
        </button>
      </div>
      <TxHorizontal
        rows={rows}
        selected={selected}
        onUpdateRow={updateRow}
        onConfirmRow={confirmRow}
        onSkipRow={onClose}
        onConfirmAll={async (sel) => { for (const r of sel) await confirmRow(r); }}
        onToggleSelect={id => setSelected(s => ({ ...s, [id]: !s[id] }))}
        onToggleAll={() => {}}
        source="reconcile"
        hideBatchFooter
        accounts={accounts}
        employeeLoans={employeeLoans || []}
        categories={categories}
        incomeSrcs={incomeSrcs}
        T={T}
        user={user}
        onAccountCreated={onAccountCreated}
        onMergeTransfer={() => reconcile.mergeTransferPair?.(stmtRow._id)}
      />
    </div>
  );
}

// ── Inline missing row with accordion add panel ───────────────
export function ReconcileMissingRowInline({ missingRow, reconcile, accounts, employeeLoans, user, onRefresh, onAccountCreated, COLS, ROW_PAD, FF: FF_PROP, categories = [], incomeSrcs = [] }) {
  const expanded = reconcile.expandedIds.has(missingRow._id);
  const [dupDismissed, setDupDismissed] = useState(false);
  const FF_USED = FF_PROP || FF;
  const amt = Math.abs(Number(missingRow.amount || 0));
  const rawDupLevel = missingRow._dupLevel || 0;
  const dupLevel = dupDismissed ? 0 : rawDupLevel;

  const rowBg     = "#fffbeb";
  const rowBorder = "#fde68a";

  const fmtDateIndo = (date) => {
    try {
      return new Date(date + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return date; }
  };

  return (
    <>
      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: COLS, borderBottom: expanded ? "none" : `0.5px solid ${rowBorder}`, padding: ROW_PAD, alignItems: "center", background: rowBg }}>
        <div style={{ fontSize: 11, color: "#d97706", fontFamily: FF_USED, padding: "8px 6px", whiteSpace: "nowrap", fontStyle: "italic" }}>
          {fmtDateIndo(missingRow.date)}
        </div>
        <div style={{ padding: "8px 6px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, overflow: "hidden" }}>
            {missingRow._dupLevel > 0 && (
              <span style={{ fontSize: 9, fontWeight: 800, background: "#F7C1C1", color: "#791F1F", padding: "2px 5px", borderRadius: 4, fontFamily: FF_USED, whiteSpace: "nowrap", flexShrink: 0 }}>
                {missingRow._dupLevel === 3 ? "DUP" : missingRow._dupLevel === 2 ? "POSSIBLE DUP" : "SUSPICIOUS"}
              </span>
            )}
            <span style={{ fontSize: 12, fontWeight: 500, color: "#d97706", fontFamily: FF_USED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: "italic" }}>
              {missingRow.description || missingRow.merchant || "—"}
            </span>
          </div>
        </div>
        <div style={{ padding: "8px 6px" }}>
          <ReconcileStatusBadge type="missing" />
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#A32D2D", fontFamily: FF_USED, padding: "8px 6px", textAlign: "right" }}>
          {fmtIDR(amt)}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#d1d5db", fontFamily: FF_USED, padding: "8px 6px", textAlign: "right" }}>—</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#d1d5db", fontFamily: FF_USED, padding: "8px 6px", textAlign: "right" }}>—</div>
        <div style={{ display: "flex", gap: 4, padding: "8px 6px", justifyContent: "center" }}>
          <button
            title="Add to ledger"
            onClick={() => reconcile.toggleExpanded(missingRow._id)}
            style={{ width: 22, height: 22, fontSize: 11, fontWeight: 700, borderRadius: 4, border: "none", cursor: "pointer", background: expanded ? "#fbbf24" : "#fef3c7", color: "#d97706" }}>
            +
          </button>
          <button
            title="Ignore"
            onClick={() => reconcile.markIgnored(missingRow._id)}
            style={{ width: 22, height: 22, fontSize: 11, fontWeight: 700, borderRadius: 4, border: "none", cursor: "pointer", background: "#f3f4f6", color: "#9ca3af" }}>
            ✕
          </button>
        </div>
      </div>

      {/* Inline add panel */}
      {expanded && (
        <ReconcileAddPanel
          stmtRow={missingRow}
          reconcile={reconcile}
          accounts={accounts}
          employeeLoans={employeeLoans}
          user={user}
          onRefresh={onRefresh}
          onAccountCreated={onAccountCreated}
          categories={categories}
          incomeSrcs={incomeSrcs}
          onClose={() => reconcile.toggleExpanded(missingRow._id)}
        />
      )}
    </>
  );
}
