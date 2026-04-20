// ReconcileOverlay — shared reconcile mode for Bank & CC statements
// Provides: upload modal, matching logic, status column renderer, and reconcile bar
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { reconcileApi, ledgerApi, getTxFromToTypes } from "../../api";
import { supabase } from "../../lib/supabase";
import { fmtIDR, todayStr, resolveCategoryIds } from "../../utils";
import { Button, showToast, TransactionReviewList } from "./index";
import { LIGHT, DARK } from "../../theme";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES_LIST } from "../../constants";
import Modal from "./Modal";
import TransactionModal from "./TransactionModal";

const EDGE_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-estatement`;
const FF = "Figtree, sans-serif";

// ── TX Types and helpers (copied from TransactionReviewList.jsx) ──
export const TX_REVIEW_TYPES = [
  { value: "expense",        label: "Expense",        color: "#dc2626" },
  { value: "income",         label: "Income",         color: "#059669" },
  { value: "transfer",       label: "Transfer",       color: "#3b5bdb" },
  { value: "pay_cc",         label: "Pay CC",         color: "#7c3aed" },
  { value: "buy_asset",      label: "Buy Asset",      color: "#0891b2" },
  { value: "sell_asset",     label: "Sell Asset",     color: "#059669" },
  { value: "reimburse_out",  label: "Reimburse Out",  color: "#d97706" },
  { value: "reimburse_in",   label: "Reimburse In",   color: "#059669" },
  { value: "give_loan",      label: "Give Loan",      color: "#d97706" },
  { value: "collect_loan",   label: "Collect Loan",   color: "#059669" },
  { value: "pay_liability",  label: "Pay Liability",  color: "#d97706" },
  { value: "fx_exchange",    label: "FX Exchange",    color: "#0891b2" },
  { value: "cc_installment", label: "CC Installment", color: "#3b5bdb" },
];

const NO_CAT_TYPES    = new Set(["transfer","pay_cc","give_loan","collect_loan","fx_exchange",
                                  "reimburse_in","reimburse_out","buy_asset","sell_asset","pay_liability","cc_installment"]);
const REIMBURSE_TYPES = new Set(["reimburse_in","reimburse_out"]);
const INCOME_LIKE     = new Set(["income","collect_loan","reimburse_in","sell_asset"]);

// ── Account type helpers ────────────────────────────────────────
const isCashAcc = a => a.type === "cash" || a.subtype === "cash" || /-cash$/i.test(a.name || "");
const isCCAcc   = a => a.type === "credit_card";
const isBankAcc = a => a.type === "bank" && !isCashAcc(a);

const OTHER_ACCT_GROUPS = [
  { type: "asset",      label: "Assets"      },
  { type: "receivable", label: "Receivables" },
  { type: "liability",  label: "Liabilities" },
];

const REIMBURSE_ENTITY_NAMES = ["Hamasa", "SDC", "Travelio"];

// ── Account filter/mode per tx_type ────────────────────────────
function getAcctCfg(txType, accounts) {
  const bc      = accounts.filter(a => ["bank","cash"].includes(a.type));
  const bccc    = accounts.filter(a => ["bank","cash","credit_card"].includes(a.type));
  const cc      = accounts.filter(a => a.type === "credit_card");
  const asset    = accounts.filter(a => a.type === "asset");
  const loanRecv = accounts.filter(a => a.type === "receivable" && !REIMBURSE_ENTITY_NAMES.includes(a.name));
  const loanRecvWithBal = loanRecv.filter(a => Number(a.current_balance || 0) > 0);
  const liab    = accounts.filter(a => a.type === "liability");
  const all     = accounts;
  switch (txType) {
    case "income":        return { mode: "to",       to: bc };
    case "reimburse_in":  return { mode: "to",       to: bc };
    case "sell_asset":    return { mode: "from_to",  from: asset, to: bc };
    case "collect_loan":  return { mode: "from_to",  from: loanRecvWithBal.length ? loanRecvWithBal : loanRecv, to: bc };
    case "transfer":      return { mode: "from_to",  from: all,   to: all };
    case "pay_cc":        return { mode: "from_to",  from: bc,    to: cc };
    case "buy_asset":     return { mode: "from_to",  from: bc,    to: asset };
    case "give_loan":     return { mode: "from_to",  from: bc,    to: loanRecv };
    case "pay_liability": return { mode: "from_to",  from: bc,    to: liab };
    case "fx_exchange":   return { mode: "from_to",  from: all,   to: all };
    case "cc_installment":return { mode: "from",     from: cc };
    default:              return { mode: "from",     from: bccc }; // expense, reimburse_out
  }
}

// ── Validation ─────────────────────────────────────────────────
function validateRow(r, accounts) {
  const cfg = getAcctCfg(r.tx_type, accounts);
  const isUUID = v => typeof v === "string" && v.length === 36;
  if (r.tx_type === "collect_loan") {
    if (!isUUID(r.employee_loan_id)) return "Pilih borrower";
    if (!isUUID(r.to_id)) return "Pilih akun tujuan";
    return null;
  }
  if ((cfg.mode === "from" || cfg.mode === "from_to") && !isUUID(r.from_id))
    return "Pilih akun sumber";
  if ((cfg.mode === "to"   || cfg.mode === "from_to") && !isUUID(r.to_id))
    return "Pilih akun tujuan";
  if (!NO_CAT_TYPES.has(r.tx_type) && !r.category_id)
    return "Pilih kategori";
  if (r.tx_type === "reimburse_in" && !r.entity)
    return "Pilih entity reimburse";
  if (r.tx_type === "fx_exchange" && (!r.fx_rate || Number(r.fx_rate) <= 0))
    return "Isi FX rate";
  return null;
}

// ── Amount helpers ──────────────────────────────────────────────
const fmtAmt = (v) => {
  const n = Math.abs(Math.round(Number(v) || 0));
  return "Rp " + n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

// ── Inline style helpers ────────────────────────────────────────
const inSel = (T, extra = {}) => ({
  fontSize: 11, padding: "3px 4px", border: `1px solid ${T.border}`,
  borderRadius: 5, background: T.surface, color: T.text,
  fontFamily: "Figtree, sans-serif", cursor: "pointer",
  boxSizing: "border-box", ...extra,
});
const inInp = (T, extra = {}) => ({
  fontSize: 11, padding: "3px 5px", border: `1px solid ${T.border}`,
  borderRadius: 5, background: T.surface, color: T.text,
  fontFamily: "Figtree, sans-serif", boxSizing: "border-box", ...extra,
});
const ACT_BTN = (extra = {}) => ({
  width: 26, height: 26, borderRadius: 6, border: "1px solid #e5e7eb",
  background: "#f9fafb", cursor: "pointer", fontSize: 12, fontWeight: 700,
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "Figtree, sans-serif", padding: 0, flexShrink: 0, ...extra,
});

// ── Tabbed account select (Bank / Cash / CC tabs) ────────────────
function TabbedAcctSelect({ accounts, value, onChange, placeholder = "Select…", showLast4 = false, T }) {
  const bankAccs  = accounts.filter(isBankAcc);
  const cashAccs  = accounts.filter(isCashAcc);
  const ccAccs    = accounts.filter(isCCAcc);
  const otherAccs = accounts.filter(a => !isBankAcc(a) && !isCashAcc(a) && !isCCAcc(a));

  const tabs = [
    bankAccs.length > 0 && { id: "bank", label: "Bank", accs: bankAccs },
    cashAccs.length > 0 && { id: "cash", label: "Cash", accs: cashAccs },
    ccAccs.length   > 0 && { id: "cc",   label: "CC",   accs: ccAccs   },
  ].filter(Boolean);

  const initTab = () => {
    if (value) {
      if (bankAccs.some(a => a.id === value)) return "bank";
      if (cashAccs.some(a => a.id === value)) return "cash";
      if (ccAccs.some(a   => a.id === value)) return "cc";
    }
    return tabs[0]?.id || "bank";
  };
  const [activeTab, setActiveTab] = useState(initTab);

  const activeAccs = (tabs.find(t => t.id === activeTab)?.accs || accounts).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const tabBtn = (id, label) => (
    <button key={id} type="button" onClick={() => setActiveTab(id)}
      style={{
        padding: "1px 7px", borderRadius: 4, border: "none", cursor: "pointer",
        fontSize: 10, fontWeight: activeTab === id ? 700 : 500,
        fontFamily: "Figtree, sans-serif",
        background: activeTab === id ? "#3b5bdb" : "transparent",
        color: activeTab === id ? "#fff" : "#9ca3af",
      }}>
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      {tabs.length > 1 && (
        <div style={{ display: "flex", gap: 1, flexShrink: 0 }}>
          {tabs.map(t => tabBtn(t.id, t.label))}
        </div>
      )}
      <select style={{ ...inSel(T), flex: 1, minWidth: 0 }}
        value={value || ""}
        onChange={e => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {activeAccs.map(a => (
          <option key={a.id} value={a.id}>
            {a.name}{showLast4 && (a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : ""}
          </option>
        ))}
        {otherAccs.length > 0 && OTHER_ACCT_GROUPS.map(g => {
          const grp = otherAccs.filter(a => a.type === g.type).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
          if (!grp.length) return null;
          return (
            <optgroup key={g.type} label={g.label}>
              {grp.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}{showLast4 && (a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : ""}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}

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
export function useReconcile({ user, accountId, fromDate, toDate, ledgerRows, currentAccountId }) {
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
    currentAccountId,
  };
}

// ── Reconcile bar + upload modal ─────────────────────────────
export function ReconcileBar({ reconcile, onRefresh }) {
  const { active, stats, processing, pdfSource, fileRef, stageAndProcess, exitReconcile } = reconcile;
  const [showUpload, setShowUpload] = useState(false);
  const [stagedFile, setStagedFile] = useState(null);

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
      <Modal isOpen={showUpload} onClose={() => { setShowUpload(false); setStagedFile(null); }} title="Upload Statement PDF" width={520}>
        {stagedFile ? (
          /* Staging UI */
          <div style={{ textAlign: "center", padding: "20px" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: FF, marginBottom: 4 }}>
              {stagedFile.name}
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: FF, marginBottom: 20 }}>
              {(stagedFile.size / 1024 > 1024
                ? `${(stagedFile.size / (1024 * 1024)).toFixed(1)} MB`
                : `${(stagedFile.size / 1024).toFixed(0)} KB`)}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button
                onClick={() => { setStagedFile(null); }}
                style={{ fontSize: 12, padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", color: "#6b7280", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
                Cancel
              </button>
              <button
                onClick={() => { stageAndProcess(stagedFile); setShowUpload(false); setStagedFile(null); }}
                style={{ fontSize: 12, padding: "8px 16px", borderRadius: 8, border: "none", background: "#3b5bdb", color: "#fff", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
                Process with AI
              </button>
            </div>
          </div>
        ) : (
          /* Drop zone */
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
            <div style={{ marginTop: 12 }}><Button variant="primary" size="sm">Choose File</Button></div>
          </div>
        )}
      </Modal>
    </>
  );
}

// ── Helper function to get missing rows by date ──────────────
export function getMissingRowsMap(missing) {
  const map = new Map();
  missing.forEach(row => {
    const date = row.date || "";
    if (!map.has(date)) {
      map.set(date, []);
    }
    map.get(date).push(row);
  });
  return map;
}

// ── Inline missing row component with expanded form ──────────
export function ReconcileMissingRowInline({ missingRow, reconcile, COLS, ROW_PAD, FF, accounts, user, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [row, setRow] = useState({
    _id: missingRow._id,
    tx_date: missingRow.date || todayStr(),
    description: missingRow.description || missingRow.merchant || "",
    amount: Math.abs(Number(missingRow.amount || 0)),
    amount_idr: Math.abs(Number(missingRow.amount || 0)),
    currency: missingRow.currency || "IDR",
    tx_type: "expense",
    from_id: reconcile.currentAccountId || "",
    from_type: "account",
    to_id: "",
    to_type: "account",
    category_id: null,
    category_name: null,
    entity: "",
    notes: "",
    _cicilan: false,
    _cicilanKe: 1,
    _cicilanMonths: 3,
  });
  const [saving, setSaving] = useState(false);
  const [validErr, setValidErr] = useState(null);
  const T = LIGHT;

  const amt = Math.abs(Number(missingRow.amount || 0));
  const fmtDateIndo = (date) => {
    try {
      return new Date(date + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return date; }
  };

  const handleSave = async () => {
    const err = validateRow(row, accounts);
    if (err) { setValidErr(err); return; }
    setSaving(true);
    try {
      const { from_type, to_type } = getTxFromToTypes(row.tx_type);
      const payload = {
        user_id: user.id,
        tx_date: row.tx_date,
        tx_type: row.tx_type,
        description: row.description,
        amount: row.amount_idr || row.amount,
        amount_idr: row.amount_idr || row.amount,
        currency: row.currency || "IDR",
        fx_rate_used: 1,
        from_id: (from_type === "account") ? row.from_id : null,
        from_type,
        to_id: (to_type === "account" || to_type === "expense_category") ? (row.to_id || null) : null,
        to_type,
        category_id: row.category_id || null,
        category_name: row.category_name || null,
        entity: row.entity || null,
        is_reimburse: ["reimburse_in","reimburse_out"].includes(row.tx_type),
        notes: row.notes || null,
      };
      const { error } = await supabase.from("ledger").insert(payload);
      if (error) throw error;
      reconcile.markIgnored(missingRow._id);
      setExpanded(false);
      onRefresh?.();
      showToast("Transaction saved");
    } catch(e) {
      showToast("Error: " + e.message, "error");
    } finally { setSaving(false); }
  };

  const cfg = getAcctCfg(row.tx_type, accounts);
  const showCat = !NO_CAT_TYPES.has(row.tx_type);
  const cats = row.tx_type === "income" ? INCOME_CATEGORIES_LIST : EXPENSE_CATEGORIES;
  const typeColor = TX_REVIEW_TYPES.find(t => t.value === row.tx_type)?.color || T.text;
  const isFX = row.currency && row.currency !== "IDR";

  return (
    <div>
      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: COLS, borderBottom: "0.5px solid #fde68a", padding: ROW_PAD, alignItems: "center", background: "#fffbeb" }}>
        <div style={{ fontSize: 11, color: "#d97706", fontFamily: FF, padding: "8px 6px", whiteSpace: "nowrap", fontStyle: "italic" }}>
          {fmtDateIndo(missingRow.date)}
        </div>
        <div style={{ padding: "8px 6px", minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: "#d97706", fontFamily: FF, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: "italic" }}>
            {missingRow.description || missingRow.merchant || "—"}
          </div>
        </div>
        <div style={{ padding: "8px 6px" }}>
          <ReconcileStatusBadge type="missing" />
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#A32D2D", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
          {fmtIDR(amt)}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#d1d5db", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>—</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#d1d5db", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>—</div>
        <div style={{ display: "flex", gap: 4, padding: "8px 6px", justifyContent: "center" }}>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ fontSize: 10, fontWeight: 700, color: "#d97706", background: "none", border: "1px solid #d97706", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontFamily: FF }}>
            + Add
          </button>
          <button
            onClick={() => reconcile.markIgnored(missingRow._id)}
            style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", background: "none", border: "1px solid #e5e7eb", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontFamily: FF }}>
            Ignore
          </button>
        </div>
      </div>

      {/* Expanded inline form */}
      {expanded && (
        <div style={{ background: "#fffbeb", borderBottom: "1px solid #fde68a", padding: "6px 12px 10px" }}>
          {/* Row 1: type, category, account tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "nowrap", overflow: "hidden", marginBottom: 4 }}>
            {/* Type dropdown */}
            <select
              style={{ ...inSel(T), width: 112, flexShrink: 0, color: typeColor, fontWeight: 600 }}
              value={row.tx_type}
              onChange={e => {
                const t = e.target.value;
                setRow(prev => ({
                  ...prev,
                  tx_type: t,
                  category_id: NO_CAT_TYPES.has(t) ? null : prev.category_id,
                  entity: REIMBURSE_TYPES.has(t) ? (prev.entity || "") : "",
                }));
              }}>
              {TX_REVIEW_TYPES.map(t => (
                <option key={t.value} value={t.value} style={{ color: t.color, fontWeight: 600 }}>{t.label}</option>
              ))}
            </select>

            {/* Category */}
            {showCat && (
              <select style={{ ...inSel(T), width: 118, flexShrink: 0 }}
                value={row.category_id || ""}
                onChange={e => {
                  const cat = cats.find(c => c.id === e.target.value);
                  setRow(prev => ({ ...prev, category_id: e.target.value, category_name: cat?.label || "" }));
                }}>
                <option value="">Category…</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ${c.label}` : c.label}</option>)}
              </select>
            )}

            {/* Entity (reimburse) */}
            {REIMBURSE_TYPES.has(row.tx_type) && (
              <select
                style={{ ...inSel(T), width: 90, flexShrink: 0, fontWeight: 600, color: row.entity ? "#92400e" : "#6b7280" }}
                value={row.entity || ""}
                onChange={e => setRow(prev => ({ ...prev, entity: e.target.value }))}>
                <option value="">Entity…</option>
                {["Hamasa", "SDC", "Travelio"].map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            )}

            {/* FX rate */}
            {(row.tx_type === "fx_exchange" || isFX) && (
              <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: T.text3, whiteSpace: "nowrap", fontFamily: FF }}>Rate:</span>
                <input type="number"
                  style={{ ...inInp(T), width: 60, fontSize: 11, textAlign: "right" }}
                  value={row.fx_rate ?? ""}
                  onChange={e => {
                    const rate = e.target.value;
                    const idr = Math.round(Number(row.amount || 0) * Number(rate || 0));
                    setRow(prev => ({ ...prev, fx_rate: rate, amount_idr: String(idr) }));
                  }}
                />
              </div>
            )}

            {/* Account selector with tabs */}
            <div style={{ flex: 1, minWidth: 120, overflow: "hidden" }}>
              {cfg.mode === "to" ? (
                <TabbedAcctSelect
                  accounts={cfg.to}
                  value={row.to_id || ""}
                  onChange={v => setRow(prev => ({ ...prev, to_id: v }))}
                  placeholder="To Account…"
                  showLast4
                  T={T}
                />
              ) : cfg.mode === "from_to" ? (
                <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TabbedAcctSelect
                      accounts={cfg.from}
                      value={row.from_id || ""}
                      onChange={v => setRow(prev => ({ ...prev, from_id: v }))}
                      placeholder="From…"
                      showLast4
                      T={T}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: T.text3, flexShrink: 0 }}>→</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TabbedAcctSelect
                      accounts={cfg.to}
                      value={row.to_id || ""}
                      onChange={v => setRow(prev => ({ ...prev, to_id: v }))}
                      placeholder="To…"
                      showLast4
                      T={T}
                    />
                  </div>
                </div>
              ) : (
                <TabbedAcctSelect
                  accounts={cfg.from}
                  value={row.from_id || ""}
                  onChange={v => setRow(prev => ({ ...prev, from_id: v }))}
                  placeholder="From Account…"
                  showLast4
                  T={T}
                />
              )}
            </div>

            {/* Action buttons */}
            <button onClick={handleSave} disabled={saving}
              style={{ ...ACT_BTN({ background: "#dcfce7", color: "#059669", border: "1px solid #bbf7d0" }) }}
              title="Save">
              {saving ? "…" : "✓"}
            </button>

            <button onClick={() => setExpanded(false)}
              style={{ ...ACT_BTN({ color: "#9ca3af" }) }}
              title="Cancel">
              ✕
            </button>
          </div>

          {/* Cicilan toggle (if expense + CC account) */}
          {row.tx_type === "expense" && accounts.some(a => a.id === row.from_id && a.type === "credit_card") && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11, color: T.text2, fontFamily: FF, fontWeight: 600, userSelect: "none" }}>
                <input type="checkbox" checked={!!row._cicilan}
                  onChange={e => setRow(prev => ({ ...prev, _cicilan: e.target.checked, ...(!e.target.checked ? { _cicilanKe: null, _cicilanMonths: null } : { _cicilanKe: prev._cicilanKe || 1, _cicilanMonths: prev._cicilanMonths || 3 }) }))}
                  style={{ accentColor: "#3b5bdb", width: 13, height: 13 }} />
                🔄 Cicilan
              </label>
              {row._cicilan && (
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 10, color: T.text2, fontFamily: FF }}>ke-</span>
                  <input type="number" min={1} max={row._cicilanMonths || 60}
                    value={row._cicilanKe || 1}
                    onChange={e => setRow(prev => ({ ...prev, _cicilanKe: Math.max(1, Math.min(prev._cicilanMonths || 60, Number(e.target.value) || 1)) }))}
                    style={{ width: 36, fontSize: 11, padding: "2px 4px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontFamily: FF, textAlign: "center" }}
                  />
                  <span style={{ fontSize: 10, color: T.text2, fontFamily: FF }}>dari</span>
                  <input type="number" min={2} max={60}
                    value={row._cicilanMonths || ""}
                    onChange={e => setRow(prev => ({ ...prev, _cicilanMonths: Math.max(2, Math.min(60, Number(e.target.value) || 2)) }))}
                    style={{ width: 36, fontSize: 11, padding: "2px 4px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontFamily: FF, textAlign: "center" }}
                  />
                  <span style={{ fontSize: 10, color: T.text3, fontFamily: FF }}>bulan</span>
                  <span style={{ fontSize: 10, color: "#3b5bdb", fontFamily: FF, fontWeight: 600 }}>
                    (total {fmtAmt(Number(row.amount || row.amount_idr || 0) * (row._cicilanMonths || 3))})
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Validation error */}
          {validErr && (
            <div style={{ marginTop: 4, padding: "3px 8px", background: "#fff5f5", border: "1px solid #fecaca", borderRadius: 4 }}>
              <span style={{ fontSize: 10, color: "#dc2626", fontFamily: FF, fontWeight: 600 }}>
                ⚠ {validErr}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

