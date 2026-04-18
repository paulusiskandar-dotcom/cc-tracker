// ReconcileModal.jsx — Full reconcile flow: PDF extraction → match → review
import { useState, useMemo, useCallback, useEffect } from "react";
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
function similarity(a, b) {
  if (!a || !b) return 0;
  const la = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const lb = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!la || !lb) return 0;
  let matches = 0;
  const shorter = la.length <= lb.length ? la : lb;
  const longer  = la.length <= lb.length ? lb : la;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return matches / longer.length;
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
      const amtDiff = Math.abs(Number(s.amount || 0) - Number(l.amount_idr || l.amount || 0));
      if (amtDiff > 100) continue; // amount must be within Rp 100
      const sd = new Date(s.date + "T00:00:00");
      const ld = new Date((l.tx_date || "") + "T00:00:00");
      const dayDiff = Math.abs((sd - ld) / 86400000);
      if (dayDiff > 1) continue; // date within ±1 day
      const descSim = similarity(s.description || s.merchant, l.description);
      const score = (amtDiff < 1 ? 2 : 1) + (descSim >= 0.6 ? 1 : 0) + (dayDiff === 0 ? 0.5 : 0);
      if (score > bestScore) { bestScore = score; bestIdx = li; }
    }
    if (bestIdx >= 0) {
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
  const periodStr = account ? `${year}-${String(month).padStart(2, "0")}` : "";
  const periodLabel = account ? new Date(year, month - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "";

  // Filter ledger for this account + period
  const periodLedger = useMemo(() => {
    if (!account || !ledger) return [];
    return ledger.filter(e => {
      const ym = (e.tx_date || "").slice(0, 7);
      return ym === periodStr && (e.from_id === account.id || e.to_id === account.id);
    });
  }, [ledger, account, periodStr]);

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

  if (!account) return null;

  const ROW_STYLE = {
    display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
    borderRadius: 8, marginBottom: 4, fontFamily: "Figtree, sans-serif",
  };

  const hasSomething = stmtRows.length > 0 || periodLedger.length > 0;
  const footer = (
    <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
      <label style={{ cursor: "pointer" }}>
        {/* value reset lets the user pick the SAME file twice in a row */}
        <input type="file" accept=".pdf" onChange={handleUpload}
          onClick={e => { e.target.value = ""; }}
          style={{ display: "none" }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "#3b5bdb", fontFamily: "Figtree, sans-serif", cursor: "pointer" }}>
          {pdfSource ? "Upload PDF lain" : "Upload PDF"}
        </span>
      </label>
      <Button onClick={handleComplete} disabled={completing || !hasSomething}>
        {completing ? "Saving…" : "Selesai ✓"}
      </Button>
    </div>
  );

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={`Reconcile — ${account.name}`} footer={footer} width={720}>
        {/* Subtitle */}
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12, fontFamily: "Figtree, sans-serif" }}>
          {periodLabel}{pdfSource ? ` · ${pdfSource}` : ""}
        </div>

        {/* Statement-from-email banner */}
        {stmtRows.length === 0 && emailStmt && (
          <div style={{
            background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10,
            padding: "10px 14px", marginBottom: 14, fontFamily: "Figtree, sans-serif",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>📎</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1e3a8a" }}>
                  Statement tersedia dari email
                </div>
                <div style={{
                  fontSize: 11, color: "#475569",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {emailStmt.filename || "statement.pdf"}
                  {emailStmt.sender_email ? ` · ${emailStmt.sender_email}` : ""}
                </div>
              </div>
            </div>
            {needsPassword && (
              <input
                type="password"
                placeholder="Password PDF (jika terenkripsi)"
                value={emailPassword}
                onChange={e => setEmailPassword(e.target.value)}
                style={{
                  fontSize: 12, padding: "6px 10px", border: "1px solid #cbd5e1",
                  borderRadius: 8, fontFamily: "Figtree, sans-serif",
                  width: "100%", marginBottom: 8, boxSizing: "border-box",
                }}
              />
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleDownloadFromEmail}
                disabled={processing}
                style={{
                  fontSize: 12, fontWeight: 700, color: "#fff",
                  background: processing ? "#93c5fd" : "#3b5bdb",
                  padding: "6px 16px", borderRadius: 8, border: "none",
                  cursor: processing ? "default" : "pointer",
                  fontFamily: "Figtree, sans-serif",
                }}
              >
                {processing ? "Processing…" : (needsPassword ? "Retry with Password" : "Download & Process")}
              </button>
              {!needsPassword && (
                <button
                  onClick={() => setNeedsPassword(true)}
                  style={{
                    fontSize: 11, fontWeight: 600, color: "#475569",
                    background: "transparent", padding: "6px 10px",
                    border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer",
                    fontFamily: "Figtree, sans-serif",
                  }}
                >
                  PDF terenkripsi?
                </button>
              )}
            </div>
          </div>
        )}

        {/* Password input */}
        {stmtRows.length === 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <input
              type="password" placeholder="PDF password (optional)"
              value={pdfPassword} onChange={e => setPdfPassword(e.target.value)}
              style={{ fontSize: 12, padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8, fontFamily: "Figtree, sans-serif", width: 200 }}
            />
            <label style={{ cursor: "pointer" }}>
              <input type="file" accept=".pdf" onChange={handleUpload}
                onClick={e => { e.target.value = ""; }}
                style={{ display: "none" }} />
              <span style={{
                display: "inline-block", fontSize: 12, fontWeight: 700, color: "#fff",
                background: "#3b5bdb", padding: "6px 16px", borderRadius: 8, cursor: "pointer",
                fontFamily: "Figtree, sans-serif",
              }}>
                {processing ? "Processing…" : "Upload PDF"}
              </span>
            </label>
          </div>
        )}

        {/* Processing spinner */}
        {processing && (
          <div style={{ textAlign: "center", padding: "20px 0", fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
            Extracting transactions from PDF…
          </div>
        )}

        {/* Stats bar */}
        {stmtRows.length > 0 && (
          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <span style={PILL("#dcfce7", "#059669")}>✓ {matchCount} Match</span>
            <span style={PILL("#fef3c7", "#d97706")}>! {missingCount} Missing</span>
            <span style={PILL("#fee2e2", "#dc2626")}>? {extraCount} Extra</span>
            {keptCount > 0 && <span style={PILL("#e5e7eb", "#6b7280")}>◦ {keptCount} Kept</span>}
            <span style={PILL("#f3f4f6", "#374151")}>{stmtRows.length} Total</span>
          </div>
        )}

        {/* Results */}
        {stmtRows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 420, overflowY: "auto" }}>
            {/* Column headers */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 32px 1fr", gap: 4, padding: "4px 10px", fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", fontFamily: "Figtree, sans-serif" }}>
              <span>Statement</span>
              <span />
              <span>Ledger</span>
            </div>

            {results.filter(r => r.type !== "missing").map((r, i) => {
              if (r.type === "match") {
                const s = r.stmt;
                const l = r.ledger;
                return (
                  <div key={i} style={{ ...ROW_STYLE, background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.description || s.merchant || "—"}
                      </div>
                      <div style={{ fontSize: 10, color: "#6b7280" }}>{s.date} · {fmtIDR(Math.abs(Number(s.amount || 0)), true)}</div>
                    </div>
                    <div style={{ width: 32, textAlign: "center", fontSize: 14 }}>✓</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {l.description || "—"}
                      </div>
                      <div style={{ fontSize: 10, color: "#6b7280" }}>{l.tx_date} · {fmtIDR(Number(l.amount_idr || l.amount || 0), true)}</div>
                    </div>
                  </div>
                );
              }

              if (r.type === "kept") {
                const l = r.ledger;
                return (
                  <div key={i} style={{ ...ROW_STYLE, background: "#f9fafb", border: "1px solid #e5e7eb", opacity: 0.75 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 10, color: "#9ca3af", fontStyle: "italic" }}>Kept (intentional)</span>
                    </div>
                    <div style={{ width: 32, textAlign: "center", fontSize: 14, color: "#9ca3af" }}>◦</div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {l.description || "—"}
                        </div>
                        <div style={{ fontSize: 10, color: "#9ca3af" }}>{l.tx_date} · {fmtIDR(Number(l.amount_idr || l.amount || 0), true)}</div>
                      </div>
                      <button onClick={() => setKeptIds(prev => { const n = new Set(prev); n.delete(l.id); return n; })}
                        style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", background: "none", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap" }}>
                        Undo
                      </button>
                    </div>
                  </div>
                );
              }

              // extra
              const l = r.ledger;
              const btnStyle = (color, border) => ({
                fontSize: 10, fontWeight: 700, color, background: "none",
                border: `1px solid ${border}`, borderRadius: 4, padding: "2px 8px",
                cursor: "pointer", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap",
              });
              return (
                <div key={i} style={{ ...ROW_STYLE, background: "#fef2f2", border: "1px solid #fecaca" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 10, color: "#dc2626", fontStyle: "italic" }}>Not in statement</span>
                  </div>
                  <div style={{ width: 32, textAlign: "center", fontSize: 14 }}>?</div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {l.description || "—"}
                      </div>
                      <div style={{ fontSize: 10, color: "#6b7280" }}>{l.tx_date} · {fmtIDR(Number(l.amount_idr || l.amount || 0), true)}</div>
                    </div>
                    <button onClick={() => openEditFromLedger(l)} style={btnStyle("#3b5bdb", "#bfdbfe")}>Edit</button>
                    <button onClick={() => markKept(l.id)}       style={btnStyle("#059669", "#bbf7d0")}>Keep</button>
                    <button onClick={() => setDelTarget(l)}      style={btnStyle("#dc2626", "#fecaca")}>Hapus</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Missing rows — full AI-scan-style review list */}
        {missingRowsFinal.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#d97706", fontFamily: "Figtree, sans-serif", marginBottom: 6 }}>
              Missing from Ledger ({missingRowsFinal.length})
            </div>
            <TransactionReviewList
              rows={missingRowsFinal}
              selected={missingSelected}
              skipped={missingSkipped}
              onUpdateRow={updateMissingRow}
              onConfirmRow={confirmMissingOne}
              onSkipRow={skipMissing}
              onConfirmAll={confirmMissingAll}
              onToggleSelect={id => setMissingSelected(s => ({ ...s, [id]: !s[id] }))}
              onToggleAll={() => {
                const allSel = missingRowsFinal.every(r => missingSelected[r._id]);
                const next = {};
                missingRowsFinal.forEach(r => { next[r._id] = !allSel; });
                setMissingSelected(next);
              }}
              source="reconcile"
              accounts={accounts}
              T={T}
              busy={missingImporting}
            />
          </div>
        )}

        {/* Empty state */}
        {!processing && stmtRows.length === 0 && (
          <div style={{ textAlign: "center", padding: "30px 0", color: "#9ca3af", fontSize: 12, fontFamily: "Figtree, sans-serif" }}>
            Upload a bank statement PDF to start reconciling
          </div>
        )}
      </Modal>

      {/* Add / Edit Transaction Modal */}
      {txModalMode && txInitial && (
        <TransactionModal
          open={!!txModalMode}
          mode={txModalMode}
          initialData={txInitial}
          onSave={() => { onRefresh?.(); setTxModalMode(null); setTxInitial(null); }}
          onDelete={() => { onRefresh?.(); setTxModalMode(null); setTxInitial(null); }}
          onClose={() => { setTxModalMode(null); setTxInitial(null); }}
          user={user}
          accounts={accounts}
          setLedger={setLedger}
          categories={categories}
          fxRates={fxRates}
          allCurrencies={allCurrencies}
          bankAccounts={bankAccounts}
          creditCards={creditCards}
          assets={assets}
          liabilities={liabilities}
          receivables={receivables}
          incomeSrcs={incomeSrcs}
          accountCurrencies={accountCurrencies}
          onRefresh={onRefresh}
        />
      )}

      {/* Delete confirmation */}
      {delTarget && (
        <Modal
          isOpen={!!delTarget}
          onClose={() => setDelTarget(null)}
          title={`Hapus transaksi ${delTarget.description ? `"${delTarget.description}"` : ""}?`}
          width={420}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
              <Button variant="ghost" onClick={() => setDelTarget(null)}>Batal</Button>
              <Button variant="danger" onClick={handleDelete}>Hapus</Button>
            </div>
          }>
          <div style={{ fontSize: 12, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
            <strong>{delTarget.description || "—"}</strong> · {delTarget.tx_date} · {fmtIDR(Number(delTarget.amount_idr || delTarget.amount || 0), true)}
          </div>
        </Modal>
      )}
    </>
  );
}
