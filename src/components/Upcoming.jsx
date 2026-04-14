import { useMemo, useState } from "react";
import { recurringApi, loanPaymentsApi, ledgerApi, recalculateBalance } from "../api";
import { fmtIDR, todayStr } from "../utils";
import { showToast, Button, Modal, AmountInput, Field, Input, FormRow } from "./shared/index";
import Select from "./shared/Select";
import { LIGHT, DARK } from "../theme";

const TYPE_META = {
  reminder:         { icon: "🔄", color: "#3b5bdb", bg: "#dbeafe" },
  loan:             { icon: "👤", color: "#d97706", bg: "#fef3c7" },
  receivable:       { icon: "📋", color: "#d97706", bg: "#fef9ec" },
  loan_recv:        { icon: "💰", color: "#059669", bg: "#f0fdf4" },
  installment:      { icon: "📅", color: "#9ca3af", bg: "#f3f4f6" },
  cc_due:           { icon: "💳", color: "#dc2626", bg: "#fde8e8" },
  income_recur:     { icon: "↓",  color: "#059669", bg: "#f0fdf4" },
  expense_recur:    { icon: "↑",  color: "#dc2626", bg: "#fee2e2" },
  reimburse_pend:   { icon: "↙",  color: "#d97706", bg: "#fef9ec" },
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
  const [confirmingId,  setConfirmingId]  = useState(null);
  const [payModal,      setPayModal]      = useState(false);
  const [payLoan,       setPayLoan]       = useState(null);
  const [payForm,       setPayForm]       = useState({ amount: "", pay_date: todayStr(), notes: "" });
  const [saving,        setSaving]        = useState(false);
  const [settleModal,   setSettleModal]   = useState(false);
  const [settleRec,     setSettleRec]     = useState(null);
  const [settleAmount,  setSettleAmount]  = useState("");
  const [settleBankId,  setSettleBankId]  = useState("");
  const [settleSaving,  setSettleSaving]  = useState(false);
  // CC Pay modal
  const [ccPayModal,  setCcPayModal]  = useState(false);
  const [ccPayCard,   setCcPayCard]   = useState(null);
  const [ccPayForm,   setCcPayForm]   = useState({ bankId: "", amount: "", date: todayStr() });
  const [ccPaySaving, setCcPaySaving] = useState(false);
  // Recurring confirm modal
  const [recurModal,  setRecurModal]  = useState(false);
  const [recurItem,   setRecurItem]   = useState(null);
  const [recurForm,   setRecurForm]   = useState({ date: todayStr(), amount: "", from_id: "", to_id: "", notes: "" });
  const [recurSaving, setRecurSaving] = useState(false);
  // Reimburse pending settle
  const [reimModal,   setReimModal]   = useState(false);
  const [reimPend,    setReimPend]    = useState(null);
  const [reimForm,    setReimForm]    = useState({ amount: "", date: todayStr(), to_id: "" });
  const [reimSaving,  setReimSaving]  = useState(false);

  // ── Loan stats (outstanding = paid_months × monthly_installment) ────
  const loansWithStats = useMemo(() => {
    return employeeLoans.map(loan => {
      const paidMonths = Number(loan.paid_months || 0);
      const monthly    = Number(loan.monthly_installment || 0);
      const total      = Number(loan.total_amount || 0);
      const paidSoFar  = paidMonths * monthly;
      const remaining  = Math.max(0, total - paidSoFar);
      return { ...loan, paidSoFar, remaining };
    });
  }, [employeeLoans]);

  // ── Build unified upcoming list ──────────────────────────────
  const items = useMemo(() => {
    const all = [];
    const today = new Date();
    const cutoff = new Date(today.getTime() + 7 * 86400000);

    // Returns the next future occurrence of dayOfMonth (>=tomorrow).
    // If that day already passed this month (or is today), use next month.
    const getNextDueDate = (dayOfMonth) => {
      const thisMonth = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);
      if (thisMonth <= today) {
        return new Date(today.getFullYear(), today.getMonth() + 1, dayOfMonth);
      }
      return thisMonth;
    };

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

    // 2. Employee loan next payments (next due = start_date + (paid_months+1) months)
    loansWithStats
      .filter(l => l.status !== "settled" && l.remaining > 0)
      .forEach(loan => {
        if (!loan.monthly_installment || !loan.start_date) return;
        const start = new Date(loan.start_date + "T00:00:00");
        const paidMo = Number(loan.paid_months || 0);
        const nextDue = new Date(start.getFullYear(), start.getMonth() + paidMo + 1, start.getDate());
        if (nextDue > cutoff) return; // only show within 7 days
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

    // 6. CC Jatuh Tempo — due within next 7 days
    creditCards.filter(cc => cc.due_day).forEach(cc => {
      const dueDate = getNextDueDate(Number(cc.due_day));
      if (dueDate > cutoff) return;
      all.push({
        id: `cc-due-${cc.id}`,
        type: "cc_due",
        raw: cc,
        date: dueDate.toISOString().slice(0, 10),
        title: `${cc.name} — Jatuh Tempo`,
        amount: Math.max(0, Number(cc.current_balance || 0)),
        sub: `Balance: ${fmtIDR(Math.abs(Number(cc.current_balance || 0)))}`,
        actionable: true,
      });
    });

    // 7 & 8. Recurring income / expense — day_of_month within next 7 days, not already in reminders
    const reminderTplIds = new Set(reminders.map(r => r.template_id || r.recurring_template_id).filter(Boolean));
    recurTemplates
      .filter(t => t.active && (t.tx_type === "income" || t.tx_type === "expense") && t.day_of_month)
      .forEach(t => {
        if (reminderTplIds.has(t.id)) return;
        const dueDate = getNextDueDate(Number(t.day_of_month));
        if (dueDate > cutoff) return;
        all.push({
          id: `recur-${t.id}`,
          type: t.tx_type === "income" ? "income_recur" : "expense_recur",
          raw: t,
          date: dueDate.toISOString().slice(0, 10),
          title: `${t.name || (t.tx_type === "income" ? "Income" : "Expense")} — Recurring`,
          amount: Number(t.amount || 0),
          sub: t.entity || "",
          actionable: true,
        });
      });

    // 9. Reimburse Out Pending — net reimburse_out minus reimburse_in per entity > 0
    const reimMap = {};
    ledger.forEach(e => {
      if (!e.entity) return;
      if (e.tx_type === "reimburse_out") {
        if (!reimMap[e.entity]) reimMap[e.entity] = { entity: e.entity, out: 0, in: 0, from_id: e.from_id };
        reimMap[e.entity].out += Number(e.amount_idr || 0);
      } else if (e.tx_type === "reimburse_in") {
        if (!reimMap[e.entity]) reimMap[e.entity] = { entity: e.entity, out: 0, in: 0, from_id: null };
        reimMap[e.entity].in += Number(e.amount_idr || 0);
      }
    });
    Object.values(reimMap).forEach(v => {
      const net = v.out - v.in;
      if (net <= 0) return;
      all.push({
        id: `reim-pend-${v.entity}`,
        type: "reimburse_pend",
        raw: { ...v, net },
        date: todayStr(),
        title: `${v.entity} — Reimburse Pending`,
        amount: net,
        sub: `Pending: ${fmtIDR(net)}`,
        actionable: true,
      });
    });

    return all.sort((a, b) => a.date.localeCompare(b.date));
  }, [reminders, loansWithStats, receivables, installments, creditCards, bankAccounts, recurTemplates, ledger]);

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

  const openSettleModal = (rec) => {
    setSettleRec(rec);
    setSettleAmount(String(rec.receivable_outstanding || ""));
    setSettleBankId(bankAccounts[0]?.id || "");
    setSettleModal(true);
  };

  const doSettle = async () => {
    if (!settleRec || !settleBankId) return showToast("Select a bank account", "error");
    setSettleSaving(true);
    try {
      const amount = Number(settleAmount) || Number(settleRec.receivable_outstanding) || 0;
      await ledgerApi.create(user.id, {
        tx_date:     todayStr(),
        description: `${settleRec.entity || settleRec.name} reimburse received`,
        amount,
        currency:    "IDR",
        amount_idr:  amount,
        tx_type:     "reimburse_in",
        from_type:   "account",
        from_id:     settleRec.id,
        to_type:     "account",
        to_id:       settleBankId,
        entity:      settleRec.entity || "Personal",
        category_id: null,
        notes:       "",
      }, accounts);
      showToast("Reimburse recorded");
      setSettleModal(false);
      await onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
    setSettleSaving(false);
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

  // ── CC Pay ──────────────────────────────────────────────────
  const openCCPay = (cc) => {
    setCcPayCard(cc);
    setCcPayForm({ bankId: bankAccounts[0]?.id || "", amount: String(Math.max(0, Number(cc.current_balance || 0))), date: todayStr() });
    setCcPayModal(true);
  };

  const doCCPay = async () => {
    if (!ccPayCard || !ccPayForm.bankId || !ccPayForm.amount) return showToast("Fill required fields", "error");
    setCcPaySaving(true);
    try {
      const amt = Number(ccPayForm.amount) || 0;
      const created = await ledgerApi.create(user.id, {
        tx_date:     ccPayForm.date || todayStr(),
        description: `Pay ${ccPayCard.name} bill`,
        amount:      amt, currency: "IDR", amount_idr: amt,
        tx_type:     "pay_cc",
        from_type:   "account", to_type: "account",
        from_id:     ccPayForm.bankId,
        to_id:       ccPayCard.id,
        entity:      "Personal", notes: "",
      }, accounts);
      if (created) setLedger?.(p => [created, ...p]);
      await Promise.all([recalculateBalance(ccPayForm.bankId, user.id), recalculateBalance(ccPayCard.id, user.id)]);
      showToast(`Paid ${fmtIDR(amt)} to ${ccPayCard.name}`);
      setCcPayModal(false);
      await onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
    setCcPaySaving(false);
  };

  // ── Recurring Confirm ────────────────────────────────────────
  const openRecurConfirm = (tmpl) => {
    setRecurItem(tmpl);
    setRecurForm({ date: todayStr(), amount: String(tmpl.amount || ""), from_id: tmpl.from_id || "", to_id: tmpl.to_id || "", notes: "" });
    setRecurModal(true);
  };

  const doRecurConfirm = async () => {
    if (!recurItem || !recurForm.amount) return showToast("Amount required", "error");
    setRecurSaving(true);
    try {
      const amt = Number(recurForm.amount) || 0;
      const created = await ledgerApi.create(user.id, {
        tx_date:     recurForm.date || todayStr(),
        description: recurItem.name || "Recurring",
        amount: amt, currency: recurItem.currency || "IDR", amount_idr: amt,
        tx_type:     recurItem.tx_type,
        from_type:   "account", to_type: "account",
        from_id:     recurForm.from_id || recurItem.from_id || null,
        to_id:       recurForm.to_id   || recurItem.to_id   || null,
        entity:      recurItem.entity || "",
        category_id: recurItem.category_id || null,
        notes:       recurForm.notes || "",
      }, accounts);
      if (created) setLedger?.(p => [created, ...p]);
      const fromId = recurForm.from_id || recurItem.from_id;
      const toId   = recurForm.to_id   || recurItem.to_id;
      await Promise.all([
        fromId ? recalculateBalance(fromId, user.id) : Promise.resolve(),
        toId   ? recalculateBalance(toId,   user.id) : Promise.resolve(),
      ]);
      showToast(`${recurItem.name || "Recurring"} recorded`);
      setRecurModal(false);
      await onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
    setRecurSaving(false);
  };

  // ── Reimburse Pending Settle ─────────────────────────────────
  const openReimSettle = (pend) => {
    setReimPend(pend);
    setReimForm({ amount: String(pend.net || ""), date: todayStr(), to_id: bankAccounts[0]?.id || "" });
    setReimModal(true);
  };

  const doReimSettle = async () => {
    if (!reimPend || !reimForm.to_id) return showToast("Select bank account", "error");
    setReimSaving(true);
    try {
      const amt = Number(reimForm.amount) || reimPend.net;
      const created = await ledgerApi.create(user.id, {
        tx_date:     reimForm.date || todayStr(),
        description: `${reimPend.entity} reimburse received`,
        amount: amt, currency: "IDR", amount_idr: amt,
        tx_type:     "reimburse_in",
        from_type:   "account", to_type: "account",
        from_id:     reimPend.from_id || reimForm.to_id,
        to_id:       reimForm.to_id,
        entity:      reimPend.entity || "",
        category_id: null, notes: "",
      }, accounts);
      if (created) setLedger?.(p => [created, ...p]);
      await recalculateBalance(reimForm.to_id, user.id);
      showToast("Reimburse recorded");
      setReimModal(false);
      await onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
    setReimSaving(false);
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
          const isReminder    = item.type === "reminder";
          const isLoan        = item.type === "loan";
          const isReceivable  = item.type === "receivable";
          const isInstall     = item.type === "installment";
          const isCCDue       = item.type === "cc_due";
          const isIncomeRecur = item.type === "income_recur";
          const isExpenseRecur = item.type === "expense_recur";
          const isReimPend    = item.type === "reimburse_pend";

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
                      onClick={e => { e.stopPropagation(); e.preventDefault(); confirmReminder(item.raw); }}
                      disabled={confirmingId === item.raw.id}
                      style={BTN_GREEN}
                      title="Confirm"
                    >
                      {confirmingId === item.raw.id ? "…" : "✓"}
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); e.preventDefault(); skipReminder(item.raw); }}
                      style={BTN_GHOST} title="Skip"
                    >
                      ✕
                    </button>
                  </>
                )}
                {isLoan && (
                  <button
                    onClick={e => { e.stopPropagation(); e.preventDefault(); openPayModal(item.raw); }}
                    style={BTN_AMBER}
                  >
                    Pay
                  </button>
                )}
                {isReceivable && (
                  <button
                    onClick={e => { e.stopPropagation(); e.preventDefault(); openSettleModal(item.raw); }}
                    style={BTN_AMBER}
                  >
                    Settle
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
                {isCCDue && (
                  <button
                    onClick={e => { e.stopPropagation(); e.preventDefault(); openCCPay(item.raw); }}
                    style={{ ...BTN_BASE, background: "#ede9fe", color: "#7c3aed" }}
                  >
                    Pay
                  </button>
                )}
                {(isIncomeRecur || isExpenseRecur) && (
                  <button
                    onClick={e => { e.stopPropagation(); e.preventDefault(); openRecurConfirm(item.raw); }}
                    style={isIncomeRecur ? BTN_GREEN : { ...BTN_BASE, background: "#fee2e2", color: "#dc2626" }}
                  >
                    ✓ Record
                  </button>
                )}
                {isReimPend && (
                  <button
                    onClick={e => { e.stopPropagation(); e.preventDefault(); openReimSettle(item.raw); }}
                    style={BTN_AMBER}
                  >
                    Settle
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* Settle Receivable Modal */}
      <Modal
        isOpen={settleModal && !!settleRec}
        onClose={() => setSettleModal(false)}
        title={`Settle — ${settleRec?.entity || settleRec?.name || "Reimburse"}`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setSettleModal(false)}>Cancel</Button>
            <Button variant="primary" size="md" busy={settleSaving} onClick={doSettle}>✓ Record</Button>
          </div>
        }
      >
        {settleRec && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
              Outstanding: <strong style={{ color: "#111827" }}>{fmtIDR(Number(settleRec.receivable_outstanding || 0))}</strong>
            </div>
            <AmountInput
              label="Amount Received"
              value={settleAmount}
              onChange={v => setSettleAmount(v)}
              currency="IDR"
            />
            <Field label="To Bank Account">
              <Select
                value={settleBankId}
                onChange={e => setSettleBankId(e.target.value)}
                options={bankAccounts.map(a => ({ value: a.id, label: a.name }))}
                placeholder="Select bank…"
              />
            </Field>
          </div>
        )}
      </Modal>

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

      {/* Pay CC Modal */}
      <Modal
        isOpen={ccPayModal && !!ccPayCard}
        onClose={() => setCcPayModal(false)}
        title={`Pay CC — ${ccPayCard?.name || ""}`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setCcPayModal(false)}>Cancel</Button>
            <Button variant="primary" size="md" busy={ccPaySaving} disabled={!ccPayForm.bankId || !ccPayForm.amount} onClick={doCCPay}>
              Pay
            </Button>
          </div>
        }
      >
        {ccPayCard && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
              Balance: <strong style={{ color: "#7c3aed" }}>{fmtIDR(Math.abs(Number(ccPayCard.current_balance || 0)))}</strong>
            </div>
            <FormRow>
              <AmountInput label="Amount *" value={ccPayForm.amount} onChange={v => setCcPayForm(f => ({ ...f, amount: v }))} currency="IDR" />
              <Field label="Date">
                <Input type="date" value={ccPayForm.date} onChange={e => setCcPayForm(f => ({ ...f, date: e.target.value }))} />
              </Field>
            </FormRow>
            <Field label="From Bank Account">
              <Select
                value={ccPayForm.bankId}
                onChange={e => setCcPayForm(f => ({ ...f, bankId: e.target.value }))}
                options={bankAccounts.map(a => ({ value: a.id, label: a.name }))}
                placeholder="Select bank…"
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* Recurring Confirm Modal */}
      <Modal
        isOpen={recurModal && !!recurItem}
        onClose={() => setRecurModal(false)}
        title={`Record — ${recurItem?.name || "Recurring"}`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setRecurModal(false)}>Cancel</Button>
            <Button variant="primary" size="md" busy={recurSaving} disabled={!recurForm.amount} onClick={doRecurConfirm}>
              ✓ Record
            </Button>
          </div>
        }
      >
        {recurItem && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
              {recurItem.entity && <span>Entity: <strong style={{ color: "#111827" }}>{recurItem.entity}</strong> · </span>}
              Type: <strong style={{ color: recurItem.tx_type === "income" ? "#059669" : "#dc2626" }}>{recurItem.tx_type === "income" ? "Income" : "Expense"}</strong>
            </div>
            <FormRow>
              <AmountInput label="Amount *" value={recurForm.amount} onChange={v => setRecurForm(f => ({ ...f, amount: v }))} currency={recurItem.currency || "IDR"} />
              <Field label="Date">
                <Input type="date" value={recurForm.date} onChange={e => setRecurForm(f => ({ ...f, date: e.target.value }))} />
              </Field>
            </FormRow>
            {recurItem.tx_type === "income" && (
              <Field label="To Account">
                <Select
                  value={recurForm.to_id}
                  onChange={e => setRecurForm(f => ({ ...f, to_id: e.target.value }))}
                  options={bankAccounts.map(a => ({ value: a.id, label: a.name }))}
                  placeholder="Select account…"
                />
              </Field>
            )}
            {recurItem.tx_type === "expense" && (
              <Field label="From Account">
                <Select
                  value={recurForm.from_id}
                  onChange={e => setRecurForm(f => ({ ...f, from_id: e.target.value }))}
                  options={bankAccounts.map(a => ({ value: a.id, label: a.name }))}
                  placeholder="Select account…"
                />
              </Field>
            )}
            <Field label="Notes">
              <Input value={recurForm.notes} onChange={e => setRecurForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
            </Field>
          </div>
        )}
      </Modal>

      {/* Reimburse Pending Settle Modal */}
      <Modal
        isOpen={reimModal && !!reimPend}
        onClose={() => setReimModal(false)}
        title={`Settle Reimburse — ${reimPend?.entity || ""}`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setReimModal(false)}>Cancel</Button>
            <Button variant="primary" size="md" busy={reimSaving} disabled={!reimForm.to_id} onClick={doReimSettle}>
              ✓ Record
            </Button>
          </div>
        }
      >
        {reimPend && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "#fef9ec", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
              Pending: <strong style={{ color: "#d97706" }}>{fmtIDR(reimPend.net)}</strong>
            </div>
            <AmountInput
              label="Amount Received"
              value={reimForm.amount}
              onChange={v => setReimForm(f => ({ ...f, amount: v }))}
              currency="IDR"
            />
            <FormRow>
              <Field label="To Bank Account">
                <Select
                  value={reimForm.to_id}
                  onChange={e => setReimForm(f => ({ ...f, to_id: e.target.value }))}
                  options={bankAccounts.map(a => ({ value: a.id, label: a.name }))}
                  placeholder="Select bank…"
                />
              </Field>
              <Field label="Date">
                <Input type="date" value={reimForm.date} onChange={e => setReimForm(f => ({ ...f, date: e.target.value }))} />
              </Field>
            </FormRow>
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
