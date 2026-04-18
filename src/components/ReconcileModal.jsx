// ReconcileModal.jsx — Full reconcile flow: PDF extraction → match → review
import { useState, useMemo, useCallback, useEffect } from "react";
import { reconcileApi, ledgerApi } from "../api";
import { supabase } from "../lib/supabase";
import { fmtIDR, todayStr } from "../utils";
import Modal from "./shared/Modal";
import { Button, showToast } from "./shared/index";
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

  // Add transaction modal
  const [addModal,    setAddModal]    = useState(false);
  const [addPreFill,  setAddPreFill]  = useState(null);
  // Delete confirmation
  const [delTarget,   setDelTarget]   = useState(null);

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

  const results = useMemo(() => matchTransactions(stmtRows, periodLedger), [stmtRows, periodLedger]);
  const matchCount   = results.filter(r => r.type === "match").length;
  const missingCount = results.filter(r => r.type === "missing").length;
  const extraCount   = results.filter(r => r.type === "extra").length;

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

  // ── Add missing transaction ─────────────────────────────────
  const openAddFromStmt = (s) => {
    setAddPreFill({
      tx_date: s.date || todayStr(),
      description: s.description || s.merchant || "",
      amount: Math.abs(Number(s.amount || 0)),
      currency: s.currency || "IDR",
      amount_idr: Math.abs(Number(s.amount || 0)),
      tx_type: (s.direction === "in") ? "income" : "expense",
      from_id: (s.direction !== "in") ? account.id : null,
      to_id: (s.direction === "in") ? account.id : null,
    });
    setAddModal(true);
  };

  // ── Delete extra transaction ────────────────────────────────
  const handleDelete = async () => {
    if (!delTarget) return;
    try {
      await supabase.from("ledger").delete().eq("id", delTarget.id);
      setLedger?.(prev => prev.filter(e => e.id !== delTarget.id));
      showToast("Deleted");
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

  const footer = (
    <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
      <label style={{ cursor: "pointer" }}>
        <input type="file" accept=".pdf" onChange={handleUpload} style={{ display: "none" }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "#3b5bdb", fontFamily: "Figtree, sans-serif", cursor: "pointer" }}>
          {pdfSource ? "Upload PDF lain" : "Upload PDF"}
        </span>
      </label>
      <Button onClick={handleComplete} disabled={completing || stmtRows.length === 0}>
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
              <input type="file" accept=".pdf" onChange={handleUpload} style={{ display: "none" }} />
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

            {results.map((r, i) => {
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

              if (r.type === "missing") {
                const s = r.stmt;
                return (
                  <div key={i} style={{ ...ROW_STYLE, background: "#fffbeb", border: "1px solid #fde68a" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.description || s.merchant || "—"}
                      </div>
                      <div style={{ fontSize: 10, color: "#6b7280" }}>{s.date} · {fmtIDR(Math.abs(Number(s.amount || 0)), true)}</div>
                    </div>
                    <div style={{ width: 32, textAlign: "center", fontSize: 14 }}>!</div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, color: "#d97706", fontStyle: "italic" }}>Not in ledger</span>
                      <button onClick={() => openAddFromStmt(s)}
                        style={{ fontSize: 10, fontWeight: 700, color: "#3b5bdb", background: "none", border: "1px solid #bfdbfe", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: "Figtree, sans-serif" }}>
                        Tambah
                      </button>
                    </div>
                  </div>
                );
              }

              // extra
              const l = r.ledger;
              return (
                <div key={i} style={{ ...ROW_STYLE, background: "#fef2f2", border: "1px solid #fecaca" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 10, color: "#dc2626", fontStyle: "italic" }}>Not in statement</span>
                  </div>
                  <div style={{ width: 32, textAlign: "center", fontSize: 14 }}>?</div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {l.description || "—"}
                      </div>
                      <div style={{ fontSize: 10, color: "#6b7280" }}>{l.tx_date} · {fmtIDR(Number(l.amount_idr || l.amount || 0), true)}</div>
                    </div>
                    <button onClick={() => setDelTarget(l)}
                      style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", background: "none", border: "1px solid #fecaca", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap" }}>
                      Hapus
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {!processing && stmtRows.length === 0 && (
          <div style={{ textAlign: "center", padding: "30px 0", color: "#9ca3af", fontSize: 12, fontFamily: "Figtree, sans-serif" }}>
            Upload a bank statement PDF to start reconciling
          </div>
        )}
      </Modal>

      {/* Add Transaction Modal */}
      {addModal && addPreFill && (
        <TransactionModal
          isOpen={addModal}
          onClose={() => { setAddModal(false); setAddPreFill(null); }}
          user={user}
          accounts={accounts}
          categories={categories}
          ledger={ledger}
          setLedger={setLedger}
          onRefresh={onRefresh}
          initialData={addPreFill}
        />
      )}

      {/* Delete confirmation */}
      {delTarget && (
        <Modal isOpen={!!delTarget} onClose={() => setDelTarget(null)} title="Hapus transaksi?" width={380}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
              <Button variant="ghost" onClick={() => setDelTarget(null)}>Batal</Button>
              <Button variant="danger" onClick={handleDelete}>Hapus</Button>
            </div>
          }>
          <div style={{ fontSize: 12, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
            <strong>{delTarget.description}</strong> · {delTarget.tx_date} · {fmtIDR(Number(delTarget.amount_idr || delTarget.amount || 0), true)}
          </div>
        </Modal>
      )}
    </>
  );
}
