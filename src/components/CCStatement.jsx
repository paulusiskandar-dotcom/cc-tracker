import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../lib/supabase";
import { fmtIDR } from "../utils";
import { TX_TYPE_MAP } from "../constants";
import { showToast } from "./shared/Card";
import TxVerticalBig from "./shared/TxVerticalBig";
import { useReconcile, ReconcileBar, ReconcileStatusBadge, ReconcileMissingRowInline, ReconcileMissingBar, getMissingRowsMap } from "./shared/ReconcileOverlay";
import ProgressIndicator from "./shared/ProgressIndicator";
import { useImportDraft } from "../lib/useImportDraft";
import DraftBanner from "./shared/DraftBanner";
import PDFViewer from "./shared/PDFViewer";
import { ledgerApi } from "../api";
import * as XLSX from "xlsx";

const FF = "Figtree, sans-serif";

const todayStr = () => new Date().toISOString().slice(0, 10);
const firstOfMonthStr = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

const fmtDateLabel = (d) => {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("id-ID", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
    });
  } catch { return d; }
};

const fmtDateShort = (d) => {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("id-ID", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return d; }
};

// For CC: positive saldo = debt (black), negative = overpaid (green)
const fmtBalCC = (v) => {
  const n = Number(v || 0);
  return {
    text:  fmtIDR(Math.abs(n)),
    color: n < 0 ? "#059669" : "#111827",
    sign:  n < 0 ? "-" : "",
    label: n < 0 ? " (overpaid)" : "",
  };
};

// For CC: from_id=cc AND from_type="account" → charge (debt up)
//          to_id=cc AND to_type="account"   → payment (debt down)
function ccDirection(tx, accountId) {
  const isCharge  = tx.from_id === accountId && tx.from_type === "account";
  const isPayment = tx.to_id   === accountId && tx.to_type   === "account";
  if (isCharge && !isPayment) return "charge";
  if (isPayment && !isCharge) return "payment";
  return null;
}

function SummaryCard({ label, value, color, bg }) {
  return (
    <div style={{
      background: bg, borderRadius: 12, padding: "14px 16px",
      border: "0.5px solid #e5e7eb", flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF, marginBottom: 6, opacity: 0.8 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: FF, lineHeight: 1.2 }}>
        {value < 0 ? "-" : ""}{fmtIDR(Math.abs(value))}
      </div>
    </div>
  );
}

