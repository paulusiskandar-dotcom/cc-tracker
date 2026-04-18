// ReconcileModal.jsx — Full reconcile flow: PDF extraction → match → review
import React, { useState, useMemo, useCallback, useEffect } from "react";
import { reconcileApi, ledgerApi, installmentsApi, getTxFromToTypes } from "../api";
import { supabase } from "../lib/supabase";
import { fmtIDR, todayStr, checkDuplicateTransaction, resolveCategoryIds } from "../utils";
import { LIGHT, DARK } from "../theme";
import Modal from "./shared/Modal";
import { Button, showToast, TransactionReviewList } from "./shared/index";
import TransactionModal from "./shared/TransactionModal";

const EDGE_URL          = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-estatement`;
const RECONCILE_PDF_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/reconcile-pdf`;

const PILL = (bg, color) => ({
  display: "inline-flex", alignItems: "center", gap: 4,
  fontSize: 11, fontWeight: 700, padding: "3px 10px",
  borderRadius: 6, background: bg, color, fontFamily: "Figtree, sans-serif",
});

// ── Matching logic ───────────────────────────────────────────
// Word-overlap similarity — more robust than character matching
function similarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = a.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const wordsB = b.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  if (!wordsA.length || !wordsB.length) return 0;
  const setB = new Set(wordsB);
  const overlap = wordsA.filter(w => setB.has(w)).length;
  return overlap / Math.max(wordsA.length, wordsB.length);
}

function matchTransactions(stmtRows, ledgerRows) {
  const matched = [];
  const usedLedger = new Set();
  const usedStmt   = new Set();

  for (let si = 0; si < stmtRows.length; si++) {
    const s = stmtRows[si];
    let bestIdx = -1, bestScore = 0;
    for (let li = 0; li < ledgerRows.length; li++) {
      if (usedLedger.has(li)) continue;
      const l = ledgerRows[li];
      const sAmt = Math.abs(Number(s.amount || 0));
      const lAmt = Math.abs(Number(l.amount_idr || l.amount || 0));
      const amtDiff = Math.abs(sAmt - lAmt);
      if (amtDiff > 100) continue; // amount must be within Rp 100

      const sd = new Date((s.date || "") + "T00:00:00");
      const ld = new Date((l.tx_date || "") + "T00:00:00");
      const dayDiff = Math.abs((sd - ld) / 86400000);
      const descSim = similarity(s.description || s.merchant || "", l.description || "");

      // Path 1: amount match + date within ±3 days + description similarity >= 60%
      // Path 2: amount match + description very similar (>= 80%) — date can be further apart
      let score = 0;
      if (dayDiff <= 3 && descSim >= 0.6) {
        score = 3 + (amtDiff < 1 ? 1 : 0) + (dayDiff === 0 ? 0.5 : dayDiff <= 1 ? 0.3 : 0) + descSim;
      } else if (descSim >= 0.8) {
        // Very similar description — allow wider date range (up to 7 days)
        if (dayDiff <= 7) score = 2 + descSim + (amtDiff < 1 ? 0.5 : 0);
      } else if (dayDiff <= 3 && amtDiff < 1) {
        // Exact amount + close date — match even with low description similarity
        score = 2 + (dayDiff === 0 ? 0.5 : 0);
      }

      if (score > bestScore) { bestScore = score; bestIdx = li; }
    }
    if (bestIdx >= 0 && bestScore >= 2) {
      matched.push({ type: "match", stmt: s, ledger: ledgerRows[bestIdx] });
      usedLedger.add(bestIdx);
      usedStmt.add(si);
    }
  }

  const missing = stmtRows.filter((_, i) => !usedStmt.has(i)).map(s => ({ type: "missing", stmt: s }));
  const extra   = ledgerRows.filter((_, i) => !usedLedger.has(i)).map(l => ({ type: "extra", ledger: l }));

  return [...matched, ...missing, ...extra];
}

