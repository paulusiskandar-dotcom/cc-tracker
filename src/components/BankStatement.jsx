import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../lib/supabase";
import { fmtIDR, fmtCur } from "../utils";
import { TX_TYPE_MAP } from "../constants";
import { showToast } from "./shared/Card";
import TransactionModal from "./shared/TransactionModal";
import * as XLSX from "xlsx";

const FF = "Figtree, sans-serif";

// Format a running/closing balance with red color when negative
const fmtBal = (v) => {
  const n = Number(v || 0);
  return {
    text:  fmtIDR(Math.abs(n)),
    color: n < 0 ? "#A32D2D" : "#111827",
    sign:  n < 0 ? "-" : "",
  };
};

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

// ─── DEBIT/CREDIT DETERMINATION ──────────────────────────────
// Returns whether this tx is debit (out from account) or credit (in to account).
// Must check both the ID and the _type to correctly handle non-account sides
// (e.g. expense to_type is "expense" — should not be counted as a credit).
function txDirection(tx, accountId) {
  const isDebit  = tx.from_id === accountId && tx.from_type === "account";
  const isCredit = tx.to_id   === accountId && tx.to_type   === "account";
  if (isDebit && !isCredit) return "debit";
  if (isCredit && !isDebit) return "credit";
  return null;
}