export default function CCStatement({
  initialAccount, accounts, user, categories = [], onRefresh, onBack,
  bankAccounts: bankAccsProp = [], creditCards: creditCardsProp = [],
  assets = [], liabilities = [], receivables = [],
  accountCurrencies = [], allCurrencies = [], fxRates = {},
  incomeSrcs = [], merchantMaps = [],
  initialFromDate = null, initialToDate = null, initialSelectedMonth = null,
  initialReconcileTxs = null, initialReconcileFilename = "",
  initialReconcileFullState = null,
  initialReconcileBlobUrl = null, initialReconcileClosingBal = null, initialReconcileOpeningBal = null,
}) {
  const hasInitialDates = useRef(!!(initialFromDate));
  const [accountId, setAccountId] = useState(initialAccount?.id || "");
  const [fromDate,  setFromDate]  = useState(initialFromDate || firstOfMonthStr());
  const [toDate,    setToDate]    = useState(initialToDate   || todayStr());
  const [selectedMonth, setSelectedMonth] = useState(
    initialSelectedMonth || (initialFromDate ? initialFromDate.slice(0, 7) : new Date().toISOString().slice(0, 7))
  );
  const [loading,   setLoading]   = useState(false);
  const [data,      setData]      = useState(null);

  const [editEntry,    setEditEntry]    = useState(null);
  const [savingAll,    setSavingAll]    = useState(false);
  const [showPdfPanel, setShowPdfPanel] = useState(false);
  const printRef = useRef(null);

  // Reconcile mode
  const reconcile = useReconcile({ user, accountId, fromDate, toDate, ledgerRows: useMemo(() => (data?.txs || []).map(tx => ({ ...tx, _dir: ccDirection(tx, accountId) === "charge" ? "debit" : "credit" })), [data, accountId]), currentAccountId: accountId, accounts, merchantMaps });

  const reconcileDraft = useImportDraft({
    user,
    source: "reconcile",
    accountId: accountId || null,
    state: reconcile.active && reconcile.stmtRows?.length > 0 ? {
      stmtRows: reconcile.stmtRows,
      ignoredIds: [...reconcile.ignoredIds],
      pendingRows: reconcile.pendingRows,
      pdfSource: reconcile.pdfSource,
      stmtClosingBalance: reconcile.stmtClosingBalance,
      stmtOpeningBalance: reconcile.stmtOpeningBalance,
    } : null,
    onRestore: (s) => reconcile.seedFullState(s),
  });

  // Seed reconcile state from props (GlobalReconcileButton or draft-continue flow)
  useEffect(() => {
    if (initialReconcileFullState?.stmtRows?.length) {
      reconcile.seedFullState(initialReconcileFullState);
    } else if (initialReconcileTxs?.length) {
      reconcile.seedStmtRows(initialReconcileTxs, initialReconcileFilename, {
        blobUrl: initialReconcileBlobUrl,
        closingBal: initialReconcileClosingBal,
        openingBal: initialReconcileOpeningBal,
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAll = async () => {
    const missing = reconcile.missing;
    if (!missing.length) return;
    setSavingAll(true);
    let successCount = 0, errCount = 0;
    for (const stmtRow of missing) {
      // Build default row from statement data, merge with any user edits from the panel
      const defaultRow = {
        tx_date: stmtRow.date || todayStr(),
        description: stmtRow.description || stmtRow.merchant || "",
        amount: Math.abs(Number(stmtRow.amount || 0)),
        amount_idr: Math.abs(Number(stmtRow.amount || 0)),
        currency: stmtRow.currency || "IDR",
        tx_type: "expense",
        from_id: accountId || "",
        from_type: "account",
        to_id: null,
        to_type: "expense_category",
        category_id: null,
        category_name: null,
        entity: null,
        notes: null,
        fx_rate: 1,
      };
      const r = { ...defaultRow, ...(reconcile.pendingRows[stmtRow._id] || {}) };
      try {
        const entry = {
          tx_date: r.tx_date, tx_type: r.tx_type, description: r.description,
          amount: Number(r.amount || r.amount_idr || 0),
          amount_idr: Number(r.amount_idr || r.amount || 0),
          currency: r.currency || "IDR", fx_rate_used: Number(r.fx_rate || 1),
          from_id: r.from_id, from_type: r.from_type,
          to_id: r.to_id, to_type: r.to_type,
          category_id: r.category_id || null, category_name: r.category_name || null,
          entity: r.entity || null,
          is_reimburse: ["reimburse_in", "reimburse_out"].includes(r.tx_type),
          notes: r.notes || null,
        };
        await ledgerApi.create(user.id, entry, accounts);
        successCount++;
      } catch (e) { errCount++; console.error("[saveAll]", e); }
    }
    setSavingAll(false);
    reconcile.collapseAll();
    Object.keys(reconcile.pendingRows).forEach(id => reconcile.removePendingRow(id));
    showToast(`Saved ${successCount}${errCount ? `, ${errCount} failed` : ""}`);
    load();
    onRefresh?.();
  };

  const bankAccs    = bankAccsProp.length > 0 ? bankAccsProp : accounts.filter(a => a.type === "bank");
  const creditCards = creditCardsProp.length > 0 ? creditCardsProp : accounts.filter(a => a.type === "credit_card");

  const openEdit = (tx) => setEditEntry(tx);

  const selectedAccount = accounts.find(a => a.id === accountId) || null;

  // Auto-compute billing cycle dates when month picker changes
  // (skip on first run if caller supplied explicit initialFromDate/initialToDate)
  useEffect(() => {
    if (hasInitialDates.current) { hasInitialDates.current = false; return; }
    if (!selectedMonth || !selectedAccount) return;
    const [y, m] = selectedMonth.split("-").map(Number);
    const stDay = Number(selectedAccount.statement_day);
    if (stDay > 0) {
      // Billing cycle: (stDay+1) of prev month → stDay of selected month
      const endDate = new Date(y, m - 1, stDay);
      const startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - 1);
      startDate.setDate(startDate.getDate() + 1);
      setFromDate(startDate.toISOString().slice(0, 10));
      setToDate(endDate.toISOString().slice(0, 10));
    } else {
      // No statement_day: use calendar month
      setFromDate(`${y}-${String(m).padStart(2, "0")}-01`);
      setToDate(new Date(y, m, 0).toISOString().slice(0, 10));
    }
  }, [selectedMonth, selectedAccount]);

  const load = async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [{ data: inRange, error: e1 }, { data: beforeRange, error: e2 }] = await Promise.all([
        supabase.from("ledger")
          .select("*")
          .eq("user_id", user.id)
          .or(`from_id.eq.${accountId},to_id.eq.${accountId}`)
          .gte("tx_date", fromDate)
          .lte("tx_date", toDate)
          .order("tx_date",    { ascending: true })
          .order("created_at", { ascending: true }),
        supabase.from("ledger")
          .select("amount_idr, from_id, from_type, to_id, to_type")
          .eq("user_id", user.id)
          .or(`from_id.eq.${accountId},to_id.eq.${accountId}`)
          .lt("tx_date", fromDate),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;

      const initialBal   = Number(selectedAccount?.initial_balance || 0);
      const preTxs       = beforeRange || [];
      // For CC: charges (from_id=cc) increase debt; payments (to_id=cc) reduce debt
      const beforeCharge  = preTxs
        .filter(t => t.from_id === accountId && t.from_type === "account")
        .reduce((s, t) => s + Number(t.amount_idr || 0), 0);
      const beforePayment = preTxs
        .filter(t => t.to_id   === accountId && t.to_type   === "account")
        .reduce((s, t) => s + Number(t.amount_idr || 0), 0);
      const openingBal   = initialBal + beforeCharge - beforePayment;

      const txs           = inRange || [];
      const totalCharge   = txs
        .filter(t => t.from_id === accountId && t.from_type === "account")
        .reduce((s, t) => s + Number(t.amount_idr || 0), 0);
      const totalPayment  = txs
        .filter(t => t.to_id   === accountId && t.to_type   === "account")
        .reduce((s, t) => s + Number(t.amount_idr || 0), 0);
      const closingBal   = openingBal + totalCharge - totalPayment;

      setData({ txs, openingBal, totalCharge, totalPayment, closingBal });
    } catch (e) {
      console.error("[CCStatement]", e);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (accountId) load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rowsWithBalance = useMemo(() => {
    if (!data) return [];
    let bal = data.openingBal;
    return data.txs.map(tx => {
      const dir = ccDirection(tx, accountId);
      const amt = Number(tx.amount_idr || 0);
      if (dir === "charge")  bal += amt;
      if (dir === "payment") bal -= amt;
      return { ...tx, _dir: dir, _runBal: bal };
    });
  }, [data, accountId]);

  const grouped = useMemo(() => {
    const map = {};
    rowsWithBalance.forEach(r => {
      if (!map[r.tx_date]) map[r.tx_date] = [];
      map[r.tx_date].push(r);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [rowsWithBalance]);

  const periodLabel = (() => {
    try {
      const f = new Date(fromDate + "T00:00:00");
      const t = new Date(toDate   + "T00:00:00");
      if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) {
        return f.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
      }
      return `${fmtDateShort(fromDate)} – ${fmtDateShort(toDate)}`;
    } catch { return `${fromDate} – ${toDate}`; }
  })();

  const exportExcel = () => {
    if (!data) return;
    const wb   = XLSX.utils.book_new();
    const name = (selectedAccount?.name || "CCStatement").replace(/[^a-zA-Z0-9]/g, "_");

    const summaryRows = [
      ["CC Statement — Paulus Finance"],
      ["Card",   selectedAccount?.name || accountId],
      ["Period", `${fromDate} to ${toDate}`],
      [],
      ["Item",                   "Amount (IDR)"],
      ["Opening Balance (Debt)", data.openingBal],
      ["Total Transaksi",        data.totalCharge],
      ["Total Pembayaran",       data.totalPayment],
      ["Closing Balance (Debt)", data.closingBal],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");

    const hdr = ["Tanggal","Keterangan","Jenis","Transaksi","Pembayaran","Saldo Hutang"];
    const rows = rowsWithBalance.map(r => [
      r.tx_date,
      r.description || r.merchant_name || "",
      TX_TYPE_MAP[r.tx_type]?.label || r.tx_type || "",
      r._dir === "charge"  ? Number(r.amount_idr || 0) : "",
      r._dir === "payment" ? Number(r.amount_idr || 0) : "",
      r._runBal,
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hdr, ...rows]), "Transactions");

    XLSX.writeFile(wb, `${name}_${fromDate}_${toDate}.xlsx`);
  };

  const exportPDF = () => window.print();

  const SEL_STYLE = {
    fontSize: 12, padding: "6px 8px", borderRadius: 8,
    border: "1px solid #e5e7eb", background: "#fff", color: "#111827",
    fontFamily: FF, cursor: "pointer",
  };
  const BTN = (extra = {}) => ({
    fontSize: 12, padding: "6px 14px", borderRadius: 8,
    border: "1px solid #e5e7eb", background: "#f9fafb", color: "#374151",
    fontFamily: FF, cursor: "pointer", fontWeight: 600, ...extra,
  });

  return (
    <div ref={printRef} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Header row ── */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={onBack} style={BTN()}>← Back</button>
        <span style={{ fontSize: 16, fontWeight: 800, color: "#111827", fontFamily: FF }}>
          CC Statement{selectedAccount ? ` — ${selectedAccount.name}` : ""}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {data && !reconcile.active && (
            <button onClick={reconcile.startReconcile} style={BTN()}>☑ Reconcile</button>
          )}
          <button onClick={exportPDF} style={BTN()}>🖨 PDF</button>
          <button onClick={exportExcel} disabled={!data} style={BTN({ opacity: data ? 1 : 0.4, cursor: data ? "pointer" : "default" })}>
            📊 Excel
          </button>
        </div>
      </div>

      {/* Reconcile draft banner */}
      {reconcileDraft.showBanner && !reconcile.active && (
        <DraftBanner draftInfo={reconcileDraft.draftInfo} onResume={reconcileDraft.resume} onDiscard={reconcileDraft.discard} />
      )}

      {/* Reconcile bar */}
      <ReconcileBar
        reconcile={reconcile}
        onRefresh={() => { load(); onRefresh?.(); }}
        onClearDraft={reconcileDraft.clearDraft}
        currentAccount={selectedAccount}
        periodLabel={periodLabel}
        ledgerClosingBalance={data?.closingBal ?? null}
        showPdfPanel={showPdfPanel}
        onTogglePdfPanel={() => setShowPdfPanel(p => !p)}
      />
      {reconcile.active && reconcile.stmtRows?.length > 0 && (
        <ProgressIndicator
          label="Reconcile"
          total={reconcile.stmtRows.length}
          processed={reconcile.stats.match + reconcile.stats.ignored}
          pending={reconcile.stats.missing}
          matched={reconcile.stats.match}
        />
      )}

      {/* Split view wrapper — flex row when PDF panel is open */}
      <div style={showPdfPanel && reconcile.pdfBlobUrl ? { display: "grid", gridTemplateColumns: "2fr 3fr", gap: 12, alignItems: "flex-start" } : {}}>
        {showPdfPanel && reconcile.pdfBlobUrl && (
          <PDFViewer fileUrl={reconcile.pdfBlobUrl} filename={reconcile.pdfSource} />
        )}
        <div style={showPdfPanel && reconcile.pdfBlobUrl ? { display: "flex", flexDirection: "column", gap: 16 } : {}}>

      {/* ── Print-only header ── */}
      <div className="print-only" style={{ display: "none" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#111827", fontFamily: FF }}>Paulus Finance — CC Statement</div>
        <div style={{ fontSize: 13, color: "#374151", fontFamily: FF, marginTop: 4 }}>
          {selectedAccount?.name || ""} · {fmtDateShort(fromDate)} – {fmtDateShort(toDate)}
        </div>
        <hr style={{ margin: "10px 0", borderColor: "#e5e7eb" }} />
      </div>

      {/* ── Filters ── */}
      <div className="no-print" style={{
        background: "#fff", borderRadius: 12, border: "0.5px solid #e5e7eb",
        padding: "14px 16px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end",
      }}>
        {/* Card selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "2 1 200px" }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>Credit Card</label>
          <select style={SEL_STYLE} value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value="">— Select card —</option>
            {creditCards
              .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
              .map(cc => (
                <option key={cc.id} value={cc.id}>
                  {cc.name}{cc.last4 ? ` ···${cc.last4}` : ""}
                </option>
              ))
            }
          </select>
        </div>

        {/* Month picker */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px" }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>Period</label>
          <select style={SEL_STYLE} value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
            {Array.from({ length: 24 }).map((_, i) => {
              const d = new Date(); d.setMonth(d.getMonth() - i);
              const m = d.toISOString().slice(0, 7);
              return <option key={m} value={m}>{d.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</option>;
            })}
          </select>
        </div>
        {/* Show computed date range */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px", justifyContent: "flex-end" }}>
          <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: FF, padding: "8px 0" }}>
            {fmtDateShort(fromDate)} – {fmtDateShort(toDate)}
          </div>
        </div>

        {/* Apply */}
        <button
          onClick={load}
          disabled={!accountId || loading}
          style={BTN({
            background: accountId ? "#111827" : "#f3f4f6",
            color:      accountId ? "#fff"    : "#9ca3af",
            border:     "none",
            padding: "7px 20px",
          })}>
          {loading ? "Loading…" : "Apply"}
        </button>
      </div>

      {/* ── Summary cards ── */}
      {data && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <SummaryCard label="Opening Balance"     value={data.openingBal}   color={data.openingBal  < 0 ? "#059669" : "#1d4ed8"} bg={data.openingBal  < 0 ? "#f0fdf4" : "#eff6ff"} />
          <SummaryCard label="Total Transaksi"     value={data.totalCharge}  color="#A32D2D" bg="#fff1f2" />
          <SummaryCard label="Total Pembayaran"    value={data.totalPayment} color="#3B6D11" bg="#f0fdf4" />
          <SummaryCard label="Closing Balance"     value={data.closingBal}   color={data.closingBal  < 0 ? "#059669" : "#111827"} bg={data.closingBal  < 0 ? "#f0fdf4" : "#f9fafb"} />
        </div>
      )}

      {/* ── Loading state ── */}
      {loading && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontFamily: FF, fontSize: 13 }}>
          Loading transactions…
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !data && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontFamily: FF, fontSize: 13 }}>
          {accountId ? "Press Apply to load statement" : "Select a credit card to view statement"}
        </div>
      )}

      {/* ── No transactions ── */}
      {!loading && data && rowsWithBalance.length === 0 && !(reconcile.active && reconcile.missing?.length) && (
        <div style={{
          background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb",
          padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontFamily: FF, fontSize: 13,
        }}>
          No transactions in this period.
        </div>
      )}

      {/* ── Transaction table ── */}
      {!loading && data && (rowsWithBalance.length > 0 || (reconcile.active && reconcile.missing?.length > 0)) && (() => {
        // Columns: Tanggal | Keterangan | Jenis | Transaksi | Pembayaran | Saldo Hutang
        const COLS = reconcile.active ? "80px 1fr 110px 120px 120px 130px 48px" : "80px 1fr 110px 120px 120px 130px";
        const HDR_CELLS = [
          { label: "Tanggal",      align: "left"  },
          { label: "Keterangan",   align: "left"  },
          { label: "Jenis",        align: "left"  },
          { label: "Transaksi",    align: "right" },
          { label: "Pembayaran",   align: "right" },
          { label: "Saldo Hutang", align: "right" },
          ...(reconcile.active ? [{ label: "Status", align: "center" }] : []),
        ];
        const ROW_PAD = "0 14px";
        return (
          <>
          {reconcile.active && reconcile.missing.length > 0 && (
            <ReconcileMissingBar
              reconcile={reconcile}
              accounts={accounts}
              onExpandAll={() => {
                if (reconcile.expandedIds.size === reconcile.missing.length) reconcile.collapseAll();
                else reconcile.expandAll();
              }}
              expandedCount={reconcile.expandedIds.size}
              totalMissing={reconcile.missing.length}
              onSaveAll={saveAll}
              saving={savingAll}
            />
          )}
          <div style={{ background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb", overflow: "hidden" }}>

            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#f9fafb", borderBottom: "0.5px solid #e5e7eb", padding: ROW_PAD }}>
              {HDR_CELLS.map(({ label, align }) => (
                <div key={label} style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF, padding: "9px 6px", textAlign: align }}>
                  {label}
                </div>
              ))}
            </div>

            {/* Opening balance row */}
            {(() => {
              const b = fmtBalCC(data.openingBal);
              const c = data.openingBal < 0 ? "#059669" : "#1d4ed8";
              return (
                <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#eff6ff", borderBottom: "0.5px solid #dbeafe", padding: ROW_PAD }}>
                  <div style={{ fontSize: 11, color: c, fontFamily: FF, padding: "7px 6px", whiteSpace: "nowrap" }}>{fmtDateShort(fromDate)}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: c, fontFamily: FF, padding: "7px 6px" }}>Opening Balance</div>
                  <div />{/* Jenis */}
                  <div />{/* Transaksi */}
                  <div />{/* Pembayaran */}
                  <div style={{ fontSize: 11, fontWeight: 800, color: c, fontFamily: FF, padding: "7px 6px", textAlign: "right" }}>{b.sign}{b.text}</div>
                  {reconcile.active && <div />}
                </div>
              );
            })()}

            {/* Grouped rows with interleaved missing rows */}
            {(() => {
              const missingRowsMap = getMissingRowsMap(reconcile.missing || []);
              const allDates = new Set([
                ...grouped.map(([date]) => date),
                ...missingRowsMap.keys()
              ]);
              const sortedDates = Array.from(allDates).sort();
              const groupMap = Object.fromEntries(grouped);

              return sortedDates.map(date => (
                <div key={date}>
                  {/* Date separator */}
                  <div style={{ background: "#f3f4f6", borderBottom: "0.5px solid #e5e7eb", padding: "5px 20px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>
                    {fmtDateLabel(date)}
                  </div>

                  {/* Ledger transactions for this date */}
                  {(groupMap[date] || []).map(tx => {
                    const typeInfo = TX_TYPE_MAP[tx.tx_type];
                    const amt      = Number(tx.amount_idr || 0);
                    const subLine  = [tx.category_name, tx.entity && tx.entity !== "Personal" ? tx.entity : ""].filter(Boolean).join(" · ");
                    const b        = fmtBalCC(tx._runBal);
                    const status    = reconcile.getStatus(tx.id);
                    const isMatched = reconcile.active && status === "match";
                    const rowBg     = isMatched ? "#dcfce7" : "transparent";
                    return (
                      <div key={tx.id}
                        style={{ position: "relative", display: "grid", gridTemplateColumns: COLS, borderBottom: "0.5px solid #f3f4f6", padding: ROW_PAD, alignItems: "center", background: rowBg }}
                        onMouseEnter={e => { if (!isMatched) e.currentTarget.style.background = "#fafafa"; e.currentTarget.querySelector(".edit-btn")?.style && (e.currentTarget.querySelector(".edit-btn").style.opacity = "1"); }}
                        onMouseLeave={e => { e.currentTarget.style.background = rowBg; e.currentTarget.querySelector(".edit-btn")?.style && (e.currentTarget.querySelector(".edit-btn").style.opacity = "0"); }}
                      >
                        {/* Tanggal */}
                        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, padding: "8px 6px", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                          {fmtDateShort(tx.tx_date)}
                          {tx.reconciled_at && !reconcile.active && (
                            <span title="Reconciled" style={{ fontSize: 8, fontWeight: 800, background: "#dcfce7", color: "#059669", borderRadius: 3, padding: "1px 3px", lineHeight: 1, flexShrink: 0 }}>R</span>
                          )}
                        </div>

                        {/* Keterangan */}
                        <div style={{ padding: "8px 6px", minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: "#111827", fontFamily: FF, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {tx.description || tx.merchant_name || "—"}
                          </div>
                          {subLine && (
                            <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {subLine}
                            </div>
                          )}
                        </div>

                        {/* Jenis badge */}
                        <div style={{ padding: "8px 6px" }}>
                          {typeInfo && (
                            <span style={{ fontSize: 9, fontWeight: 700, fontFamily: FF, background: typeInfo.color + "18", color: typeInfo.color, borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap" }}>
                              {typeInfo.icon} {typeInfo.label}
                            </span>
                          )}
                        </div>

                        {/* Transaksi (charge) */}
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#A32D2D", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                          {tx._dir === "charge"  ? fmtIDR(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                        </div>

                        {/* Pembayaran (payment) */}
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#3B6D11", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                          {tx._dir === "payment" ? fmtIDR(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                        </div>

                        {/* Saldo Hutang */}
                        <div style={{ fontSize: 12, fontWeight: 700, color: b.color, fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                          {b.sign}{b.text}
                        </div>

                        {/* Status (reconcile mode) */}
                        {reconcile.active && (
                          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "8px 0" }}>
                            {isMatched
                              ? <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", fontFamily: FF, textTransform: "uppercase", letterSpacing: "0.04em" }}>Matched</span>
                              : <ReconcileStatusBadge type={status} />
                            }
                          </div>
                        )}

                        {/* Edit button */}
                        <button
                          className="edit-btn no-print"
                          onClick={e => { e.stopPropagation(); openEdit(tx); }}
                          style={{
                            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                            width: 26, height: 26, borderRadius: 6,
                            border: "1px solid #e5e7eb", background: "#fff",
                            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 14, color: "#9ca3af",
                            opacity: 0, transition: "opacity 0.15s",
                            padding: "4px 8px", boxSizing: "border-box",
                          }}
                          title="Edit transaction"
                        >
                          ✎
                        </button>
                      </div>
                    );
                  })}

                  {/* Missing rows for this date (interleaved) */}
                  {reconcile.active && missingRowsMap.has(date) && missingRowsMap.get(date).map(missingRow => (
                    <ReconcileMissingRowInline
                      key={missingRow._id}
                      missingRow={missingRow}
                      reconcile={reconcile}
                      COLS={COLS}
                      ROW_PAD={ROW_PAD}
                      FF={FF}
                      accounts={accounts}
                      employeeLoans={[]}
                      user={user}
                      onRefresh={() => { load(); onRefresh?.(); }}
                    />
                  ))}
                </div>
              ));
            })()}

            {/* Closing balance row */}
            {(() => {
              const b = fmtBalCC(data.closingBal);
              return (
                <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#f9fafb", borderTop: "1.5px solid #e5e7eb", padding: ROW_PAD }}>
                  <div style={{ fontSize: 11, color: "#374151", fontFamily: FF, padding: "9px 6px", whiteSpace: "nowrap" }}>{fmtDateShort(toDate)}</div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: b.color, fontFamily: FF, padding: "9px 6px" }}>Closing Balance</div>
                  <div />{/* Jenis */}
                  <div />{/* Transaksi */}
                  <div />{/* Pembayaran */}
                  <div style={{ fontSize: 13, fontWeight: 800, color: b.color, fontFamily: FF, padding: "9px 6px", textAlign: "right" }}>{b.sign}{b.text}</div>
                  {reconcile.active && <div />}
                </div>
              );
            })()}
          </div>
          </>
        );
      })()}


      {/* ── Footer ── */}
      {data && rowsWithBalance.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#9ca3af", fontFamily: FF }}>
            {rowsWithBalance.length} transaction{rowsWithBalance.length !== 1 ? "s" : ""} · {periodLabel}
          </span>
          {(() => { const b = fmtBalCC(data.closingBal); return (
            <span style={{ fontSize: 12, fontWeight: 700, color: b.color, fontFamily: FF }}>
              Closing balance: {b.sign}{b.text}
            </span>
          ); })()}
        </div>
      )}

        </div>{/* end split right column */}
      </div>{/* end split view wrapper */}

      {/* ── Edit Transaction Modal ── */}
      <TxVerticalBig
        open={!!editEntry}
        mode="edit"
        initialData={editEntry}
        onSave={() => { load(); onRefresh?.(); }}
        onDelete={() => { load(); onRefresh?.(); }}
        onClose={() => setEditEntry(null)}
        user={user}
        accounts={accounts}
        setLedger={() => {}}
        categories={categories}
        fxRates={fxRates}
        allCurrencies={allCurrencies}
        bankAccounts={bankAccs}
        creditCards={creditCards}
        assets={assets}
        liabilities={liabilities}
        receivables={receivables}
        incomeSrcs={incomeSrcs}
        accountCurrencies={accountCurrencies}
        onRefresh={() => { load(); onRefresh?.(); }}
      />
    </div>
  );
}
