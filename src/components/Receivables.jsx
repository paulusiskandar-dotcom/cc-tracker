import { useState, useMemo } from "react";
import { ledgerApi, employeeLoanApi, loanPaymentsApi } from "../api";
import { fmtIDR, todayStr, agingLabel } from "../utils";
import { ENT_COL, ENT_BG, LIGHT, DARK } from "../theme";
import {
  Modal, Button,
  Field, AmountInput, Input, FormRow,
  Select,
  EmptyState, showToast,
} from "./shared/index";

// ─── PROGRESS BAR ─────────────────────────────────────────────
function ProgressBar({ value, max, color = "#059669", height = 6 }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: "#e5e7eb", borderRadius: 99, height, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width .4s" }} />
    </div>
  );
}

const SUBTABS = [
  { id: "reimburse", label: "Reimburse"      },
  { id: "loans",     label: "Employee Loans" },
  { id: "history",   label: "History"        },
];

const ENTITY_CHOICES = ["Hamasa", "SDC", "Travelio"];

const EMPTY_LOAN = {
  employee_name: "", employee_dept: "",
  total_amount: "", monthly_installment: "",
  start_date: todayStr(), notes: "",
};

export default function Receivables({
  user, accounts, ledger,
  employeeLoans, setEmployeeLoans,
  loanPayments,  setLoanPayments,
  onRefresh, setAccounts, setLedger, dark,
}) {
  const T = dark ? DARK : LIGHT;

  const [subTab, setSubTab] = useState("reimburse");
  const [saving, setSaving] = useState(false);

  // ── Reimburse modals ─────────────────────────────────────────
  const [outModal, setOutModal]     = useState(false);
  const [inModal, setInModal]       = useState(false);
  const [selectedRec, setSelectedRec] = useState(null);

  const [outForm, setOutForm] = useState({
    date: todayStr(), description: "", amount: "",
    entity: "Hamasa", from_id: "", notes: "",
  });
  const [inForm, setInForm] = useState({
    date: todayStr(), amount: "", bank_id: "", notes: "",
  });

  // ── Employee Loan modals ──────────────────────────────────────
  const [addLoanModal,  setAddLoanModal]  = useState(false);
  const [editLoanModal, setEditLoanModal] = useState(false);
  const [payModal,      setPayModal]      = useState(false);
  const [selectedLoan,  setSelectedLoan]  = useState(null);

  const [loanForm, setLoanForm] = useState(EMPTY_LOAN);
  const [payForm,  setPayForm]  = useState({ amount: "", pay_date: todayStr(), notes: "" });

  // ── DERIVED ────────────────────────────────────────────────
  const receivables    = useMemo(() => accounts.filter(a => a.type === "receivable"), [accounts]);
  const reimburseAccs  = useMemo(() => receivables.filter(a => a.receivable_type === "reimburse"), [receivables]);
  const bankAccounts   = useMemo(() => accounts.filter(a => a.type === "bank"), [accounts]);
  const spendAccounts  = useMemo(() => accounts.filter(a => ["bank", "credit_card"].includes(a.type)), [accounts]);

  const recStats = useMemo(() => receivables.map(r => {
    const entries = ledger
      .filter(e => e.from_id === r.id || e.to_id === r.id)
      .sort((a, b) => b.tx_date.localeCompare(a.tx_date));
    const firstEntry = entries[entries.length - 1];
    const aging = firstEntry ? agingLabel(firstEntry.tx_date) : null;
    return { ...r, entries, aging };
  }), [receivables, ledger]);

  const settledEntries = useMemo(() =>
    ledger.filter(e => e.tx_type === "reimburse_in")
      .sort((a, b) => b.tx_date.localeCompare(a.tx_date))
  , [ledger]);

  // Per-loan: compute paid so far from payments table
  const loansWithStats = useMemo(() => {
    return employeeLoans.map(loan => {
      const payments = loanPayments.filter(p => p.loan_id === loan.id);
      const paidSoFar = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
      const remaining = Math.max(0, Number(loan.total_amount || 0) - paidSoFar);
      return { ...loan, paidSoFar, remaining, payments };
    });
  }, [employeeLoans, loanPayments]);

  const totalLoanOutstanding = useMemo(
    () => loansWithStats.filter(l => l.status !== "settled").reduce((s, l) => s + l.remaining, 0),
    [loansWithStats]
  );

  // ── REIMBURSE ACTIONS ──────────────────────────────────────
  const handleOut = async () => {
    if (!outForm.description || !outForm.amount || !outForm.from_id)
      return showToast("Fill all required fields", "error");
    setSaving(true);
    try {
      const rec = receivables.find(r =>
        r.entity === outForm.entity && r.receivable_type === "reimburse"
      );
      if (!rec) {
        showToast(`No reimburse account for ${outForm.entity}. Add one in Accounts.`, "error");
        setSaving(false);
        return;
      }
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt = sn(outForm.amount);
      const entry = {
        tx_date:      outForm.date,
        description:  outForm.description,
        amount:       amt,
        currency:     "IDR",
        amount_idr:   amt,
        tx_type:      "reimburse_out",
        from_type:    "account",
        to_type:      "account",
        from_id:      outForm.from_id,
        to_id:        rec.id,
        entity:       outForm.entity,
        notes:        outForm.notes || "",
        is_reimburse: true,
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(prev => [r, ...prev]);
      await onRefresh();
      showToast(`Recorded: ${fmtIDR(amt, true)} for ${outForm.entity}`);
      setOutModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleIn = async () => {
    if (!selectedRec || !inForm.amount || !inForm.bank_id)
      return showToast("Fill all required fields", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt = sn(inForm.amount);
      const entry = {
        tx_date:     inForm.date || todayStr(),
        description: `${selectedRec.entity} reimburse received`,
        amount:      amt,
        currency:    "IDR",
        amount_idr:  amt,
        tx_type:     "reimburse_in",
        from_type:   "account",
        to_type:     "account",
        from_id:     selectedRec.id,
        to_id:       inForm.bank_id,
        entity:      selectedRec.entity,
        notes:       inForm.notes || "",
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(prev => [r, ...prev]);
      await onRefresh();
      showToast(`Received ${fmtIDR(amt, true)} from ${selectedRec.entity}`);
      setInModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── EMPLOYEE LOAN ACTIONS ──────────────────────────────────
  const handleAddLoan = async () => {
    if (!loanForm.employee_name || !loanForm.total_amount)
      return showToast("Employee name and total amount are required", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const d = {
        employee_name:        loanForm.employee_name.trim(),
        employee_dept:        loanForm.employee_dept.trim() || null,
        total_amount:         sn(loanForm.total_amount),
        monthly_installment:  sn(loanForm.monthly_installment),
        start_date:           loanForm.start_date || null,
        notes:                loanForm.notes || null,
        status:               "active",
        paid_months:          0,
      };
      const created = await employeeLoanApi.create(user.id, d);
      if (created) setEmployeeLoans(prev => [created, ...prev]);
      showToast(`Loan added for ${d.employee_name}`);
      setAddLoanModal(false);
      setLoanForm(EMPTY_LOAN);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleEditLoan = async () => {
    if (!selectedLoan || !loanForm.employee_name || !loanForm.total_amount)
      return showToast("Employee name and total amount are required", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const d = {
        employee_name:        loanForm.employee_name.trim(),
        employee_dept:        loanForm.employee_dept.trim() || null,
        total_amount:         sn(loanForm.total_amount),
        monthly_installment:  sn(loanForm.monthly_installment),
        start_date:           loanForm.start_date || null,
        notes:                loanForm.notes || null,
      };
      const updated = await employeeLoanApi.update(selectedLoan.id, d);
      if (updated) setEmployeeLoans(prev => prev.map(l => l.id === updated.id ? updated : l));
      showToast("Loan updated");
      setEditLoanModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleDeleteLoan = async (loan) => {
    if (!window.confirm(`Delete loan for ${loan.employee_name}? This cannot be undone.`)) return;
    try {
      await employeeLoanApi.delete(loan.id);
      setEmployeeLoans(prev => prev.filter(l => l.id !== loan.id));
      setLoanPayments(prev => prev.filter(p => p.loan_id !== loan.id));
      showToast("Loan deleted");
    } catch (e) { showToast(e.message, "error"); }
  };

  const handleRecordPayment = async () => {
    if (!selectedLoan || !payForm.amount)
      return showToast("Amount is required", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt = sn(payForm.amount);
      const pd = {
        loan_id:  selectedLoan.id,
        pay_date: payForm.pay_date || todayStr(),
        amount:   amt,
        notes:    payForm.notes || null,
      };
      const created = await loanPaymentsApi.create(user.id, pd);
      if (created) setLoanPayments(prev => [created, ...prev]);

      // Check if fully paid → auto-settle
      const loan = loansWithStats.find(l => l.id === selectedLoan.id);
      const newPaid = (loan?.paidSoFar || 0) + amt;
      if (newPaid >= Number(loan?.total_amount || 0)) {
        await employeeLoanApi.update(selectedLoan.id, { status: "settled" });
        setEmployeeLoans(prev => prev.map(l => l.id === selectedLoan.id ? { ...l, status: "settled" } : l));
        showToast("Payment recorded — loan fully settled! 🎉");
      } else {
        showToast(`Payment of ${fmtIDR(amt, true)} recorded`);
      }
      setPayModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── STYLES ────────────────────────────────────────────────
  const card = (borderColor) => ({
    background:   T.surface,
    border:       `1px solid ${T.border}`,
    borderLeft:   `4px solid ${borderColor || T.ac}`,
    borderRadius: 16,
    padding:      "16px 18px",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── HEADER ──────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: "0.06em" }}>
          {reimburseAccs.reduce((s, a) => s + Number(a.receivable_outstanding || 0), 0) > 0 &&
            `${fmtIDR(reimburseAccs.reduce((s, a) => s + Number(a.receivable_outstanding || 0), 0), true)} reimburse outstanding`}
          {totalLoanOutstanding > 0 && reimburseAccs.reduce((s, a) => s + Number(a.receivable_outstanding || 0), 0) > 0 && "  ·  "}
          {totalLoanOutstanding > 0 &&
            `${fmtIDR(totalLoanOutstanding, true)} loans outstanding`}
        </div>
        <Button variant="primary" size="sm" onClick={() => {
          setOutForm({ date: todayStr(), description: "", amount: "", entity: "Hamasa", from_id: spendAccounts[0]?.id || "", notes: "" });
          setOutModal(true);
        }}>
          + Record Expense
        </Button>
      </div>

      {/* ── SUB-TABS ─────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 4 }}>
        {SUBTABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              padding:    "7px 16px",
              borderRadius: 99,
              border:     "none",
              cursor:     "pointer",
              fontSize:   13,
              fontWeight: 600,
              fontFamily: "Figtree, sans-serif",
              background: subTab === t.id ? T.text    : T.sur2,
              color:      subTab === t.id ? T.darkText : T.text2,
              transition: "background .15s, color .15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* ── REIMBURSE TAB ────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "reimburse" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {reimburseAccs.length === 0 ? (
            <EmptyState
              icon="📋"
              message="No reimburse accounts. Add one from Accounts (type: Receivable → Reimburse)."
            />
          ) : (
            recStats.filter(r => r.receivable_type === "reimburse").map(r => {
              const outstanding = Number(r.receivable_outstanding || 0);
              const entCol      = ENT_COL[r.entity] || T.ac;
              const entBg       = ENT_BG[r.entity]  || T.sur2;
              const recentEntries = r.entries.slice(0, 3);

              return (
                <div key={r.id} style={card(entCol)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    {/* Left */}
                    <div>
                      <span style={{
                        display: "inline-block",
                        background: entBg, color: entCol,
                        borderRadius: 6, padding: "2px 8px",
                        fontSize: 11, fontWeight: 700,
                      }}>
                        {r.entity}
                      </span>
                      <div style={{ fontSize: 24, fontWeight: 900, color: entCol, marginTop: 6 }}>
                        {fmtIDR(outstanding)}
                      </div>
                      <div style={{ fontSize: 11, color: T.text3 }}>outstanding</div>
                      {r.aging && outstanding > 0 && (
                        <div style={{
                          display: "inline-flex", marginTop: 6,
                          background: r.aging.color + "22", color: r.aging.color,
                          borderRadius: 5, padding: "2px 7px",
                          fontSize: 10, fontWeight: 700,
                        }}>
                          ⏱ {r.aging.label}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          setOutForm(f => ({ ...f, entity: r.entity }));
                          setOutModal(true);
                        }}
                      >
                        + Expense
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSelectedRec(r);
                          setInForm({
                            date:    todayStr(),
                            amount:  String(outstanding),
                            bank_id: bankAccounts[0]?.id || "",
                            notes:   "",
                          });
                          setInModal(true);
                        }}
                        style={{ color: "#059669", borderColor: "#059669" }}
                      >
                        ↙ Receive
                      </Button>
                    </div>
                  </div>

                  {/* Recent entries */}
                  {recentEntries.length > 0 && (
                    <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
                      {recentEntries.map(e => (
                        <div key={e.id} style={{
                          display: "flex", justifyContent: "space-between",
                          fontSize: 11, color: T.text3, marginBottom: 4,
                        }}>
                          <span>{e.tx_date} · {e.description}</span>
                          <span style={{ fontWeight: 700, color: e.tx_type === "reimburse_in" ? "#059669" : "#dc2626" }}>
                            {e.tx_type === "reimburse_in" ? "−" : "+"}{fmtIDR(Number(e.amount || 0), true)}
                          </span>
                        </div>
                      ))}
                      {r.entries.length > 3 && (
                        <div style={{ fontSize: 10, color: T.text3 }}>
                          +{r.entries.length - 3} more entries
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── LOANS TAB ────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "loans" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Add loan button */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="primary" size="sm" onClick={() => {
              setLoanForm(EMPTY_LOAN);
              setAddLoanModal(true);
            }}>
              + Add Loan
            </Button>
          </div>

          {loansWithStats.length === 0 ? (
            <EmptyState icon="👤" message="No employee loans yet. Click + Add Loan to create one." />
          ) : (
            loansWithStats.map(loan => {
              const total       = Number(loan.total_amount || 0);
              const paid        = loan.paidSoFar;
              const remaining   = loan.remaining;
              const pct         = total > 0 ? (paid / total) * 100 : 0;
              const monthly     = Number(loan.monthly_installment || 0);
              const isSettled   = loan.status === "settled" || remaining <= 0;

              // Next due date
              const nextDue = (() => {
                if (!loan.start_date || !monthly) return null;
                const day = new Date(loan.start_date).getDate();
                const now = new Date();
                let d = new Date(now.getFullYear(), now.getMonth(), day);
                if (d <= now) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
                return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
              })();

              // Last payment date for aging
              const lastPay = loan.payments[0]?.pay_date;
              const aging   = lastPay && !isSettled ? agingLabel(lastPay) : null;

              return (
                <div key={loan.id} style={card(isSettled ? "#059669" : "#d97706")}>
                  {/* Header row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    {/* Left: avatar + name */}
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 10,
                        background: isSettled ? "#dcfce7" : "#fef3c7",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 18, flexShrink: 0,
                      }}>
                        👤
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
                          {loan.employee_name}
                        </div>
                        {loan.employee_dept && (
                          <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                            {loan.employee_dept}
                          </div>
                        )}
                        {aging && (
                          <div style={{
                            display: "inline-flex", marginTop: 4,
                            background: aging.color + "22", color: aging.color,
                            borderRadius: 5, padding: "2px 7px",
                            fontSize: 10, fontWeight: 700,
                          }}>
                            {aging.label}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: amount */}
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                      {isSettled ? (
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#059669" }}>🎉 Settled</div>
                      ) : (
                        <>
                          <div style={{ fontSize: 18, fontWeight: 900, color: "#d97706" }}>
                            {fmtIDR(remaining, true)}
                          </div>
                          <div style={{ fontSize: 10, color: T.text3 }}>remaining</div>
                        </>
                      )}
                      {monthly > 0 && !isSettled && (
                        <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>
                          {fmtIDR(monthly, true)}/mo
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  {total > 0 && (
                    <>
                      <ProgressBar value={paid} max={total} color="#059669" height={6} />
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.text3, marginTop: 4 }}>
                        <span>{pct.toFixed(0)}% paid</span>
                        <span>{fmtIDR(paid, true)} / {fmtIDR(total, true)}</span>
                      </div>
                    </>
                  )}

                  {/* Next due */}
                  {!isSettled && nextDue && (
                    <div style={{ marginTop: 8, fontSize: 11, color: T.text3 }}>
                      📅 Next: <strong style={{ color: T.text }}>{nextDue}</strong>
                    </div>
                  )}

                  {/* Notes */}
                  {loan.notes && (
                    <div style={{ marginTop: 6, fontSize: 11, color: T.text3, fontStyle: "italic" }}>
                      {loan.notes}
                    </div>
                  )}

                  {/* Recent payments */}
                  {loan.payments.length > 0 && (
                    <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 10, paddingTop: 8 }}>
                      {loan.payments.slice(0, 3).map(p => (
                        <div key={p.id} style={{
                          display: "flex", justifyContent: "space-between",
                          fontSize: 11, color: T.text3, marginBottom: 3,
                        }}>
                          <span>{p.pay_date}{p.notes ? ` · ${p.notes}` : ""}</span>
                          <span style={{ fontWeight: 700, color: "#059669" }}>
                            {fmtIDR(Number(p.amount || 0), true)}
                          </span>
                        </div>
                      ))}
                      {loan.payments.length > 3 && (
                        <div style={{ fontSize: 10, color: T.text3 }}>+{loan.payments.length - 3} more</div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    {!isSettled && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          setSelectedLoan(loan);
                          setPayForm({
                            amount:   String(monthly || ""),
                            pay_date: todayStr(),
                            notes:    "",
                          });
                          setPayModal(true);
                        }}
                      >
                        + Record Payment
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelectedLoan(loan);
                        setLoanForm({
                          employee_name:        loan.employee_name,
                          employee_dept:        loan.employee_dept || "",
                          total_amount:         String(loan.total_amount || ""),
                          monthly_installment:  String(loan.monthly_installment || ""),
                          start_date:           loan.start_date || todayStr(),
                          notes:                loan.notes || "",
                        });
                        setEditLoanModal(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteLoan(loan)}
                      style={{ color: "#dc2626" }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── HISTORY TAB ──────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "history" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {settledEntries.length === 0 ? (
            <EmptyState icon="📜" message="No settled receivables yet." />
          ) : (
            settledEntries.map(e => {
              const rec = accounts.find(a => a.id === e.from_id);
              return (
                <div key={e.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 14px", background: T.sur2, borderRadius: 10,
                }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{e.description}</div>
                    <div style={{ fontSize: 10, color: T.text3 }}>
                      {e.tx_date} · {rec?.entity || rec?.contact_name || "—"}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#059669" }}>
                    +{fmtIDR(Number(e.amount || 0), true)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── RECORD EXPENSE MODAL (reimburse_out) ──────── */}
      {/* ══════════════════════════════════════════════════ */}
      <Modal
        isOpen={outModal}
        onClose={() => setOutModal(false)}
        title="Record Expense for Entity"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setOutModal(false)}>Cancel</Button>
            <Button
              variant="primary" size="md" busy={saving}
              disabled={!outForm.description || !outForm.amount || !outForm.from_id}
              onClick={handleOut}
            >
              Record Expense
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Entity *">
            <Select
              value={outForm.entity}
              onChange={e => setOutForm(f => ({ ...f, entity: e.target.value }))}
              options={ENTITY_CHOICES.map(e => ({ value: e, label: e }))}
            />
          </Field>
          <Field label="Description *">
            <Input
              value={outForm.description}
              onChange={e => setOutForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What was the expense?"
            />
          </Field>
          <FormRow>
            <AmountInput
              label="Amount (IDR) *"
              value={outForm.amount}
              onChange={v => setOutForm(f => ({ ...f, amount: v }))}
              currency="IDR"
            />
            <Field label="Date">
              <Input type="date" value={outForm.date} onChange={e => setOutForm(f => ({ ...f, date: e.target.value }))} />
            </Field>
          </FormRow>
          <Field label="Paid From *">
            <Select
              value={outForm.from_id}
              onChange={e => setOutForm(f => ({ ...f, from_id: e.target.value }))}
              options={spendAccounts.map(a => ({ value: a.id, label: a.name }))}
              placeholder="Select account…"
            />
          </Field>
          <Field label="Notes">
            <Input value={outForm.notes} onChange={e => setOutForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
          </Field>
        </div>
      </Modal>

      {/* ── RECEIVE REIMBURSEMENT MODAL ─────────────────── */}
      <Modal
        isOpen={inModal && !!selectedRec}
        onClose={() => setInModal(false)}
        title="Receive Reimbursement"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setInModal(false)}>Cancel</Button>
            <Button variant="primary" size="md" busy={saving} disabled={!inForm.amount || !inForm.bank_id} onClick={handleIn}>
              Record →
            </Button>
          </div>
        }
      >
        {selectedRec && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{
              background: ENT_BG[selectedRec.entity] || T.sur2,
              borderRadius: 10, padding: "10px 14px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div style={{ fontSize: 12, color: T.text2 }}>Outstanding — {selectedRec.entity}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: ENT_COL[selectedRec.entity] || T.ac }}>
                {fmtIDR(Number(selectedRec.receivable_outstanding || 0))}
              </div>
            </div>
            <FormRow>
              <AmountInput label="Amount Received *" value={inForm.amount} onChange={v => setInForm(f => ({ ...f, amount: v }))} currency="IDR" />
              <Field label="Date">
                <Input type="date" value={inForm.date} onChange={e => setInForm(f => ({ ...f, date: e.target.value }))} />
              </Field>
            </FormRow>
            <Field label="To Bank Account *">
              <Select
                value={inForm.bank_id}
                onChange={e => setInForm(f => ({ ...f, bank_id: e.target.value }))}
                options={bankAccounts.map(b => ({ value: b.id, label: b.name }))}
                placeholder="Select bank…"
              />
            </Field>
            <Field label="Notes">
              <Input value={inForm.notes} onChange={e => setInForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
            </Field>
          </div>
        )}
      </Modal>

      {/* ── ADD LOAN MODAL ───────────────────────────────── */}
      <Modal
        isOpen={addLoanModal}
        onClose={() => setAddLoanModal(false)}
        title="Add Employee Loan"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setAddLoanModal(false)}>Cancel</Button>
            <Button
              variant="primary" size="md" busy={saving}
              disabled={!loanForm.employee_name || !loanForm.total_amount}
              onClick={handleAddLoan}
            >
              Add Loan
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <FormRow>
            <Field label="Employee Name *">
              <Input value={loanForm.employee_name} onChange={e => setLoanForm(f => ({ ...f, employee_name: e.target.value }))} placeholder="Full name" />
            </Field>
            <Field label="Department">
              <Input value={loanForm.employee_dept} onChange={e => setLoanForm(f => ({ ...f, employee_dept: e.target.value }))} placeholder="e.g. Finance" />
            </Field>
          </FormRow>
          <FormRow>
            <AmountInput label="Total Loan Amount *" value={loanForm.total_amount} onChange={v => setLoanForm(f => ({ ...f, total_amount: v }))} currency="IDR" />
            <AmountInput label="Monthly Installment" value={loanForm.monthly_installment} onChange={v => setLoanForm(f => ({ ...f, monthly_installment: v }))} currency="IDR" />
          </FormRow>
          <Field label="Start Date">
            <Input type="date" value={loanForm.start_date} onChange={e => setLoanForm(f => ({ ...f, start_date: e.target.value }))} />
          </Field>
          <Field label="Notes">
            <Input value={loanForm.notes} onChange={e => setLoanForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
          </Field>
        </div>
      </Modal>

      {/* ── EDIT LOAN MODAL ──────────────────────────────── */}
      <Modal
        isOpen={editLoanModal && !!selectedLoan}
        onClose={() => setEditLoanModal(false)}
        title={`Edit Loan — ${selectedLoan?.employee_name || ""}`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setEditLoanModal(false)}>Cancel</Button>
            <Button
              variant="primary" size="md" busy={saving}
              disabled={!loanForm.employee_name || !loanForm.total_amount}
              onClick={handleEditLoan}
            >
              Save
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <FormRow>
            <Field label="Employee Name *">
              <Input value={loanForm.employee_name} onChange={e => setLoanForm(f => ({ ...f, employee_name: e.target.value }))} />
            </Field>
            <Field label="Department">
              <Input value={loanForm.employee_dept} onChange={e => setLoanForm(f => ({ ...f, employee_dept: e.target.value }))} />
            </Field>
          </FormRow>
          <FormRow>
            <AmountInput label="Total Loan Amount *" value={loanForm.total_amount} onChange={v => setLoanForm(f => ({ ...f, total_amount: v }))} currency="IDR" />
            <AmountInput label="Monthly Installment" value={loanForm.monthly_installment} onChange={v => setLoanForm(f => ({ ...f, monthly_installment: v }))} currency="IDR" />
          </FormRow>
          <Field label="Start Date">
            <Input type="date" value={loanForm.start_date} onChange={e => setLoanForm(f => ({ ...f, start_date: e.target.value }))} />
          </Field>
          <Field label="Notes">
            <Input value={loanForm.notes} onChange={e => setLoanForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
          </Field>
        </div>
      </Modal>

      {/* ── RECORD PAYMENT MODAL ─────────────────────────── */}
      <Modal
        isOpen={payModal && !!selectedLoan}
        onClose={() => setPayModal(false)}
        title={`Record Payment — ${selectedLoan?.employee_name || ""}`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setPayModal(false)}>Cancel</Button>
            <Button variant="primary" size="md" busy={saving} disabled={!payForm.amount} onClick={handleRecordPayment}>
              Save
            </Button>
          </div>
        }
      >
        {selectedLoan && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Outstanding banner */}
            <div style={{
              background: T.sur2, borderRadius: 10, padding: "10px 14px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div style={{ fontSize: 12, color: T.text2 }}>Remaining</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#d97706" }}>
                {fmtIDR(loansWithStats.find(l => l.id === selectedLoan.id)?.remaining || 0)}
              </div>
            </div>
            <FormRow>
              <AmountInput label="Amount *" value={payForm.amount} onChange={v => setPayForm(f => ({ ...f, amount: v }))} currency="IDR" />
              <Field label="Date">
                <Input type="date" value={payForm.pay_date} onChange={e => setPayForm(f => ({ ...f, pay_date: e.target.value }))} />
              </Field>
            </FormRow>
            <Field label="Notes">
              <Input value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
            </Field>
          </div>
        )}
      </Modal>

    </div>
  );
}
