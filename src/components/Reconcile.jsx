// Reconcile.jsx — Monthly inbox driven by the auto-statement pipeline.
// Statements download + diff themselves (gmail-estatement "prepare");
// this page groups the results per month: Needs review / All matched /
// Completed / Waiting. One-click Finalize for perfect statements.
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { importDrafts } from "../lib/importDrafts";
import { useReconcileDrafts } from "../lib/useReconcileDrafts";
import { processReconcilePDF, matchDetectedAccount } from "../lib/reconcilePdfUpload";
import { matchRows } from "./shared/ReconcileOverlay";
import { reconcileApi } from "../api";
import { fmtIDR } from "../utils";
import { showToast } from "./shared/index";
import GlobalReconcileButton from "./shared/GlobalReconcileButton";
import {
  ChevronLeft, ChevronRight, CreditCard, Landmark, Clock, Check,
  FileText, Eye, AlertTriangle,
} from "lucide-react";

const FF = "Figtree, sans-serif";

const fmtDate = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
  catch { return iso; }
};
const addDays = (d, n) => { const t = new Date(d + "T00:00:00"); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };

// ── Shared bits ───────────────────────────────────────────────
const CHIP = (bg, color) => ({
  fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99,
  background: bg, color, display: "inline-flex", alignItems: "center", gap: 4,
  fontFamily: FF, whiteSpace: "nowrap",
});
const BTN = (bg, color, border = "none") => ({
  fontSize: 11.5, fontWeight: 700, padding: "7px 16px", borderRadius: 9,
  border, background: bg, color, cursor: "pointer", fontFamily: FF, flexShrink: 0,
});

