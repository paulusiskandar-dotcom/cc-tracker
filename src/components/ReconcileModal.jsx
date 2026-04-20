// ReconcileModal.jsx — Full reconcile flow: PDF extraction → match → review
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { reconcileApi, ledgerApi, installmentsApi, getTxFromToTypes } from "../api";
import { supabase } from "../lib/supabase";
import { fmtIDR, todayStr, checkDuplicateTransaction, resolveCategoryIds } from "../utils";
import { LIGHT, DARK } from "../theme";
import Modal from "./shared/Modal";
import { Button, showToast, TxHorizontal } from "./shared/index";
import TxVerticalBig from "./shared/TxVerticalBig";

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
const MO_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function ReconcileModal({
  isOpen, onClose, account, user, accounts, categories,
  ledger, setLedger, onRefresh, sessionId,
  dark,
  bankAccounts, creditCards, assets, liabilities, receivables,
  incomeSrcs, fxRates, allCurrencies, accountCurrencies,
  reconSessions = [], earliestTxDate,
}) {
  // Period selection (managed internally)
  const [year,  setYear]  = useState(null);
  const [month, setMonth] = useState(null);
  const periodSelected = year != null && month != null;

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
  const [ignoredIds,   setIgnoredIds]   = useState(() => new Set());
  // Missing-row review state (TransactionReviewList)
  const [missingSelected, setMissingSelected] = useState({});
  const [missingSkipped,  setMissingSkipped]  = useState(() => new Set());
  const [missingImporting, setMissingImporting] = useState(false);

  const fileRef = useRef(null);
  const [pdfFile, setPdfFile] = useState(null); // File object for staged upload
  const T = dark ? DARK : LIGHT;

  // Derive current step from state
  // 1=period, 2=upload, 3=processing, 4=results
  // Step only advances to 4 (results) when PDF has been processed and stmtRows populated
  const step = stmtRows.length > 0 ? 4 : processing ? 3 : periodSelected ? 2 : 1;

  // ── Generate period pills ──────────────────────────────────
  const now = new Date();
  const curYear = now.getFullYear();
  const curMo   = now.getMonth() + 1;

  const periodPills = useMemo(() => {
    let startY, startM;
    if (earliestTxDate && earliestTxDate.length >= 7) {
      startY = Number(earliestTxDate.slice(0, 4)) || curYear;
      startM = Number(earliestTxDate.slice(5, 7)) || 1;
    } else { startY = curYear; startM = 1; }
    // Safety: don't go further back than 3 years
    if (startY < curYear - 3) { startY = curYear - 3; startM = 1; }
    const pills = [];
    let y = startY, m = startM;
    while (y < curYear || (y === curYear && m <= curMo)) {
      pills.push({ year: y, month: m });
      m++; if (m > 12) { m = 1; y++; }
    }
    return pills;
  }, [earliestTxDate, curYear, curMo]);

  const completedKeys = useMemo(() => new Set(
    reconSessions.filter(s => s.status === "completed" && s.account_id === account?.id)
      .map(s => `${s.period_year}-${s.period_month}`)
  ), [reconSessions, account]);
  const inProgressKeys = useMemo(() => new Set(
    reconSessions.filter(s => s.status !== "completed" && s.account_id === account?.id)
      .map(s => `${s.period_year}-${s.period_month}`)
  ), [reconSessions, account]);

  // Auto-select most recent unreconciled month on open
  useEffect(() => {
    if (!isOpen || !account || periodSelected) return;
    const unrecon = periodPills.filter(p => !completedKeys.has(`${p.year}-${p.month}`));
    const pick = unrecon.length > 0 ? unrecon[unrecon.length - 1] : periodPills[periodPills.length - 1];
    if (pick) { setYear(pick.year); setMonth(pick.month); }
  }, [isOpen, account]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setYear(null); setMonth(null); setStmtRows([]); setSession(null);
      setPdfSource(""); setPdfPassword(""); setKeptIds(new Set()); setIgnoredIds(new Set());
      setMissingOverrides({}); setMissingSelected({}); setMissingSkipped(new Set());
    }
  }, [isOpen]);

  // ── Period date range (bank = calendar month, CC = billing cycle) ──
  const isCC = account?.type === "credit_card";
  const stmtDay = isCC ? (Number(account?.statement_day) || 25) : 0;

  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    if (!account || !year || !month) return { periodStart: "", periodEnd: "", periodLabel: "" };
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

  // Fetch ledger directly from Supabase for this account + period (no 500-row cap)
  const [periodLedger, setPeriodLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  useEffect(() => {
    if (!isOpen || !account || !user || !periodStart) { setPeriodLedger([]); return; }
    let cancelled = false;
    const BUFFER_DAYS = 5;
    const bufStart = new Date(periodStart + "T00:00:00");
    bufStart.setDate(bufStart.getDate() - BUFFER_DAYS);
    const bufEnd = new Date(periodEnd + "T00:00:00");
    bufEnd.setDate(bufEnd.getDate() + BUFFER_DAYS);
    const startStr = bufStart.toISOString().slice(0, 10);
    const endStr   = bufEnd.toISOString().slice(0, 10);

    setLedgerLoading(true);
    supabase
      .from("ledger")
      .select("*")
      .eq("user_id", user.id)
      .or(`from_id.eq.${account.id},to_id.eq.${account.id}`)
      .gte("tx_date", startStr)
      .lte("tx_date", endStr)
      .order("tx_date", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("[reconcile] ledger fetch error:", error.message);
        setPeriodLedger(data || []);
        setLedgerLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, account, user, periodStart, periodEnd]);

  // Re-fetch after a ledger mutation (add/delete) — bump this counter to trigger
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const refetchLedger = useCallback(() => setLedgerVersion(v => v + 1), []);
  useEffect(() => {
    if (!ledgerVersion || !isOpen || !account || !user || !periodStart) return;
    let cancelled = false;
    const BUFFER_DAYS = 5;
    const bufStart = new Date(periodStart + "T00:00:00");
    bufStart.setDate(bufStart.getDate() - BUFFER_DAYS);
    const bufEnd = new Date(periodEnd + "T00:00:00");
    bufEnd.setDate(bufEnd.getDate() + BUFFER_DAYS);
    supabase
      .from("ledger")
      .select("*")
      .eq("user_id", user.id)
      .or(`from_id.eq.${account.id},to_id.eq.${account.id}`)
      .gte("tx_date", bufStart.toISOString().slice(0, 10))
      .lte("tx_date", bufEnd.toISOString().slice(0, 10))
      .order("tx_date", { ascending: true })
      .then(({ data }) => { if (!cancelled) setPeriodLedger(data || []); });
    return () => { cancelled = true; };
  }, [ledgerVersion, isOpen, account, user, periodStart, periodEnd]);

  const results = useMemo(() => {
    const raw = matchTransactions(stmtRows, periodLedger);
    return raw.map(r => {
      if (r.type === "extra" && keptIds.has(r.ledger?.id)) return { ...r, type: "kept" };
      if (r.type === "missing" && ignoredIds.has(r.stmt?._id)) return { ...r, type: "ignored" };
      return r;
    });
  }, [stmtRows, periodLedger, keptIds, ignoredIds]);
  const matchCount   = results.filter(r => r.type === "match").length;
  const missingRaw   = results.filter(r => r.type === "missing");
  const missingCount = missingRaw.length;
  const extraCount   = results.filter(r => r.type === "extra").length;
  const keptCount    = results.filter(r => r.type === "kept").length;
  const ignoredCount = results.filter(r => r.type === "ignored").length;

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
        _reconTxId:    s._reconTxId || null,
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

  // ── Load existing session + saved transactions on modal open ────
  useEffect(() => {
    if (!isOpen || !account || !user) return;
    let cancelled = false;
    (async () => {
      // Find existing session for this account + period
      const { data: sessions } = await supabase
        .from("reconcile_sessions")
        .select("*")
        .eq("user_id", user.id)
        .eq("account_id", account.id)
        .eq("period_year", year)
        .eq("period_month", month)
        .order("created_at", { ascending: false })
        .limit(1);
      const existing = sessions?.[0];
      if (cancelled) return;
      if (existing) {
        setSession(existing.id);
        setPdfSource(existing.pdf_filename || "");
        // Load saved reconcile_transactions
        const { data: savedTxs } = await supabase
          .from("reconcile_transactions")
          .select("*")
          .eq("session_id", existing.id)
          .order("tx_date", { ascending: true });
        if (cancelled) return;
        if (savedTxs?.length) {
          // Convert DB rows back to stmtRows format
          setStmtRows(savedTxs.map((t, i) => ({
            _id:         t.id,
            _reconTxId:  t.id,
            date:        t.tx_date,
            description: t.description,
            amount:      Number(t.amount || 0),
            direction:   t.tx_direction === "credit" ? "in" : "out",
            matched_ledger_id: t.matched_ledger_id,
            _savedStatus: t.status, // 'match' | 'missing' | 'kept'
          })));
          // Restore kept IDs from saved status
          const kept = savedTxs.filter(t => t.status === "kept").map(t => t.matched_ledger_id).filter(Boolean);
          if (kept.length) setKeptIds(new Set(kept));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, account, user, year, month]);

  // ── Helper: ensure session exists (create if needed) ────────
  const ensureSession = useCallback(async () => {
    if (session) return session;
    const created = await reconcileApi.create(user.id, {
      account_id: account.id,
      period_year: year,
      period_month: month,
      status: "in_progress",
      pdf_filename: pdfSource || null,
    });
    setSession(created.id);
    return created.id;
  }, [session, user, account, year, month, pdfSource]);

  // ── Helper: save extracted rows to reconcile_transactions ───
  const saveExtractedTxs = useCallback(async (sid, transactions, ledgerRows) => {
    const matchResults = matchTransactions(transactions, ledgerRows);
    const rows = matchResults
      .filter(r => r.type === "match" || r.type === "missing")
      .map(r => {
        const s = r.stmt;
        if (!s) return null;
        return {
          session_id:        sid,
          user_id:           user.id,
          tx_date:           s.date || null,
          description:       s.description || s.merchant || "",
          amount:            Math.abs(Number(s.amount || 0)),
          tx_direction:      s.direction === "in" ? "credit" : "debit",
          matched_ledger_id: r.ledger?.id || null,
          status:            r.type, // 'match' or 'missing'
        };
      })
      .filter(Boolean);
    if (rows.length) {
      await supabase.from("reconcile_transactions").insert(rows);
    }
  }, [user]);

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

      if (data.needs_password || data.encrypted) {
        setNeedsPassword(true);
        showToast("Password salah atau PDF tidak dapat dibuka", "error");
        return;
      }
      if (data.success && Array.isArray(data.transactions)) {
        const rows = data.transactions.map((t, i) => ({ ...t, _id: `stmt-${i}` }));
        setStmtRows(rows);
        setNeedsPassword(false);
        // Persist to DB
        const sid = await ensureSession();
        await supabase.from("reconcile_sessions").update({ pdf_filename: emailStmt.filename || "statement.pdf" }).eq("id", sid);
        await supabase.from("reconcile_transactions").delete().eq("session_id", sid);
        await saveExtractedTxs(sid, rows, periodLedger);
        showToast(`${data.transactions.length} transactions extracted`);
      } else {
        showToast(data.error || "No transactions found", "error");
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    } finally {
      setProcessing(false);
    }
  }, [emailStmt, emailPassword, user, ensureSession, saveExtractedTxs, periodLedger]);

  // ── Stage file (step 2) ─────────────────────────────────────
  const stageFile = useCallback((eOrFile) => {
    const file = eOrFile instanceof File ? eOrFile : eOrFile?.target?.files?.[0];
    if (!file) return;
    setPdfFile(file);
    setPdfSource(file.name);
  }, []);

  // ── Process staged PDF (step 2→3→4) ────────────────────────
  const processFile = useCallback(async () => {
    if (!pdfFile) return;
    setProcessing(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(pdfFile);
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
      if (data.needs_password || data.encrypted) {
        showToast("PDF terenkripsi. Silakan hapus password terlebih dahulu menggunakan Chrome Print to PDF atau ilovepdf.com, lalu upload ulang.", "error");
        setProcessing(false);
        setPdfFile(null); setPdfSource("");
        return;
      }
      if (data.transactions?.length) {
        const rows = data.transactions.map((t, i) => ({ ...t, _id: `stmt-${i}` }));
        setStmtRows(rows);
        const sid = await ensureSession();
        await supabase.from("reconcile_sessions").update({ pdf_filename: pdfSource }).eq("id", sid);
        await supabase.from("reconcile_transactions").delete().eq("session_id", sid);
        await saveExtractedTxs(sid, rows, periodLedger);
        showToast(`${data.transactions.length} transactions extracted`);
      } else {
        // Replace technical AES/encryption messages with user-friendly text
        const rawErr = data.error || "";
        const userMsg = /aes|encrypt|decrypt|password/i.test(rawErr)
          ? "Password salah atau PDF tidak dapat dibuka"
          : rawErr || "No transactions found";
        showToast(userMsg, "error");
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    } finally {
      setProcessing(false);
    }
  }, [pdfFile, user, pdfPassword, pdfSource, ensureSession, saveExtractedTxs, periodLedger]);

  // ── Complete reconcile ──────────────────────────────────────
  const handleComplete = async () => {
    setCompleting(true);
    try {
      const sid = await ensureSession();
      await reconcileApi.complete(sid, {
        total_statement: stmtRows.length,
        total_match: matchCount,
        total_missing: missingCount,
        total_extra: extraCount,
        pdf_filename: pdfSource || null,
      });
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
        refetchLedger();
        // Update reconcile_transactions status
        if (row._reconTxId) {
          supabase.from("reconcile_transactions").update({ status: "match", matched_ledger_id: created.id }).eq("id", row._reconTxId).then(null, e => console.error("[recon tx update]", e));
        }
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
    if (ok > 0) refetchLedger();
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
    // Persist kept status — save a reconcile_transaction entry for this extra row
    if (session) {
      const entry = periodLedger.find(e => e.id === ledgerId);
      supabase.from("reconcile_transactions").upsert({
        session_id:        session,
        user_id:           user.id,
        tx_date:           entry?.tx_date || null,
        description:       entry?.description || "",
        amount:            Math.abs(Number(entry?.amount_idr || entry?.amount || 0)),
        tx_direction:      "debit",
        matched_ledger_id: ledgerId,
        status:            "kept",
      }, { onConflict: "session_id,matched_ledger_id" }).then(null, e => console.error("[recon kept]", e));
    }
  };

  // ── Delete extra transaction ────────────────────────────────
  const handleDelete = async () => {
    if (!delTarget) return;
    try {
      await supabase.from("ledger").delete().eq("id", delTarget.id);
      setLedger?.(prev => prev.filter(e => e.id !== delTarget.id));
      refetchLedger();
      // Update any reconcile_transaction that was matched to this ledger entry
      if (session) {
        supabase.from("reconcile_transactions").update({ status: "missing", matched_ledger_id: null })
          .eq("session_id", session).eq("matched_ledger_id", delTarget.id)
          .then(null, e => console.error("[recon tx update]", e));
      }
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
      .filter(r => viewFilter === "all" || r.type === viewFilter || (viewFilter === "match" && (r.type === "kept" || r.type === "ignored")))
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

  const hasSomething = stmtRows.length > 0;
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

  const footer = step === 4 ? (
    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
      <Button onClick={handleComplete} disabled={completing || !hasSomething}>
        {completing ? "Saving…" : "Selesai ✓"}
      </Button>
    </div>
  ) : null;

  const BADGE_S  = { match: { bg: "#dcfce7", color: "#059669", label: "✓" }, missing: { bg: "#fef3c7", color: "#d97706", label: "!" }, extra: { bg: "#fee2e2", color: "#dc2626", label: "?" }, kept: { bg: "#e5e7eb", color: "#6b7280", label: "◦" }, ignored: { bg: "#f3f4f6", color: "#9ca3af", label: "–" } };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={`Reconcile — ${account.name}`} footer={footer} width={900}>

        {/* ── Step indicator ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
          {[
            { n: 1, label: "Periode" },
            { n: 2, label: "Upload" },
            { n: 3, label: "Process" },
            { n: 4, label: "Review" },
          ].map((s, i) => {
            const done = step > s.n;
            const active = step === s.n;
            return (
              <React.Fragment key={s.n}>
                {i > 0 && <span style={{ width: 16, height: 1, background: done ? "#059669" : "#e5e7eb" }} />}
                <span style={{
                  fontSize: 10, fontWeight: 700, fontFamily: F, padding: "2px 8px", borderRadius: 10,
                  background: done ? "#dcfce7" : active ? "#dbeafe" : "#f3f4f6",
                  color: done ? "#059669" : active ? "#3b5bdb" : "#9ca3af",
                }}>
                  {done ? "✓" : s.n}. {s.label}
                </span>
              </React.Fragment>
            );
          })}
        </div>

        {/* ── STEP 1: Period selector ── */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: step === 1 ? 0 : 14, alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", fontFamily: F, marginRight: 4 }}>Period</span>
          {periodPills.map(p => {
            const key = `${p.year}-${p.month}`;
            const done = completedKeys.has(key);
            const inProg = inProgressKeys.has(key);
            const active = year === p.year && month === p.month;
            const shortYr = p.year !== curYear ? ` '${String(p.year).slice(2)}` : "";
            return (
              <button key={key}
                onClick={() => {
                  setYear(p.year); setMonth(p.month);
                  setStmtRows([]); setSession(null); setPdfSource(""); setPdfFile(null);
                  setKeptIds(new Set()); setIgnoredIds(new Set()); setMissingOverrides({});
                }}
                style={{
                  fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                  cursor: "pointer", fontFamily: F, transition: "all .15s",
                  border: active ? "1.5px solid #3b5bdb" : done ? "none" : inProg ? "1px solid #d97706" : "0.5px solid #e5e7eb",
                  background: active ? "#dbeafe" : done ? "#111827" : "transparent",
                  color: active ? "#3b5bdb" : done ? "#fff" : inProg ? "#d97706" : "#9ca3af",
                }}>
                {MO_LABELS[p.month - 1]}{shortYr}
                {done ? " ✓" : inProg ? " ●" : ""}
              </button>
            );
          })}
        </div>
        {periodSelected && step < 4 && (
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12, fontFamily: F }}>
            {periodLabel}
          </div>
        )}

        {/* ── STEP 2: Upload PDF ── */}
        {step === 2 && (
          <div>
            {/* Email banner */}
            {emailStmt && (
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
                <button onClick={handleDownloadFromEmail} disabled={processing} style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#3b5bdb", padding: "6px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: F }}>
                  Download & Process
                </button>
              </div>
            )}

            {/* Drop zone */}
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) stageFile(f); }}
              style={{
                border: `2px dashed ${pdfFile ? "#3b5bdb" : "#e5e7eb"}`, borderRadius: 16, padding: "28px 24px",
                textAlign: "center", cursor: "pointer", background: pdfFile ? "#eff6ff" : "#fafafa",
                marginBottom: 10,
              }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>{pdfFile ? "✅" : "📄"}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: F, marginBottom: 4 }}>
                {pdfFile ? pdfSource : "Drop PDF statements here or click to browse"}
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: F }}>
                {pdfFile ? "Click to change file" : "Upload bank or credit card statements (PDF)"}
              </div>
              <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }}
                onChange={e => { stageFile(e); e.target.value = ""; }} />
              {!pdfFile && <div style={{ marginTop: 12 }}><Button variant="primary" size="sm">Choose File</Button></div>}
            </div>

            {pdfFile && (
              <div style={{ marginTop: 4, textAlign: "right" }}>
                <Button onClick={processFile}>Process →</Button>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: Processing ── */}
        {step === 3 && (
          <div style={{ border: "2px dashed #bfdbfe", borderRadius: 16, padding: "40px 24px", textAlign: "center", background: "#eff6ff" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1e3a8a", fontFamily: F }}>Menganalisis statement dengan AI...</div>
            <div style={{ fontSize: 12, color: "#475569", fontFamily: F, marginTop: 4 }}>This may take a moment for large statements</div>
          </div>
        )}

        {/* ── STEP 4: Results ── */}
        {step === 4 && hasSomething && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={PILL("#dcfce7", "#059669")}>✓ {matchCount}</span>
              <span style={PILL("#fef3c7", "#d97706")}>! {missingCount}</span>
              <span style={PILL("#fee2e2", "#dc2626")}>? {extraCount}</span>
              {keptCount > 0 && <span style={PILL("#e5e7eb", "#6b7280")}>◦ {keptCount}</span>}
              {ignoredCount > 0 && <span style={PILL("#f3f4f6", "#9ca3af")}>– {ignoredCount}</span>}
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

        {/* ── Statement table (matches CCStatement style) ── */}
        {step === 4 && hasSomething && (() => {
          const COLS = "80px 1fr 120px 120px 130px 48px";
          const ROW_PAD = "0 14px";
          const HDR = [
            { label: "Tanggal",    align: "left"   },
            { label: "Keterangan", align: "left"   },
            { label: "Debit",      align: "right"  },
            { label: "Kredit",     align: "right"  },
            { label: "Saldo",      align: "right"  },
            { label: "Status",     align: "center" },
          ];
          const fmtDateLabel = (d) => { try { return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }); } catch { return d; } };
          const fmtDateShort = (d) => { try { return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }); } catch { return d; } };

          // Group by date
          const groups = {};
          sortedResults.forEach((r, i) => {
            const date = r.stmt?.date || r.ledger?.tx_date || "";
            if (!groups[date]) groups[date] = [];
            groups[date].push({ ...r, _idx: i });
          });
          const sortedDates = Object.keys(groups).sort();

          return (
            <div style={{ background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb", overflow: "hidden" }}>

              {/* Column header */}
              <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#f9fafb", borderBottom: "0.5px solid #e5e7eb", padding: ROW_PAD }}>
                {HDR.map(h => (
                  <div key={h.label} style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: F, padding: "9px 6px", textAlign: h.align }}>
                    {h.label}
                  </div>
                ))}
              </div>

              {/* Opening balance row */}
              <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#eff6ff", borderBottom: "0.5px solid #dbeafe", padding: ROW_PAD }}>
                <div style={{ fontSize: 11, color: "#1d4ed8", fontFamily: F, padding: "7px 6px", whiteSpace: "nowrap" }}>{fmtDateShort(periodStart)}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", fontFamily: F, padding: "7px 6px" }}>Opening Balance</div>
                <div /><div />
                <div style={{ fontSize: 11, fontWeight: 800, color: "#1d4ed8", fontFamily: F, padding: "7px 6px", textAlign: "right" }}>—</div>
                <div />
              </div>

              {/* Scrollable body */}
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                {sortedDates.map(date => (
                  <div key={date}>
                    {/* Date group header */}
                    <div style={{ background: "#f3f4f6", borderBottom: "0.5px solid #e5e7eb", padding: "5px 20px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: F }}>
                      {fmtDateLabel(date)}
                    </div>

                    {/* Transaction rows for this date */}
                    {groups[date].map(r => {
                      const type = r.type;
                      const s = r.stmt;
                      const l = r.ledger;
                      const desc = s ? (s.description || s.merchant || "") : (l?.description || "");
                      const amt  = Math.abs(Number(s?.amount || l?.amount_idr || l?.amount || 0));
                      const dir  = s?.direction || (l?.tx_type === "income" ? "in" : "out");
                      const badge = BADGE_S[type];
                      const isMuted = type === "kept" || type === "ignored";
                      const isExp = expandedId === (s?._id || l?.id);
                      const missRow = type === "missing" ? missingRowsFinal.find(mr => mr._id === s?._id) : null;
                      const rowKey = s?._id || l?.id || r._idx;

                      return (
                        <div key={rowKey}>
                          {/* Main row */}
                          <div
                            onClick={() => {
                              if (type === "missing" || type === "extra" || type === "kept" || type === "ignored")
                                setExpandedId(isExp ? null : (s?._id || l?.id));
                            }}
                            style={{
                              display: "grid", gridTemplateColumns: COLS,
                              borderBottom: "0.5px solid #f3f4f6", padding: ROW_PAD,
                              alignItems: "center",
                              opacity: isMuted ? 0.55 : 1,
                              cursor: (type === "missing" || type === "extra" || type === "kept" || type === "ignored") ? "pointer" : "default",
                            }}
                            onMouseEnter={e => { if (!isMuted) e.currentTarget.style.background = "#fafafa"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                          >
                            {/* Tanggal */}
                            <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: F, padding: "8px 6px", whiteSpace: "nowrap" }}>
                              {fmtDateShort(date)}
                            </div>

                            {/* Keterangan */}
                            <div style={{ padding: "8px 6px", minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, color: isMuted ? "#9ca3af" : "#111827", fontFamily: F, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {desc || "—"}
                                {type === "ignored" && <span style={{ marginLeft: 6, fontSize: 8, fontWeight: 700, color: "#9ca3af", background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>Ignored</span>}
                              </div>
                              {type === "extra" && (
                                <div style={{ fontSize: 10, color: "#dc2626", fontFamily: F, marginTop: 1 }}>Not in statement</div>
                              )}
                            </div>

                            {/* Debit */}
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#A32D2D", fontFamily: F, padding: "8px 6px", textAlign: "right" }}>
                              {dir === "out" ? fmtIDR(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                            </div>

                            {/* Kredit */}
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#3B6D11", fontFamily: F, padding: "8px 6px", textAlign: "right" }}>
                              {dir === "in" ? fmtIDR(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                            </div>

                            {/* Saldo */}
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", fontFamily: F, padding: "8px 6px", textAlign: "right" }}>
                              {fmtIDR(Math.abs(balanceMap[r._idx] || 0))}
                            </div>

                            {/* Status badge */}
                            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, background: badge.bg, color: badge.color, fontSize: 11, fontWeight: 800 }}>{badge.label}</span>
                            </div>
                          </div>

                          {/* Expanded: missing → AI scan input */}
                          {type === "missing" && isExp && missRow && (
                            <div style={{ background: "#fffbeb", borderBottom: "1px solid #fde68a", padding: "8px 14px" }}>
                              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                                <button onClick={() => setExpandedId(null)} style={btnS("#6b7280", "#e5e7eb")}>Cancel</button>
                                <button onClick={() => setIgnoredIds(prev => { const n = new Set(prev); n.add(s?._id); return n; setExpandedId(null); })} style={btnS("#6b7280", "#e5e7eb")}>Ignore</button>
                              </div>
                              <TxHorizontal
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

                          {/* Expanded: extra → action buttons */}
                          {type === "extra" && isExp && (
                            <div style={{ display: "flex", gap: 6, padding: "6px 20px 8px", background: "#fef2f2", borderBottom: "1px solid #fecaca" }}>
                              <button onClick={() => markKept(l.id)} style={btnS("#059669", "#bbf7d0")}>Keep</button>
                              <button onClick={() => openEditFromLedger(l)} style={btnS("#3b5bdb", "#bfdbfe")}>Edit</button>
                              <button onClick={() => setDelTarget(l)} style={btnS("#dc2626", "#fecaca")}>Hapus</button>
                            </div>
                          )}

                          {/* Expanded: kept → undo */}
                          {type === "kept" && isExp && (
                            <div style={{ display: "flex", gap: 6, padding: "6px 20px 8px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", opacity: 0.55 }}>
                              <button onClick={() => setKeptIds(prev => { const n = new Set(prev); n.delete(l.id); return n; })} style={btnS("#6b7280", "#e5e7eb")}>Undo Keep</button>
                            </div>
                          )}

                          {/* Expanded: ignored → undo */}
                          {type === "ignored" && isExp && (
                            <div style={{ display: "flex", gap: 6, padding: "6px 20px 8px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", opacity: 0.55 }}>
                              <button onClick={() => { setIgnoredIds(prev => { const n = new Set(prev); n.delete(s?._id); return n; }); setExpandedId(null); }} style={btnS("#6b7280", "#e5e7eb")}>Undo Ignore</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Closing balance row */}
              <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#f9fafb", borderTop: "1.5px solid #e5e7eb", padding: ROW_PAD }}>
                <div style={{ fontSize: 11, color: "#374151", fontFamily: F, padding: "9px 6px", whiteSpace: "nowrap" }}>{fmtDateShort(periodEnd)}</div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#111827", fontFamily: F, padding: "9px 6px" }}>Closing Balance</div>
                <div /><div />
                <div style={{ fontSize: 11, fontWeight: 800, color: "#111827", fontFamily: F, padding: "9px 6px", textAlign: "right" }}>
                  {fmtIDR(Math.abs(balanceMap[sortedResults.length - 1] || 0))}
                </div>
                <div />
              </div>
            </div>
          );
        })()}

      </Modal>

      {/* Edit Transaction Modal */}
      {txModalMode && txInitial && (
        <TxVerticalBig
          open={!!txModalMode} mode={txModalMode} initialData={txInitial}
          onSave={() => { refetchLedger(); onRefresh?.(); setTxModalMode(null); setTxInitial(null); }}
          onDelete={() => { refetchLedger(); onRefresh?.(); setTxModalMode(null); setTxInitial(null); }}
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
            <strong>{delTarget.description || "—"}</strong> · {delTarget.tx_date} · {fmtIDR(Number(delTarget.amount_idr || delTarget.amount || 0))}
          </div>
        </Modal>
      )}
    </>
  );
}
