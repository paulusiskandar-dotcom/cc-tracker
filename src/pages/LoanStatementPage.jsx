import { useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fmtIDR } from "../utils";

const FF  = "Figtree, sans-serif";
const TH  = { fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", padding: "9px 6px", fontFamily: FF };
const COLS = "90px 1fr 90px 130px 130px 130px";
const RP   = "0 14px";

function SummaryCard({ label, value, color, bg }) {
  return (
    <div style={{ background: bg, borderRadius: 12, padding: "14px 16px", border: "0.5px solid #e5e7eb", flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF, marginBottom: 6, opacity: 0.8 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: FF, lineHeight: 1.2 }}>{value}</div>
    </div>
  );
}

const fmtDateShort = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
};
const fmtDateLabel = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }); }
  catch { return d; }
};

export default function LoanStatementPage({
  employeeLoans = [], loanPayments = [], ledger = [], accounts = [],
}) {
  const { loanId } = useParams();
  const navigate   = useNavigate();
  const printRef   = useRef(null);

  const loan = employeeLoans.find(l => String(l.id) === String(loanId));

  // ── Try ledger first (employee_loan_id field) ─────────────────
  const ledgerRows = useMemo(() => {
    if (!loan) return [];
    return ledger
      .filter(e => String(e.employee_loan_id) === String(loan.id) &&
        (e.tx_type === "give_loan" || e.tx_type === "collect_loan"))
      .sort((a, b) => a.tx_date.localeCompare(b.tx_date));
  }, [ledger, loan]);

  // ── Running balance from ledger rows ──────────────────────────
  const ledgerRowsWithBal = useMemo(() => {
    let bal = 0;
    return ledgerRows.map(e => {
      const amt = Number(e.amount_idr || 0);
      if (e.tx_type === "give_loan")    bal += amt;
      if (e.tx_type === "collect_loan") bal -= amt;
      return { ...e, _runBal: bal, _dir: e.tx_type === "give_loan" ? "pinjam" : "bayar" };
    });
  }, [ledgerRows]);

  // ── Fallback: synthetic row + loanPayments ────────────────────
  const payments = useMemo(() => {
    if (!loan || ledgerRows.length > 0) return [];
    return loanPayments
      .filter(p => p.loan_id === loan.id)
      .sort((a, b) => (a.pay_date || "").localeCompare(b.pay_date || ""));
  }, [loan, loanPayments, ledgerRows.length]);

  const useLedger = ledgerRows.length > 0;

  // ── Summary metrics ───────────────────────────────────────────
  const { totalLoaned, totalCollected, outstanding, lastDate } = useMemo(() => {
    if (!loan) return { totalLoaned: 0, totalCollected: 0, outstanding: 0, lastDate: null };
    if (useLedger) {
      const tl = ledgerRows.filter(e => e.tx_type === "give_loan").reduce((s, e) => s + Number(e.amount_idr || 0), 0);
      const tc = ledgerRows.filter(e => e.tx_type === "collect_loan").reduce((s, e) => s + Number(e.amount_idr || 0), 0);
      const ld = ledgerRows.filter(e => e.tx_type === "collect_loan").sort((a, b) => b.tx_date.localeCompare(a.tx_date))[0];
      return { totalLoaned: tl, totalCollected: tc, outstanding: tl - tc, lastDate: ld?.tx_date || null };
    }
    const total = Number(loan.total_amount || 0);
    const tc = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const ld = payments.slice().sort((a, b) => (b.pay_date || "").localeCompare(a.pay_date || ""))[0];
    return { totalLoaned: total, totalCollected: tc, outstanding: Math.max(0, total - tc), lastDate: ld?.pay_date || null };
  }, [loan, useLedger, ledgerRows, payments]);

  // ── Group by date ─────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = {};
    if (useLedger) {
      ledgerRowsWithBal.forEach(r => {
        if (!map[r.tx_date]) map[r.tx_date] = [];
        map[r.tx_date].push(r);
      });
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [useLedger, ledgerRowsWithBal]);

  if (!loan) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: FF }}>
        <div style={{ fontSize: 14, color: "#6b7280" }}>Loan not found.</div>
        <button onClick={() => navigate(-1)} style={{ marginTop: 16, fontSize: 13, color: "#3b5bdb", background: "none", border: "none", cursor: "pointer" }}>← Back</button>
      </div>
    );
  }

  const isSettled = loan.status === "settled" || outstanding <= 0;

  const exportPDF = () => {
    const prev = document.title;
    document.title = `${loan.employee_name}_LoanStatement`;
    window.print();
    document.title = prev;
  };

  const BTN = (extra = {}) => ({
    height: 34, padding: "0 12px", borderRadius: 8, border: "1px solid #e5e7eb",
    background: "#f9fafb", color: "#374151", fontSize: 12, fontWeight: 600,
    cursor: "pointer", fontFamily: FF, ...extra,
  });

  return (
    <div ref={printRef} style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: FF }}>

      {/* ── Header ── */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={() => navigate(-1)} style={BTN()}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>{loan.employee_name}</span>
            <span style={{
              padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700,
              background: isSettled ? "#dcfce7" : "#fef3c7",
              color:      isSettled ? "#059669" : "#d97706",
            }}>
              {isSettled ? "Settled" : "Active"}
            </span>
          </div>
          {loan.employee_dept && <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{loan.employee_dept}</div>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={exportPDF} style={BTN()}>🖨 PDF</button>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <SummaryCard label="Total Loaned"    value={fmtIDR(totalLoaned)}    color="#d97706" bg="#fef9ec" />
        <SummaryCard label="Total Collected" value={fmtIDR(totalCollected)} color="#059669" bg="#f0fdf4" />
        <SummaryCard label="Outstanding"     value={fmtIDR(outstanding)}    color={outstanding > 0 ? "#111827" : "#059669"} bg={outstanding <= 0 ? "#f0fdf4" : "#f9fafb"} />
        <SummaryCard label="Last Payment"    value={lastDate ? fmtDateShort(lastDate) : "None"} color="#6b7280" bg="#f9fafb" />
      </div>

      {/* ── Ledger-based grid ── */}
      {useLedger ? (
        <div style={{ background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#f9fafb", borderBottom: "0.5px solid #e5e7eb", padding: RP }}>
            {[
              { label: "Tanggal",     align: "left"  },
              { label: "Keterangan",  align: "left"  },
              { label: "Jenis",       align: "left"  },
              { label: "Pinjam",      align: "right" },
              { label: "Bayar",       align: "right" },
              { label: "Sisa Hutang", align: "right" },
            ].map(({ label, align }) => (
              <div key={label} style={{ ...TH, textAlign: align }}>{label}</div>
            ))}
          </div>

          {grouped.map(([date, txs]) => (
            <div key={date}>
              <div style={{ background: "#f3f4f6", borderBottom: "0.5px solid #e5e7eb", padding: "5px 20px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>
                {fmtDateLabel(date)}
              </div>
              {txs.map(tx => {
                const amt      = Number(tx.amount_idr || 0);
                const isPinjam = tx._dir === "pinjam";
                const fromAcc  = accounts.find(a => a.id === tx.from_id);
                const toAcc    = accounts.find(a => a.id === tx.to_id);
                const sub      = isPinjam ? (fromAcc ? `← ${fromAcc.name}` : "") : (toAcc ? `→ ${toAcc.name}` : "");
                return (
                  <div key={tx.id} style={{ display: "grid", gridTemplateColumns: COLS, borderBottom: "0.5px solid #f3f4f6", padding: RP, alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, padding: "8px 6px", whiteSpace: "nowrap" }}>
                      {fmtDateShort(tx.tx_date)}
                    </div>
                    <div style={{ padding: "8px 6px", minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "#111827", fontFamily: FF, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {tx.description || (isPinjam ? "Loan Given" : "Loan Collected")}
                      </div>
                      {sub && <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, marginTop: 2 }}>{sub}</div>}
                    </div>
                    <div style={{ padding: "8px 6px" }}>
                      <span style={{ fontSize: 9, fontWeight: 700, fontFamily: FF, background: isPinjam ? "#fef9c3" : "#f0fdf4", color: isPinjam ? "#92400e" : "#059669", borderRadius: 4, padding: "2px 6px" }}>
                        {isPinjam ? "Give Loan" : "Collect"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#d97706", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                      {isPinjam ? fmtIDR(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#059669", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                      {!isPinjam ? fmtIDR(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: tx._runBal <= 0 ? "#059669" : "#111827", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                      {tx._runBal <= 0 ? <span style={{ color: "#059669" }}>LUNAS</span> : fmtIDR(tx._runBal)}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Closing row */}
          <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#f9fafb", borderTop: "1.5px solid #e5e7eb", padding: RP }}>
            <div /><div style={{ fontSize: 11, fontWeight: 800, color: outstanding <= 0 ? "#059669" : "#111827", fontFamily: FF, padding: "9px 6px" }}>Outstanding</div>
            <div /><div /><div />
            <div style={{ fontSize: 13, fontWeight: 800, color: outstanding <= 0 ? "#059669" : "#111827", fontFamily: FF, padding: "9px 6px", textAlign: "right" }}>
              {outstanding <= 0 ? "LUNAS" : fmtIDR(outstanding)}
            </div>
          </div>
        </div>
      ) : (
        /* ── Fallback: payment table (no ledger entries) ── */
        <div style={{ background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 120px 120px 130px", background: "#f9fafb", borderBottom: "0.5px solid #e5e7eb", padding: RP }}>
            {[["Tanggal","left"],["Keterangan","left"],["Pinjam","right"],["Bayar","right"],["Sisa Hutang","right"]].map(([l,a]) => (
              <div key={l} style={{ ...TH, textAlign: a }}>{l}</div>
            ))}
          </div>

          {/* Initial loan row */}
          {loan.start_date && (
            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 120px 120px 130px", borderBottom: "0.5px solid #f3f4f6", padding: RP, alignItems: "center", background: "#f0f9ff" }}>
              <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, padding: "8px 6px" }}>{loan.start_date}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", fontFamily: FF, padding: "8px 6px" }}>Initial Loan</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#3b5bdb", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>{fmtIDR(totalLoaned)}</div>
              <div style={{ fontSize: 12, color: "#d1d5db", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>—</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>{fmtIDR(totalLoaned)}</div>
            </div>
          )}

          {/* Payment rows */}
          {(() => {
            let runBal = totalLoaned;
            return payments.map(p => {
              runBal = Math.max(0, runBal - Number(p.amount || 0));
              return (
                <div key={p.id} style={{ display: "grid", gridTemplateColumns: "90px 1fr 120px 120px 130px", borderBottom: "0.5px solid #f3f4f6", padding: RP, alignItems: "center" }}>
                  <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, padding: "8px 6px" }}>{p.pay_date}</div>
                  <div style={{ fontSize: 12, color: "#374151", fontFamily: FF, padding: "8px 6px" }}>{p.notes || "Payment"}</div>
                  <div style={{ fontSize: 12, color: "#d1d5db", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>—</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#059669", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>{fmtIDR(Number(p.amount || 0))}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: runBal <= 0 ? "#059669" : "#374151", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                    {runBal <= 0 ? <span style={{ color: "#059669" }}>LUNAS</span> : fmtIDR(runBal)}
                  </div>
                </div>
              );
            });
          })()}

          {payments.length === 0 && !loan.start_date && (
            <div style={{ padding: "32px 20px", textAlign: "center", color: "#9ca3af", fontSize: 13, fontFamily: FF }}>No payments recorded yet</div>
          )}

          {/* Closing row */}
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 120px 120px 130px", background: "#f9fafb", borderTop: "1.5px solid #e5e7eb", padding: RP }}>
            <div /><div style={{ fontSize: 11, fontWeight: 800, color: outstanding <= 0 ? "#059669" : "#111827", fontFamily: FF, padding: "9px 6px" }}>Outstanding</div>
            <div /><div />
            <div style={{ fontSize: 13, fontWeight: 800, color: outstanding <= 0 ? "#059669" : "#111827", fontFamily: FF, padding: "9px 6px", textAlign: "right" }}>
              {outstanding <= 0 ? "LUNAS" : fmtIDR(outstanding)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
