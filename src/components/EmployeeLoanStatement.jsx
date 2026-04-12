import { useMemo, useRef } from "react";
import { fmtIDR } from "../utils";
import { showToast } from "./shared/Card";
import * as XLSX from "xlsx";

const FF = "Figtree, sans-serif";

const fmtDateShort = (d) => {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("id-ID", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return d; }
};

const fmtDateLabel = (d) => {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("id-ID", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
    });
  } catch { return d; }
};

const ym = (d) => (d || "").slice(0, 7);

// For loans: positive saldo = owes (black), zero/negative = fully paid (green)
const fmtSaldo = (v) => {
  const n = Number(v || 0);
  return {
    text:  fmtIDR(Math.abs(n)),
    color: n <= 0 ? "#059669" : "#111827",
    sign:  n < 0 ? "-" : "",
  };
};

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
        {value}
      </div>
    </div>
  );
}

// receivable = accounts row (type=receivable, subtype != 'reimburse')
// ledger = all ledger rows for this user
export default function EmployeeLoanStatement({
  receivable, ledger, accounts, user, onBack,
  onCollect, onGiveLoan,
}) {
  const printRef = useRef(null);

  // All transactions involving this receivable account
  const rows = useMemo(() => {
    return ledger
      .filter(e =>
        (e.tx_type === "give_loan"    && e.to_id   === receivable.id) ||
        (e.tx_type === "collect_loan" && e.from_id  === receivable.id)
      )
      .sort((a, b) => {
        const d = a.tx_date.localeCompare(b.tx_date);
        if (d !== 0) return d;
        return (a.created_at || "").localeCompare(b.created_at || "");
      });
  }, [ledger, receivable.id]);

  // Running balance (sisa hutang), ascending
  const rowsWithBal = useMemo(() => {
    let bal = Number(receivable.initial_balance || 0);
    return rows.map(tx => {
      const amt = Number(tx.amount_idr || 0);
      const dir = tx.tx_type === "give_loan" ? "pinjam" : "bayar";
      if (dir === "pinjam") bal += amt;
      if (dir === "bayar")  bal -= amt;
      return { ...tx, _dir: dir, _runBal: bal };
    });
  }, [rows, receivable]);

  // Grouped by date
  const grouped = useMemo(() => {
    const map = {};
    rowsWithBal.forEach(r => {
      if (!map[r.tx_date]) map[r.tx_date] = [];
      map[r.tx_date].push(r);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [rowsWithBal]);

  // Metrics
  const totalLoaned  = rows.filter(e => e.tx_type === "give_loan")   .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
  const totalRepaid  = rows.filter(e => e.tx_type === "collect_loan").reduce((s, e) => s + Number(e.amount_idr || 0), 0);
  const outstanding  = totalLoaned - totalRepaid;
  const lastPayment  = rows.filter(e => e.tx_type === "collect_loan").sort((a, b) => b.tx_date.localeCompare(a.tx_date))[0];

  const periodLabel = rows.length > 0
    ? `${fmtDateShort(rows[0].tx_date)} – ${fmtDateShort(rows[rows.length - 1].tx_date)}`
    : "—";

  const BTN = (extra = {}) => ({
    fontSize: 12, padding: "6px 14px", borderRadius: 8,
    border: "1px solid #e5e7eb", background: "#f9fafb", color: "#374151",
    fontFamily: FF, cursor: "pointer", fontWeight: 600, ...extra,
  });

  // ── Excel export ───────────────────────────────────────────
  const exportExcel = () => {
    const wb   = XLSX.utils.book_new();
    const name = (receivable.name || "LoanStatement").replace(/[^a-zA-Z0-9]/g, "_");

    const summaryRows = [
      ["Loan Statement — Paulus Finance"],
      ["Person",        receivable.name],
      [],
      ["Total Loaned",  totalLoaned],
      ["Total Repaid",  totalRepaid],
      ["Outstanding",   outstanding],
      ["Last Payment",  lastPayment ? lastPayment.tx_date : "—"],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");

    const hdr = ["Tanggal", "Keterangan", "Jenis", "Pinjam", "Bayar", "Sisa Hutang"];
    const txRows = rowsWithBal.map(r => [
      r.tx_date,
      r.description || "",
      r._dir === "pinjam" ? "Give Loan" : "Collect Loan",
      r._dir === "pinjam" ? Number(r.amount_idr || 0) : "",
      r._dir === "bayar"  ? Number(r.amount_idr || 0) : "",
      r._runBal,
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hdr, ...txRows]), "Transactions");

    XLSX.writeFile(wb, `${name}_LoanStatement_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportPDF = () => window.print();

  const COLS    = "80px 1fr 110px 120px 120px 120px";
  const ROW_PAD = "0 14px";
  const HDR_CELLS = [
    { label: "Tanggal",     align: "left"  },
    { label: "Keterangan",  align: "left"  },
    { label: "Jenis",       align: "left"  },
    { label: "Pinjam",      align: "right" },
    { label: "Bayar",       align: "right" },
    { label: "Sisa Hutang", align: "right" },
  ];

  return (
    <div ref={printRef} style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: FF }}>

      {/* ── Header ── */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={onBack} style={BTN()}>← Back</button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>
            {receivable.name} — Loan Statement
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>
            Outstanding: <strong style={{ color: outstanding > 0 ? "#111827" : "#059669" }}>{fmtIDR(outstanding)}</strong>
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {onCollect && (
            <button onClick={onCollect} style={BTN({ background: "#f0fdf4", color: "#059669", border: "1px solid #bbf7d0" })}>
              ✓ Record Payment
            </button>
          )}
          {onGiveLoan && (
            <button onClick={onGiveLoan} style={BTN({ background: "#eff6ff", color: "#3b5bdb", border: "1px solid #bfdbfe" })}>
              + New Loan
            </button>
          )}
          <button onClick={exportPDF}   style={BTN()}>🖨 PDF</button>
          <button onClick={exportExcel} style={BTN()}>📊 Excel</button>
        </div>
      </div>

      {/* ── Print header ── */}
      <div className="print-only" style={{ display: "none" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#111827", fontFamily: FF }}>Paulus Finance — Loan Statement</div>
        <div style={{ fontSize: 13, color: "#374151", fontFamily: FF, marginTop: 4 }}>
          {receivable.name} · {periodLabel}
        </div>
        <hr style={{ margin: "10px 0", borderColor: "#e5e7eb" }} />
      </div>

      {/* ── Metrics ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <SummaryCard label="Total Loaned"  value={fmtIDR(totalLoaned)}  color="#d97706" bg="#fef9ec" />
        <SummaryCard label="Total Repaid"  value={fmtIDR(totalRepaid)}  color="#3B6D11" bg="#f0fdf4" />
        <SummaryCard label="Outstanding"   value={fmtIDR(outstanding)}  color={outstanding > 0 ? "#111827" : "#059669"} bg={outstanding <= 0 ? "#f0fdf4" : "#f9fafb"} />
        <SummaryCard label="Last Payment"  value={lastPayment ? fmtDateShort(lastPayment.tx_date) : "None"} color="#6b7280" bg="#f9fafb" />
      </div>

      {/* ── Empty ── */}
      {rows.length === 0 && (
        <div style={{
          background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb",
          padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: 13,
        }}>
          No transactions found for this person.
        </div>
      )}

      {/* ── Statement table ── */}
      {rows.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb", overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#f9fafb", borderBottom: "0.5px solid #e5e7eb", padding: ROW_PAD }}>
            {HDR_CELLS.map(({ label, align }) => (
              <div key={label} style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF, padding: "9px 6px", textAlign: align }}>
                {label}
              </div>
            ))}
          </div>

          {/* Grouped rows */}
          {grouped.map(([date, txs]) => (
            <div key={date}>
              <div style={{ background: "#f3f4f6", borderBottom: "0.5px solid #e5e7eb", padding: "5px 20px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>
                {fmtDateLabel(date)}
              </div>

              {txs.map(tx => {
                const amt = Number(tx.amount_idr || 0);
                const isPinjam = tx._dir === "pinjam";
                const fromAcc = accounts.find(a => a.id === tx.from_id);
                const toAcc   = accounts.find(a => a.id === tx.to_id);
                const sub     = isPinjam
                  ? (fromAcc ? `← ${fromAcc.name}` : "")
                  : (toAcc   ? `→ ${toAcc.name}`   : "");
                const b = fmtSaldo(tx._runBal);
                return (
                  <div key={tx.id} style={{ display: "grid", gridTemplateColumns: COLS, borderBottom: "0.5px solid #f3f4f6", padding: ROW_PAD, alignItems: "center" }}>
                    {/* Tanggal */}
                    <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, padding: "8px 6px", whiteSpace: "nowrap" }}>
                      {fmtDateShort(tx.tx_date)}
                    </div>

                    {/* Keterangan */}
                    <div style={{ padding: "8px 6px", minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "#111827", fontFamily: FF, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {tx.description || (isPinjam ? "Loan Given" : "Loan Collected")}
                      </div>
                      {sub && (
                        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, marginTop: 2 }}>{sub}</div>
                      )}
                    </div>

                    {/* Jenis badge */}
                    <div style={{ padding: "8px 6px" }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, fontFamily: FF,
                        background: isPinjam ? "#fef9c3" : "#f0fdf4",
                        color: isPinjam ? "#92400e" : "#059669",
                        borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap",
                      }}>
                        {isPinjam ? "Give Loan" : "Collect"}
                      </span>
                    </div>

                    {/* Pinjam */}
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#d97706", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                      {isPinjam ? fmtIDR(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                    </div>

                    {/* Bayar */}
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#3B6D11", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                      {!isPinjam ? fmtIDR(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                    </div>

                    {/* Sisa Hutang */}
                    <div style={{ fontSize: 12, fontWeight: 700, color: b.color, fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                      {b.sign}{b.text}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Closing row */}
          {(() => {
            const b = fmtSaldo(outstanding);
            return (
              <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#f9fafb", borderTop: "1.5px solid #e5e7eb", padding: ROW_PAD }}>
                <div style={{ fontSize: 11, color: "#374151", fontFamily: FF, padding: "9px 6px" }} />
                <div style={{ fontSize: 11, fontWeight: 800, color: b.color, fontFamily: FF, padding: "9px 6px" }}>Outstanding</div>
                <div />{/* Jenis */}
                <div />{/* Pinjam */}
                <div />{/* Bayar */}
                <div style={{ fontSize: 13, fontWeight: 800, color: b.color, fontFamily: FF, padding: "9px 6px", textAlign: "right" }}>{b.sign}{b.text}</div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Footer ── */}
      {rows.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#9ca3af", fontFamily: FF }}>
            {rows.length} transaction{rows.length !== 1 ? "s" : ""} · {periodLabel}
          </span>
          {(() => {
            const b = fmtSaldo(outstanding);
            return (
              <span style={{ fontSize: 12, fontWeight: 700, color: b.color, fontFamily: FF }}>
                Outstanding: {b.sign}{b.text}
              </span>
            );
          })()}
        </div>
      )}
    </div>
  );
}