// ─── GROUPED ACCOUNT OPTIONS ─────────────────────────────────
function AccountOptions({ accounts }) {
  const GROUPS = [
    { type: "bank",  label: "🏦 Bank"  },
    { type: "cash",  label: "💵 Cash"  },
  ];
  return (
    <>
      <option value="">— Select account —</option>
      {GROUPS.map(g => {
        const grp = accounts
          .filter(a => a.type === "bank" && (g.type === "cash" ? a.subtype === "cash" : a.subtype !== "cash"))
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        if (!grp.length) return null;
        return (
          <optgroup key={g.type} label={g.label}>
            {grp.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}
                {(a.last4 || a.account_no)
                  ? ` ···${a.last4 || String(a.account_no || "").slice(-4)}`
                  : ""}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

// ─── SUMMARY CARD ────────────────────────────────────────────
function SummaryCard({ label, value, displayText, color, bg }) {
  return (
    <div style={{
      background: bg, borderRadius: 12, padding: "14px 16px",
      border: "0.5px solid #e5e7eb", flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF, marginBottom: 6, opacity: 0.8 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: FF, lineHeight: 1.2 }}>
        {displayText !== undefined
          ? displayText
          : (value < 0 ? "-" : "") + fmtIDR(Math.abs(value))}
      </div>
    </div>
  );
}

// ─── MAIN EXPORT ─────────────────────────────────────────────
export default function BankStatement({
  initialAccount, accounts, user, categories = [], onRefresh, onBack,
  bankAccounts: bankAccsProp = [], creditCards = [], assets = [], liabilities = [],
  receivables = [], accountCurrencies = [], allCurrencies = [], fxRates = {},
  incomeSrcs = [],
}) {
  const [accountId,      setAccountId]      = useState(initialAccount?.id || "");
  const [fromDate,       setFromDate]       = useState(firstOfMonthStr());
  const [toDate,         setToDate]         = useState(todayStr());
  const [loading,        setLoading]        = useState(false);
  const [rawData,        setRawData]        = useState(null);  // { allTxs, allPreTxs }
  const [editEntry,      setEditEntry]      = useState(null);
  const [activeCurrency, setActiveCurrency] = useState("IDR");
  const [acctCurrencies, setAcctCurrencies] = useState([]);    // rows from account_currencies
  const printRef = useRef(null);

  // Derive bank accounts from all accounts if not passed separately
  const bankAccs = bankAccsProp.length > 0
    ? bankAccsProp
    : accounts.filter(a => a.type === "bank");

  // ── Open edit modal ────────────────────────────────────────
  const openEdit = (tx) => setEditEntry(tx);

  const selectedAccount = accounts.find(a => a.id === accountId) || null;

  // ── Fetch account_currencies when account changes (multicurrency only) ──
  useEffect(() => {
    setActiveCurrency("IDR");
    setAcctCurrencies([]);
    setRawData(null);
    if (!accountId) return;
    const acc = accounts.find(a => a.id === accountId);
    if (!acc?.is_multicurrency) return;
    supabase.from("account_currencies")
      .select("currency, balance, initial_balance")
      .eq("account_id", accountId)
      .then(({ data: rows }) => { if (rows?.length) setAcctCurrencies(rows); });
  }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load raw transaction data ───────────────────────────────
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
          .select("amount_idr, amount, currency, from_id, from_type, to_id, to_type")
          .eq("user_id", user.id)
          .or(`from_id.eq.${accountId},to_id.eq.${accountId}`)
          .lt("tx_date", fromDate),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setRawData({ allTxs: inRange || [], allPreTxs: beforeRange || [] });
    } catch (e) {
      console.error("[BankStatement]", e);
    }
    setLoading(false);
  };

  // Auto-load on mount if account is pre-selected
  useEffect(() => {
    if (accountId) load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Compute currency-filtered data from raw transactions ───
  const data = useMemo(() => {
    if (!rawData || !selectedAccount) return null;
    const { allTxs, allPreTxs } = rawData;
    const isMulti  = !!selectedAccount.is_multicurrency;
    const curIsIDR = !isMulti || activeCurrency === "IDR";

    // Pick the correct amount field: IDR uses amount_idr, foreign currency uses amount
    const getAmt = (t) => curIsIDR ? Number(t.amount_idr || 0) : Number(t.amount || 0);

    // Filter transactions for the selected currency tab
    const txs    = isMulti ? allTxs.filter(t => (t.currency || "IDR") === activeCurrency)    : allTxs;
    const preTxs = isMulti ? allPreTxs.filter(t => (t.currency || "IDR") === activeCurrency) : allPreTxs;

    // Opening balance seed: IDR uses accounts.initial_balance; foreign uses account_currencies.initial_balance
    const initialBal = curIsIDR
      ? Number(selectedAccount.initial_balance || 0)
      : Number(acctCurrencies.find(c => c.currency === activeCurrency)?.initial_balance || 0);

    const beforeCredit = preTxs
      .filter(t => t.to_id === accountId && t.to_type === "account")
      .reduce((s, t) => s + getAmt(t), 0);
    const beforeDebit = preTxs
      .filter(t => t.from_id === accountId && t.from_type === "account")
      .reduce((s, t) => s + getAmt(t), 0);
    const openingBal = initialBal + beforeCredit - beforeDebit;

    const totalCredit = txs
      .filter(t => t.to_id === accountId && t.to_type === "account")
      .reduce((s, t) => s + getAmt(t), 0);
    const totalDebit = txs
      .filter(t => t.from_id === accountId && t.from_type === "account")
      .reduce((s, t) => s + getAmt(t), 0);
    const closingBal = openingBal + totalCredit - totalDebit;

    return { txs, openingBal, totalCredit, totalDebit, closingBal };
  }, [rawData, activeCurrency, acctCurrencies, accountId, selectedAccount]);

  // ── Compute rows with running balance ─────────────────────
  const rowsWithBalance = useMemo(() => {
    if (!data || !selectedAccount) return [];
    const curIsIDR = !selectedAccount.is_multicurrency || activeCurrency === "IDR";
    let bal = data.openingBal;
    return data.txs.map(tx => {
      const dir = txDirection(tx, accountId);
      const amt = curIsIDR ? Number(tx.amount_idr || 0) : Number(tx.amount || 0);
      if (dir === "debit")  bal -= amt;
      if (dir === "credit") bal += amt;
      return { ...tx, _dir: dir, _runBal: bal, _displayAmt: amt };
    });
  }, [data, accountId, selectedAccount, activeCurrency]);

  // Group by date
  const grouped = useMemo(() => {
    const map = {};
    rowsWithBalance.forEach(r => {
      if (!map[r.tx_date]) map[r.tx_date] = [];
      map[r.tx_date].push(r);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [rowsWithBalance]);

  // ── Excel export ───────────────────────────────────────────
  const exportExcel = () => {
    if (!data || !rawData) return;
    const wb   = XLSX.utils.book_new();
    const name = (selectedAccount?.name || "Statement").replace(/[^a-zA-Z0-9]/g, "_");

    // Sheet 1: Summary
    const summaryRows = [
      ["Bank Statement — Paulus Finance"],
      ["Account", selectedAccount?.name || accountId],
      ["Period",  `${fromDate} to ${toDate}`],
      [],
      ["Item",               "Amount (IDR)"],
      ["Opening Balance",    data.openingBal],
      ["Total Debit (Out)",  data.totalDebit],
      ["Total Kredit (In)",  data.totalCredit],
      ["Closing Balance",    data.closingBal],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");

    // Sheet 2: Transactions
    const hdr = ["Tanggal","Keterangan","Jenis","Kategori","Entiti","Debit (Out)","Kredit (In)","Saldo"];
    const rows = rowsWithBalance.map(r => [
      r.tx_date,
      r.description || r.merchant_name || "",
      TX_TYPE_MAP[r.tx_type]?.label || r.tx_type || "",
      r.category_name || "",
      r.entity || "",
      r._dir === "debit"  ? Number(r.amount_idr || 0) : "",
      r._dir === "credit" ? Number(r.amount_idr || 0) : "",
      r._runBal,
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hdr, ...rows]), "Transactions");

    XLSX.writeFile(wb, `${name}_${fromDate}_${toDate}.xlsx`);
  };

  // ── PDF export (browser print) ────────────────────────────
  const exportPDF = () => window.print();

  // ── Month/year label for footer ───────────────────────────
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

  // ── Currency-aware amount formatters ─────────────────────
  const curIsIDR = !selectedAccount?.is_multicurrency || activeCurrency === "IDR";
  const fmtAmt   = (n) => fmtCur(Math.abs(Number(n || 0)), curIsIDR ? "IDR" : activeCurrency);
  const fmtBalCur = (v) => {
    const n = Number(v || 0);
    return { text: fmtAmt(n), color: n < 0 ? "#A32D2D" : "#111827", sign: n < 0 ? "-" : "" };
  };

  // ── Styles ────────────────────────────────────────────────
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
          Bank Statement{selectedAccount ? ` — ${selectedAccount.name}` : ""}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={exportPDF} style={BTN()}>🖨 PDF</button>
          <button onClick={exportExcel} disabled={!rawData} style={BTN({ opacity: rawData ? 1 : 0.4, cursor: rawData ? "pointer" : "default" })}>
            📊 Excel
          </button>
        </div>
      </div>

      {/* ── Print-only header ── */}
      <div className="print-only" style={{ display: "none" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#111827", fontFamily: FF }}>Paulus Finance — Bank Statement</div>
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
        {/* Account */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "2 1 200px" }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>Account</label>
          <select style={SEL_STYLE} value={accountId} onChange={e => setAccountId(e.target.value)}>
            <AccountOptions accounts={accounts} />
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

        {/* Currency tabs — only for multicurrency accounts */}
        {selectedAccount?.is_multicurrency && (
          <div style={{ width: "100%", display: "flex", gap: 4, flexWrap: "wrap", paddingTop: 2 }}>
            {["IDR", ...acctCurrencies.map(c => c.currency).filter(c => c !== "IDR").sort()]
              .map(cur => {
                const active = activeCurrency === cur;
                return (
                  <button key={cur} onClick={() => setActiveCurrency(cur)} style={{
                    height: 30, padding: "0 12px", borderRadius: 20,
                    border: `1.5px solid ${active ? "#111827" : "#e5e7eb"}`,
                    background: active ? "#111827" : "#fff",
                    color: active ? "#fff" : "#6b7280",
                    fontSize: 12, fontWeight: active ? 700 : 500,
                    cursor: "pointer", fontFamily: FF, transition: "all 0.15s",
                  }}>
                    {cur}
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {/* ── Summary cards ── */}
      {data && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <SummaryCard label="Opening Balance"   value={data.openingBal}  displayText={(data.openingBal  < 0 ? "-" : "") + fmtAmt(data.openingBal)}  color={data.openingBal  < 0 ? "#A32D2D" : "#1d4ed8"} bg={data.openingBal  < 0 ? "#fff1f2" : "#eff6ff"} />
          <SummaryCard label="Total Debit (Out)" value={data.totalDebit}  displayText={fmtAmt(data.totalDebit)}  color="#A32D2D" bg="#fff1f2" />
          <SummaryCard label="Total Kredit (In)" value={data.totalCredit} displayText={fmtAmt(data.totalCredit)} color="#3B6D11" bg="#f0fdf4" />
          <SummaryCard label="Closing Balance"   value={data.closingBal}  displayText={(data.closingBal  < 0 ? "-" : "") + fmtAmt(data.closingBal)}  color={data.closingBal  < 0 ? "#A32D2D" : "#111827"} bg={data.closingBal  < 0 ? "#fff1f2" : "#f9fafb"} />
        </div>
      )}

      {/* ── Loading state ── */}
      {loading && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontFamily: FF, fontSize: 13 }}>
          Loading transactions…
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !rawData && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontFamily: FF, fontSize: 13 }}>
          {accountId ? "Press Apply to load statement" : "Select an account to view statement"}
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
        // 6-column grid: Tanggal | Keterangan | Jenis | Debit | Kredit | Saldo
        const COLS = "80px 1fr 110px 120px 120px 130px";
        const HDR_CELLS = [
          { label: "Tanggal",    align: "left"  },
          { label: "Keterangan", align: "left"  },
          { label: "Jenis",      align: "left"  },
          { label: "Debit",      align: "right" },
          { label: "Kredit",     align: "right" },
          { label: "Saldo",      align: "right" },
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
            {(() => { const b = fmtBalCur(data.openingBal); const c = b.color === "#A32D2D" ? "#A32D2D" : "#1d4ed8"; return (
            <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#eff6ff", borderBottom: "0.5px solid #dbeafe", padding: ROW_PAD }}>
              <div style={{ fontSize: 11, color: c, fontFamily: FF, padding: "7px 6px", whiteSpace: "nowrap" }}>{fmtDateShort(fromDate)}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: c, fontFamily: FF, padding: "7px 6px" }}>Opening Balance</div>
              <div />{/* Jenis */}
              <div />{/* Debit */}
              <div />{/* Kredit */}
              <div style={{ fontSize: 11, fontWeight: 800, color: c, fontFamily: FF, padding: "7px 6px", textAlign: "right" }}>{b.sign}{b.text}</div>
            </div>
            ); })()}

            {/* Grouped transaction rows */}
            {grouped.map(([date, txs]) => (
              <div key={date}>
                {/* Date separator */}
                <div style={{ background: "#f3f4f6", borderBottom: "0.5px solid #e5e7eb", padding: "5px 20px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>
                  {fmtDateLabel(date)}
                </div>

                {txs.map(tx => {
                  const typeInfo = TX_TYPE_MAP[tx.tx_type];
                  const amt      = tx._displayAmt ?? Number(tx.amount_idr || 0);
                  const subLine  = [tx.category_name, tx.entity && tx.entity !== "Personal" ? tx.entity : ""].filter(Boolean).join(" · ");
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

                      {/* Keterangan (desc + sub-line) */}
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

                      {/* Debit */}
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#A32D2D", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                        {tx._dir === "debit" ? fmtAmt(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                      </div>

                      {/* Kredit */}
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#3B6D11", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                        {tx._dir === "credit" ? fmtAmt(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                      </div>

                      {/* Saldo */}
                      {(() => { const b = fmtBalCur(tx._runBal); return (
                        <div style={{ fontSize: 12, fontWeight: 700, color: b.color, fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                          {b.sign}{b.text}
                        </div>
                      ); })()}

                      {/* Edit button — overlay, opacity 0→1 on row hover */}
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
            {(() => { const b = fmtBalCur(data.closingBal); return (
            <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#f9fafb", borderTop: "1.5px solid #e5e7eb", padding: ROW_PAD }}>
              <div style={{ fontSize: 11, color: "#374151", fontFamily: FF, padding: "9px 6px", whiteSpace: "nowrap" }}>{fmtDateShort(toDate)}</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: b.color, fontFamily: FF, padding: "9px 6px" }}>Closing Balance</div>
              <div />{/* Jenis */}
              <div />{/* Debit */}
              <div />{/* Kredit */}
              <div style={{ fontSize: 13, fontWeight: 800, color: b.color, fontFamily: FF, padding: "9px 6px", textAlign: "right" }}>{b.sign}{b.text}</div>
            </div>
            ); })()}
          </div>
        );
      })()}

      {/* ── Footer ── */}
      {data && rowsWithBalance.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#9ca3af", fontFamily: FF }}>
            {rowsWithBalance.length} transaction{rowsWithBalance.length !== 1 ? "s" : ""} · {periodLabel}
          </span>
          {(() => { const b = fmtBalCur(data.closingBal); return (
            <span style={{ fontSize: 12, fontWeight: 700, color: b.color, fontFamily: FF }}>
              Closing balance: {b.sign}{b.text}
            </span>
          ); })()}
        </div>
      )}

      {/* ── Edit Transaction Modal ── */}
      <TransactionModal
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
