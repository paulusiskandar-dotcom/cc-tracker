import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../lib/supabase";
import { ledgerApi, getTxFromToTypes, categoriesApi, recalculateBalance } from "../api";
import { toIDR as toIDRFn, fmtIDR } from "../utils";
import { TX_TYPE_MAP } from "../constants";
import Modal, { ConfirmModal } from "./shared/Modal";
import { showToast } from "./shared/Card";
import { TxForm, EMPTY } from "./shared/TxForm";
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
  incomeSrcs = [],
}) {
  const [accountId, setAccountId] = useState(initialAccount?.id || "");
  const [fromDate,  setFromDate]  = useState(firstOfMonthStr());
  const [toDate,    setToDate]    = useState(todayStr());
  const [loading,   setLoading]   = useState(false);
  const [data,      setData]      = useState(null);

  const [editEntry,         setEditEntry]         = useState(null);
  const [editForm,          setEditForm]          = useState({});
  const [editSaving,        setEditSaving]        = useState(false);
  const [editConfirmDelete, setEditConfirmDelete] = useState(false);
  const [editDeleting,      setEditDeleting]      = useState(false);
  const [modalCategories,   setModalCategories]   = useState([]);
  const printRef = useRef(null);

  const setF = (k, v) => setEditForm(f => ({ ...f, [k]: v }));

  const bankAccs    = bankAccsProp.length > 0 ? bankAccsProp : accounts.filter(a => a.type === "bank");
  const creditCards = creditCardsProp.length > 0 ? creditCardsProp : accounts.filter(a => a.type === "credit_card");

  const editType = editForm.tx_type || "expense";
  const editFromOptions = useMemo(() => ({
    expense:       [...bankAccs, ...creditCards],
    income:        [],
    transfer:      [...bankAccs],
    pay_cc:        [...bankAccs],
    buy_asset:     [...bankAccs, ...creditCards],
    sell_asset:    [...assets],
    pay_liability: [...bankAccs],
    reimburse_out: [...bankAccs, ...creditCards],
    reimburse_in:  [...receivables],
    give_loan:     [...bankAccs],
    collect_loan:  [...receivables],
    fx_exchange:   [...bankAccs],
  })[editType] || accounts, [editType, bankAccs, creditCards, assets, receivables, accounts]);

  const editToOptions = useMemo(() => ({
    expense:       [],
    income:        [...bankAccs],
    transfer:      [...bankAccs],
    pay_cc:        [...creditCards],
    buy_asset:     [...assets],
    sell_asset:    [...bankAccs],
    pay_liability: [...liabilities],
    reimburse_out: [...receivables],
    reimburse_in:  [...bankAccs],
    give_loan:     [...receivables],
    collect_loan:  [...bankAccs],
    fx_exchange:   [...bankAccs],
  })[editType] || [], [editType, bankAccs, creditCards, assets, liabilities, receivables]);

  const editAmtIDR = toIDRFn(Number(editForm.amount || 0), editForm.currency || "IDR", fxRates, allCurrencies);

  const openEdit = (tx) => {
    setEditForm({
      ...EMPTY,
      tx_date:       tx.tx_date       || "",
      description:   tx.description   || tx.merchant_name || "",
      amount:        tx.amount        || "",
      currency:      tx.currency      || "IDR",
      tx_type:       tx.tx_type       || "expense",
      from_id:       tx.from_id       || null,
      to_id:         tx.to_id         || null,
      from_type:     tx.from_type     || getTxFromToTypes(tx.tx_type || "expense").from_type,
      to_type:       tx.to_type       || getTxFromToTypes(tx.tx_type || "expense").to_type,
      category_id:   tx.category_id   || null,
      category_name: tx.category_name || null,
      entity:        tx.entity        || "Personal",
      notes:         tx.notes         || "",
      is_reimburse:  tx.is_reimburse  || false,
    });
    setEditEntry(tx);
    categoriesApi.getAll(user.id)
      .then(cats => setModalCategories(cats || []))
      .catch(() => setModalCategories(categories));
  };

  const saveEdit = async () => {
    if (!editEntry) return;
    if (!editForm.amount || Number(editForm.amount) <= 0) {
      showToast("Amount is required", "error"); return;
    }
    setEditSaving(true);
    try {
      const uuid = (v) => (v && typeof v === "string" && v.length === 36) ? v : null;
      const sn   = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const type = editForm.tx_type;
      const cat  = categories.find(c => c.id === editForm.category_id);
      const { from_type, to_type } = getTxFromToTypes(type);
      const AUTO_DESC = {
        transfer: "Transfer", pay_cc: "CC Payment", buy_asset: "Asset Purchase",
        sell_asset: "Asset Sale", give_loan: "Employee Loan", collect_loan: "Loan Collection",
        reimburse_in: "Reimburse Received", pay_liability: "Liability Payment", fx_exchange: "FX Exchange",
      };
      const description = editForm.description?.trim() || AUTO_DESC[type] || "Transaction";
      let computedAmtIDR = sn(editAmtIDR);
      let computedFxRate = null;
      if (type === "fx_exchange") {
        const rate = sn(editForm.fx_rate_used);
        computedFxRate = rate || null;
        if (rate > 0) computedAmtIDR = Math.round(sn(editForm.amount) * rate);
      }
      const entry = {
        tx_date:       editForm.tx_date || todayStr(),
        description,
        amount:        sn(editForm.amount),
        currency:      editForm.currency || "IDR",
        amount_idr:    computedAmtIDR,
        fx_rate_used:  computedFxRate,
        tx_type:       type,
        from_type, to_type,
        from_id:       uuid(editForm.from_id),
        to_id:         uuid(editForm.to_id),
        category_id:   uuid(editForm.category_id),
        category_name: cat?.name || editForm.category_name || null,
        entity:        type === "reimburse_out" ? (editForm.entity || "Hamasa") : (editForm.entity || "Personal"),
        is_reimburse:  editForm.is_reimburse || false,
        merchant_name: null,
        notes:         editForm.notes || null,
      };
      await ledgerApi.update(editEntry.id, entry);
      const affectedIds = [
        ...(entry.from_type === "account" && entry.from_id ? [entry.from_id] : []),
        ...(entry.to_type   === "account" && entry.to_id   ? [entry.to_id]   : []),
        ...(editEntry.from_type === "account" && editEntry.from_id ? [editEntry.from_id] : []),
        ...(editEntry.to_type   === "account" && editEntry.to_id   ? [editEntry.to_id]   : []),
      ];
      await Promise.all([...new Set(affectedIds)].map(id => recalculateBalance(id, user.id)));
      showToast("Transaction updated");
      setEditEntry(null);
      await load();
      if (onRefresh) onRefresh();
    } catch (e) {
      showToast(e.message, "error");
    }
    setEditSaving(false);
  };

  const deleteFromEdit = async () => {
    if (!editEntry) return;
    setEditDeleting(true);
    try {
      const affectedIds = [
        ...(editEntry.from_type === "account" && editEntry.from_id ? [editEntry.from_id] : []),
        ...(editEntry.to_type   === "account" && editEntry.to_id   ? [editEntry.to_id]   : []),
      ];
      await ledgerApi.delete(editEntry.id, editEntry, accounts);
      await Promise.all([...new Set(affectedIds)].map(id => recalculateBalance(id, user.id)));
      showToast("Transaction deleted");
      setEditConfirmDelete(false);
      setEditEntry(null);
      await load();
      if (onRefresh) onRefresh();
    } catch (e) {
      showToast(e.message, "error");
    }
    setEditDeleting(false);
  };

  const selectedAccount = accounts.find(a => a.id === accountId) || null;

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
          <button onClick={exportPDF} style={BTN()}>🖨 PDF</button>
          <button onClick={exportExcel} disabled={!data} style={BTN({ opacity: data ? 1 : 0.4, cursor: data ? "pointer" : "default" })}>
            📊 Excel
          </button>
        </div>
      </div>

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

        {/* From date */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 130px" }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>From</label>
          <input type="date" style={SEL_STYLE} value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>

        {/* To date */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 130px" }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>To</label>
          <input type="date" style={SEL_STYLE} value={toDate} onChange={e => setToDate(e.target.value)} />
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
      {!loading && data && rowsWithBalance.length === 0 && (
        <div style={{
          background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb",
          padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontFamily: FF, fontSize: 13,
        }}>
          No transactions in this period.
        </div>
      )}

      {/* ── Transaction table ── */}
      {!loading && data && rowsWithBalance.length > 0 && (() => {
        // Columns: Tanggal | Keterangan | Jenis | Transaksi | Pembayaran | Saldo Hutang
        const COLS = "80px 1fr 110px 120px 120px 130px";
        const HDR_CELLS = [
          { label: "Tanggal",      align: "left"  },
          { label: "Keterangan",   align: "left"  },
          { label: "Jenis",        align: "left"  },
          { label: "Transaksi",    align: "right" },
          { label: "Pembayaran",   align: "right" },
          { label: "Saldo Hutang", align: "right" },
        ];
        const ROW_PAD = "0 14px";
        return (
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
                </div>
              );
            })()}

            {/* Grouped rows */}
            {grouped.map(([date, txs]) => (
              <div key={date}>
                <div style={{ background: "#f3f4f6", borderBottom: "0.5px solid #e5e7eb", padding: "5px 20px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>
                  {fmtDateLabel(date)}
                </div>

                {txs.map(tx => {
                  const typeInfo = TX_TYPE_MAP[tx.tx_type];
                  const amt      = Number(tx.amount_idr || 0);
                  const subLine  = [tx.category_name, tx.entity && tx.entity !== "Personal" ? tx.entity : ""].filter(Boolean).join(" · ");
                  const b        = fmtBalCC(tx._runBal);
                  return (
                    <div key={tx.id}
                      style={{ position: "relative", display: "grid", gridTemplateColumns: COLS, borderBottom: "0.5px solid #f3f4f6", padding: ROW_PAD, alignItems: "center" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#fafafa"; e.currentTarget.querySelector(".edit-btn")?.style && (e.currentTarget.querySelector(".edit-btn").style.opacity = "1"); }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.querySelector(".edit-btn")?.style && (e.currentTarget.querySelector(".edit-btn").style.opacity = "0"); }}
                    >
                      {/* Tanggal */}
                      <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, padding: "8px 6px", whiteSpace: "nowrap" }}>
                        {fmtDateShort(tx.tx_date)}
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
              </div>
            ))}

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
                </div>
              );
            })()}
          </div>
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

      {/* ── Edit Transaction Modal ── */}
      <Modal
        isOpen={!!editEntry}
        onClose={() => setEditEntry(null)}
        title="Edit Transaction"
        footer={
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setEditConfirmDelete(true)}
              disabled={editSaving}
              style={{ height: 44, padding: "0 16px", borderRadius: 10, border: "1px solid #fca5a5", background: "#fff1f2", color: "#b91c1c", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FF, flexShrink: 0 }}
            >
              Delete
            </button>
            <button
              onClick={saveEdit}
              disabled={editSaving}
              style={{ flex: 1, height: 44, borderRadius: 10, border: "none", background: "#111827", color: "#fff", fontSize: 14, fontWeight: 700, cursor: editSaving ? "default" : "pointer", fontFamily: FF, opacity: editSaving ? 0.6 : 1 }}
            >
              {editSaving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        }
      >
        {editEntry && (
          <TxForm
            form={editForm}
            set={setF}
            fromOptions={editFromOptions}
            toOptions={editToOptions}
            accounts={accounts}
            categories={modalCategories.length > 0 ? modalCategories : categories}
            incomeSrcs={incomeSrcs}
            allCurrencies={allCurrencies}
            amtIDR={editAmtIDR}
            receivables={receivables}
            assets={assets}
            accountCurrencies={accountCurrencies}
          />
        )}
      </Modal>

      {/* ── Delete confirm ── */}
      <ConfirmModal
        isOpen={editConfirmDelete}
        onClose={() => setEditConfirmDelete(false)}
        onConfirm={deleteFromEdit}
        title="Hapus Transaksi"
        message="Hapus transaksi ini? Tindakan ini tidak bisa dibatalkan."
        danger
        busy={editDeleting}
      />
    </div>
  );
}