function AccountTile({ type }) {
  const isCC = type === "credit_card";
  const Icon = isCC ? CreditCard : Landmark;
  return (
    <span style={{
      width: 34, height: 34, borderRadius: 10, flexShrink: 0,
      background: isCC ? "#fde8e8" : "#dbeafe", color: isCC ? "#dc2626" : "#3b5bdb",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
    }}>
      <Icon size={17} strokeWidth={2} />
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function Reconcile({
  user,
  accounts,
  reconSessions,
  setTab,
  setPendingReconcileNav,
}) {
  const now = new Date();
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [sessions, setSessions] = useState(null);              // local override after actions
  const [finalizing, setFinalizing] = useState(null);          // account id being finalized
  const [valasByAcc, setValasByAcc] = useState({});            // accountId → waiting-valas count
  const [queue, setQueue] = useState([]);
  const [processing, setProcessing] = useState(null);

  const allSessions = useMemo(() => sessions ?? reconSessions ?? [], [sessions, reconSessions]);
  const { drafts, reload: reloadDrafts } = useReconcileDrafts(user?.id);
  const draftByAcc = useMemo(() => Object.fromEntries((drafts || []).map(d => [d.account_id, d])), [drafts]);

  const refreshSessions = useCallback(async () => {
    try { setSessions(await reconcileApi.getAll(user.id)); } catch { /* keep prop */ }
  }, [user?.id]);

  // Valas items parked "waiting for statement" → purple chip on their card
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("email_sync").select("ai_raw_result").eq("user_id", user.id).eq("status", "waiting_statement")
      .then(({ data }) => {
        const map = {};
        for (const r of data || []) {
          let arr = r.ai_raw_result; try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { arr = null; }
          for (const t of (Array.isArray(arr) ? arr : [])) {
            if (!t || t._imported || t._skipped || !t._waiting_statement) continue;
            if (t.from_account_id) map[t.from_account_id] = (map[t.from_account_id] || 0) + 1;
          }
        }
        setValasByAcc(map);
      });
  }, [user?.id]);

  // Manual-upload queue from Gmail scan (fallback path, unchanged)
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("estatement_pdfs")
      .select("id, filename, file_path, status, account_id, ai_raw_result, created_at")
      .eq("user_id", user.id).in("status", ["queued", "extracted", "failed"])
      .order("created_at", { ascending: false })
      .then(({ data }) => setQueue(data || []));
  }, [user?.id]);

  const activeAccounts = useMemo(
    () => (accounts || []).filter(a => a.is_active && (a.type === "bank" || a.type === "credit_card")),
    [accounts]);

  // ── Derive per-account status for the selected month ─────────
  const monthData = useMemo(() => {
    const inMonth = allSessions.filter(s => s.period_year === month.y && s.period_month === month.m);
    const byAcc = {};
    for (const s of inMonth) {
      const cur = byAcc[s.account_id];
      // completed supersedes prepared; newest wins within a status
      if (!cur) { byAcc[s.account_id] = s; continue; }
      if (s.status === "completed" && cur.status !== "completed") byAcc[s.account_id] = s;
      else if (s.status === cur.status && new Date(s.created_at) > new Date(cur.created_at)) byAcc[s.account_id] = s;
    }

    const needsReview = [], ready = [], completed = [], waiting = [];
    for (const acc of activeAccounts) {
      const s = byAcc[acc.id];
      if (!s) { waiting.push({ acc }); continue; }
      if (s.status === "completed") { completed.push({ acc, s }); continue; }
      const gap = (s.closing_balance != null && s.calculated_balance != null)
        ? Math.round(Number(s.closing_balance) - Number(s.calculated_balance)) : null;
      const item = { acc, s, gap, valas: valasByAcc[acc.id] || 0 };
      if ((s.total_missing || 0) > 0 || gap === null || Math.abs(gap) >= 1) needsReview.push(item);
      else ready.push(item);
    }
    // gap issues first
    needsReview.sort((a, b) => (Math.abs(b.gap || 0)) - (Math.abs(a.gap || 0)));
    completed.sort((a, b) => new Date(b.s.completed_at || 0) - new Date(a.s.completed_at || 0));
    return { needsReview, ready, completed, waiting };
  }, [allSessions, activeAccounts, month, valasByAcc]);

  // "usually ~day X" — median statement day from this account's history
  const usualDay = useCallback((accId) => {
    const days = allSessions
      .filter(s => s.account_id === accId && s.period_end)
      .map(s => Number(String(s.period_end).slice(8, 10)))
      .filter(Boolean);
    const a = activeAccounts.find(x => x.id === accId);
    if (a?.last_statement_date) days.push(Number(String(a.last_statement_date).slice(8, 10)));
    if (!days.length) return null;
    days.sort((x, y) => x - y);
    return days[Math.floor(days.length / 2)];
  }, [allSessions, activeAccounts]);

  const isCurrentMonth = month.y === now.getFullYear() && month.m === now.getMonth() + 1;
  const monthLabel = new Date(month.y, month.m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const navMonth = (d) => setMonth(({ y, m }) => {
    const t = new Date(y, m - 1 + d, 1);
    return { y: t.getFullYear(), m: t.getMonth() + 1 };
  });

  // ── Actions ───────────────────────────────────────────────────
  const openReview = (acc) => {
    const draft = draftByAcc[acc.id];
    const accType = acc.type === "credit_card" ? "credit_card" : "bank";
    if (draft?.state_json?.stmtRows?.length) {
      setPendingReconcileNav({ accType, acc, seeds: { fullState: draft.state_json } });
    } else {
      const from = `${month.y}-${String(month.m).padStart(2, "0")}-01`;
      const to = new Date(month.y, month.m, 0).toISOString().slice(0, 10);
      setPendingReconcileNav({ accType, acc, seeds: { from, to } });
    }
    setTab(accType === "credit_card" ? "cards" : "bank");
  };

  // One-click finalize: re-verify the match client-side (same matchRows the
  // review UI uses), then stamp reconciled_at + anchor CC statement + complete.
  const finalize = async ({ acc, s }) => {
    setFinalizing(acc.id);
    try {
      const draft = draftByAcc[acc.id] || await importDrafts.load(user.id, "reconcile", acc.id);
      const st = draft?.state_json;
      if (!st?.stmtRows?.length) throw new Error("Draft not found — use Review instead");
      const dates = st.stmtRows.map(r => r.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d || "")).sort();
      if (!dates.length) throw new Error("Statement rows have no dates — use Review");
      const { data: led, error } = await supabase.from("ledger")
        .select("id, tx_date, description, merchant_name, amount, amount_idr, from_id, to_id")
        .eq("user_id", user.id)
        .or(`from_id.eq.${acc.id},to_id.eq.${acc.id}`)
        .gte("tx_date", addDays(dates[0], -7)).lte("tx_date", addDays(dates[dates.length - 1], 7));
      if (error) throw error;
      const { matched, missing } = matchRows(st.stmtRows, led || []);
      if (missing.length) { showToast(`${missing.length} row(s) no longer match — use Review`, "warning"); return; }

      const nowIso = new Date().toISOString();
      if (matched.size) {
        const { error: e2 } = await supabase.from("ledger")
          .update({ reconciled_at: nowIso }).in("id", [...matched.keys()]).eq("user_id", user.id);
        if (e2) throw e2;
      }
      if (acc.type === "credit_card" && st.stmtClosingBalance != null) {
        await supabase.from("accounts")
          .update({ last_statement_amount: st.stmtClosingBalance, last_statement_date: dates[dates.length - 1] })
          .eq("id", acc.id).eq("user_id", user.id);
      }
      await supabase.from("reconcile_sessions")
        .update({ status: "completed", completed_at: nowIso }).eq("id", s.id).eq("user_id", user.id);
      await importDrafts.clear(user.id, "reconcile", acc.id);
      await refreshSessions();
      await reloadDrafts();
      showToast(`${acc.name} reconciled — ${matched.size} rows ✓`);
    } catch (e) {
      showToast(e.message || "Finalize failed", "error");
    } finally {
      setFinalizing(null);
    }
  };

  const finalizeAll = async () => {
    for (const item of monthData.ready) await finalize(item);
  };

  // Manual upload / Gmail queue (existing fallback flows)
  const navigateToAccount = (acc, year, m, txs, filename, blobUrl, closingBal, openingBal) => {
    const from = `${year}-${String(m).padStart(2, "0")}-01`;
    const to = new Date(year, m, 0).toISOString().slice(0, 10);
    setPendingReconcileNav({
      accType: acc.type === "credit_card" ? "credit_card" : "bank",
      acc, seeds: { from, to, txs, filename, blobUrl, closingBal, openingBal },
    });
    setTab(acc.type === "credit_card" ? "cards" : "bank");
  };

  const handleProcess = async (item) => {
    setProcessing(item.id);
    try {
      let txs, detectedAcc, year, m, filename, blobUrl, closingBal, openingBal;
      if (item.status === "extracted" && item.ai_raw_result?.transactions?.length) {
        const r = item.ai_raw_result;
        txs = r.transactions; filename = item.filename || "statement.pdf";
        closingBal = r.closing_balance ?? null; openingBal = r.opening_balance ?? null;
        detectedAcc = matchDetectedAccount(r.detected_account, activeAccounts);
        year = r.detected_period?.year || now.getFullYear();
        m = r.detected_period?.month || (now.getMonth() + 1);
        blobUrl = null;
      } else {
        if (!item.file_path) throw new Error("No PDF source available");
        const { data: blob, error } = await supabase.storage.from("estatement-pdfs").download(item.file_path);
        if (error || !blob) throw new Error("Could not download PDF");
        const file = new File([blob], item.filename || "statement.pdf", { type: "application/pdf" });
        const result = await processReconcilePDF(file, user.id);
        if (result.error) { showToast(result.error, "error"); return; }
        txs = result.transactions; filename = result.filename; blobUrl = result.blobUrl;
        closingBal = result.closing_balance ?? null; openingBal = result.opening_balance ?? null;
        detectedAcc = matchDetectedAccount(result.detected_account, activeAccounts);
        year = result.detected_period?.year || now.getFullYear();
        m = result.detected_period?.month || (now.getMonth() + 1);
      }
      await supabase.from("estatement_pdfs").update({ status: "done" }).eq("id", item.id);
      setQueue(prev => prev.filter(q => q.id !== item.id));
      const acc = detectedAcc
        || (item.account_id ? (accounts || []).find(a => a.id === item.account_id) : null)
        || activeAccounts[0];
      if (!acc) { showToast("Account not matched — open Bank or Cards to reconcile manually", "warning"); return; }
      navigateToAccount(acc, year, m, txs, filename, blobUrl, closingBal, openingBal);
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

  // ── Progress numbers ──────────────────────────────────────────
  const total = activeAccounts.length || 1;
  const nDone = monthData.completed.length, nReview = monthData.needsReview.length, nReady = monthData.ready.length;
  const pct = (n) => `${(n / total) * 100}%`;

  const sectionTitle = (label, count, bg, color, extra = null) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", fontFamily: FF }}>{label}</div>
      <span style={CHIP(bg, color)}>{count}</span>
      <span style={{ flex: 1 }} />
      {extra}
    </div>
  );

  return (
    <div style={{ padding: 16, fontFamily: FF, maxWidth: 1100, margin: "0 auto" }}>

      {/* HEADER + MONTH BAR */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>Reconcile</h1>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
            Statements download &amp; diff themselves — you only review what needs attention
          </div>
        </div>
        <GlobalReconcileButton type="all" accounts={activeAccounts} user={user} onNavigate={navigateToAccount} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", margin: "14px 0 6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => navMonth(-1)} style={{ ...BTN("#fff", "#6b7280", "1px solid #e5e7eb"), padding: "4px 9px" }}><ChevronLeft size={14} /></button>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#111827", minWidth: 130, textAlign: "center" }}>{monthLabel}</span>
          <button onClick={() => navMonth(1)} disabled={isCurrentMonth}
            style={{ ...BTN("#fff", isCurrentMonth ? "#d1d5db" : "#6b7280", "1px solid #e5e7eb"), padding: "4px 9px", cursor: isCurrentMonth ? "default" : "pointer" }}><ChevronRight size={14} /></button>
        </div>
        <div style={{ flex: 1, minWidth: 200, maxWidth: 400 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "#6b7280", marginBottom: 4 }}>
            <span>This month's progress</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}><b>{nDone}</b>/{total} accounts</span>
          </div>
          <div style={{ height: 7, borderRadius: 99, background: "#f3f4f6", overflow: "hidden", display: "flex" }}>
            <span style={{ width: pct(nDone), background: "#059669" }} />
            <span style={{ width: pct(nReady), background: "#34d399" }} />
            <span style={{ width: pct(nReview), background: "#d97706" }} />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: "#6b7280", marginBottom: 20 }}>
        <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: "#059669", marginRight: 5 }} />Completed {nDone}</span>
        <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: "#34d399", marginRight: 5 }} />Ready to finalize {nReady}</span>
        <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: "#d97706", marginRight: 5 }} />Needs review {nReview}</span>
        <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: "#e5e7eb", marginRight: 5 }} />Waiting {monthData.waiting.length}</span>
      </div>

      {/* NEEDS REVIEW */}
      {monthData.needsReview.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          {sectionTitle("Needs review", monthData.needsReview.length, "#fef3c7", "#b45309")}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {monthData.needsReview.map(({ acc, s, gap, valas }) => (
              <div key={acc.id} style={{
                background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14,
                borderLeft: `3px solid ${gap !== null && Math.abs(gap) >= 1 ? "#dc2626" : "#d97706"}`,
                padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              }}>
                <AccountTile type={acc.type} />
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827" }}>{acc.name}</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>
                    Statement {fmtDate(s.period_end)}{s.closing_balance != null ? ` · closing ${fmtIDR(s.closing_balance)}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={CHIP("#dcfce7", "#059669")}><Check size={11} strokeWidth={2.5} />{s.total_match || 0} matched</span>
                  {(s.total_missing || 0) > 0 && <span style={CHIP("#fef3c7", "#b45309")}>{s.total_missing} not in ledger</span>}
                  {gap !== null && Math.abs(gap) >= 1 && <span style={CHIP("#fee2e2", "#dc2626")}>gap {fmtIDR(Math.abs(gap))}</span>}
                  {gap !== null && Math.abs(gap) < 1 && <span style={CHIP("#f3f4f6", "#6b7280")}>closing matches</span>}
                  {gap === null && <span style={CHIP("#f3f4f6", "#6b7280")}>no closing balance</span>}
                  {valas > 0 && <span style={CHIP("#ede9fe", "#6d28d9")}>{valas} FX waiting → resolves here</span>}
                </div>
                <button onClick={() => openReview(acc)} style={BTN("#3b5bdb", "#fff")}>Review →</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* READY TO FINALIZE */}
      {monthData.ready.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          {sectionTitle("All matched — ready to finalize", monthData.ready.length, "#dcfce7", "#059669",
            monthData.ready.length > 1 && (
              <button onClick={finalizeAll} disabled={!!finalizing} style={BTN("#059669", "#fff")}>
                Finalize all ({monthData.ready.length})
              </button>
            ))}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {monthData.ready.map((item) => (
              <div key={item.acc.id} style={{
                background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, borderLeft: "3px solid #059669",
                padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              }}>
                <AccountTile type={item.acc.type} />
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827" }}>{item.acc.name}</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>
                    Statement {fmtDate(item.s.period_end)}{item.s.closing_balance != null ? ` · closing ${fmtIDR(item.s.closing_balance)}` : ""}
                  </div>
                </div>
                <span style={CHIP("#dcfce7", "#059669")}>
                  <Check size={11} strokeWidth={2.5} />
                  {item.s.total_match || 0} matched · 0 missing · gap Rp0
                </span>
                <button onClick={() => finalize(item)} disabled={finalizing === item.acc.id} style={BTN("#059669", "#fff")}>
                  {finalizing === item.acc.id ? "Finalizing…" : "✓ Finalize"}
                </button>
                <button onClick={() => openReview(item.acc)} style={BTN("#fff", "#6b7280", "1px solid #e5e7eb")}>View</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* COMPLETED */}
      {monthData.completed.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          {sectionTitle("Completed this month", monthData.completed.length, "#f3f4f6", "#6b7280")}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "4px 0" }}>
            {monthData.completed.map(({ acc, s }, i) => (
              <div key={acc.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 16px",
                fontSize: 12, color: "#6b7280",
                borderBottom: i < monthData.completed.length - 1 ? "1px solid #f3f4f6" : "none",
              }}>
                <Check size={14} strokeWidth={2.5} color="#059669" />
                <span style={{ fontWeight: 600, color: "#111827", width: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acc.name}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  reconciled {fmtDate((s.completed_at || "").slice(0, 10))} · {s.total_statement || 0} rows
                  {(s.total_missing || 0) === 0 ? " · all matched" : ` · ${s.total_missing} imported at review`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* WAITING */}
      {monthData.waiting.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          {sectionTitle("Waiting for statement", monthData.waiting.length, "#f3f4f6", "#6b7280")}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8 }}>
            {monthData.waiting.map(({ acc }) => {
              const day = usualDay(acc.id);
              const late = isCurrentMonth && day && now.getDate() > day + 5;
              return (
                <div key={acc.id} style={{
                  display: "flex", alignItems: "center", gap: 9, borderRadius: 11, padding: "9px 12px",
                  border: late ? "1px solid #fde68a" : "1px dashed #e5e7eb",
                  background: late ? "#fffbeb" : "transparent", fontSize: 12, color: "#6b7280",
                }}>
                  {late ? <AlertTriangle size={14} color="#d97706" /> : <Clock size={14} color="#9ca3af" />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "#111827", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acc.name}</div>
                    <div style={{ fontSize: 10.5, color: late ? "#b45309" : "#9ca3af", fontVariantNumeric: "tabular-nums" }}>
                      {late ? `late — usually ~day ${day}` : day ? `usually ~day ${day}` : "no history yet"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PENDING GMAIL QUEUE (manual fallback) */}
      {queue.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>Pending from Gmail</div>
            <div style={{ fontSize: 10, color: "#9ca3af" }}>Auto-detected by Email Sync</div>
          </div>
          {queue.map((item, idx) => {
            const isProc = processing === item.id;
            const acc = item.account_id ? (accounts || []).find(a => a.id === item.account_id) : null;
            const badge = item.status === "extracted"
              ? { label: "Ready", bg: "#dbeafe", color: "#1d4ed8" }
              : item.status === "failed"
                ? { label: "Failed", bg: "#fee2e2", color: "#dc2626" }
                : { label: "Queued", bg: "#f3f4f6", color: "#6b7280" };
            return (
              <div key={item.id} style={{
                padding: "10px 16px", display: "flex", alignItems: "center", gap: 12,
                borderBottom: idx < queue.length - 1 ? "1px solid #f3f4f6" : "none",
              }}>
                <FileText size={16} color="#9ca3af" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.filename || "statement.pdf"}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: badge.bg, color: badge.color }}>{badge.label}</span>
                    {acc && <span style={{ fontSize: 11, color: "#374151" }}>{acc.name}</span>}
                    {item.created_at && <span style={{ fontSize: 11, color: "#9ca3af" }}>{fmtDate(item.created_at.slice(0, 10))}</span>}
                  </div>
                </div>
                <button onClick={() => handleProcess(item)} disabled={isProc}
                  style={BTN(isProc ? "#e5e7eb" : "#dcfce7", isProc ? "#9ca3af" : "#059669")}>
                  {isProc ? "Processing…" : "Process →"}
                </button>
                <button onClick={() => handleDeletePDF(item.id)} title="Remove from queue"
                  style={{ background: "transparent", border: "none", color: "#d1d5db", fontSize: 14, cursor: "pointer", padding: 2, flexShrink: 0 }}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      {/* HOW IT WORKS */}
      <div style={{ padding: "10px 14px", background: "#f9fafb", borderRadius: 10, fontSize: 11, color: "#6b7280", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Eye size={13} color="#9ca3af" />
        Statements are fetched from email every 12 hours, parsed and diffed against your ledger automatically.
        You only review what's flagged — or hit <b style={{ color: "#374151" }}>Finalize</b> when everything already matches.
        Manual upload stays available via the button top-right.
      </div>
    </div>
  );
}