// ── Main component ───────────────────────────────────────────
export default function ReconcileModal({
  isOpen, onClose, account, user, accounts, categories,
  ledger, setLedger, onRefresh, year, month, sessionId,
  dark,
  // Data props forwarded to TransactionModal (Add / Edit flows).
  bankAccounts, creditCards, assets, liabilities, receivables,
  incomeSrcs, fxRates, allCurrencies, accountCurrencies,
}) {
  const [stmtRows,    setStmtRows]    = useState([]);
  const [processing,  setProcessing]  = useState(false);
  const [pdfPassword, setPdfPassword] = useState("");
  const [pdfSource,   setPdfSource]   = useState(""); // filename
  const [completing,  setCompleting]  = useState(false);
  const [session,     setSession]     = useState(sessionId || null);

  // Statement PDF detected from Gmail (flagged by gmail-sync)
  const [emailStmt,      setEmailStmt]      = useState(null); // row from statement_attachments
  const [emailPassword,  setEmailPassword]  = useState("");
  const [needsPassword,  setNeedsPassword]  = useState(false);

  // Add-from-missing / Edit-extra transaction modal
  const [txModalMode,  setTxModalMode]  = useState(null); // 'add' | 'edit' | null
  const [txInitial,    setTxInitial]    = useState(null);
  // Delete confirmation (for extra ledger rows)
  const [delTarget,    setDelTarget]    = useState(null);
  // Kept extras — user marked these as intentional so they aren't flagged anymore
  const [keptIds,      setKeptIds]      = useState(() => new Set());
  // Missing-row review state (TransactionReviewList)
  const [missingSelected, setMissingSelected] = useState({});
  const [missingSkipped,  setMissingSkipped]  = useState(() => new Set());
  const [missingImporting, setMissingImporting] = useState(false);

  const T = dark ? DARK : LIGHT;

  // ── Period date range (bank = calendar month, CC = billing cycle) ──
  const isCC = account?.type === "credit_card";
  const stmtDay = isCC ? (Number(account?.statement_day) || 25) : 0;

  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    if (!account) return { periodStart: "", periodEnd: "", periodLabel: "" };
    if (!isCC) {
      // Bank: calendar month
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      const endDate = new Date(year, month, 0); // last day of month
      const end = endDate.toISOString().slice(0, 10);
      const label = new Date(year, month - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      return { periodStart: start, periodEnd: end, periodLabel: label };
    }
    // CC: billing cycle — statement_day of prev month+1 through statement_day of this month
    // e.g. statement_day=19, month=2 (Feb): 20 Jan → 19 Feb
    const endDate = new Date(year, month - 1, stmtDay); // statement_day of selected month
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - 1);
    startDate.setDate(startDate.getDate() + 1); // day after previous statement_day
    const start = startDate.toISOString().slice(0, 10);
    const end = endDate.toISOString().slice(0, 10);
    const label = `${startDate.toLocaleDateString("en-US", { day: "numeric", month: "short" })} – ${endDate.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}`;
    return { periodStart: start, periodEnd: end, periodLabel: label };
  }, [account, year, month, isCC, stmtDay]);

  // Filter ledger for this account + period date range (with ±5 day buffer for boundary matching)
  const periodLedger = useMemo(() => {
    if (!account || !ledger || !periodStart) return [];
    const BUFFER_DAYS = 5;
    const bufStart = new Date(periodStart + "T00:00:00");
    bufStart.setDate(bufStart.getDate() - BUFFER_DAYS);
    const bufEnd = new Date(periodEnd + "T00:00:00");
    bufEnd.setDate(bufEnd.getDate() + BUFFER_DAYS);
    const startStr = bufStart.toISOString().slice(0, 10);
    const endStr   = bufEnd.toISOString().slice(0, 10);
    return ledger.filter(e => {
      const d = e.tx_date || "";
      return d >= startStr && d <= endStr && (e.from_id === account.id || e.to_id === account.id);
    });
  }, [ledger, account, periodStart, periodEnd]);

  const results = useMemo(() => {
    const raw = matchTransactions(stmtRows, periodLedger);
    // Rewrite "extra" rows that the user has marked kept into a distinct type.
    return raw.map(r =>
      r.type === "extra" && keptIds.has(r.ledger?.id) ? { ...r, type: "kept" } : r
    );
  }, [stmtRows, periodLedger, keptIds]);
  const matchCount   = results.filter(r => r.type === "match").length;
  const missingRaw   = results.filter(r => r.type === "missing");
  const missingCount = missingRaw.length;
  const extraCount   = results.filter(r => r.type === "extra").length;
  const keptCount    = results.filter(r => r.type === "kept").length;

  // Convert missing stmt rows into editable review rows for TransactionReviewList
  const missingReviewRows = useMemo(() => {
    return missingRaw.map(r => {
      const s = r.stmt;
      const isIncome = s.direction === "in";
      const amt = Math.abs(Number(s.amount || 0));
      const txType = isIncome ? "income" : "expense";
      const dup = checkDuplicateTransaction(ledger, {
        tx_date: s.date, amount_idr: amt, description: s.description || s.merchant || "",
        from_id: isIncome ? null : account?.id,
      });
      return {
        _id:           s._id || `miss-${s.date}-${amt}`,
        tx_date:       s.date || todayStr(),
        description:   s.description || s.merchant || "",
        amount:        amt,
        amount_idr:    amt,
        currency:      s.currency || "IDR",
        tx_type:       txType,
        from_id:       isIncome ? null : account?.id,
        to_id:         isIncome ? account?.id : null,
        category_id:   s.category_id || null,
        category_name: null,
        entity:        "Personal",
        notes:         "",
        source:        "reconcile",
        status:        dup?.level === 3 ? "duplicate" : dup?.level === 2 ? "possible_duplicate" : dup?.level === 1 ? "review" : null,
        _dupEntry:     dup?.matchEntry || null,
        _dupReasons:   dup?.reasons || [],
      };
    });
  }, [missingRaw, ledger, account]);

  // Auto-select non-duplicate missing rows when they first appear
  useEffect(() => {
    if (missingReviewRows.length === 0) return;
    setMissingSelected(prev => {
      const next = { ...prev };
      let changed = false;
      missingReviewRows.forEach(r => {
        if (!(r._id in next)) { next[r._id] = r.status !== "duplicate"; changed = true; }
      });
      return changed ? next : prev;
    });
  }, [missingReviewRows]);

  // Missing row handlers
  const updateMissingRow = useCallback((_id, patch) => {
    // We can't mutate the results memo, so we track overrides in a ref-like state
    setMissingOverrides(prev => ({ ...prev, [_id]: { ...(prev[_id] || {}), ...patch } }));
  }, []);
  const [missingOverrides, setMissingOverrides] = useState({});

  // Apply overrides to review rows
  const missingRowsFinal = useMemo(() =>
    missingReviewRows.map(r => ({ ...r, ...(missingOverrides[r._id] || {}) })),
  [missingReviewRows, missingOverrides]);

  // ── Look up statement PDF flagged from Gmail for this account+period ────
  useEffect(() => {
    if (!isOpen || !account || !user) { setEmailStmt(null); return; }
    let cancelled = false;
    (async () => {
      // Prefer an exact account+period match; fall back to any statement from the
      // same bank matching the period (account_id may be null if gmail-sync couldn't
      // disambiguate multiple accounts on the same bank).
      const { data: exact } = await supabase
        .from("statement_attachments")
        .select("*")
        .eq("user_id", user.id)
        .eq("account_id", account.id)
        .eq("period_year", year)
        .eq("period_month", month)
        .order("received_at", { ascending: false })
        .limit(1);
      let row = exact?.[0] || null;

      if (!row && account.bank_name) {
        const { data: byBank } = await supabase
          .from("statement_attachments")
          .select("*")
          .eq("user_id", user.id)
          .is("account_id", null)
          .eq("period_year", year)
          .eq("period_month", month)
          .ilike("bank_name", `%${account.bank_name}%`)
          .order("received_at", { ascending: false })
          .limit(1);
        row = byBank?.[0] || null;
      }
      if (!cancelled) setEmailStmt(row);
    })();
    return () => { cancelled = true; };
  }, [isOpen, account, user, year, month]);

  // ── Download & process PDF from Gmail ───────────────────────
  const handleDownloadFromEmail = useCallback(async () => {
    if (!emailStmt) return;
    setProcessing(true);
    setPdfSource(emailStmt.filename || "statement.pdf");
    try {
      const res = await fetch(RECONCILE_PDF_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          user_id:       user.id,
          email_id:      emailStmt.gmail_message_id,
          attachment_id: emailStmt.attachment_id,
          password:      emailPassword || undefined,
        }),
      });
      const data = await res.json();

      if (data.needs_password) {
        setNeedsPassword(true);
        showToast(data.error || "Password required", "error");
        return;
      }
      if (data.success && Array.isArray(data.transactions)) {
        setStmtRows(data.transactions.map((t, i) => ({ ...t, _id: `stmt-${i}` })));
        setNeedsPassword(false);
        showToast(`${data.transactions.length} transactions extracted`);
      } else {
        showToast(data.error || "No transactions found", "error");
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    } finally {
      setProcessing(false);
    }
  }, [emailStmt, emailPassword, user]);

  // ── Upload & process PDF ────────────────────────────────────
  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfSource(file.name);
    setProcessing(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch(EDGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          action: "process_upload",
          user_id: user.id,
          pdf_base64: base64,
          ...(pdfPassword ? { only_password: pdfPassword } : {}),
        }),
      });
      const data = await res.json();
      if (data.transactions?.length) {
        setStmtRows(data.transactions.map((t, i) => ({ ...t, _id: `stmt-${i}` })));
        showToast(`${data.transactions.length} transactions extracted`);
      } else {
        showToast(data.error || "No transactions found", "error");
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    } finally {
      setProcessing(false);
    }
  }, [user, pdfPassword]);

  // ── Complete reconcile ──────────────────────────────────────
  const handleComplete = async () => {
    setCompleting(true);
    try {
      let sid = session;
      if (!sid) {
        const created = await reconcileApi.create(user.id, {
          account_id: account.id,
          period_year: year,
          period_month: month,
          status: "completed",
          pdf_filename: pdfSource || null,
          total_statement: stmtRows.length,
          total_match: matchCount,
          total_missing: missingCount,
          total_extra: extraCount,
          completed_at: new Date().toISOString(),
        });
        sid = created.id;
      } else {
        await reconcileApi.complete(sid, {
          total_statement: stmtRows.length,
          total_match: matchCount,
          total_missing: missingCount,
          total_extra: extraCount,
        });
      }
      setSession(sid);
      showToast("Reconcile completed");
      onRefresh?.();
      onClose();
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    } finally {
      setCompleting(false);
    }
  };

  // ── Import one missing row (inline confirm from TransactionReviewList) ──
  const buildEntry = (r) => {
    const txType = r.tx_type || "expense";
    const { from_type, to_type } = getTxFromToTypes(txType);
    const catResolved = resolveCategoryIds(r.category_id, categories);
    return {
      tx_date:     r.tx_date,
      description: r.description || "",
      amount:      Number(r.amount || 0),
      currency:    r.currency || "IDR",
      amount_idr:  Number(r.amount_idr || r.amount || 0),
      tx_type:     txType, from_type, to_type,
      from_id:     r.from_id || null,
      to_id:       r.to_id || null,
      category_id: catResolved.category_id,
      category_name: catResolved.category_name,
      entity:      r.entity || "Personal",
      is_reimburse: txType === "reimburse_out" || txType === "reimburse_in",
      notes:       r.notes || "",
    };
  };

  const confirmMissingOne = async (row) => {
    try {
      const created = await ledgerApi.create(user.id, buildEntry(row), accounts);
      if (created) {
        setLedger?.(prev => [created, ...prev]);
        if (row._cicilan && row._cicilanMonths >= 2) {
          installmentsApi.createFromImport(user.id, {
            ledgerId: created.id, description: row.description || "", accountId: row.from_id,
            amount: Number(row.amount_idr || row.amount || 0), totalMonths: row._cicilanMonths,
            paidMonths: row._cicilanKe || 1,
            currency: row.currency || "IDR", txDate: row.tx_date, categoryId: row.category_id || null,
          }).catch(e => console.error("[cicilan reconcile]", e));
        }
        showToast(`Imported: ${row.description || "transaction"}`);
      }
    } catch (e) { showToast(e.message, "error"); }
  };

  const confirmMissingAll = async (validRows) => {
    setMissingImporting(true);
    let ok = 0;
    for (const r of validRows) {
      try {
        const created = await ledgerApi.create(user.id, buildEntry(r), accounts);
        if (created) {
          setLedger?.(prev => [created, ...prev]); ok++;
          if (r._cicilan && r._cicilanMonths >= 2) {
            installmentsApi.createFromImport(user.id, {
              ledgerId: created.id, description: r.description || "", accountId: r.from_id,
              amount: Number(r.amount_idr || r.amount || 0), totalMonths: r._cicilanMonths,
              paidMonths: r._cicilanKe || 1,
              currency: r.currency || "IDR", txDate: r.tx_date, categoryId: r.category_id || null,
            }).catch(e => console.error("[cicilan reconcile]", e));
          }
        }
      } catch { /* continue */ }
    }
    showToast(`Imported ${ok} of ${validRows.length} transactions`);
    setMissingImporting(false);
  };

  const skipMissing = (id) => {
    setMissingSkipped(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  // ── Edit extra ledger row (opens TransactionModal in 'edit') ───
  const openEditFromLedger = (l) => {
    setTxInitial(l);
    setTxModalMode("edit");
  };

  // ── Keep extra row (mark as intentional — stops showing as problem) ──
  const markKept = (ledgerId) => {
    setKeptIds(prev => {
      const next = new Set(prev);
      next.add(ledgerId);
      return next;
    });
  };

  // ── Delete extra transaction ────────────────────────────────
  const handleDelete = async () => {
    if (!delTarget) return;
    try {
      await supabase.from("ledger").delete().eq("id", delTarget.id);
      setLedger?.(prev => prev.filter(e => e.id !== delTarget.id));
      showToast("Transaksi dihapus");
      onRefresh?.();
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    }
    setDelTarget(null);
  };

  // ── Filter + sort ───────────────────────────────────────────
  const [viewFilter, setViewFilter] = useState("all"); // all | missing | extra | match
  const [expandedId, setExpandedId] = useState(null);  // _id of expanded missing row

  const sortedResults = useMemo(() =>
    [...results]
      .filter(r => viewFilter === "all" || r.type === viewFilter || (viewFilter === "match" && r.type === "kept"))
      .sort((a, b) => {
        const da = a.stmt?.date || a.ledger?.tx_date || "";
        const db = b.stmt?.date || b.ledger?.tx_date || "";
        return da.localeCompare(db);
      }),
  [results, viewFilter]);

  // Running balance for display rows
  const balanceMap = useMemo(() => {
    const map = {};
    let bal = 0;
    sortedResults.forEach((r, i) => {
      const amt = Math.abs(Number(r.stmt?.amount || r.ledger?.amount_idr || r.ledger?.amount || 0));
      const dir = r.stmt?.direction || (r.ledger?.tx_type === "income" ? "in" : "out");
      bal += dir === "in" ? amt : -amt;
      map[i] = bal;
    });
    return map;
  }, [sortedResults]);

  if (!account) return null;

  const hasSomething = stmtRows.length > 0 || periodLedger.length > 0;
  const totalRows = stmtRows.length + periodLedger.length;
  const F = "Figtree, sans-serif";
  const btnS = (color, border) => ({ fontSize: 10, fontWeight: 700, color, background: "none", border: `1px solid ${border}`, borderRadius: 4, padding: "2px 7px", cursor: "pointer", fontFamily: F, whiteSpace: "nowrap" });
  const filterPill = (id, label) => {
    const active = viewFilter === id;
    return (
      <button key={id} onClick={() => setViewFilter(id)}
        style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: active ? "none" : "1px solid #e5e7eb", cursor: "pointer", fontFamily: F, background: active ? "#111827" : "#fff", color: active ? "#fff" : "#6b7280" }}>
        {label}
      </button>
    );
  };

  const footer = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
      <label style={{ cursor: "pointer" }}>
        <input type="file" accept=".pdf" onChange={handleUpload} onClick={e => { e.target.value = ""; }} style={{ display: "none" }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "#3b5bdb", fontFamily: F, cursor: "pointer" }}>
          {pdfSource ? "Upload PDF lain" : "Upload PDF"}
        </span>
      </label>
      <Button onClick={handleComplete} disabled={completing || !hasSomething}>
        {completing ? "Saving…" : "Selesai ✓"}
      </Button>
    </div>
  );

  const BORDER_L = { match: "3px solid #059669", missing: "3px solid #d97706", extra: "3px solid #dc2626", kept: "3px solid #d1d5db" };
  const ROW_BG   = { match: "#f0fdf4", missing: "#fffbeb", extra: "#fef2f2", kept: "#f9fafb" };
  const BADGE_S  = { match: { bg: "#dcfce7", color: "#059669", label: "✓" }, missing: { bg: "#fef3c7", color: "#d97706", label: "!" }, extra: { bg: "#fee2e2", color: "#dc2626", label: "?" }, kept: { bg: "#e5e7eb", color: "#6b7280", label: "◦" } };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={`Reconcile — ${account.name}`} footer={footer} width={900}>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12, fontFamily: F }}>
          {periodLabel}{pdfSource ? ` · ${pdfSource}` : ""}
        </div>

        {/* Email banner */}
        {stmtRows.length === 0 && emailStmt && (
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontFamily: F }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>📎</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1e3a8a" }}>Statement tersedia dari email</div>
                <div style={{ fontSize: 11, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {emailStmt.filename || "statement.pdf"}{emailStmt.sender_email ? ` · ${emailStmt.sender_email}` : ""}
                </div>
              </div>
            </div>
            {needsPassword && <input type="password" placeholder="Password PDF" value={emailPassword} onChange={e => setEmailPassword(e.target.value)} style={{ fontSize: 12, padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 8, fontFamily: F, width: "100%", marginBottom: 8, boxSizing: "border-box" }} />}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleDownloadFromEmail} disabled={processing} style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: processing ? "#93c5fd" : "#3b5bdb", padding: "6px 16px", borderRadius: 8, border: "none", cursor: processing ? "default" : "pointer", fontFamily: F }}>
                {processing ? "Processing…" : (needsPassword ? "Retry with Password" : "Download & Process")}
              </button>
              {!needsPassword && <button onClick={() => setNeedsPassword(true)} style={{ fontSize: 11, fontWeight: 600, color: "#475569", background: "transparent", padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer", fontFamily: F }}>PDF terenkripsi?</button>}
            </div>
          </div>
        )}

        {/* Upload */}
        {stmtRows.length === 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <input type="password" placeholder="PDF password (optional)" value={pdfPassword} onChange={e => setPdfPassword(e.target.value)} style={{ fontSize: 12, padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8, fontFamily: F, width: 200 }} />
            <label style={{ cursor: "pointer" }}>
              <input type="file" accept=".pdf" onChange={handleUpload} onClick={e => { e.target.value = ""; }} style={{ display: "none" }} />
              <span style={{ display: "inline-block", fontSize: 12, fontWeight: 700, color: "#fff", background: "#3b5bdb", padding: "6px 16px", borderRadius: 8, cursor: "pointer", fontFamily: F }}>{processing ? "Processing…" : "Upload PDF"}</span>
            </label>
          </div>
        )}

        {processing && <div style={{ textAlign: "center", padding: "20px 0", fontSize: 12, color: "#6b7280", fontFamily: F }}>Extracting transactions from PDF…</div>}

        {/* ── Top bar: stats + filters + bulk ── */}
        {hasSomething && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={PILL("#dcfce7", "#059669")}>✓ {matchCount}</span>
              <span style={PILL("#fef3c7", "#d97706")}>! {missingCount}</span>
              <span style={PILL("#fee2e2", "#dc2626")}>? {extraCount}</span>
              {keptCount > 0 && <span style={PILL("#e5e7eb", "#6b7280")}>◦ {keptCount}</span>}
              <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: F }}>{totalRows} total</span>
              <span style={{ width: 1, height: 16, background: "#e5e7eb" }} />
              {filterPill("all", "All")}
              {filterPill("missing", "Missing")}
              {filterPill("extra", "Extra")}
              {filterPill("match", "Match")}
            </div>
            {missingCount > 0 && (
              <button onClick={() => confirmMissingAll(missingRowsFinal)} disabled={missingImporting}
                style={{ fontSize: 11, fontWeight: 700, padding: "5px 14px", borderRadius: 8, border: "none", cursor: missingImporting ? "default" : "pointer", fontFamily: F, background: "#3b5bdb", color: "#fff", opacity: missingImporting ? 0.6 : 1 }}>
                {missingImporting ? "Importing…" : `Accept All Missing (${missingCount})`}
              </button>
            )}
          </div>
        )}

        {/* ── Statement table ── */}
        {hasSomething && (
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: "58px 1fr 80px 80px 90px 48px", background: "#fafafa", borderBottom: "1px solid #e5e7eb", padding: "6px 8px", fontSize: 9, fontWeight: 800, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: F }}>
              <span>Tanggal</span><span>Keterangan</span><span style={{ textAlign: "right" }}>Debit</span><span style={{ textAlign: "right" }}>Kredit</span><span style={{ textAlign: "right" }}>Saldo</span><span style={{ textAlign: "center" }}>Status</span>
            </div>

            {/* Scrollable rows */}
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {sortedResults.map((r, i) => {
                const type = r.type;
                const s = r.stmt;
                const l = r.ledger;
                const date = s?.date || l?.tx_date || "";
                const desc = s ? (s.description || s.merchant || "") : (l?.description || "");
                const amt  = Math.abs(Number(s?.amount || l?.amount_idr || l?.amount || 0));
                const dir  = s?.direction || (l?.tx_type === "income" ? "in" : "out");
                const badge = BADGE_S[type];
                const isExpanded = expandedId === (s?._id || l?.id || i);
                const missRow = type === "missing" ? missingRowsFinal.find(mr => mr._id === s?._id) : null;
                const isOdd = i % 2 === 1;

                return (
                  <div key={s?._id || l?.id || i}>
                    <div style={{
                      display: "grid", gridTemplateColumns: "58px 1fr 80px 80px 90px 48px",
                      padding: "6px 8px", borderLeft: BORDER_L[type],
                      background: isOdd ? (ROW_BG[type] || "#fafafa") : ROW_BG[type],
                      borderBottom: "1px solid #f3f4f6", alignItems: "center",
                      opacity: type === "kept" ? 0.55 : 1,
                      fontFamily: F, fontSize: 11,
                    }}>
                      <span style={{ fontSize: 10, color: "#6b7280" }}>{date.slice(5)}</span>
                      <span style={{ fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 4 }}>{desc || "—"}</span>
                      <span style={{ textAlign: "right", fontWeight: 600, color: dir === "out" ? "#dc2626" : "transparent" }}>{dir === "out" ? fmtIDR(amt, true) : ""}</span>
                      <span style={{ textAlign: "right", fontWeight: 600, color: dir === "in" ? "#059669" : "transparent" }}>{dir === "in" ? fmtIDR(amt, true) : ""}</span>
                      <span style={{ textAlign: "right", fontSize: 10, color: "#6b7280" }}>{fmtIDR(Math.abs(balanceMap[i] || 0), true)}</span>
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 4, background: badge.bg, color: badge.color, fontSize: 10, fontWeight: 800 }}>{badge.label}</span>
                      </div>
                    </div>

                    {/* Action row for missing */}
                    {type === "missing" && !isExpanded && (
                      <div style={{ display: "flex", gap: 6, padding: "4px 8px 6px 64px", background: "#fffbeb", borderBottom: "1px solid #fde68a", borderLeft: "3px solid #d97706" }}>
                        <button onClick={() => setExpandedId(s?._id)} style={btnS("#3b5bdb", "#bfdbfe")}>Add</button>
                      </div>
                    )}

                    {/* Expanded inline editor for missing (AI scan style) */}
                    {type === "missing" && isExpanded && missRow && (
                      <div style={{ background: "#fffbeb", borderBottom: "1px solid #fde68a", borderLeft: "3px solid #d97706", padding: "8px 10px" }}>
                        <TransactionReviewList
                          rows={[missRow]}
                          selected={{ [missRow._id]: true }}
                          onUpdateRow={updateMissingRow}
                          onConfirmRow={async (row) => { await confirmMissingOne(row); setExpandedId(null); }}
                          onSkipRow={() => setExpandedId(null)}
                          onConfirmAll={async (rows) => { await confirmMissingAll(rows); setExpandedId(null); }}
                          onToggleSelect={() => {}}
                          onToggleAll={() => {}}
                          source="reconcile"
                          accounts={accounts}
                          T={T}
                          busy={missingImporting}
                        />
                      </div>
                    )}

                    {/* Action row for extra */}
                    {type === "extra" && (
                      <div style={{ display: "flex", gap: 4, padding: "4px 8px 6px 64px", background: "#fef2f2", borderBottom: "1px solid #fecaca", borderLeft: "3px solid #dc2626" }}>
                        <button onClick={() => markKept(l.id)} style={btnS("#059669", "#bbf7d0")}>Keep</button>
                        <button onClick={() => openEditFromLedger(l)} style={btnS("#3b5bdb", "#bfdbfe")}>Edit</button>
                        <button onClick={() => setDelTarget(l)} style={btnS("#dc2626", "#fecaca")}>Hapus</button>
                      </div>
                    )}

                    {/* Action row for kept */}
                    {type === "kept" && (
                      <div style={{ display: "flex", gap: 4, padding: "4px 8px 6px 64px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", borderLeft: "3px solid #d1d5db", opacity: 0.55 }}>
                        <button onClick={() => setKeptIds(prev => { const n = new Set(prev); n.delete(l.id); return n; })} style={btnS("#6b7280", "#e5e7eb")}>Undo Keep</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!processing && !hasSomething && (
          <div style={{ textAlign: "center", padding: "30px 0", color: "#9ca3af", fontSize: 12, fontFamily: F }}>
            Upload a bank statement PDF to start reconciling
          </div>
        )}
      </Modal>

      {/* Edit Transaction Modal */}
      {txModalMode && txInitial && (
        <TransactionModal
          open={!!txModalMode} mode={txModalMode} initialData={txInitial}
          onSave={() => { onRefresh?.(); setTxModalMode(null); setTxInitial(null); }}
          onDelete={() => { onRefresh?.(); setTxModalMode(null); setTxInitial(null); }}
          onClose={() => { setTxModalMode(null); setTxInitial(null); }}
          user={user} accounts={accounts} setLedger={setLedger} categories={categories}
          fxRates={fxRates} allCurrencies={allCurrencies}
          bankAccounts={bankAccounts} creditCards={creditCards}
          assets={assets} liabilities={liabilities} receivables={receivables}
          incomeSrcs={incomeSrcs} accountCurrencies={accountCurrencies} onRefresh={onRefresh}
        />
      )}

      {/* Delete confirmation */}
      {delTarget && (
        <Modal isOpen={!!delTarget} onClose={() => setDelTarget(null)}
          title={`Hapus transaksi ${delTarget.description ? `"${delTarget.description}"` : ""}?`} width={420}
          footer={<div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}><Button variant="ghost" onClick={() => setDelTarget(null)}>Batal</Button><Button variant="danger" onClick={handleDelete}>Hapus</Button></div>}>
          <div style={{ fontSize: 12, color: "#374151", fontFamily: F }}>
            <strong>{delTarget.description || "—"}</strong> · {delTarget.tx_date} · {fmtIDR(Number(delTarget.amount_idr || delTarget.amount || 0), true)}
          </div>
        </Modal>
      )}
    </>
  );
}
