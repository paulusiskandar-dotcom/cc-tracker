// Reconcile.jsx — Monthly inbox driven by the auto-statement pipeline.
// Statements download + diff themselves (gmail-estatement "prepare");
// this page groups the results per month: Needs review / All matched /
// Completed / Waiting. One-click Finalize for perfect statements.
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { importDrafts } from "../lib/importDrafts";
import { useReconcileDrafts } from "../lib/useReconcileDrafts";
import { processReconcilePDF, matchDetectedAccount } from "../lib/reconcilePdfUpload";
import { matchRows, statementAnchorDate } from "./shared/ReconcileOverlay";
import { reconcileApi, installmentsApi } from "../api";
import { fmtIDR } from "../utils";
import { showToast } from "./shared/index";
import GlobalReconcileButton from "./shared/GlobalReconcileButton";
import {
  ChevronLeft, ChevronRight, CreditCard, Landmark, Clock, Check,
  FileText, Eye, AlertTriangle, X,
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
  ledger = [],
}) {
  const now = new Date();
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [sessions, setSessions] = useState(null);              // local override after actions
  const [finalizing, setFinalizing] = useState(null);          // account id being finalized
  const [valasByAcc, setValasByAcc] = useState({});            // accountId → waiting-valas count
  const [queue, setQueue] = useState([]);
  const [processing, setProcessing] = useState(null);
  const [bukaWaiting, setBukaWaiting] = useState(false);

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

  // Hanya rekening yang MEMANG menerbitkan statement. Sebelumnya seluruh
  // rekening bank aktif ikut dihitung — termasuk dompet kas (JPY Cash, IDR
  // Cash) yang tidak pernah punya statement. Akibatnya penyebut jadi 74 dan
  // "13 selesai" terbaca 18% padahal 13 dari 22 kartu sudah beres, dan
  // daftar Waiting terisi 51 rekening yang tidak menunggu apa pun.
  const activeAccounts = useMemo(() => {
    const pernah = new Set((reconSessions || []).map(x => x.account_id));
    return (accounts || []).filter(a => {
      if (!a.is_active) return false;
      if (a.type === "credit_card") return true;
      if (a.type !== "bank") return false;
      if (a.subtype === "cash" || a.subtype === "pocket") return false;
      if (pernah.has(a.id) || a.last_statement_date) return true;
      // Kantong valas (BCA JPY, Jenius SGD, …) adalah sub-dompet dari rekening
      // induknya dan tidak pernah menerima statement sendiri. Rekening rupiah
      // yang belum pernah direkonsiliasi TETAP dihitung — itu justru pekerjaan
      // yang belum tersentuh, bukan sesuatu yang boleh disembunyikan.
      return (a.currency || "IDR") === "IDR";
    });
  }, [accounts, reconSessions]);

  // Live per-card re-match: the stored session totals (total_match/total_missing/
  // calculated_balance) are PREPARE-TIME snapshots and go stale the moment rows
  // are imported via Email Pending. Recompute against the current ledger so the
  // review cards agree with the live "ready to finalize" strip.
  const liveByAcc = useMemo(() => {
    const out = {};
    for (const d of (drafts || [])) {
      const st = d.state_json;
      if (!st?.stmtRows?.length) continue;
      const led = (ledger || []).filter(l => l.from_id === d.account_id || l.to_id === d.account_id);
      const { matched, missing } = matchRows(st.stmtRows, led);
      const ignored = new Set(st.ignoredIds || []);
      const open = missing.filter(m => !ignored.has(m._id));
      // Uji penutupan yang sama dengan yang dipakai Finalize, dihitung di muka.
      // Tanpa ini kartu bisa berbunyi "gap Rp0 · siap difinalize" lalu ditolak
      // saat tombolnya ditekan — persis yang terjadi pada Jenius dan CIMB ALL.
      const acc = (accounts || []).find(a => a.id === d.account_id);
      let tutup = null;
      if (acc?.type === "credit_card" && st.stmtClosingBalance != null) {
        const cutoff = statementAnchorDate(st.stmtRows, st.stmtStatementDate);
        if (cutoff) {
          const b = new Date(cutoff + "T00:00:00");
          b.setDate(b.getDate() - 3);
          const awal = `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, "0")}-${String(b.getDate()).padStart(2, "0")}`;
          let net = Number(acc.initial_balance || 0), geser = 0;
          for (const r of led) {
            if (r.tx_date > cutoff) continue;
            if (!matched.has(r.id) && r.tx_date >= awal) { geser++; continue; }
            const amt = Number(r.amount_idr || r.amount || 0);
            if (r.from_id === acc.id && r.from_type === "account") net += amt;
            if (r.to_id === acc.id && r.to_type === "account") net -= amt;
          }
          tutup = { buku: net, statement: Number(st.stmtClosingBalance),
                    selisih: Math.round(net - Number(st.stmtClosingBalance)), geser };
        }
      }
      out[d.account_id] = {
        matched: matched.size,
        missing: open.length,
        missingSum: open.reduce((sum, m) => sum + Math.abs(Number(m.amount || 0)), 0),
        tutup,
      };
    }
    return out;
  }, [drafts, ledger, accounts]);

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
      const live = liveByAcc[acc.id] || null;
      // Live re-match wins over the stored prepare-time snapshot; without a
      // draft (nothing left to match) fall back to the stored numbers.
      const missingN = live ? live.missing : (s.total_missing || 0);
      const gap = live
        ? (live.missing > 0 ? Math.round(live.missingSum) : 0)
        : ((s.closing_balance != null && s.calculated_balance != null)
            ? Math.round(Number(s.closing_balance) - Number(s.calculated_balance)) : null);
      const item = { acc, s, gap, live, valas: valasByAcc[acc.id] || 0 };
      const tutupGagal = live?.tutup && Math.abs(live.tutup.selisih) > 2;
      if (missingN > 0 || gap === null || Math.abs(gap) >= 1 || tutupGagal) needsReview.push(item);
      else ready.push(item);
    }
    // gap issues first
    needsReview.sort((a, b) => (Math.abs(b.gap || 0)) - (Math.abs(a.gap || 0)));
    completed.sort((a, b) => new Date(b.s.completed_at || 0) - new Date(a.s.completed_at || 0));
    return { needsReview, ready, completed, waiting };
  }, [allSessions, activeAccounts, month, valasByAcc, liveByAcc]);

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
        .select("id, tx_date, description, merchant_name, amount, amount_idr, from_id, to_id, split_group_id")
        .eq("user_id", user.id)
        .or(`from_id.eq.${acc.id},to_id.eq.${acc.id}`)
        .gte("tx_date", addDays(dates[0], -7)).lte("tx_date", addDays(dates[dates.length - 1], 7));
      if (error) throw error;
      const { matched, missing } = matchRows(st.stmtRows, led || []);
      // Ignored rows (e.g. installment-conversion wash pairs) have no ledger
      // counterpart by design — the live re-match skips them, so finalize must too.
      const ignored = new Set(st.ignoredIds || []);
      const stillMissing = missing.filter(m => !ignored.has(m._id));
      if (stillMissing.length) { showToast(`${stillMissing.length} row(s) no longer match — use Review`, "warning"); return; }

      // ── UJI PENUTUPAN — syarat Finalize (2026-08-28) ────────────────────
      // Nol-hilang belum berarti benar: baris bisa cocok satu-satu tapi salah
      // klasifikasi. Ujian yang menangkap itu: rantai buku harus MENDARAT di
      // penutupan statement, rupiah demi rupiah (toleransi 2 — pembulatan
      // cicilan ala 4.231.333×12). Uji inilah yang menangkap beda 2 rupiah
      // di CIMB ALL saat 12 baris dibuat manual.
      if (acc.type === "credit_card" && st.stmtClosingBalance != null) {
        const cutoff = statementAnchorDate(st.stmtRows, st.stmtStatementDate)
          || dates[dates.length - 1];
        const { data: semua, error: eAll } = await supabase.from("ledger")
          .select("id, tx_date, description, amount_idr, amount, from_id, from_type, to_id, to_type")
          .eq("user_id", user.id)
          .or(`from_id.eq.${acc.id},to_id.eq.${acc.id}`);
        if (eAll) throw eAll;
        // Belanja di hari-hari terakhir siklus sudah ada di buku tapi belum
        // dibukukan bank — ia terbit di statement berikutnya. Baris seperti itu
        // membuat buku lebih tinggi dari penutupan padahal tidak ada yang salah:
        // CIMB ALL 24 Agu tertahan oleh tiga belanja 23–24 Agu (5.940.268), dan
        // Jenius oleh dua belanja 25–26 Agu (285.015). Yang menandainya: baris
        // TIDAK tercocokkan ke statement DAN bertanggal di ujung siklus.
        const SENGGANG_POSTING = 3;
        const batasGeser = new Date(cutoff + "T00:00:00");
        batasGeser.setDate(batasGeser.getDate() - SENGGANG_POSTING);
        const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const awalSenggang = ymd(batasGeser);

        let net = Number(acc.initial_balance || 0);
        const geser = [];
        for (const r of (semua || [])) {
          if (r.tx_date > cutoff) continue;
          const amt = Number(r.amount_idr || r.amount || 0);
          if (!matched.has(r.id) && r.tx_date >= awalSenggang) { geser.push(r); continue; }
          if (r.from_id === acc.id && r.from_type === "account") net += amt;
          if (r.to_id === acc.id && r.to_type === "account") net -= amt;
        }
        const selisih = Math.round(net - Number(st.stmtClosingBalance));
        if (Math.abs(selisih) > 2) {
          showToast(
            `Closing check failed: book ${fmtIDR(net)} vs statement ${fmtIDR(st.stmtClosingBalance)} ` +
            `(off by ${fmtIDR(selisih)}) — a row is on the wrong side, use Review`,
            "error");
          return;
        }
        if (geser.length) {
          showToast(`${geser.length} purchases on ${awalSenggang.slice(5)}–${cutoff.slice(5)} not yet posted — they land on next month\u2019s statement`, "info");
        }
      }

      const nowIso = new Date().toISOString();
      if (matched.size) {
        const { error: e2 } = await supabase.from("ledger")
          .update({ reconciled_at: nowIso }).in("id", [...matched.keys()]).eq("user_id", user.id);
        if (e2) throw e2;
      }
      if (acc.type === "credit_card" && st.stmtClosingBalance != null) {
        await supabase.from("accounts")
          .update({
            last_statement_amount: st.stmtClosingBalance,
            last_statement_date: statementAnchorDate(st.stmtRows, st.stmtStatementDate),
          })
          .eq("id", acc.id).eq("user_id", user.id);
      }
      // Advance installment paid_months from the statement's "… : X/N" markers —
      // same sync ReconcileOverlay runs on full-review exit.
      if (acc.type === "credit_card") {
        try {
          const synced = await installmentsApi.syncFromStatementRows(user.id, acc.id, st.stmtRows);
          if (synced) showToast(`${synced} cicilan disinkron dari statement`);
        } catch (e2) { console.error("[finalize] installment sync error:", e2); }
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

  const nTelat = monthData.waiting.filter(({ acc }) => {
    const day = usualDay(acc.id);
    return isCurrentMonth && day && now.getDate() > day + 5;
  }).length;

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
            {/* Sisa bilah = yang statement-nya belum datang. Tanpa segmen ini
                bilahnya tidak pernah penuh dan terlihat seperti tertinggal. */}
            <span style={{ width: pct(monthData.waiting.length), background: "#e5e7eb" }} />
          </div>
        </div>
      </div>
      {/* Keterangan yang nilainya nol tidak menjelaskan apa pun dan cuma
          memanjangkan baris — hanya yang terisi yang ditampilkan. */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: "#6b7280", marginBottom: 20 }}>
        {[["Completed", nDone, "#059669"], ["Ready to finalize", nReady, "#34d399"],
          ["Needs review", nReview, "#d97706"], ["Waiting", monthData.waiting.length, "#e5e7eb"]]
          .filter(([, n]) => n > 0)
          .map(([label, n, warna]) => (
            <span key={label}>
              <i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: warna, marginRight: 5 }} />
              {label} {n}
            </span>
          ))}
      </div>

      {/* NEEDS REVIEW */}
      {monthData.needsReview.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          {sectionTitle("Needs review", monthData.needsReview.length, "#fef3c7", "#b45309")}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {monthData.needsReview.map(({ acc, s, gap, valas, live }) => (
              <div key={acc.id} style={{
                background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14,
                borderLeft: `3px solid ${gap !== null && Math.abs(gap) >= 1 ? "#dc2626" : "#d97706"}`,
                padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
              }}>
                <AccountTile type={acc.type} />
                <div style={{ width: 150, flexShrink: 0, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acc.name}</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1, whiteSpace: "nowrap" }}>
                    Statement {fmtDate(s.statement_date || s.period_end)}
                  </div>
                </div>
                {/* Kolom nominal berlebar tetap supaya angka antar-kartu sejajar,
                    bukan mengalir di tengah kalimat dengan panjang berbeda-beda. */}
                <div style={{ width: "14ch", flexShrink: 0, textAlign: "right", fontVariantNumeric: "tabular-nums",
                              fontSize: 12, fontWeight: 700, color: "#111827", whiteSpace: "nowrap" }}>
                  {s.closing_balance != null ? fmtIDR(s.closing_balance) : "—"}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={CHIP("#dcfce7", "#059669")}><Check size={11} strokeWidth={2.5} />{(live ? live.matched : s.total_match) || 0} matched</span>
                  {((live ? live.missing : s.total_missing) || 0) > 0 && <span style={CHIP("#fef3c7", "#b45309")}>{live ? live.missing : s.total_missing} not in ledger</span>}
                  {gap !== null && Math.abs(gap) >= 1 && <span style={CHIP("#fee2e2", "#dc2626")}>gap {fmtIDR(Math.abs(gap))}</span>}
                  {gap !== null && Math.abs(gap) < 1 && !(live?.tutup && Math.abs(live.tutup.selisih) > 2) &&
                    <span style={CHIP("#f3f4f6", "#6b7280")}>closing matches</span>}
                  {live?.tutup && Math.abs(live.tutup.selisih) > 2 && (
                    <span style={CHIP("#fee2e2", "#dc2626")}>
                      book {fmtIDR(live.tutup.buku)} vs statement {fmtIDR(live.tutup.statement)}
                    </span>
                  )}
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
                padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
              }}>
                <AccountTile type={item.acc.type} />
                <div style={{ width: 150, flexShrink: 0, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.acc.name}</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1, whiteSpace: "nowrap" }}>
                    Statement {fmtDate(item.s.statement_date || item.s.period_end)}
                  </div>
                </div>
                <div style={{ width: "14ch", flexShrink: 0, textAlign: "right", fontVariantNumeric: "tabular-nums",
                              fontSize: 12, fontWeight: 700, color: "#111827", whiteSpace: "nowrap" }}>
                  {item.s.closing_balance != null ? fmtIDR(item.s.closing_balance) : "—"}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={CHIP("#dcfce7", "#059669")}>
                    <Check size={11} strokeWidth={2.5} />
                    {(item.live ? item.live.matched : item.s.total_match) || 0} matched · closing OK
                  </span>
                  {item.live?.tutup?.geser > 0 && (
                    <span style={CHIP("#f3f4f6", "#6b7280")}>{item.live.tutup.geser} not yet posted</span>
                  )}
                </div>
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
          {/* Kolom tetap, bukan satu kalimat panjang: tanggal, jumlah baris, dan
              nilai penutupan berdiri di kolomnya masing-masing supaya bisa
              dibandingkan antar-baris dengan sekali lihat. Kata "reconciled"
              dibuang — seluruh bagian ini memang sudah reconciled. */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "4px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 16px 8px",
                          fontSize: 9.5, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.4px",
                          borderBottom: "1px solid #f3f4f6" }}>
              <span style={{ width: 14, flexShrink: 0 }} />
              <span style={{ width: 160, flexShrink: 0 }}>Account</span>
              <span style={{ width: "6ch", flexShrink: 0 }}>Done</span>
              <span style={{ width: "5ch", flexShrink: 0, textAlign: "right" }}>Rows</span>
              <span style={{ width: "14ch", flexShrink: 0, textAlign: "right" }}>Closing</span>
              <span style={{ flex: 1, minWidth: 0 }} />
            </div>
            {monthData.completed.map(({ acc, s }, i) => (
              <div key={acc.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 16px",
                fontSize: 12, color: "#6b7280", fontVariantNumeric: "tabular-nums",
                borderBottom: i < monthData.completed.length - 1 ? "1px solid #f3f4f6" : "none",
              }}>
                <Check size={14} strokeWidth={2.5} color="#059669" style={{ flexShrink: 0 }} />
                <span style={{ fontWeight: 600, color: "#111827", width: 160, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acc.name}</span>
                <span style={{ width: "6ch", flexShrink: 0, whiteSpace: "nowrap" }}>{fmtDate((s.completed_at || "").slice(0, 10))}</span>
                <span style={{ width: "5ch", flexShrink: 0, textAlign: "right" }}>{s.total_statement || 0}</span>
                <span style={{ width: "14ch", flexShrink: 0, textAlign: "right", color: "#111827", fontWeight: 600 }}>
                  {s.closing_balance != null ? fmtIDR(s.closing_balance) : "—"}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {(s.total_missing || 0) > 0 && (
                    <span style={CHIP("#eff6ff", "#1d4ed8")}>{s.total_missing} added here</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* WAITING */}
      {monthData.waiting.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          {sectionTitle("Waiting for statement", monthData.waiting.length, "#f3f4f6", "#6b7280",
            <>
              {!bukaWaiting && nTelat > 0 && (
                <span style={{ fontSize: 11, color: "#9ca3af" }}>showing {nTelat} past their usual day</span>
              )}
              <button onClick={() => setBukaWaiting(v => !v)} style={BTN("#fff", "#6b7280", "1px solid #e5e7eb")}>
                {bukaWaiting ? "Hide" : "Show all"}
              </button>
            </>)}
          {/* Diciutkan secara bawaan: ini daftar terpanjang di halaman dan tidak
              ada yang bisa dikerjakan di sini. Yang sudah lewat tanggal biasanya
              TETAP tampil — itu satu-satunya bagian yang perlu ditindaklanjuti. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8 }}>
            {monthData.waiting.map(({ acc }) => {
              const day = usualDay(acc.id);
              const late = isCurrentMonth && day && now.getDate() > day + 5;
              if (!late && !bukaWaiting) return null;
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
                  style={{ background: "transparent", border: "none", color: "#d1d5db", cursor: "pointer", padding: 2, flexShrink: 0, display: "inline-flex", alignItems: "center" }}><X size={14} /></button>
              </div>
            );
          })}
        </div>
      )}

      {/* HOW IT WORKS */}
      <div style={{ padding: "10px 14px", background: "#f9fafb", borderRadius: 10, fontSize: 11, color: "#6b7280", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Eye size={13} color="#9ca3af" />
        Statements arrive from email every 12 hours and diff themselves. Review what is flagged, or
        <b style={{ color: "#374151" }}> Finalize</b> when it already matches.
      </div>
    </div>
  );
}
