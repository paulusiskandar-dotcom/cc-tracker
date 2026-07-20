// ReconcileReview — statement-centric review screen for reconcile mode.
// Replaces the four stacked banners + ledger-table overlay in Bank/CC statement:
// one status strip, statement-side tiles, a "Needs action" work queue, a dense
// matched list, and a sticky footer whose Finalize unlocks at 0 pending rows.
// Mockup (approved 2026-07-15): claude.ai/code/artifact/900e6ccb-c823-4b32-9d66-e910c82bc744
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { ledgerApi } from "../../api";
import { fmtIDR } from "../../utils";
import { TX_TYPE_MAP } from "../../constants";
import { ReconcileAddPanel } from "./ReconcileOverlay";
import { showToast } from "./index";
import ReconcileSummaryModal from "./ReconcileSummaryModal";
import PDFViewer from "./PDFViewer";
import {
  CreditCard, Landmark, FileText, Check, Info, AlertTriangle, Undo2,
  Pencil, Trash2, ChevronDown, ChevronRight,
} from "lucide-react";

const FF = "Figtree, sans-serif";
const NUM = { fontVariantNumeric: "tabular-nums" };

const fmtD = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
  catch { return d || "—"; }
};

const CHIP = (bg, color) => ({
  fontSize: 11, fontWeight: 700, padding: "3.5px 11px", borderRadius: 99,
  background: bg, color, display: "inline-flex", alignItems: "center", gap: 5,
  whiteSpace: "nowrap", fontFamily: FF, ...NUM,
});
const BTN = (bg, color, border = "1px solid transparent") => ({
  fontSize: 12, fontWeight: 700, borderRadius: 9, padding: "8px 16px",
  border, background: bg, color, cursor: "pointer", fontFamily: FF,
});

