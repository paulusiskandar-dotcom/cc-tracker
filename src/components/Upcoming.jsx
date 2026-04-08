import { useMemo, useState } from "react";
import { recurringApi, loanPaymentsApi } from "../api";
import { fmtIDR, todayStr } from "../utils";
import { showToast, Button, Modal, AmountInput, Field, Input, FormRow } from "./shared/index";
import { LIGHT, DARK } from "../theme";

const TYPE_META = {
  reminder:    { icon: "🔄", color: "#3b5bdb", bg: "#dbeafe" },
  loan:        { icon: "👤", color: "#d97706", bg: "#fef3c7" },
  receivable:  { icon: "📋", color: "#d97706", bg: "#fef9ec" },
  installment: { icon: "📅", color: "#9ca3af", bg: "#f3f4f6" },
};

export default function Upcoming({
  user, accounts, ledger, reminders, recurTemplates,
  employeeLoans = [], loanPayments = [], receivables = [],
  installments = [], creditCards = [], bankAccounts = [],
  categories = [],
  setReminders, setLoanPayments, setEmployeeLoans, setLedger,
  onRefresh, setTab, dark,
}) {
  const T = dark ? DARK : LIGHT;
  const [confirmingId, setConfirmingId] = useState(null);
  const [payModal, setPayModal]   = useState(false);
  const [payLoan,  setPayLoan]    = useState(null);
  const [payForm,  setPayForm]    = useState({ amount: "", pay_date: todayStr(), notes: "" });
  const [saving,   setSaving]     = useState(false);

  // ── Loan stats ──────────────────────────────────────────────
  const loansWithStats = useMemo(() => {
    return employeeLoans.map(loan => {
      const payments = loanPayments.filter(p => p.loan_id === loan.id);
      const paidSoFar = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
      const remaining = Math.max(0, Number(loan.total_amount || 0) - paidSoFar);
      return { ...loan, paidSoFar, remaining };
    });
  }, [employeeLoans, loanPayments]);

  // ── Build unified upcoming list ──────────────────────────────
  const items = useMemo(() => {
    const all = [];
    const today = new Date();

    // 1. Pending recurring reminders
    reminders.forEach(r => {
      all.push({
        id: `reminder-${r.id}`,
        type: "reminder",
        raw: r,
        date: r.due_date,
        title: r.recurring_templates?.name || "Reminder",
        amount: Number(r.recurring_templates?.amount || 0),
        sub: r.recurring_templates?.entity || "",
        actionable: true,
      });
    });

    // 2. Employee loan next payments
    loansWithStats
      .filter(l => l.status !== "settled" && l.remaining > 0)
      .forEach(loan => {
        if (!loan.monthly_installment) return;
        const startDay = loan.start_date
          ? new Date(loan.start_date + "T00:00:00").getDate()
          : 1;
        let nextDue = new Date(today.getFullYear(), today.getMonth(), startDay);
        if (nextDue <= today) nextDue = new Date(today.getFullYear(), today.getMonth() + 1, startDay);
        all.push({
          id: `loan-${loan.id}`,
          type: "loan",
          raw: loan,
          date: nextDue.toISOString().slice(0, 10),
          title: `${loan.employee_name} — Monthly Payment`,
          amount: Number(loan.monthly_installment),
          sub: `Remaining: ${fmtIDR(loan.remaining, true)}`,
          actionable: true,
        });
      });

    // 3. Outstanding receivables
    receivables
      .filter(r => Number(r.receivable_outstanding || 0) > 0)
      .forEach(r => {
        all.push({
          id: `recv-${r.id}`,
          type: "receivable",
          raw: r,
          date: todayStr(),
          title: `${r.entity || r.name} — Outstanding Receivable`,
          amount: Number(r.receivable_outstanding),
          sub: r.entity || "",
          actionable: false, // settling is done in Receivables tab
        });
      });

    // 4. CC installments (info-only)
    installments
      .filter(inst => (inst.paid_months || 0) < (inst.months || 0))
      .forEach(inst => {
        const cc = creditCards.find(c => c.id === inst.account_id);
        const startDay = inst.start_date
          ? new Date(inst.start_date + "T00:00:00").getDate()
          : 1;
        let nextDue = new Date(today.getFullYear(), today.getMonth(), startDay);
        if (nextDue <= today) nextDue = new Date(today.getFullYear(), today.getMonth() + 1, startDay);
        all.push({
          id: `install-${inst.id}`,
          type: "installment",
          raw: inst,
          date: nextDue.toISOString().slice(0, 10),
          title: inst.description || "CC Installment",
          amount: Number(inst.monthly_amount || 0),
          sub: `${cc?.name || "CC"} · ${inst.paid_months}/${inst.months} paid`,
          actionable: false,
        });
      });

    return all.sort((a, b) => a.date.localeCompare(b.date));
  }, [reminders, loansWithStats, receivables, installments, creditCards]);

  // ── Actions ─────────────────────────────────────────────────
  const confirmReminder = async (r) => {
    if (confirmingId === r.id) return;
    setConfirmingId(r.id);
    try {
      await recurringApi.confirmReminder(r.id);
      setReminders?.(p => p.filter(x => x.id !== r.id));
      showToast(`✓ ${r.recurring_templates?.name || "Reminder"} confirmed`);
      await onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
    setConfirmingId(null);
  };

  const skipReminder = async (r) => {
    try {
      await recurringApi.skipReminder(r.id);
      setReminders?.(p => p.filter(x => x.id !== r.id));
      showToast(`Skipped: ${r.recurring_templates?.name || "Reminder"}`);
    } catch (e) { showToast(e.message, "error"); }
  };

  const openPayModal = (loan) => {
    setPayLoan(loan);
    setPayForm({ amount: String(loan.monthly_installment || ""), pay_date: todayStr(), notes: "" });
    setPayModal(true);
  };

  const handleRecordPayment = async () => {
    if (!payLoan || !payForm.amount) return showToast("Amount is required", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt = sn(payForm.amount);
      const created = await loanPaymentsApi.create(user.id, {
        loan_id: payLoan.id, pay_date: payForm.pay_date || todayStr(),
        amount: amt, notes: payForm.notes || null,
      });
      if (created) setLoanPayments?.(prev => [created, ...prev]);
      const newPaid = (payLoan.paidSoFar || 0) + amt;
      if (newPaid >= Number(payLoan.total_amount || 0)) {
        const { employeeLoanApi } = await import("../api");
        await employeeLoanApi.update(payLoan.id, { status: "settled" });
        setEmployeeLoans?.(prev => prev.map(l => l.id === payLoan.id ? { ...l, status: "settled" } : l));
        showToast("Payment recorded — loan fully settled! 🎉");
      } else {
        showToast(`Payment of ${fmtIDR(amt, true)} recorded`);
      }
      setPayModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── Helpers ─────────────────────────────────────────────────
  const daysLabel = (dateStr) => {
    const diff = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
    if (diff < 0)  return { text: `${Math.abs(diff)}d overdue`, color: "#dc2626" };
    if (diff === 0) return { text: "Today",    color: "#dc2626" };
    if (diff === 1) return { text: "Tomorrow", color: "#d97706" };
    if (diff <= 7)  return { text: `${diff}d`,  color: "#d97706" };
    return { text: `${diff}d`, color: "#059669" };
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 11, color: T.text3, fontWeight: 600 }}>
          {items.length} upcoming item{items.length !== 1 ? "s" : ""}
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "48px 0",
          color: T.text3, fontFamily: "Figtree, sans-serif",
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🎉</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>All clear!</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>No upcoming items.</div>
        </div>
      ) : (
        items.map(item => {
          const meta = TYPE_META[item.type] || TYPE_META.reminder;
          const dl   = daysLabel(item.date);
          const isReminder   = item.type === "reminder";
          const isLoan       = item.type === "loan";
          const isReceivable = item.type === "receivable";
          const isInstall    = item.type === "installment";

          return (
            <div key={item.id} style={{
              display:      "flex",
              alignItems:   "flex-start",
              gap:          12,
              padding:      "14px 16px",
              background:   T.surface,
              border:       `1px solid ${T.border}`,
              borderLeft:   `4px solid ${meta.color}`,
              borderRadius: 14,
            }}>
              {/* Icon */}
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: meta.bg,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16,
              }}>
                {meta.icon}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700,
                  color: isInstall ? T.text3 : T.text,
                  fontFamily: "Figtree, sans-serif",
                }}>
                  {item.title}
                </div>
                {item.sub && (
                  <div style={{ fontSize: 11, color: T.text3, fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                    {item.sub}
                  </div>
                )}
                <div style={{
                  fontSize: 11, color: dl.color, fontWeight: 700,
                  fontFamily: "Figtree, sans-serif", marginTop: 4,
                }}>
                  {dl.text}
                  {item.amount > 0 && ` · ${fmtIDR(item.amount, true)}`}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                {isReminder && (
                  <>
                    <button
                      onClick={() => confirmReminder(item.raw)}
                      disabled={confirmingId === item.raw.id}
                      style={BTN_GREEN}
                      title="Confirm"
                    >
                      {confirmingId === item.raw.id ? "…" : "✓"}
                    </button>
                    <button onClick={() => skipReminder(item.raw)} style={BTN_GHOST} title="Skip">
                      ✕
                    </button>
                  </>
                )}
                {isLoan && (
                  <button onClick={() => openPayModal(item.raw)} style={BTN_AMBER}>
                    Pay
                  </button>
                )}
                {isReceivable && (
                  <button onClick={() => setTab?.("receivables")} style={BTN_AMBER}>
                    Settle →
                  </button>
                )}
                {isInstall && (
                  <span style={{
                    fontSize: 10, color: "#9ca3af",
                    fontFamily: "Figtree, sans-serif",
                    background: "#f3f4f6", borderRadius: 6,
                    padding: "3px 7px", fontWeight: 600,
                  }}>
                    Info
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* Record Loan Payment Modal */}
      <Modal
        isOpen={payModal && !!payLoan}
        onClose={() => setPayModal(false)}
        title={`Record Payment — ${payLoan?.employee_name || ""}`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setPayModal(false)}>Cancel</Button>
            <Button variant="primary" size="md" busy={saving} disabled={!payForm.amount} onClick={handleRecordPayment}>
              Save
            </Button>
          </div>
        }
      >
        {payLoan && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{
              background: "#f9fafb", borderRadius: 10, padding: "10px 14px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Remaining</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#d97706" }}>
                {fmtIDR(payLoan.remaining || 0)}
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

// ─── BUTTON STYLES ────────────────────────────────────────────
const BTN_BASE = {
  border: "none", borderRadius: 8, cursor: "pointer",
  fontFamily: "Figtree, sans-serif", fontWeight: 700, fontSize: 12,
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: "6px 12px", height: 30, flexShrink: 0,
};

const BTN_GREEN = {
  ...BTN_BASE,
  background: "#dcfce7", color: "#059669", width: 30, padding: 0,
};

const BTN_GHOST = {
  ...BTN_BASE,
  background: "#f9fafb", color: "#9ca3af",
  border: "1px solid #e5e7eb", width: 30, padding: 0,
};

const BTN_AMBER = {
  ...BTN_BASE,
  background: "#fef3c7", color: "#d97706",
};
