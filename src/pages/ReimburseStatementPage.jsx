import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ledgerApi, recalculateBalance } from "../api";
import { fmtIDR, todayStr } from "../utils";
import { showToast } from "../components/shared/Card";
import TxVerticalBig from "../components/shared/TxVerticalBig";
import * as XLSX from "xlsx";

const FF    = "Figtree, sans-serif";
const VALID = ["Hamasa", "SDC", "Travelio"];
const COLS  = "90px 1fr 100px 130px 130px 140px";
const RP    = "0 14px";

const fmtDateShort = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
};
const fmtDateLabel = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }); }
  catch { return d; }
};

function SummaryCard({ label, value, color, bg }) {
  return (
    <div style={{ background: bg, borderRadius: 12, padding: "14px 16px", border: "0.5px solid #e5e7eb", flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF, marginBottom: 6, opacity: 0.8 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: FF, lineHeight: 1.2 }}>{value}</div>
    </div>
  );
}

const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

export default function ReimburseStatementPage({
  ledger = [], accounts = [], user, categories = [],
  setLedger, onRefresh,
  bankAccounts = [], creditCards = [], receivables = [],
  fxRates = {}, allCurrencies: CURRENCIES = [],
}) {
  const { entity } = useParams();
  const navigate   = useNavigate();

  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate,   setToDate]   = useState(todayStr());
  const [applied,  setApplied]  = useState({ from: firstOfMonth(), to: todayStr() });

  const [txOpen,    setTxOpen]    = useState(false);
  const [txMode,    setTxMode]    = useState("edit");
  const [txInitial, setTxInitial] = useState(null);

  const [delEntry,   setDelEntry]   = useState(null);
  const [delConfirm, setDelConfirm] = useState(false);
  const [delSaving,  setDelSaving]  = useState(false);

  // ── All entity rows (no date filter) for summary ──────────────
  const allRows = useMemo(() =>
    ledger
      .filter(e => e.entity === entity && (e.tx_type === "reimburse_out" || e.tx_type === "reimburse_in"))
      .sort((a, b) => a.tx_date.localeCompare(b.tx_date))
  , [ledger, entity]);

  const totalOut = allRows.filter(e => e.tx_type === "reimburse_out").reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
  const totalIn  = allRows.filter(e => e.tx_type === "reimburse_in" ).reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
  const outstanding = totalOut - totalIn;

  // ── Filtered rows (date range) with running outstanding ───────
  const filteredRows = useMemo(() => {
    const rows = allRows.filter(e => e.tx_date >= applied.from && e.tx_date <= applied.to);
    let runOut = 0;
    return rows.map(e => {
      const amt = Number(e.amount_idr || e.amount || 0);
      if (e.tx_type === "reimburse_out") runOut += amt;
      else                               runOut -= amt;
      return { ...e, _runOutstanding: runOut };
    });
  }, [allRows, applied]);

  // ── Group by date ─────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = {};
    filteredRows.forEach(r => {
      if (!map[r.tx_date]) map[r.tx_date] = [];
      map[r.tx_date].push(r);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRows]);

  // ── Delete ────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!delEntry) return;
    setDelSaving(true);
    try {
      await ledgerApi.delete(delEntry.id, delEntry, accounts);
      setLedger?.(p => p.filter(e => e.id !== delEntry.id));
      const ids = [delEntry.from_id, delEntry.to_id].filter(Boolean);
      await Promise.all(ids.map(id => recalculateBalance(id, user.id)));
      showToast("Transaction deleted");
      setDelConfirm(false); setDelEntry(null);
      onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
    setDelSaving(false);
  };

  // ── Export ────────────────────────────────────────────────────
  const exportPDF = () => window.print();

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [`Reimburse Statement — ${entity} — Paulus Finance`],
      ["Period", `${applied.from} to ${applied.to}`], [],
      ["Total Out (Reimburse)", totalOut],
      ["Total In (Settled)",    totalIn],
      ["Outstanding",           outstanding],
    ]), "Summary");
    const hdr = ["Tanggal", "Keterangan", "Kategori", "Out", "In", "Outstanding"];
    const rows = filteredRows.map(e => [
      e.tx_date,
      e.description || "",
      e.category_name || "",
      e.tx_type === "reimburse_out" ? Number(e.amount_idr || e.amount || 0) : "",
      e.tx_type === "reimburse_in"  ? Number(e.amount_idr || e.amount || 0) : "",
      e._runOutstanding,
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hdr, ...rows]), "Transactions");
    XLSX.writeFile(wb, `${entity}_Reimburse_${applied.from}_${applied.to}.xlsx`);
  };

  const BTN = (extra = {}) => ({
    height: 34, padding: "0 12px", borderRadius: 8, border: "1px solid #e5e7eb",
    background: "#f9fafb", color: "#374151", fontSize: 12, fontWeight: 600,
    cursor: "pointer", fontFamily: FF, ...extra,
  });

  const HDR = [
    { label: "Tanggal",     align: "left"  },
    { label: "Keterangan",  align: "left"  },
    { label: "Kategori",    align: "left"  },
    { label: "Out (Rp)",    align: "right" },
    { label: "In (Rp)",     align: "right" },
    { label: "Outstanding", align: "right" },
  ];

  if (!VALID.includes(entity)) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: FF }}>
        <div style={{ fontSize: 14, color: "#6b7280" }}>Invalid entity: {entity}</div>
        <button onClick={() => navigate(-1)} style={{ marginTop: 16, fontSize: 13, color: "#3b5bdb", background: "none", border: "none", cursor: "pointer" }}>← Back</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: FF }}>

      {/* ── Header ── */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={() => navigate(-1)} style={BTN()}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>{entity} — Reimburse Statement</div>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>All reimburse transactions</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={exportPDF}   style={BTN()}>🖨 PDF</button>
          <button onClick={exportExcel} style={BTN()}>📊 Excel</button>
        </div>
      </div>

      {/* ── Date filter ── */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12, padding: "10px 14px" }}>
        <span style={{ fontSize: 12, color: "#6b7280", fontFamily: FF, fontWeight: 600 }}>Period:</span>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
          style={{ height: 32, padding: "0 10px", border: "1px solid #e5e7eb", borderRadius: 8, fontFamily: FF, fontSize: 12, color: "#111827", outline: "none" }} />
        <span style={{ fontSize: 12, color: "#9ca3af" }}>—</span>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
          style={{ height: 32, padding: "0 10px", border: "1px solid #e5e7eb", borderRadius: 8, fontFamily: FF, fontSize: 12, color: "#111827", outline: "none" }} />
        <button onClick={() => setApplied({ from: fromDate, to: toDate })}
          style={{ height: 32, padding: "0 14px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FF }}>
          Apply
        </button>
        <button onClick={() => { setFromDate("2000-01-01"); setToDate(todayStr()); setApplied({ from: "2000-01-01", to: todayStr() }); }}
          style={{ height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: 12, cursor: "pointer", fontFamily: FF }}>
          All time
        </button>
      </div>

      {/* ── Summary cards ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <SummaryCard label="Total Out (Paulus bayar)" value={fmtIDR(totalOut)} color="#dc2626" bg="#fff1f2" />
        <SummaryCard label="Total In (Entity bayar balik)" value={fmtIDR(totalIn)} color="#059669" bg="#f0fdf4" />
        <SummaryCard label="Outstanding" value={fmtIDR(Math.abs(outstanding))} color={outstanding > 0 ? "#d97706" : outstanding < 0 ? "#059669" : "#6b7280"} bg={outstanding < 0 ? "#f0fdf4" : "#fef9ec"} />
      </div>
      {outstanding < 0 && (
        <div style={{ fontSize: 12, color: "#059669", fontFamily: FF, fontWeight: 700, padding: "4px 0" }}>
          ✓ Lebih bayar {fmtIDR(Math.abs(outstanding))} — entity sudah over-settled
        </div>
      )}

      {/* ── Statement grid ── */}
      <div style={{ background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#f9fafb", borderBottom: "0.5px solid #e5e7eb", padding: RP }}>
          {HDR.map(({ label, align }) => (
            <div key={label} style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF, padding: "9px 6px", textAlign: align }}>
              {label}
            </div>
          ))}
        </div>

        {filteredRows.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
            No transactions in this period.
          </div>
        ) : (
          <>
            {grouped.map(([date, txs]) => (
              <div key={date}>
                <div style={{ background: "#f3f4f6", borderBottom: "0.5px solid #e5e7eb", padding: "5px 20px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>
                  {fmtDateLabel(date)}
                </div>

                {txs.map(tx => {
                  const amt   = Number(tx.amount_idr || tx.amount || 0);
                  const isOut = tx.tx_type === "reimburse_out";
                  const acc   = accounts.find(a => a.id === (isOut ? tx.from_id : tx.to_id));
                  return (
                    <div key={tx.id} style={{ display: "grid", gridTemplateColumns: COLS, borderBottom: "0.5px solid #f3f4f6", padding: RP, alignItems: "center" }}>
                      {/* Tanggal */}
                      <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, padding: "8px 6px", whiteSpace: "nowrap" }}>
                        {fmtDateShort(tx.tx_date)}
                      </div>
                      {/* Keterangan */}
                      <div style={{ padding: "8px 6px", minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "#111827", fontFamily: FF, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {tx.description || (isOut ? "Reimburse Out" : "Reimburse In")}
                        </div>
                        {acc && (
                          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, marginTop: 2 }}>
                            {isOut ? `← ${acc.name}` : `→ ${acc.name}`}
                          </div>
                        )}
                        <div className="no-print" style={{ display: "flex", gap: 5, marginTop: 3 }}>
                          <button onClick={() => { setTxMode("edit"); setTxInitial(tx); setTxOpen(true); }}
                            style={{ fontSize: 9, padding: "1px 7px", borderRadius: 5, border: "1px solid #e5e7eb", background: "#f9fafb", color: "#374151", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
                            Edit
                          </button>
                          <button onClick={() => { setDelEntry(tx); setDelConfirm(true); }}
                            style={{ fontSize: 9, padding: "1px 7px", borderRadius: 5, border: "1px solid #fee2e2", background: "#fff5f5", color: "#dc2626", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
                            Delete
                          </button>
                        </div>
                      </div>
                      {/* Kategori */}
                      <div style={{ fontSize: 11, color: "#6b7280", fontFamily: FF, padding: "8px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {tx.category_name || "—"}
                      </div>
                      {/* Out */}
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                        {isOut ? fmtIDR(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                      </div>
                      {/* In */}
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#059669", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                        {!isOut ? fmtIDR(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                      </div>
                      {/* Outstanding */}
                      <div style={{ fontSize: 12, fontWeight: 700, color: tx._runOutstanding > 0 ? "#d97706" : "#059669", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                        {tx._runOutstanding < 0
                          ? `(${fmtIDR(Math.abs(tx._runOutstanding))})`
                          : fmtIDR(tx._runOutstanding)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Closing row */}
            <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#f9fafb", borderTop: "1.5px solid #e5e7eb", padding: RP }}>
              <div />
              <div style={{ fontSize: 11, fontWeight: 800, color: outstanding > 0 ? "#d97706" : "#059669", fontFamily: FF, padding: "9px 6px" }}>
                Outstanding (all time)
              </div>
              <div />
              <div style={{ fontSize: 13, fontWeight: 800, color: "#dc2626", fontFamily: FF, padding: "9px 6px", textAlign: "right" }}>
                {fmtIDR(totalOut)}
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#059669", fontFamily: FF, padding: "9px 6px", textAlign: "right" }}>
                {fmtIDR(totalIn)}
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: outstanding > 0 ? "#d97706" : "#059669", fontFamily: FF, padding: "9px 6px", textAlign: "right" }}>
                {outstanding < 0 ? `(${fmtIDR(Math.abs(outstanding))})` : fmtIDR(outstanding)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Footer ── */}
      {filteredRows.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#9ca3af", fontFamily: FF }}>
            {filteredRows.length} transaction{filteredRows.length !== 1 ? "s" : ""} · {applied.from} — {applied.to}
          </span>
        </div>
      )}

      {/* ── TxVerticalBig (edit) ── */}
      <TxVerticalBig
        open={txOpen}
        mode={txMode}
        initialData={txInitial}
        defaultGroup="reimburse"
        onSave={() => { setTxOpen(false); onRefresh?.(); }}
        onDelete={() => { setTxOpen(false); onRefresh?.(); }}
        onClose={() => setTxOpen(false)}
        user={user}
        accounts={accounts}
        setLedger={setLedger}
        categories={categories}
        fxRates={fxRates}
        allCurrencies={CURRENCIES}
        bankAccounts={bankAccounts}
        creditCards={creditCards}
        assets={[]}
        liabilities={[]}
        receivables={receivables}
        incomeSrcs={[]}
        onRefresh={onRefresh}
      />

      {/* ── Delete confirm ── */}
      {delConfirm && (
        <div onClick={e => { if (e.target === e.currentTarget) { setDelConfirm(false); setDelEntry(null); } }}
          style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 360, width: "100%", fontFamily: FF }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 8 }}>Delete transaction?</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>This will reverse the balance impact.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setDelConfirm(false); setDelEntry(null); }}
                style={{ flex: 1, height: 40, borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", color: "#374151", fontFamily: FF, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={handleDelete} disabled={delSaving}
                style={{ flex: 1, height: 40, borderRadius: 8, border: "none", background: "#fee2e2", color: "#dc2626", fontFamily: FF, fontSize: 13, fontWeight: 700, cursor: delSaving ? "default" : "pointer", opacity: delSaving ? 0.6 : 1 }}>
                {delSaving ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