export default function ReconcileReview({
  reconcile, account, accounts, accountChoices = [],
  categories = [], incomeSrcs = [], employeeLoans = [],
  user, ledgerRows = [], ledgerClosingBalance = null,
  onRefresh, onClearDraft, onSaveAll, savingAll = false,
  showPdfPanel = false, onTogglePdfPanel, onChangeAccount, onEditRow,
}) {
  const [showSummary, setShowSummary] = useState(false);
  const [pickAccount, setPickAccount] = useState(false);
  const [fxWaiting, setFxWaiting]     = useState(0);
  const [acctLedger, setAcctLedger]   = useState(null); // full recent ledger for THIS account
  const [showAllLedger, setShowAllLedger] = useState(true);
  const [deletingId, setDeletingId]   = useState(null);

  const { stmtRows, stats, matched, missing, extraIds, keptIds, pendingRows } = reconcile;
  const isCC = account?.type === "credit_card";

  // Period from the statement's own rows (the review is locked to it)
  const { period, stmtStart, stmtEnd } = useMemo(() => {
    const ds = (stmtRows || []).map(r => r.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d || "")).sort();
    if (!ds.length) return { period: "—", stmtStart: null, stmtEnd: null };
    return {
      period: `${fmtD(ds[0])} – ${fmtD(ds[ds.length - 1])} ${ds[ds.length - 1].slice(0, 4)}`,
      stmtStart: ds[0], stmtEnd: ds[ds.length - 1],
    };
  }, [stmtRows]);

  // Statement-side totals (statement = final source; never the ledger window)
  const sums = useMemo(() => {
    let out = 0, inn = 0, nOut = 0, nIn = 0;
    for (const r of stmtRows || []) {
      const a = Math.abs(Number(r.amount || 0));
      if (r.direction === "in") { inn += a; nIn++; } else { out += a; nOut++; }
    }
    return { out, inn, nOut, nIn };
  }, [stmtRows]);

  const stmtClosing  = reconcile.stmtClosingBalance;
  const stmtOpening  = reconcile.stmtOpeningBalance;

  // Ledger balance AT THE STATEMENT'S CLOSING DATE. Derived from the account's
  // AUTHORITATIVE stored balance (outstanding for CC, current_balance for bank —
  // both kept accurate by recalculateBalance), then rolled back over any rows
  // dated after the statement closed. This is window-independent: it doesn't
  // matter whether the page loaded a wide or narrow ledger window, so a fee on
  // the exact closing day (e.g. materai on the 17th) can't produce a phantom gap.
  // Falls back to the page's window-based closing until acctLedger has loaded.
  const ledgerAtEnd = useMemo(() => {
    const nowBal = isCC ? Number(account?.outstanding_amount || 0) : Number(account?.current_balance || 0);
    if (acctLedger == null || !stmtEnd || !account?.id) return ledgerClosingBalance;
    let adj = 0; // net effect to remove from "now": post-statement rows + rows the user Kept
    for (const l of acctLedger) {
      const isAfter = l.tx_date && l.tx_date > stmtEnd;
      const isKept  = keptIds?.has?.(l.id);   // "Keep" = legit but not part of THIS statement (next cycle) → exclude
      if (!isAfter && !isKept) continue;
      const a = Math.abs(Number(l.amount_idr || 0));
      const isOut = l.from_id === account.id && l.from_type === "account"; // charge (CC) / debit (bank)
      const isIn  = l.to_id   === account.id && l.to_type   === "account"; // payment (CC) / credit (bank)
      if (isCC) { if (isOut) adj += a; if (isIn) adj -= a; }
      else      { if (isIn)  adj += a; if (isOut) adj -= a; }
    }
    return nowBal - adj;
  }, [isCC, account?.id, account?.outstanding_amount, account?.current_balance, acctLedger, stmtEnd, keptIds, ledgerClosingBalance]);

  const gap = (stmtClosing != null && ledgerAtEnd != null)
    ? Math.round(stmtClosing - ledgerAtEnd) : null;
  const missingSum = useMemo(
    () => (missing || []).reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0),
    [missing]);
  // The friendliest case: importing the missing rows closes the gap exactly
  const gapIsMissing = gap != null && missing?.length > 0 &&
    Math.abs(Math.abs(gap) - missingSum) < 1;

  // Parked FX items that this statement's import will auto-clear
  useEffect(() => {
    if (!user?.id || !account?.id) return;
    supabase.from("email_sync").select("ai_raw_result").eq("user_id", user.id).eq("status", "waiting_statement")
      .then(({ data }) => {
        let n = 0;
        for (const r of data || []) {
          let arr = r.ai_raw_result; try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { arr = null; }
          for (const t of (Array.isArray(arr) ? arr : [])) {
            if (t && t._waiting_statement && !t._imported && !t._skipped && t.from_account_id === account.id) n++;
          }
        }
        setFxWaiting(n);
      });
  }, [user?.id, account?.id]);

  // Full recent ledger for THIS account — independent of the reconcile match
  // window, so activity outside the statement's dates (e.g. a charge weeks
  // before a 1-row "previous balance" statement) is always visible & editable.
  const fetchAcctLedger = useCallback(() => {
    if (!user?.id || !account?.id) return;
    const anchor = stmtStart || new Date().toISOString().slice(0, 10);
    const from = (() => { const t = new Date(anchor + "T00:00:00"); t.setDate(t.getDate() - 75); return t.toISOString().slice(0, 10); })();
    supabase.from("ledger")
      .select("id, tx_date, tx_type, description, merchant_name, amount, amount_idr, currency, category_name, entity, from_id, from_type, to_id, to_type, reconciled_at, fx_rate_used")
      .eq("user_id", user.id)
      .or(`from_id.eq.${account.id},to_id.eq.${account.id}`)
      .gte("tx_date", from)
      .order("tx_date", { ascending: false })
      .then(({ data }) => setAcctLedger(data || []));
  // ledgerClosingBalance shifts whenever the account's ledger changes (edit via
  // modal, add, delete) → refetch so this panel stays in sync.
  }, [user?.id, account?.id, stmtStart, ledgerClosingBalance]);
  useEffect(() => { fetchAcctLedger(); }, [fetchAcctLedger]);

  const deleteRow = async (row) => {
    if (deletingId) return;
    if (!window.confirm(`Hapus transaksi ini dari ledger?\n\n${row.description || row.merchant_name || "—"} · ${fmtIDR(Math.abs(Number(row.amount_idr || 0)))}\n\nSaldo akun akan dihitung ulang. Tidak bisa di-undo dari sini.`)) return;
    setDeletingId(row.id);
    try {
      await ledgerApi.delete(row.id, row, accounts);
      showToast("Transaksi dihapus");
      fetchAcctLedger();
      onRefresh?.();
    } catch (e) { showToast("Gagal hapus: " + e.message, "error"); }
    setDeletingId(null);
  };

  // Matched list: ledgerId → { ledger row, stmt row }
  const matchedList = useMemo(() => {
    const byId = new Map((ledgerRows || []).map(l => [l.id, l]));
    const list = [];
    for (const [lid, s] of matched?.entries?.() || []) {
      const l = byId.get(lid);
      if (l) list.push({ l, s });
    }
    list.sort((a, b) => (a.l.tx_date || "") < (b.l.tx_date || "") ? -1 : 1);
    return list;
  }, [matched, ledgerRows]);

  // Extra: in ledger, not on the statement — only WITHIN the statement period.
  // The ledger is loaded with a ±7d pad so boundary rows can still match; rows
  // outside the period that didn't match are just neighbours, not discrepancies.
  const extraList = useMemo(() => {
    const byId = new Map((ledgerRows || []).map(l => [l.id, l]));
    return [...(extraIds || [])].filter(id => !keptIds?.has(id)).map(id => byId.get(id))
      .filter(l => l && (!stmtStart || (l.tx_date >= stmtStart && l.tx_date <= stmtEnd)))
      .sort((a, b) => (a.tx_date || "") < (b.tx_date || "") ? -1 : 1);
  }, [extraIds, keptIds, ledgerRows, stmtStart, stmtEnd]);

  const nAction = (missing?.length || 0);
  // Save-all counts only drafts whose statement row is STILL missing — a
  // restored draft can carry entries for rows that have since matched.
  const pendingCount = useMemo(() => {
    const ids = new Set((missing || []).map(r => r._id));
    return Object.keys(pendingRows || {}).filter(k => ids.has(k)).length;
  }, [missing, pendingRows]);
  const total   = stmtRows?.length || 1;
  const pctGood = ((stats?.match || 0) / total) * 100;
  const pctWarn = (nAction / total) * 100;
  const accName = (id) => (accounts || []).find(a => a.id === id)?.name || null;

  const Tile = ({ label, value, sub, highlight, good }) => (
    <div style={{
      background: highlight ? "#fffdf6" : "#fff", borderRadius: 13, padding: "12px 14px",
      border: `1px solid ${highlight ? "#f2ddb0" : "#e5e7eb"}`, flex: "1 1 160px", minWidth: 150,
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: "#9ca3af", fontFamily: FF }}>{label}</div>
      <div style={{ fontSize: 16.5, fontWeight: 800, marginTop: 5, color: good ? "#059669" : "#111827", fontFamily: FF, ...NUM }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, marginTop: 3, color: highlight ? "#b45309" : "#9ca3af", fontWeight: highlight ? 650 : 400, fontFamily: FF, ...NUM }}>{sub}</div>}
    </div>
  );

  const AccIcon = isCC ? CreditCard : Landmark;

  const content = (
    <div style={{ display: "flex", flexDirection: "column", fontFamily: FF }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap", paddingBottom: 16 }}>
        <span style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          background: isCC ? "#fde8e8" : "#dbeafe", color: isCC ? "#dc2626" : "#3b5bdb",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}><AccIcon size={19} strokeWidth={2} /></span>
        <div style={{ minWidth: 200 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#111827", letterSpacing: "-.01em" }}>
            Reconcile — {account?.name}
            {account?.card_last4 && <span style={{ color: "#9ca3af", fontWeight: 600 }}> ·· {account.card_last4}</span>}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...NUM }}>
            {period}
            {reconcile.pdfSource && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, background: "#f3f4f6", border: "1px solid #e5e7eb", padding: "2.5px 9px", borderRadius: 99, maxWidth: 320, overflow: "hidden" }}>
                <FileText size={11} style={{ flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reconcile.pdfSource}</span>
              </span>
            )}
            {onChangeAccount && !pickAccount && (
              <button onClick={() => setPickAccount(true)}
                style={{ fontSize: 11, color: "#3b5bdb", fontWeight: 650, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: FF }}>
                Wrong account?
              </button>
            )}
            {pickAccount && (
              <select autoFocus value={account?.id || ""}
                onChange={e => { setPickAccount(false); if (e.target.value && e.target.value !== account?.id) onChangeAccount(e.target.value); }}
                onBlur={() => setPickAccount(false)}
                style={{ fontSize: 11.5, padding: "4px 8px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontFamily: FF }}>
                {(accountChoices.length ? accountChoices : accounts).map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {reconcile.pdfBlobUrl && onTogglePdfPanel && (
            <button onClick={onTogglePdfPanel} style={BTN("#fff", "#6b7280", "1px solid #e5e7eb")}>
              {showPdfPanel ? "Hide PDF" : "View PDF"}
            </button>
          )}
          <button
            onClick={() => nAction === 0 && setShowSummary(true)}
            disabled={nAction > 0}
            title={nAction > 0 ? `${nAction} row(s) still need action` : "Complete this reconcile"}
            style={{ ...BTN(nAction > 0 ? "#c9ced6" : "#111827", "#fff"), cursor: nAction > 0 ? "default" : "pointer" }}>
            Finalize
          </button>
        </div>
      </div>

      {/* ── Status strip ── */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 220 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6b7280", marginBottom: 6, ...NUM }}>
            <span>Reconcile progress</span>
            <span><b>{stats?.match || 0}</b>/{stmtRows?.length || 0} rows</span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: "#f3f4f6", overflow: "hidden", display: "flex" }}>
            <span style={{ width: `${pctGood}%`, background: "#059669" }} />
            <span style={{ width: `${pctWarn}%`, background: "#eab308" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <span style={CHIP("#e7f6ef", "#059669")}><Check size={11} strokeWidth={3} />{stats?.match || 0} matched</span>
          {nAction > 0 && <span style={CHIP("#fdf3d7", "#b45309")}>{nAction} not in ledger</span>}
          <span style={CHIP("#f3f4f6", "#6b7280")}>{extraList.length} extra in ledger</span>
          {fxWaiting > 0 && <span style={CHIP("#efeafb", "#6d28d9")}>{fxWaiting} FX waiting resolves here</span>}
        </div>
        {gap != null && Math.abs(gap) >= 1 && (
          <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#b45309", borderTop: "1px dashed #e5e7eb", paddingTop: 11, marginTop: 2, flexWrap: "wrap", ...NUM }}>
            <AlertTriangle size={13} strokeWidth={2.2} style={{ flexShrink: 0 }} />
            <span>
              Closing gap <b style={{ fontWeight: 800 }}>{fmtIDR(Math.abs(gap))}</b>
              {gapIsMissing
                ? <> = exactly the {nAction} row{nAction > 1 ? "s" : ""} below — import them and the gap closes to <b style={{ color: "#059669", fontWeight: 800 }}>Rp 0</b></>
                : nAction > 0
                  ? <> · {nAction} missing row{nAction > 1 ? "s" : ""} total {fmtIDR(missingSum)}</>
                  : <> · no missing rows — check the Extra section or earlier periods</>}
            </span>
          </div>
        )}
        {gap != null && Math.abs(gap) < 1 && (
          <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#059669", borderTop: "1px dashed #e5e7eb", paddingTop: 11, marginTop: 2, ...NUM }}>
            <Check size={13} strokeWidth={2.6} />
            Closing balance matches the ledger — {fmtIDR(stmtClosing)}
          </div>
        )}
      </div>

      {/* ── Statement tiles ── */}
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <Tile label="Statement opening" value={stmtOpening != null ? fmtIDR(stmtOpening) : "—"} sub={stmtOpening != null ? "from statement" : "not on statement"} />
        <Tile label={isCC ? "New charges" : "Money out"} value={fmtIDR(sums.out)} sub={`${sums.nOut} transaction${sums.nOut !== 1 ? "s" : ""}`} />
        <Tile label={isCC ? "Payments & credits" : "Money in"} value={fmtIDR(sums.inn)} sub={`${sums.nIn} transaction${sums.nIn !== 1 ? "s" : ""}`} good />
        <Tile label="Statement closing" highlight
          value={stmtClosing != null ? fmtIDR(stmtClosing) : "—"}
          sub={stmtClosing != null && ledgerAtEnd != null
            ? (Math.abs(gap) < 1 ? "Ledger matches" : `Ledger: ${fmtIDR(ledgerAtEnd)} · gap ${fmtIDR(Math.abs(gap))}`)
            : null} />
      </div>

      {/* ── Needs action ── */}
      {nAction > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "24px 2px 10px" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Needs action</span>
            <span style={{ fontSize: 11, fontWeight: 800, background: "#fdf3d7", color: "#b45309", padding: "2px 9px", borderRadius: 99, ...NUM }}>{nAction}</span>
            <span style={{ fontSize: 11.5, color: "#9ca3af", marginLeft: "auto" }}>Every row here keeps Finalize locked</span>
          </div>
          {(missing || []).map(row => {
            const expanded = reconcile.expandedIds.has(row._id);
            const dup = row._dupEntry;
            const dupAcc = dup ? (accName(dup.from_id) || accName(dup.to_id)) : null;
            return (
              <div key={row._id} style={{ background: "#fff", border: "1px solid #f2ddb0", borderLeft: "3px solid #eab308", borderRadius: 13, marginBottom: 9, overflow: "hidden" }}>
                <div style={{ padding: "13px 16px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", ...NUM }}>
                    <span style={{ fontSize: 11, color: "#6b7280", width: 52, flexShrink: 0 }}>{fmtD(row.date)}</span>
                    <span style={{ fontSize: 13, fontWeight: 650, color: "#111827", minWidth: 0, flex: 1 }}>{row.description || row.merchant || "—"}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 800, color: row.direction === "in" ? "#059669" : "#dc2626" }}>
                      {row.direction === "in" ? "+ " : ""}{fmtIDR(Math.abs(Number(row.amount || 0)))}
                    </span>
                  </div>
                  {dup && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 650, color: "#6d28d9", background: "#efeafb", padding: "2px 9px", borderRadius: 99, marginTop: 7, ...NUM }}>
                      <Info size={10} strokeWidth={2.4} />
                      Same amount {dupAcc ? `on ${dupAcc}` : "in ledger"} · {fmtD(dup.tx_date)} — check before adding
                    </span>
                  )}
                  <div style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 11, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11.5, color: "#9ca3af" }}>
                      {expanded ? "Set the details below, then confirm" : "Category & account pre-filled from your rules"}
                    </span>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
                      <button onClick={() => reconcile.toggleExpanded(row._id)}
                        style={{ fontSize: 11.5, fontWeight: 700, padding: "7px 14px", borderRadius: 8, border: "none", background: expanded ? "#e5e7eb" : "#059669", color: expanded ? "#374151" : "#fff", cursor: "pointer", fontFamily: FF }}>
                        {expanded ? "Close" : "Add to ledger"}
                      </button>
                      <button onClick={() => reconcile.markIgnored(row._id)}
                        style={{ fontSize: 11.5, fontWeight: 700, padding: "7px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer", fontFamily: FF }}>
                        Ignore
                      </button>
                    </div>
                  </div>
                </div>
                {expanded && (
                  <ReconcileAddPanel
                    stmtRow={row}
                    reconcile={reconcile}
                    accounts={accounts}
                    employeeLoans={employeeLoans}
                    user={user}
                    categories={categories}
                    incomeSrcs={incomeSrcs}
                    onRefresh={onRefresh}
                    onClose={() => reconcile.toggleExpanded(row._id)}
                  />
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ── Extra in ledger ── */}
      {extraList.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "24px 2px 10px" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>In ledger, not on statement</span>
            <span style={{ fontSize: 11, fontWeight: 800, background: "#fdecec", color: "#dc2626", padding: "2px 9px", borderRadius: 99, ...NUM }}>{extraList.length}</span>
            <span style={{ fontSize: 11.5, color: "#9ca3af", marginLeft: "auto" }}>Already recorded — Keep confirms it's fine (missed by the parser, or booked next cycle)</span>
          </div>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 13, overflow: "hidden" }}>
            {extraList.map((l, i) => {
              // Already-recorded ledger rows — show what they already are so it's
              // clear Keep doesn't need to ask for a type/category again.
              const ctx = [TX_TYPE_MAP[l.tx_type]?.label || l.tx_type, l.category_name].filter(Boolean).join(" · ");
              return (
                <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8.5px 16px", borderBottom: i < extraList.length - 1 ? "1px solid #f3f4f6" : "none", fontSize: 12.5, ...NUM }}>
                  <span style={{ fontSize: 11, color: "#9ca3af", width: 52, flexShrink: 0 }}>{fmtD(l.tx_date)}</span>
                  <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#111827" }}>
                    {l.description || l.merchant_name || "—"}
                    {ctx && (
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: "#6b7280", background: "#f3f4f6", borderRadius: 5, padding: "1px 6px", marginLeft: 7 }}>{ctx}</span>
                    )}
                  </span>
                  <span style={{ fontWeight: 650, color: l._dir === "credit" ? "#059669" : "#111827" }}>
                    {l._dir === "credit" ? "+ " : ""}{fmtIDR(Math.abs(Number(l.amount_idr || 0)))}
                  </span>
                  <button onClick={() => reconcile.markKept(l.id)} title="Already recorded with the type shown — Keep just confirms it's not a discrepancy"
                    style={{ fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 7, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer", fontFamily: FF }}>
                    Keep
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Matched ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "24px 2px 10px" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Matched</span>
        <span style={{ fontSize: 11, fontWeight: 800, background: "#e7f6ef", color: "#059669", padding: "2px 9px", borderRadius: 99, ...NUM }}>{matchedList.length}</span>
        <span style={{ fontSize: 11.5, color: "#9ca3af", marginLeft: "auto" }}>Statement ↔ ledger, auto-paired</span>
      </div>
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 13, overflow: "hidden" }}>
        {matchedList.length === 0 && (
          <div style={{ padding: "18px 16px", fontSize: 12, color: "#9ca3af", textAlign: "center" }}>No matched rows yet.</div>
        )}
        {matchedList.map(({ l, s }, i) => {
          const dirIn = l._dir === "credit" || s?.direction === "in";
          const ctx = l.category_name || TX_TYPE_MAP[l.tx_type]?.label || "";
          return (
            <div key={l.id}
              onMouseEnter={e => { const b = e.currentTarget.querySelector(".unm"); if (b) b.style.opacity = "1"; }}
              onMouseLeave={e => { const b = e.currentTarget.querySelector(".unm"); if (b) b.style.opacity = "0"; }}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8.5px 16px", borderBottom: i < matchedList.length - 1 ? "1px solid #f3f4f6" : "none", fontSize: 12.5, ...NUM }}>
              <span style={{ fontSize: 11, color: "#9ca3af", width: 52, flexShrink: 0 }}>{fmtD(l.tx_date)}</span>
              <span style={{ width: 15, height: 15, borderRadius: 99, background: "#e7f6ef", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Check size={9} strokeWidth={3.4} color="#059669" />
              </span>
              <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#111827" }}>
                {l.description || l.merchant_name || "—"}
                {l.entity && l.entity !== "Personal" && (
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: "#6b7280", background: "#f3f4f6", borderRadius: 5, padding: "1px 6px", marginLeft: 7 }}>{l.entity}</span>
                )}
              </span>
              <span style={{ fontWeight: 650, color: dirIn ? "#059669" : "#111827", whiteSpace: "nowrap" }}>
                {dirIn ? "+ " : ""}{fmtIDR(Math.abs(Number(l.amount_idr || 0)))}
              </span>
              <span style={{ fontSize: 10.5, color: "#6b7280", width: 110, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>{ctx}</span>
              <button className="unm" onClick={() => reconcile.unmatchLedgerRow(l.id)} title="Unmatch this pair"
                style={{ opacity: 0, transition: "opacity .15s", width: 24, height: 24, borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", color: "#9ca3af", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Undo2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {/* ── All transactions on this account (manage: edit / delete) ── */}
      {(() => {
        const rows = acctLedger || [];
        const inStmt = (d) => stmtStart && d >= stmtStart && d <= stmtEnd;
        const matchedIds = new Set([...(matched?.keys?.() || [])]);
        return (
          <div style={{ marginTop: 24 }}>
            <button onClick={() => setShowAllLedger(v => !v)}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: "0 2px 10px", cursor: "pointer", fontFamily: FF }}>
              {showAllLedger ? <ChevronDown size={15} color="#6b7280" /> : <ChevronRight size={15} color="#6b7280" />}
              <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>All transactions on {account?.name}</span>
              <span style={{ fontSize: 11, fontWeight: 800, background: "#f3f4f6", color: "#6b7280", padding: "2px 9px", borderRadius: 99, ...NUM }}>{rows.length}</span>
              <span style={{ fontSize: 11.5, color: "#9ca3af", marginLeft: "auto" }}>
                {acctLedger == null ? "loading…" : "see & remove anything already in the ledger"}
              </span>
            </button>
            {showAllLedger && (
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 13, overflow: "hidden" }}>
                {rows.length === 0 && (
                  <div style={{ padding: "18px 16px", fontSize: 12, color: "#9ca3af", textAlign: "center" }}>No transactions on this account.</div>
                )}
                {rows.map((l, i) => {
                  const dirIn = l.to_id === account?.id && l.to_type === "account";
                  const ctx = l.category_name || TX_TYPE_MAP[l.tx_type]?.label || l.tx_type;
                  return (
                    <div key={l.id}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8.5px 16px", borderBottom: i < rows.length - 1 ? "1px solid #f3f4f6" : "none", fontSize: 12.5, background: inStmt(l.tx_date) ? "#fbfdff" : "#fff", ...NUM }}>
                      <span style={{ fontSize: 11, color: "#9ca3af", width: 52, flexShrink: 0 }}>{fmtD(l.tx_date)}</span>
                      <span style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#111827" }}>{l.description || l.merchant_name || "—"}</span>
                        <span style={{ fontSize: 10, color: "#9ca3af" }}>
                          {ctx}
                          {matchedIds.has(l.id) && <span style={{ color: "#059669", fontWeight: 700 }}> · ✓ matched</span>}
                          {l.reconciled_at && <span style={{ color: "#6b7280" }}> · reconciled</span>}
                          {!inStmt(l.tx_date) && <span style={{ color: "#b45309" }}> · outside statement period</span>}
                        </span>
                      </span>
                      <span style={{ fontWeight: 650, color: dirIn ? "#059669" : "#111827", whiteSpace: "nowrap" }}>
                        {dirIn ? "+ " : ""}{fmtIDR(Math.abs(Number(l.amount_idr || 0)))}
                      </span>
                      {onEditRow && (
                        <button onClick={() => onEditRow(l)} title="Edit transaction"
                          style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Pencil size={12} />
                        </button>
                      )}
                      <button onClick={() => deleteRow(l)} disabled={deletingId === l.id} title="Delete transaction"
                        style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #fbd5d5", background: "#fff", color: "#dc2626", cursor: deletingId === l.id ? "default" : "pointer", opacity: deletingId === l.id ? 0.5 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Sticky footer ── */}
      <div style={{
        position: "sticky", bottom: 0, marginTop: 22, background: "#fff",
        borderTop: "1px solid #e5e7eb", borderRadius: "13px 13px 0 0", padding: "13px 18px",
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", zIndex: 5,
        boxShadow: "0 -8px 24px -18px rgba(17,24,39,.35)",
      }}>
        <div style={{ flex: "1 1 200px", minWidth: 170 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6b7280", marginBottom: 5, ...NUM }}>
            <span>{nAction > 0 ? <><b style={{ color: "#111827" }}>{nAction} row{nAction > 1 ? "s" : ""}</b> left to resolve</> : <b style={{ color: "#059669" }}>All rows resolved</b>}</span>
            <span>{Math.round(pctGood)}%</span>
          </div>
          <div style={{ height: 7, borderRadius: 99, background: "#f3f4f6", overflow: "hidden", display: "flex" }}>
            <span style={{ width: `${pctGood}%`, background: "#059669" }} />
            <span style={{ width: `${pctWarn}%`, background: "#eab308" }} />
          </div>
        </div>
        {isCC && stmtClosing != null && (
          <span style={{ fontSize: 12, color: "#6b7280", ...NUM }}>
            On finalize: card anchored to <b style={{ color: "#111827" }}>{fmtIDR(stmtClosing)}</b>
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {nAction > 0 && (
            <button onClick={() => (missing || []).forEach(r => reconcile.markIgnored(r._id))}
              style={BTN("#fff", "#b45309", "1px solid #f2ddb0")}>
              Ignore remaining ({nAction})
            </button>
          )}
          {pendingCount > 0 && onSaveAll && (
            <button onClick={onSaveAll} disabled={savingAll} style={BTN("#3b5bdb", "#fff")}>
              {savingAll ? "Saving…" : `Save all (${pendingCount})`}
            </button>
          )}
          <button
            onClick={() => nAction === 0 && setShowSummary(true)}
            disabled={nAction > 0}
            style={{ ...BTN(nAction > 0 ? "#c9ced6" : "#059669", "#fff"), cursor: nAction > 0 ? "default" : "pointer" }}>
            Finalize
          </button>
        </div>
      </div>

      {/* Summary + confirm */}
      <ReconcileSummaryModal
        open={showSummary}
        onClose={() => setShowSummary(false)}
        onRecheck={() => setShowSummary(false)}
        onProceed={async () => {
          setShowSummary(false);
          await reconcile.exitReconcile();
          onClearDraft?.();
          onRefresh?.();
        }}
        stats={stats}
        pdfFilename={reconcile.pdfSource}
        account={account}
        period={period}
        stmtClosingBalance={stmtClosing}
        ledgerClosingBalance={ledgerAtEnd}
        addedCount={0}
      />
    </div>
  );

  // Optional side-by-side PDF panel (same split the old mode offered)
  if (showPdfPanel && reconcile.pdfBlobUrl) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "2fr 3fr", gap: 12, alignItems: "flex-start" }}>
        <PDFViewer fileUrl={reconcile.pdfBlobUrl} filename={reconcile.pdfSource} />
        {content}
      </div>
    );
  }
  return content;
}
