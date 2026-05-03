import { useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fmtIDR } from "../utils";

const FF  = "Figtree, sans-serif";
const TH  = { fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", padding: "6px 8px", borderBottom: "1.5px solid #e5e7eb", fontFamily: FF };
const TD  = { fontSize: 12, padding: "8px 8px", borderBottom: "0.5px solid #f3f4f6", fontFamily: FF, verticalAlign: "top" };

export default function LoanStatementPage({ employeeLoans = [], loanPayments = [] }) {
  const { loanId } = useParams();
  const navigate   = useNavigate();
  const printRef   = useRef(null);

  const loan = employeeLoans.find(l => String(l.id) === String(loanId));

  if (!loan) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: FF }}>
        <div style={{ fontSize: 14, color: "#6b7280" }}>Loan not found.</div>
        <button onClick={() => navigate(-1)} style={{ marginTop: 16, fontSize: 13, color: "#3b5bdb", background: "none", border: "none", cursor: "pointer" }}>← Back</button>
      </div>
    );
  }

  const total          = Number(loan.total_amount || 0);
  const payments       = loanPayments
    .filter(p => p.loan_id === loan.id)
    .sort((a, b) => (a.pay_date || "").localeCompare(b.pay_date || ""));
  const totalCollected = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const outstanding    = Math.max(0, total - totalCollected);
  const isSettled      = loan.status === "settled" || outstanding <= 0;

  let runBal = total;
  const tableRows = payments.map(p => {
    runBal = Math.max(0, runBal - Number(p.amount || 0));
    return { ...p, sisa: runBal };
  });

  const exportPDF = () => {
    const prev = document.title;
    document.title = `${loan.employee_name}_LoanStatement`;
    window.print();
    document.title = prev;
  };

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 16px", fontFamily: FF }}>

      {/* ── Nav ── */}
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <button onClick={() => navigate(-1)} style={{ fontSize: 13, color: "#3b5bdb", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          ← Back
        </button>
        <button onClick={exportPDF} style={{
          height: 32, padding: "0 14px", borderRadius: 8,
          background: "#111827", color: "#fff", border: "none",
          fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FF,
        }}>
          🖨 PDF
        </button>
      </div>

      <div ref={printRef} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>{loan.employee_name}</div>
            {loan.employee_dept && <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{loan.employee_dept}</div>}
          </div>
          <span style={{
            display: "inline-flex", alignItems: "center",
            padding: "4px 12px", borderRadius: 99, fontSize: 11, fontWeight: 700,
            background: isSettled ? "#dcfce7" : "#fef3c7",
            color:      isSettled ? "#059669" : "#d97706",
          }}>
            {isSettled ? "Settled" : "Active"}
          </span>
        </div>

        {/* ── Summary ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[
            { label: "Total Loaned",    value: fmtIDR(total),          color: "#3b5bdb" },
            { label: "Total Collected", value: fmtIDR(totalCollected), color: "#059669" },
            { label: "Outstanding",     value: fmtIDR(outstanding),    color: outstanding > 0 ? "#d97706" : "#059669" },
          ].map(s => (
            <div key={s.label} style={{ background: s.color + "12", borderRadius: 10, padding: "12px 12px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4, opacity: 0.8 }}>{s.label}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── Table ── */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...TH, textAlign: "left", width: 88 }}>Tanggal</th>
                <th style={{ ...TH, textAlign: "left" }}>Keterangan</th>
                <th style={{ ...TH, textAlign: "right", width: 100 }}>Pinjam</th>
                <th style={{ ...TH, textAlign: "right", width: 100 }}>Bayar</th>
                <th style={{ ...TH, textAlign: "right", width: 110 }}>Sisa Hutang</th>
              </tr>
            </thead>
            <tbody>
              {loan.start_date && (
                <tr style={{ background: "#f0f9ff" }}>
                  <td style={{ ...TD, color: "#6b7280" }}>{loan.start_date}</td>
                  <td style={{ ...TD, fontWeight: 600, color: "#111827" }}>Initial Loan</td>
                  <td style={{ ...TD, textAlign: "right", fontWeight: 700, color: "#3b5bdb" }}>{fmtIDR(total)}</td>
                  <td style={{ ...TD, textAlign: "right" }}>—</td>
                  <td style={{ ...TD, textAlign: "right", fontWeight: 700, color: "#374151" }}>{fmtIDR(total)}</td>
                </tr>
              )}
              {tableRows.map(row => (
                <tr key={row.id}>
                  <td style={{ ...TD, color: "#6b7280" }}>{row.pay_date}</td>
                  <td style={{ ...TD, color: "#374151" }}>{row.notes || "Payment"}</td>
                  <td style={{ ...TD, textAlign: "right" }}>—</td>
                  <td style={{ ...TD, textAlign: "right", fontWeight: 700, color: "#059669" }}>{fmtIDR(Number(row.amount || 0))}</td>
                  <td style={{ ...TD, textAlign: "right", fontWeight: 700, color: row.sisa <= 0 ? "#059669" : "#374151" }}>
                    {row.sisa <= 0 ? <span style={{ color: "#059669" }}>LUNAS</span> : fmtIDR(row.sisa)}
                  </td>
                </tr>
              ))}
              {tableRows.length === 0 && (
                <tr><td colSpan={5} style={{ ...TD, textAlign: "center", color: "#9ca3af" }}>No payments recorded yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
