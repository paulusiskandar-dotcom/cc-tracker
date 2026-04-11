import { useState, useMemo } from "react";
import { ledgerApi, employeeLoanApi, loanPaymentsApi } from "../api";
import { supabase } from "../lib/supabase";
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
  total_amount: "", monthly_installment: "", already_paid: "",
  start_date: todayStr(), notes: "",
};

// ─── LOAN FORM FIELDS (shared by Add + Edit modals) ──────────
function LoanFormFields({ form, setForm, T, showAlreadyPaid = false }) {
  const total   = Number(form.total_amount   || 0);
  const monthly = Number(form.monthly_installment || 0);
  const totalMo = total > 0 && monthly > 0 ? Math.ceil(total / monthly) : null;
  const endDate = totalMo && form.start_date
    ? (() => {
        const d = new Date(form.start_date + "T00:00:00");
        d.setMonth(d.getMonth() + totalMo);
        return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      })()
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <FormRow>
        <Field label="Employee Name *">
          <Input value={form.employee_name} onChange={e => setForm(f => ({ ...f, employee_name: e.target.value }))} placeholder="Full name" />
        </Field>
        <Field label="Department">
          <Input value={form.employee_dept} onChange={e => setForm(f => ({ ...f, employee_dept: e.target.value }))} placeholder="e.g. Finance" />
        </Field>
      </FormRow>
      <FormRow>
        <AmountInput label="Total Loan Amount *" value={form.total_amount} onChange={v => setForm(f => ({ ...f, total_amount: v }))} currency="IDR" />
        <AmountInput label="Monthly Installment" value={form.monthly_installment} onChange={v => setForm(f => ({ ...f, monthly_installment: v }))} currency="IDR" />
      </FormRow>
      <Field label="Start Date">
        <Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
      </Field>
      {showAlreadyPaid && (
        <AmountInput label="Amount Already Paid (optional)" value={form.already_paid} onChange={v => setForm(f => ({ ...f, already_paid: v }))} currency="IDR" />
      )}
      <Field label="Notes">
        <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
      </Field>

      {/* Auto-calculated info box */}
      {totalMo && (
        <div style={{
          background: "#f0fdf4", border: "1px solid #bbf7d0",
          borderRadius: 10, padding: "12px 14px",
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#059669", marginBottom: 4 }}>Auto-calculated</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: "#374151" }}>Duration</span>
            <span style={{ fontWeight: 700, color: "#111827" }}>{totalMo} months</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: "#374151" }}>Monthly</span>
            <span style={{ fontWeight: 700, color: "#111827" }}>{fmtIDR(monthly)}</span>
          </div>
          {endDate && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: "#374151" }}>Ends</span>
              <span style={{ fontWeight: 700, color: "#111827" }}>{endDate}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
  const [selectedRec, setSelectedRec] = useState(null);

  const [outForm, setOutForm] = useState({
    date: todayStr(), description: "", amount: "",
    entity: "Hamasa", from_id: "", notes: "", cash_advance_fee: "",
  });

  // ── Settle (reimburse_in checklist) modal ─────────────────────
  const [settleModal,   setSettleModal]   = useState(false);
  const [settleRec,     setSettleRec]     = useState(null);   // receivable account
  const [settleChecked, setSettleChecked] = useState({});     // { entry.id: boolean }
  const [settleAmount,  setSettleAmount]  = useState("");     // editable received amount
  const [settleBankId,  setSettleBankId]  = useState("");
  const [settleShortfallCatId, setSettleShortfallCatId] = useState(null);

  // ── Employee Loan modals ──────────────────────────────────────
  const [addLoanModal,  setAddLoanModal]  = useState(false);
  const [editLoanModal, setEditLoanModal] = useState(false);
  const [payModal,      setPayModal]      = useState(false);
  const [selectedLoan,  setSelectedLoan]  = useState(null);

  const [loanForm, setLoanForm] = useState(EMPTY_LOAN);
  const [payForm,  setPayForm]  = useState({ amount: "", pay_date: todayStr(), notes: "" });

  // ── DERIVED ────────────────────────────────────────────────
  const receivables    = useMemo(() => accounts.filter(a => a.type === "receivable"), [accounts]);
  const reimburseAccs  = useMemo(() => receivables, [receivables]);
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
      const rec = receivables.find(r => r.entity === outForm.entity);
      if (!rec) {
        showToast(`No reimburse account for ${outForm.entity}. Add one in Accounts.`, "error");
        setSaving(false);
        return;
      }
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt = sn(outForm.amount);
      const fee = sn(outForm.cash_advance_fee);
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

      // Optional: record cash advance fee as an expense from the same account
      if (fee > 0) {
        const feeEntry = {
          tx_date:      outForm.date,
          description:  `${outForm.entity} Cash Advance Fee`,
          amount:       fee,
          currency:     "IDR",
          amount_idr:   fee,
          tx_type:      "expense",
          from_type:    "account",
          to_type:      "expense",
          from_id:      outForm.from_id,
          to_id:        null,
          entity:       outForm.entity,
          category_id:  "cash_advance_fee",
          notes:        `CA fee for: ${outForm.description}`,
          merchant_name: null, attachment_url: null,
          ai_categorized: false, ai_confidence: null,
          installment_id: null, scan_batch_id: null,
          is_reimburse: false,
        };
        const rf = await ledgerApi.create(user.id, feeEntry, accounts);
        if (rf) setLedger(prev => [rf, ...prev]);
      }

      await onRefresh();
      showToast(`Recorded: ${fmtIDR(amt, true)}${fee > 0 ? ` + ${fmtIDR(fee, true)} CA fee` : ""} for ${outForm.entity}`);
      setOutModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── SETTLE FLOW ──────────────────────────────────────────────
  // Open settle modal for a receivable account
  const openSettle = (rec) => {
    const outEntries = ledger.filter(e => e.tx_type === "reimburse_out" && e.to_id === rec.id);
    // Default: check all items
    const checked = {};
    outEntries.forEach(e => { checked[e.id] = true; });
    const defaultBank = bankAccounts.find(b =>
      (b.name || "").toLowerCase().includes("reimburse") || b.subtype === "reimburse"
    ) || bankAccounts[0];
    setSettleRec(rec);
    setSettleChecked(checked);
    setSettleAmount(String(Number(rec.receivable_outstanding || 0)));
    setSettleBankId(defaultBank?.id || "");
    setSettleShortfallCatId("cash_advance_fee");
    setSettleModal(true);
  };

  const handleSettle = async () => {
    if (!settleRec || !settleBankId) return showToast("Select a bank account", "error");
    const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
    const received = sn(settleAmount);
    if (received <= 0) return showToast("Enter amount received", "error");

    const outEntries = ledger.filter(e => e.tx_type === "reimburse_out" && e.to_id === settleRec.id);
    const checkedEntries = outEntries.filter(e => settleChecked[e.id]);
    const selectedTotal  = checkedEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
    const shortfall      = Math.max(0, selectedTotal - received);
    const excess         = Math.max(0, received - selectedTotal);

    setSaving(true);
    try {
      const created = [];

      // One reimburse_in for the received amount
      const inEntry = {
        tx_date:      todayStr(),
        description:  `${settleRec.entity} reimburse received`,
        amount:       received,
        currency:     "IDR",
        amount_idr:   received,
        tx_type:      "reimburse_in",
        from_type:    "account",
        to_type:      "account",
        from_id:      settleRec.id,
        to_id:        settleBankId,
        entity:       settleRec.entity,
        is_reimburse: true,
        notes:        checkedEntries.map(e => e.description).join(", ") || null,
        merchant_name: null, attachment_url: null,
        ai_categorized: false, ai_confidence: null,
        installment_id: null, scan_batch_id: null,
        category_id: null, category_name: null,
      };
      const r1 = await ledgerApi.create(user.id, inEntry, accounts);
      if (r1) created.push(r1);

      // If shortfall: record as expense from receivable (write-off)
      if (shortfall > 0) {
        const expEntry = {
          tx_date:      todayStr(),
          description:  `${settleRec.entity} settlement shortfall`,
          amount:       shortfall,
          currency:     "IDR",
          amount_idr:   shortfall,
          tx_type:      "reimburse_in",  // use reimburse_in so receivable is debited
          from_type:    "account",
          to_type:      "account",
          from_id:      settleRec.id,
          to_id:        settleBankId,    // goes to same bank (will be zero-value net)
          entity:       settleRec.entity,
          is_reimburse: true,
          category_id:  settleShortfallCatId || null,
          notes:        "Shortfall write-off",
          merchant_name: null, attachment_url: null,
          ai_categorized: false, ai_confidence: null,
          installment_id: null, scan_batch_id: null,
          category_name: null,
        };
        // Manually reduce receivable_outstanding for shortfall, then reverse bank delta
        const r2 = await ledgerApi.create(user.id, expEntry, accounts);
        if (r2) created.push(r2);
        // Reverse the bank credit (shortfall didn't actually arrive)
        // We do this by applying a -shortfall to the bank account directly
        const bankAcc = bankAccounts.find(a => a.id === settleBankId);
        if (bankAcc) {
          await supabase.rpc("increment_account_balance", {
            p_account_id: settleBankId,
            p_field:      "current_balance",
            p_delta:      -shortfall,
          }).catch(() => {});
        }
      }

      // If excess: create income entry
      if (excess > 0) {
        const exEntry = {
          tx_date:      todayStr(),
          description:  `${settleRec.entity} settlement excess`,
          amount:       excess,
          currency:     "IDR",
          amount_idr:   excess,
          tx_type:      "income",
          from_type:    "income_source",
          to_type:      "account",
          from_id:      null,
          to_id:        settleBankId,
          entity:       "Personal",
          is_reimburse: false,
          notes:        "Excess reimbursement",
          merchant_name: null, attachment_url: null,
          ai_categorized: false, ai_confidence: null,
          installment_id: null, scan_batch_id: null,
          category_id: null, category_name: null,
        };
        const r3 = await ledgerApi.create(user.id, exEntry, accounts);
        if (r3) created.push(r3);
      }

      setLedger(prev => [...created, ...prev]);
      await onRefresh();
      showToast(`Settled ${fmtIDR(received, true)} for ${settleRec.entity}`);
      setSettleModal(false);
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
      const alreadyPaid   = sn(loanForm.already_paid);
      const monthlyAmt    = sn(loanForm.monthly_installment);
      const paidMonths    = monthlyAmt > 0 ? Math.floor(alreadyPaid / monthlyAmt) : 0;
      const d = {
        employee_name:        loanForm.employee_name.trim(),
        employee_dept:        loanForm.employee_dept.trim() || null,
        total_amount:         sn(loanForm.total_amount),
        monthly_installment:  monthlyAmt,
        start_date:           loanForm.start_date || null,
        notes:                loanForm.notes || null,
        status:               "active",
        paid_months:          paidMonths,
      };
      const created = await employeeLoanApi.create(user.id, d);
      if (created) setEmployeeLoans(prev => [created, ...prev]);

      // If already_paid > 0, record initial payments so loansWithStats is accurate
      if (alreadyPaid > 0) {
        const initPayment = await loanPaymentsApi.create(user.id, {
          loan_id:  created.id,
          pay_date: loanForm.start_date || todayStr(),
          amount:   alreadyPaid,
          notes:    "Initial paid amount (pre-existing)",
        });
        if (initPayment) setLoanPayments(prev => [initPayment, ...prev]);
      }

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

  const totalReimburse  = reimburseAccs.reduce((s, a) => s + Number(a.receivable_outstanding || 0), 0);
  const activeReimburse = reimburseAccs.filter(a => Number(a.receivable_outstanding || 0) > 0).length;

  const activeLoans = loansWithStats.filter(l => l.status !== "settled" && l.remaining > 0);
  const nextLoanDue = (() => {
    const dues = activeLoans.flatMap(loan => {
      if (!loan.start_date || !Number(loan.monthly_installment)) return [];
      const day = new Date(loan.start_date + "T00:00:00").getDate();
      const now = new Date();
      let d = new Date(now.getFullYear(), now.getMonth(), day);
      if (d <= now) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
      return [d];
    });
    if (!dues.length) return null;
    dues.sort((a, b) => a - b);
    return dues[0].toLocaleDateString("en-US", { month: "short", day: "numeric" });
  })();

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
          setOutForm({ date: todayStr(), description: "", amount: "", entity: "Hamasa", from_id: spendAccounts[0]?.id || "", notes: "", cash_advance_fee: "" });
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
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* ── Summary cards ── */}
          {reimburseAccs.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {[
                { label: "Total Outstanding", value: fmtIDR(totalReimburse, true), color: totalReimburse > 0 ? "#059669" : "#6b7280" },
                { label: "Active Entities",   value: String(activeReimburse),       color: "#3b5bdb" },
                { label: "Total Entities",    value: String(reimburseAccs.length),  color: "#d97706" },
              ].map(s => (
                <div key={s.label} style={{
                  background: s.color + "14", borderRadius: 14, padding: "14px 14px",
                }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 5, opacity: 0.8 }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {reimburseAccs.length === 0 ? (
            <EmptyState
              icon="📋"
              message="No reimburse accounts. Add one from Accounts (type: Receivable → Reimburse)."
            />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
              {recStats.map(r => {
                const outstanding   = Number(r.receivable_outstanding || 0);
                const entCol        = ENT_COL[r.entity] || T.ac;
                const entBg         = ENT_BG[r.entity]  || T.sur2;
                const recentEntries = r.entries.slice(0, 3);

                return (
                  <div key={r.id} style={{
                    background: "#ffffff", borderRadius: 16,
                    border: "0.5px solid #e5e7eb",
                    overflow: "hidden",
                    display: "flex", flexDirection: "column",
                  }}>
                    {/* Color bar */}
                    <div style={{ height: 3, background: entCol }} />

                    <div style={{ padding: "14px 14px 12px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                      {/* Entity badge */}
                      <div>
                        <span style={{
                          display: "inline-block",
                          background: entBg, color: entCol,
                          borderRadius: 6, padding: "2px 8px",
                          fontSize: 11, fontWeight: 700, fontFamily: "Figtree, sans-serif",
                        }}>
                          {r.entity}
                        </span>
                      </div>

                      {/* Outstanding amount */}
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: outstanding > 0 ? entCol : "#9ca3af", fontFamily: "Figtree, sans-serif", lineHeight: 1.2 }}>
                          {fmtIDR(outstanding)}
                        </div>
                        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>outstanding</div>
                      </div>

                      {/* Aging badge */}
                      {r.aging && outstanding > 0 && (
                        <div style={{
                          display: "inline-flex", alignSelf: "flex-start",
                          background: r.aging.color + "22", color: r.aging.color,
                          borderRadius: 5, padding: "2px 7px",
                          fontSize: 10, fontWeight: 700, fontFamily: "Figtree, sans-serif",
                        }}>
                          ⏱ {r.aging.label}
                        </div>
                      )}

                      {/* Recent entries */}
                      {recentEntries.length > 0 && (
                        <div style={{ borderTop: "0.5px solid #f3f4f6", paddingTop: 8 }}>
                          {recentEntries.map(e => (
                            <div key={e.id} style={{
                              display: "flex", justifyContent: "space-between",
                              fontSize: 11, color: "#6b7280", marginBottom: 4, gap: 6,
                            }}>
                              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {e.tx_date.slice(5)} · {e.description}
                              </span>
                              <span style={{ fontWeight: 700, flexShrink: 0, color: e.tx_type === "reimburse_in" ? "#059669" : "#dc2626" }}>
                                {e.tx_type === "reimburse_in" ? "−" : "+"}{fmtIDR(Number(e.amount || 0), true)}
                              </span>
                            </div>
                          ))}
                          {r.entries.length > 3 && (
                            <div style={{ fontSize: 10, color: "#9ca3af" }}>
                              +{r.entries.length - 3} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Bottom action bar */}
                    <div style={{ borderTop: "0.5px solid #f3f4f6", padding: "8px 14px", display: "flex", gap: 6 }}>
                      <button
                        onClick={() => { setOutForm(f => ({ ...f, entity: r.entity })); setOutModal(true); }}
                        style={{
                          flex: 1, height: 30, border: "none", borderRadius: 8, cursor: "pointer",
                          background: entBg, color: entCol,
                          fontSize: 12, fontWeight: 700, fontFamily: "Figtree, sans-serif",
                        }}
                      >
                        + Expense
                      </button>
                      {outstanding > 0 && (
                        <button
                          onClick={() => openSettle(r)}
                          style={{
                            flex: 1, height: 30, border: "1px solid #bbf7d0", borderRadius: 8, cursor: "pointer",
                            background: "#f0fdf4", color: "#059669",
                            fontSize: 12, fontWeight: 700, fontFamily: "Figtree, sans-serif",
                          }}
                        >
                          ✓ Settle
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── LOANS TAB ────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "loans" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* ── Summary cards + Add button row ── */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, flex: 1 }}>
              {[
                { label: "Total Outstanding",  value: fmtIDR(totalLoanOutstanding, true), color: totalLoanOutstanding > 0 ? "#d97706" : "#6b7280" },
                { label: "Active Employees",   value: String(activeLoans.length),          color: "#3b5bdb" },
                { label: "Next Payment Due",   value: nextLoanDue || "—",                  color: "#0891b2" },
              ].map(s => (
                <div key={s.label} style={{ background: s.color + "14", borderRadius: 14, padding: "14px 14px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 5, opacity: 0.8 }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
            <Button variant="primary" size="sm" onClick={() => { setLoanForm(EMPTY_LOAN); setAddLoanModal(true); }}
              style={{ flexShrink: 0, alignSelf: "center" }}>
              + Add Loan
            </Button>
          </div>

          {loansWithStats.length === 0 ? (
            <EmptyState icon="👤" message="No employee loans yet. Click + Add Loan to create one." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
              {loansWithStats.map(loan => {
                const total     = Number(loan.total_amount || 0);
                const paid      = loan.paidSoFar;
                const remaining = loan.remaining;
                const monthly   = Number(loan.monthly_installment || 0);
                const isSettled = loan.status === "settled" || remaining <= 0;
                const totalMo   = total > 0 && monthly > 0 ? Math.ceil(total / monthly) : 0;
                const paidMo    = monthly > 0 ? Math.floor(paid / monthly) : 0;
                const pct       = totalMo > 0 ? Math.min(100, (paidMo / totalMo) * 100) : 0;
                const accentColor = isSettled ? "#059669" : "#d97706";

                const initials = (loan.employee_name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

                const startedLabel = loan.start_date
                  ? new Date(loan.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })
                  : null;

                const nextDueLabel = (() => {
                  if (!loan.start_date || !monthly || isSettled) return null;
                  const day = new Date(loan.start_date + "T00:00:00").getDate();
                  const now = new Date();
                  let d = new Date(now.getFullYear(), now.getMonth(), day);
                  if (d <= now) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
                  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
                })();

                return (
                  <div key={loan.id} style={{
                    background: "#ffffff", borderRadius: 16,
                    border: "0.5px solid #e5e7eb",
                    overflow: "hidden",
                    display: "flex", flexDirection: "column",
                  }}>
                    {/* Color bar */}
                    <div style={{ height: 3, background: accentColor }} />

                    <div style={{ padding: "14px 14px 12px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                      {/* Avatar + name + dept */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                          background: isSettled ? "#dcfce7" : "#fef3c7",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 13, fontWeight: 800, color: accentColor, fontFamily: "Figtree, sans-serif",
                        }}>
                          {initials}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {loan.employee_name}
                          </div>
                          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 1 }}>
                            {[loan.employee_dept, startedLabel ? `Started ${startedLabel}` : null].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        {isSettled && (
                          <span style={{ fontSize: 9, fontWeight: 700, background: "#dcfce7", color: "#059669", padding: "2px 6px", borderRadius: 99, flexShrink: 0 }}>SETTLED</span>
                        )}
                      </div>

                      {/* Total amount */}
                      <div>
                        <div style={{ fontSize: 20, fontWeight: 900, color: "#111827", fontFamily: "Figtree, sans-serif", lineHeight: 1.2 }}>
                          {fmtIDR(total)}
                        </div>
                        {monthly > 0 && totalMo > 0 && (
                          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                            {fmtIDR(monthly, true)}/mo × {totalMo} months
                          </div>
                        )}
                      </div>

                      {/* Progress bar */}
                      {totalMo > 0 && (
                        <div>
                          <div style={{ height: 5, background: "#f3f4f6", borderRadius: 99, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: accentColor, borderRadius: 99, transition: "width 0.3s" }} />
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 4 }}>
                            <span>{paidMo}/{totalMo} months paid</span>
                            <span style={{ fontWeight: 700, color: accentColor }}>Remaining: {fmtIDR(remaining, true)}</span>
                          </div>
                        </div>
                      )}

                      {/* Next due */}
                      {nextDueLabel && (
                        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                          Next due: <span style={{ fontWeight: 700, color: "#111827" }}>{nextDueLabel}</span>
                        </div>
                      )}

                      {/* Notes */}
                      {loan.notes && (
                        <div style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic", fontFamily: "Figtree, sans-serif" }}>{loan.notes}</div>
                      )}
                    </div>

                    {/* Bottom action bar */}
                    <div style={{ borderTop: "0.5px solid #f3f4f6", padding: "8px 14px", display: "flex", gap: 6 }}>
                      {!isSettled && (
                        <button
                          onClick={() => { setSelectedLoan(loan); setPayForm({ amount: String(monthly || ""), pay_date: todayStr(), notes: "" }); setPayModal(true); }}
                          style={{ flex: 1, height: 30, border: "none", borderRadius: 8, cursor: "pointer", background: "#fef3c7", color: "#d97706", fontSize: 12, fontWeight: 700, fontFamily: "Figtree, sans-serif" }}
                        >
                          + Payment
                        </button>
                      )}
                      <button
                        onClick={() => { setSelectedLoan(loan); setLoanForm({ employee_name: loan.employee_name, employee_dept: loan.employee_dept || "", total_amount: String(loan.total_amount || ""), monthly_installment: String(loan.monthly_installment || ""), start_date: loan.start_date || todayStr(), notes: loan.notes || "" }); setEditLoanModal(true); }}
                        style={{ flex: 1, height: 30, border: "0.5px solid #e5e7eb", borderRadius: 8, cursor: "pointer", background: "#ffffff", color: "#374151", fontSize: 12, fontWeight: 600, fontFamily: "Figtree, sans-serif" }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteLoan(loan)}
                        style={{ height: 30, padding: "0 10px", border: "none", borderRadius: 8, cursor: "pointer", background: "none", color: "#d1d5db", fontSize: 12, fontFamily: "Figtree, sans-serif" }}
                        onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                        onMouseLeave={e => e.currentTarget.style.color = "#d1d5db"}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
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
          <AmountInput
            label="Cash Advance Fee (optional)"
            value={outForm.cash_advance_fee}
            onChange={v => setOutForm(f => ({ ...f, cash_advance_fee: v }))}
            currency="IDR"
          />
          <Field label="Notes">
            <Input value={outForm.notes} onChange={e => setOutForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
          </Field>
        </div>
      </Modal>

      {/* ── SETTLE REIMBURSEMENT MODAL (checklist) ────── */}
      <Modal
        isOpen={settleModal && !!settleRec}
        onClose={() => setSettleModal(false)}
        title={`Settle ${settleRec?.entity || ""} Receivables`}
        footer={
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" size="md" onClick={() => setSettleModal(false)}>Cancel</Button>
            <Button variant="primary" size="md" busy={saving} onClick={handleSettle}>
              Confirm Settlement
            </Button>
          </div>
        }
      >
        {settleRec && (() => {
          const outEntries = ledger.filter(e => e.tx_type === "reimburse_out" && e.to_id === settleRec.id);
          const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
          const selectedTotal = outEntries.filter(e => settleChecked[e.id]).reduce((s, e) => s + Number(e.amount || 0), 0);
          const received  = sn(settleAmount);
          const shortfall = Math.max(0, selectedTotal - received);
          const excess    = Math.max(0, received - selectedTotal);

          const allCats = [
            { value: "", label: "— no category —" },
          ].concat(
            (window._catOptions || [])
          );

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Checklist */}
              {outEntries.length === 0 ? (
                <div style={{ fontSize: 13, color: "#9ca3af", textAlign: "center", padding: "20px 0" }}>
                  No reimburse_out entries found for {settleRec.entity}.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0 8px", borderBottom: "1px solid #f3f4f6", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af" }}>ITEM</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af" }}>AMOUNT</span>
                  </div>
                  {outEntries.map(e => (
                    <label key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f9fafb", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!settleChecked[e.id]}
                        onChange={ev => {
                          setSettleChecked(c => ({ ...c, [e.id]: ev.target.checked }));
                        }}
                        style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#059669" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                          {e.description || "—"}
                        </div>
                        <div style={{ fontSize: 10, color: "#9ca3af" }}>{e.tx_date}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", fontFamily: "Figtree, sans-serif", flexShrink: 0 }}>
                        {fmtIDR(Number(e.amount || 0), true)}
                      </div>
                    </label>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", fontSize: 12, fontWeight: 700 }}>
                    <span style={{ color: "#6b7280" }}>Selected total</span>
                    <span style={{ color: "#111827" }}>{fmtIDR(selectedTotal)}</span>
                  </div>
                </div>
              )}

              {/* To account */}
              <Select
                label="To Bank Account *"
                value={settleBankId}
                onChange={e => setSettleBankId(e.target.value)}
                options={bankAccounts.map(b => ({ value: b.id, label: b.name }))}
                placeholder="Select bank…"
              />

              {/* Amount received (editable) */}
              <AmountInput
                label="Amount Received *"
                value={settleAmount}
                onChange={v => setSettleAmount(v)}
                currency="IDR"
              />

              {/* Shortfall / excess indicator */}
              {shortfall > 0 && (
                <div style={{ background: "#fef9ec", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 8 }}>
                    Shortfall: {fmtIDR(shortfall)} — write off as expense?
                  </div>
                  <Select
                    label="Category (optional)"
                    value={settleShortfallCatId || ""}
                    onChange={e => setSettleShortfallCatId(e.target.value || null)}
                    options={allCats}
                    placeholder="— skip —"
                  />
                </div>
              )}
              {excess > 0 && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 14px", fontSize: 12, fontWeight: 600, color: "#059669" }}>
                  Excess: {fmtIDR(excess)} — will be recorded as income.
                </div>
              )}
            </div>
          );
        })()}
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
        <LoanFormFields form={loanForm} setForm={setLoanForm} T={T} showAlreadyPaid />
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
        <LoanFormFields form={loanForm} setForm={setLoanForm} T={T} />
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
