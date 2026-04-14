import { useMemo, useState, useEffect } from "react";
import { ledgerApi, recurringApi, reimburseSettlementsApi, settingsApi, loanPaymentsApi, employeeLoanApi } from "../api";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES_LIST } from "../constants";
import { fmtIDR, ym, mlShort, getGreeting, todayStr, groupByDate, checkDuplicateTransaction } from "../utils";
import { showToast, EmptyState, Modal, Button, AmountInput, Field, Input, FormRow } from "./shared/index";
import Select from "./shared/Select";
import { GroupedTransactionList } from "./shared/TransactionRow";

export default function Dashboard({
  user, accounts, ledger, thisMonthLedger, categories,
  reminders, recurTemplates, netWorth, bankAccounts,
  creditCards, assets, receivables, liabilities,
  installments = [],
  curMonth, pendingSyncs, setTab, setSettingsTab, openEmail,
  setLedger, setReminders, onRefresh,
  employeeLoans = [], loanPayments = [],
  setLoanPayments, setEmployeeLoans,
  reimburseSettlements = [], setReimburseSettlements,
}) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  const [gmailLastSyncAt, setGmailLastSyncAt] = useState(null);
  useEffect(() => {
    if (!user?.id) return;
    settingsApi.get(user.id, "gmail_last_sync_at", null)
      .then(v => setGmailLastSyncAt(v))
      .catch(() => {});
  }, [user?.id]);

  const [confirmModal,    setConfirmModal]    = useState(false);
  const [confirmTarget,   setConfirmTarget]   = useState(null);  // { kind, reminder?, tmpl?, editMode?, settlement? }
  const [confirmForm,     setConfirmForm]     = useState({ date: todayStr(), amount: "", notes: "", toAccountId: "" });
  const [confirmSaving,   setConfirmSaving]   = useState(false);
  const [confirmDupMatch, setConfirmDupMatch] = useState(null);
  const [dismissed,     setDismissed]     = useState(new Set()); // dismissed upcoming item ids
  const [settleModal,   setSettleModal]   = useState(false);
  const [settleRec,     setSettleRec]     = useState(null);    // receivable account raw
  const [settleBankId,  setSettleBankId]  = useState("");
  const [settleAmount,  setSettleAmount]  = useState("");
  const [settleSaving,  setSettleSaving]  = useState(false);
  const [payModal,      setPayModal]      = useState(false);
  const [payLoan,       setPayLoan]       = useState(null);
  const [payForm,       setPayForm]       = useState({ amount: "", pay_date: todayStr(), notes: "" });
  const [paySaving,     setPaySaving]     = useState(false);
  // ─── DERIVED STATS ───────────────────────────────────────────
  const nw = netWorth || { total: 0, bank: 0, assets: 0, receivables: 0, ccDebt: 0, liabilities: 0 };

  const thisMonthIncome = useMemo(() =>
    thisMonthLedger
      .filter(e => e.tx_type === "income")
      .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0),
  [thisMonthLedger]);

  const thisMonthExpense = useMemo(() =>
    thisMonthLedger
      .filter(e => e.tx_type === "expense")
      .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0),
  [thisMonthLedger]);

  const surplus = thisMonthIncome - thisMonthExpense;

  const totalCCDebt = useMemo(() =>
    creditCards.reduce((s, c) => s + Number(c.current_balance || 0), 0),
  [creditCards]);

  const thisMonthCCSpend = useMemo(() =>
    thisMonthLedger
      .filter(e => e.tx_type === "expense" && creditCards.some(c => c.id === e.from_id))
      .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0),
  [thisMonthLedger, creditCards]);

  // ─── CC SHARED LIMIT GROUPS (for dashboard) ──────────────────
  const { ccGroupMap, ccGroupedIds } = useMemo(() => {
    const gm = {};
    const gids = new Set();
    creditCards.forEach(cc => {
      if (!cc.shared_limit_group_id) return;
      gids.add(cc.id);
      if (!gm[cc.shared_limit_group_id]) {
        gm[cc.shared_limit_group_id] = {
          id: cc.shared_limit_group_id,
          name: "", sharedLimit: 0, totalDebt: 0, members: [],
        };
      }
      const g = gm[cc.shared_limit_group_id];
      g.members.push(cc);
      g.totalDebt += Number(cc.current_balance || 0);
      if (cc.is_limit_group_master) {
        g.sharedLimit = Number(cc.shared_limit || 0);
        g.name = cc.notes || cc.name || "Shared Group";
      }
    });
    // fallback name/limit from first member if no master
    Object.values(gm).forEach(g => {
      if (!g.name && g.members.length > 0) g.name = g.members[0].name || "Shared Group";
      if (!g.sharedLimit && g.members.length > 0) g.sharedLimit = Number(g.members[0].card_limit || 0);
    });
    return { ccGroupMap: gm, ccGroupedIds: gids };
  }, [creditCards]);

  const totalAssets = useMemo(() =>
    assets.reduce((s, a) => s + Number(a.current_value || 0), 0),
  [assets]);

  const totalReceivables = useMemo(() =>
    receivables.reduce((s, r) => s + Number(r.receivable_outstanding || 0), 0),
  [receivables]);

  const totalEmpLoans = useMemo(() => netWorth?.employeeLoanTotal || 0, [netWorth]);

  // Last 6 months cash flow (for mini chart)
  const cashFlowData = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = d.toISOString().slice(0, 7);
      const income  = ledger.filter(e => ym(e.tx_date) === m && e.tx_type === "income")
        .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
      const expense = ledger.filter(e => ym(e.tx_date) === m && e.tx_type === "expense")
        .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
      months.push({ month: mlShort(m), income, expense, m });
    }
    return months;
  }, [ledger]);

  const maxCF = Math.max(...cashFlowData.flatMap(d => [d.income, d.expense]), 1);

  // Recent transactions, grouped by date (last 10)
  const recentGroups = useMemo(() => {
    const recent = ledger.slice(0, 10);
    return groupByDate(recent);
  }, [ledger]);

  // Per-loan stats
  const loansWithStats = useMemo(() => {
    return employeeLoans.map(loan => {
      const paid = loanPayments.filter(p => p.loan_id === loan.id)
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      const remaining = Math.max(0, Number(loan.total_amount || 0) - paid);
      return { ...loan, paidSoFar: paid, remaining };
    });
  }, [employeeLoans, loanPayments]);

  const RE_CAT_NAMES = { Hamasa: "Hamasa RE", SDC: "SDC RE", Travelio: "Travelio RE" };

  // ── UNIFIED UPCOMING ITEMS (next 7 days, max 10) ─────────────
  const upcomingItems = useMemo(() => {
    const today = todayStr();
    const all = [];

    // A) Pending recurring reminders
    reminders.forEach(r => {
      const tmpl = r.recurring_templates || {};
      const isIncome = tmpl.tx_type === "income";
      all.push({
        id:   `r-${r.id}`, type: "reminder", raw: r,
        date: r.due_date,
        title: tmpl.name || "Reminder",
        amount: Number(tmpl.amount || 0),
        amountColor: isIncome ? "#059669" : "#dc2626",
        amountSign:  isIncome ? "+" : "−",
        icon: isIncome ? "💰" : "↑",
        iconBg: isIncome ? "#dcfce7" : "#fee2e2",
        iconColor: isIncome ? "#059669" : "#dc2626",
        actionable: true,
      });
    });

    // B) Employee loan next payments (active loans)
    loansWithStats
      .filter(l => l.status !== "settled" && l.remaining > 0 && l.monthly_installment)
      .forEach(loan => {
        const startDay = loan.start_date ? new Date(loan.start_date + "T00:00:00").getDate() : 1;
        const now = new Date();
        let nextDue = new Date(now.getFullYear(), now.getMonth(), startDay);
        if (nextDue <= now) nextDue = new Date(now.getFullYear(), now.getMonth() + 1, startDay);
        const dueDateStr = nextDue.toISOString().slice(0, 10);
        all.push({
          id:   `l-${loan.id}`, type: "loan", raw: loan,
          date: dueDateStr,
          title: `${loan.employee_name}`,
          sub: `Monthly payment · Remaining ${fmtIDR(loan.remaining, true)}`,
          amount: Number(loan.monthly_installment),
          amountColor: "#3b5bdb", amountSign: "−",
          icon: "👤", iconBg: "#dbeafe", iconColor: "#3b5bdb",
          actionable: false,
        });
      });

    // C) Unsettled reimburse (oldest outstanding first)
    receivables
      .filter(r => Number(r.receivable_outstanding || 0) > 0)
      .slice(0, 3)
      .forEach(r => {
        all.push({
          id:   `v-${r.id}`, type: "receivable", raw: r,
          date: today,
          title: `${r.entity || r.name}`,
          sub: "Outstanding reimburse",
          amount: Number(r.receivable_outstanding),
          amountColor: "#d97706", amountSign: "+",
          icon: "📋", iconBg: "#fef3c7", iconColor: "#d97706",
          actionable: false,
        });
      });

    // D) Pending reimburse settlements (expected income)
    reimburseSettlements.forEach(s => {
      all.push({
        id:   `rs-${s.id}`, type: "reimburse", raw: s,
        date: today,
        title: s.entity,
        sub:   `Expected reimbursement · ${fmtIDR(Number(s.total_out || 0), true)}`,
        amount: Number(s.total_out || 0),
        amountColor: "#059669", amountSign: "+",
        icon: "💰", iconBg: "#dcfce7", iconColor: "#059669",
        actionable: true,
      });
    });

    // E) CC installments (info only)
    installments
      .filter(inst => (inst.paid_months || 0) < (inst.months || 0))
      .slice(0, 3)
      .forEach(inst => {
        const cc = creditCards.find(c => c.id === inst.account_id);
        all.push({
          id:   `i-${inst.id}`, type: "installment", raw: inst,
          date: today,
          title: inst.description || "CC Installment",
          sub: `${cc?.name || "CC"} · Month ${(inst.paid_months || 0) + 1}/${inst.months}`,
          amount: Number(inst.monthly_amount || 0),
          amountColor: "#9ca3af", amountSign: "−",
          icon: "📅", iconBg: "#f3f4f6", iconColor: "#9ca3af",
          actionable: false, infoOnly: true,
        });
      });

    // F) Deposito jatuh tempo — within 7 days
    const todayDate = new Date(today);
    const cutoffDate = new Date(todayDate.getTime() + 7 * 86400000);
    assets
      .filter(a => a.subtype === "Deposito" && a.deposit_status !== "closed")
      .forEach(a => {
        if (!a.maturity_date) return;
        const matDate = new Date(a.maturity_date + "T00:00:00");
        if (matDate > cutoffDate) return;
        const bankAcc = bankAccounts.find(b => b.id === a.deposit_bank_id);
        const rolloverLabel = a.deposit_rollover_type === "aro" ? "ARO" : a.deposit_rollover_type === "aro_plus" ? "ARO+" : "Non-ARO";
        all.push({
          id: `dep-${a.id}`,
          type: "deposito_maturity",
          raw: a,
          date: a.maturity_date,
          title: `${a.name} jatuh tempo`,
          sub: `Deposito${bankAcc ? ` ${bankAcc.name}` : ""} · ${fmtIDR(Number(a.current_value || 0), true)} · ${rolloverLabel}`,
          amount: Number(a.current_value || 0),
          amountColor: "#2563eb", amountSign: "",
          icon: "🏦", iconBg: "#dbeafe", iconColor: "#2563eb",
          actionable: true,
        });
      });

    return all
      .filter(item => !dismissed.has(item.id))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.type === "installment" ? 1 : -1))
      .slice(0, 10);
  }, [reminders, loansWithStats, receivables, installments, creditCards, dismissed, reimburseSettlements, assets, bankAccounts]);

  // Group upcoming by date
  const upcomingGroups = useMemo(() => {
    const today    = todayStr();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const groups   = {};
    upcomingItems.forEach(item => {
      const d = item.date;
      if (!groups[d]) {
        let label;
        if (d === today)    label = "TODAY";
        else if (d === tomorrow) label = "TOMORROW";
        else label = new Date(d + "T00:00:00").toLocaleDateString("en-US", {
          weekday: "short", month: "short", day: "numeric",
        }).toUpperCase();
        groups[d] = { label, items: [] };
      }
      groups[d].items.push(item);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [upcomingItems]);

  // Last sync time — reads from gmail_last_sync_at setting (updated every time gmail-sync runs)
  const lastSyncMins = useMemo(() => {
    if (!gmailLastSyncAt) return null;
    return Math.floor((Date.now() - new Date(gmailLastSyncAt)) / 60000);
  }, [gmailLastSyncAt]);

  const monthlyChange = useMemo(() => {
    const inc  = thisMonthLedger.filter(e => e.tx_type === "income").reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
    const exp  = thisMonthLedger.filter(e => e.tx_type === "expense").reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
    return inc - exp;
  }, [thisMonthLedger]);

  // ─── REMINDER ACTIONS ────────────────────────────────────────
  const openConfirmModal = (r, editMode = false) => {
    const tmpl = r.recurring_templates || {};
    setConfirmTarget({ kind: "reminder", reminder: r, tmpl, editMode });
    const amount = String(tmpl.amount || "");
    setConfirmForm({ date: todayStr(), amount, notes: "", toAccountId: tmpl.to_id || bankAccounts[0]?.id || "" });
    setConfirmDupMatch(amount ? checkDuplicateTransaction(ledger, { tx_date: todayStr(), amount_idr: amount }) : null);
    setConfirmModal(true);
  };

  const openReimburseModal = (s) => {
    setConfirmTarget({ kind: "reimburse", settlement: s });
    const amount = String(s.total_out || "");
    setConfirmForm({ date: todayStr(), amount, notes: "", toAccountId: bankAccounts[0]?.id || "" });
    setConfirmDupMatch(amount ? checkDuplicateTransaction(ledger, { tx_date: todayStr(), amount_idr: amount }) : null);
    setConfirmModal(true);
  };

  const dismissReimburse = async (s) => {
    try {
      await reimburseSettlementsApi.update(s.id, { status: "dismissed" });
      setReimburseSettlements?.(p => p.filter(x => x.id !== s.id));
      showToast("Dismissed");
    } catch (e) { showToast(e.message, "error"); }
  };

  const doConfirm = async () => {
    if (!confirmTarget) return;
    setConfirmSaving(true);
    try {
      if (confirmTarget.kind === "reimburse") {
        const { settlement } = confirmTarget;
        const amount = Number(confirmForm.amount) || 0;
        if (!amount)                    { showToast("Enter amount", "error"); setConfirmSaving(false); return; }
        if (!confirmForm.toAccountId)   { showToast("Select a bank account", "error"); setConfirmSaving(false); return; }

        const entity      = settlement.entity;
        const recat       = (categories || []).find(c => c.label === RE_CAT_NAMES[entity] || c.name === RE_CAT_NAMES[entity]);
        const receivableAcc = receivables.find(r => r.entity === entity);

        const entry = {
          tx_date:     confirmForm.date || todayStr(),
          description: `${entity} reimburse received`,
          amount,
          currency:    "IDR",
          amount_idr:  amount,
          tx_type:     "reimburse_in",
          from_type:   "account",
          from_id:     receivableAcc?.id || null,
          to_type:     "account",
          to_id:       confirmForm.toAccountId,
          entity,
          category_id: recat?.id || null,
          is_reimburse: true,
          notes:       confirmForm.notes || null,
          merchant_name: null, attachment_url: null,
          ai_categorized: false, ai_confidence: null,
          installment_id: null, scan_batch_id: null,
        };
        const created = await ledgerApi.create(user.id, entry, accounts);
        if (created) setLedger?.(p => [created, ...p]);

        await reimburseSettlementsApi.update(settlement.id, {
          status:       "settled",
          total_in:     amount,
          to_account_id: confirmForm.toAccountId,
          settled_at:   new Date().toISOString(),
        });
        setReimburseSettlements?.(p => p.filter(x => x.id !== settlement.id));
        showToast(`✓ ${entity} reimbursement recorded`);
      } else {
        // Reminder (recurring income / expense)
        const { reminder, tmpl } = confirmTarget;
        const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
        const isIncome  = tmpl.tx_type === "income";
        const isExpense = tmpl.tx_type === "expense";
        if (isIncome || isExpense) {
          const entry = {
            tx_date:     confirmForm.date || todayStr(),
            description: tmpl.name,
            amount:      sn(confirmForm.amount),
            currency:    tmpl.currency || "IDR",
            amount_idr:  sn(confirmForm.amount),
            tx_type:     tmpl.tx_type,
            entity:      "Personal",
            notes:       confirmForm.notes || null,
            category_id: tmpl.category_id || null,
            merchant_name: null, attachment_url: null,
            ai_categorized: false, ai_confidence: null,
            installment_id: null, scan_batch_id: null,
            ...(isIncome
              ? { from_type: "income_source", from_id: null, to_type: "account",
                  to_id: confirmForm.toAccountId || tmpl.to_id || null }
              : { from_type: "account", from_id: tmpl.from_id || null, to_type: "expense", to_id: null }
            ),
          };
          const created = await ledgerApi.create(user.id, entry, accounts);
          if (created) setLedger?.(p => [created, ...p]);
        }
        await recurringApi.confirmReminder(reminder.id);
        setReminders?.(p => p.filter(x => x.id !== reminder.id));
        showToast(`✓ ${tmpl.name || "Reminder"} confirmed`);
      }
      setConfirmModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setConfirmSaving(false);
  };

  // Keep alias for Skip button reference
  const doConfirmReminder = doConfirm;

  const skipReminder = async (r) => {
    const tmpl = r.recurring_templates || {};
    try {
      await recurringApi.skipReminder(r.id);
      setReminders?.(p => p.filter(x => x.id !== r.id));
      showToast(`Skipped: ${tmpl.name || "Reminder"}`);
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  const dismissUpcoming = (itemId) => {
    setDismissed(prev => new Set([...prev, itemId]));
  };

  const openLoanPayModal = (loan) => {
    setPayLoan(loan);
    setPayForm({ amount: String(loan.monthly_installment || ""), pay_date: todayStr(), notes: "" });
    setPayModal(true);
  };

  const handleLoanPayment = async () => {
    if (!payLoan || !payForm.amount) return showToast("Amount is required", "error");
    setPaySaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt = sn(payForm.amount);
      const created = await loanPaymentsApi.create(user.id, {
        loan_id:  payLoan.id,
        pay_date: payForm.pay_date || todayStr(),
        amount:   amt,
        notes:    payForm.notes || null,
      });
      if (created) setLoanPayments?.(prev => [created, ...prev]);
      const newPaid = (payLoan.paidSoFar || 0) + amt;
      if (newPaid >= Number(payLoan.total_amount || 0)) {
        await employeeLoanApi.update(payLoan.id, { status: "settled" });
        setEmployeeLoans?.(prev => prev.map(l => l.id === payLoan.id ? { ...l, status: "settled" } : l));
        showToast("Payment recorded — loan fully settled! 🎉");
      } else {
        showToast(`Payment of ${fmtIDR(amt, true)} recorded`);
      }
      setPayModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setPaySaving(false);
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
        from_type:   "receivable",
        to_type:     "account",
        from_id:     settleRec.id,
        to_id:       settleBankId,
        entity:      settleRec.entity || "Personal",
        category_id: null,
        notes:       "",
      }, accounts);
      showToast("Reimburse recorded");
      setSettleModal(false);
      await onRefresh();
    } catch (e) { showToast(e.message, "error"); }
    setSettleSaving(false);
  };

  // ─── MOBILE NUMBER FORMATTING ────────────────────────────────
  const fmtM = (n) => {
    const v = Math.abs(Number(n) || 0);
    const sign = Number(n) < 0 ? "-" : "";
    if (v >= 1e9) return `${sign}Rp ${(v / 1e9).toFixed(1)}M`;
    if (v >= 1e6) return `${sign}Rp ${(v / 1e6).toFixed(1)}jt`;
    if (v >= 1e3) return `${sign}Rp ${(v / 1e3).toFixed(0)}rb`;
    return `${sign}Rp ${v}`;
  };

  // ─── RENDER ──────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── GREETING + SHORTCUT BUTTONS ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
          {getGreeting()}, Paulus 👋
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { label: "Email Sync",  onClick: () => openEmail?.("pending") },
            { label: "E-Statement", onClick: () => setSettingsTab?.("estatement") },
            { label: "AI Scan",     onClick: () => setTab?.("scan"), icon: true },
          ].map(({ label, onClick, icon }) => (
            <button key={label} onClick={onClick} style={{
              display: "flex", alignItems: "center", gap: 5,
              height: 28, padding: "0 12px", borderRadius: 99,
              border: "1px solid #e5e7eb", background: "#fff",
              color: "#374151", fontSize: 12, fontWeight: 500,
              fontFamily: "Figtree, sans-serif", cursor: "pointer",
              transition: "background 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "#f3f4f6"; e.currentTarget.style.borderColor = "#d1d5db"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#fff";    e.currentTarget.style.borderColor = "#e5e7eb"; }}
            >
              {icon && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              )}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── GMAIL PENDING BANNER ── */}
      {(() => {
        // pendingSyncs is already flattened individual transactions from pending email_sync rows
        // (getPending already filters status='pending', extracted_count>0, ai_raw_result IS NOT NULL)
        const gmailCount = (pendingSyncs || []).length;
        if (gmailCount === 0) return null;
        return (
          <div style={{
            background:   "#fef9ec",
            border:       "1.5px solid #fde68a",
            borderRadius: 14,
            padding:      "14px 16px",
            display:      "flex",
            alignItems:   "center",
            justifyContent: "space-between",
            gap:          12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>📧</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", fontFamily: "Figtree, sans-serif" }}>
                  {gmailCount} transaction{gmailCount > 1 ? "s" : ""} from Gmail need review
                </div>
                <div style={{ fontSize: 11, color: "#b45309", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                  {lastSyncMins != null
                    ? `Last sync ${lastSyncMins < 1 ? "just now" : `${lastSyncMins} min ago`}`
                    : "Gmail sync found new transactions"}
                </div>
              </div>
            </div>
            <button
              onClick={() => openEmail?.("pending")}
              style={{
                background:   "#d97706",
                color:        "#fff",
                border:       "none",
                borderRadius: 8,
                padding:      "7px 14px",
                fontSize:     12,
                fontWeight:   700,
                cursor:       "pointer",
                fontFamily:   "Figtree, sans-serif",
                whiteSpace:   "nowrap",
                flexShrink:   0,
              }}
            >
              Review Now →
            </button>
          </div>
        );
      })()}

      {/* ── BENTO GRID ── */}
      <div style={{
        display:             "grid",
        gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
        gap:                 isMobile ? 10 : 10,
      }}>

        {/* [1] Net Worth — dark hero, spans 2 cols on desktop */}
        <div style={{ ...BENTO_DARK, gridColumn: isMobile ? "span 1" : "span 2" }}>
          <div style={DARK_LABEL}>Total Net Worth</div>
          <div style={{
            ...DARK_VALUE,
            fontSize:     isMobile ? 26 : 28,
            overflow:     "hidden",
            textOverflow: isMobile ? "ellipsis" : "unset",
            whiteSpace:   isMobile ? "nowrap" : "normal",
          }}>
            {isMobile ? fmtM(nw.total) : fmtIDR(nw.total)}
          </div>
          {monthlyChange !== 0 && (
            <div style={{
              fontSize:   12,
              fontWeight: 600,
              color:      monthlyChange >= 0 ? "#4ade80" : "#f87171",
              fontFamily: "Figtree, sans-serif",
              marginBottom: 14,
            }}>
              {monthlyChange >= 0 ? "↑" : "↓"} {fmtIDR(Math.abs(monthlyChange), true)} this month
            </div>
          )}
          <div style={{
            ...DARK_STATS,
            gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
          }}>
            {[
              { label: "Bank",    raw: nw.bank,              color: "#a5f3fc" },
              { label: "Assets",  raw: nw.assets,            color: "#86efac" },
              { label: "Recv",    raw: nw.receivables,       color: "#fde68a" },
              { label: "Loans",   raw: nw.employeeLoanTotal, color: "#fde68a" },
              { label: "CC Debt", raw: nw.ccDebt,            color: "#fca5a5" },
            ].filter(s => Number(s.raw) > 0).map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 2 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: isMobile ? 11 : 12, fontWeight: 700, color: s.color, fontFamily: "Figtree, sans-serif" }}>
                  {isMobile ? fmtM(s.raw) : fmtIDR(s.raw, true)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* [2] CC This Month */}
        <div style={{ ...BENTO_BASE, background: "#fde8e8" }}>
          {/* badge */}
          {creditCards.length > 0 && (
            <div style={{
              position: "absolute", top: 12, right: 12,
              fontSize: 9, fontWeight: 700, fontFamily: "Figtree, sans-serif",
              background: "#dc262620", color: "#dc2626",
              padding: "2px 6px", borderRadius: 20,
            }}>
              {creditCards.length} cards
            </div>
          )}
          {/* icon */}
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: "rgba(220,38,38,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, marginBottom: 10,
          }}>💳</div>
          {/* label */}
          <div style={{
            fontSize: 10, fontWeight: 700, color: "#9ca3af",
            textTransform: "uppercase", letterSpacing: "0.5px",
            fontFamily: "Figtree, sans-serif", marginBottom: 4,
          }}>CC This Month</div>
          {/* main value = this month spend */}
          <div style={{
            fontSize: 16, fontWeight: 800, color: "#111827",
            fontFamily: "Figtree, sans-serif", lineHeight: 1.2, marginBottom: 2,
          }}>{fmtIDR(thisMonthCCSpend)}</div>
          {/* total debt */}
          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginBottom: 10 }}>
            Total debt: {fmtIDR(totalCCDebt, true)}
          </div>

          {/* ── shared limit groups ── */}
          {Object.values(ccGroupMap).map(g => {
            const util = g.sharedLimit > 0 ? Math.min(100, (g.totalDebt / g.sharedLimit) * 100) : 0;
            const utilColor = util > 80 ? "#dc2626" : util > 50 ? "#d97706" : "#059669";
            return (
              <div key={g.id} style={{ marginBottom: 8 }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "baseline",
                  marginBottom: 3,
                }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
                    {g.name}
                  </span>
                  <span style={{ fontSize: 10, color: utilColor, fontWeight: 700, fontFamily: "Figtree, sans-serif" }}>
                    {util.toFixed(0)}% of {fmtIDR(g.sharedLimit, true)}
                  </span>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: "#f3f4f6", overflow: "hidden" }}>
                  <div style={{ width: `${util}%`, height: "100%", background: utilColor, borderRadius: 3, transition: "width 0.3s" }} />
                </div>
                <div style={{ fontSize: 9, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                  {g.members.map(m => m.name).join(" · ")}
                </div>
              </div>
            );
          })}

          {/* ── standalone cards (not in any group) ── */}
          {creditCards.filter(c => !ccGroupedIds.has(c.id) && Number(c.current_balance || 0) > 0).map(c => {
            const debt  = Number(c.current_balance || 0);
            const limit = Number(c.card_limit || 0);
            const util  = limit > 0 ? Math.min(100, (debt / limit) * 100) : 0;
            const utilColor = util > 80 ? "#dc2626" : util > 50 ? "#d97706" : "#059669";
            return (
              <div key={c.id} style={{ marginBottom: 6 }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2,
                }}>
                  <span style={{ fontSize: 10, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>{c.name}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
                    {fmtIDR(debt, true)}
                  </span>
                </div>
                {limit > 0 && (
                  <div style={{ height: 3, borderRadius: 2, background: "#f3f4f6", overflow: "hidden" }}>
                    <div style={{ width: `${util}%`, height: "100%", background: utilColor, borderRadius: 2 }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* [3] Bank & Cash Total */}
        {(() => {
          const cashAccs  = bankAccounts.filter(a => a.subtype === "cash");
          const bankOnly  = bankAccounts.filter(a => a.subtype !== "cash");
          const cashTotal = cashAccs.reduce((s, a) => s + Number(a.current_balance || 0), 0);
          const bankTotal = nw.bank - cashTotal;
          const sub = cashTotal > 0
            ? `Bank: ${fmtIDR(bankTotal, true)} · Cash: ${fmtIDR(cashTotal, true)}`
            : `${bankOnly.length} account${bankOnly.length !== 1 ? "s" : ""}`;
          return (
            <BentoTile
              bg="#e8f4fd" icon="🏦" iconBg="rgba(59,91,219,0.12)"
              label="Bank & Cash"
              value={fmtIDR(nw.bank)}
              sub={sub}
              badge={bankAccounts.length > 0 ? `${bankAccounts.length} accs` : null}
              badgeColor="#3b5bdb"
            />
          );
        })()}

        {/* [4] Assets */}
        <BentoTile
          bg="#e8fdf0" icon="📈" iconBg="rgba(5,150,105,0.12)"
          label="Assets"
          value={fmtIDR(totalAssets)}
          sub={`${assets.length} item${assets.length !== 1 ? "s" : ""}`}
          badge={assets.length > 0 ? `${assets.length} items` : null}
          badgeColor="#059669"
        />

        {/* [5] Receivables */}
        <BentoTile
          bg="#fdf6e8" icon="📋" iconBg="rgba(217,119,6,0.12)"
          label="Receivables"
          value={fmtIDR(totalReceivables + totalEmpLoans)}
          sub={`Reimburse: ${fmtIDR(totalReceivables, true)}${totalEmpLoans > 0 ? ` · Loans: ${fmtIDR(totalEmpLoans, true)}` : ""}`}
          badge={totalReceivables + totalEmpLoans > 0 ? "View →" : null}
          badgeColor="#d97706"
          onClick={() => setTab?.("receivables")}
        />

        {/* [6] Cash Flow — spans 2 cols on desktop, full width on mobile */}
        <div style={{ ...BENTO_WHITE, gridColumn: isMobile ? "span 1" : "span 2" }}>
          <div style={{
            ...CARD_ROW,
            flexDirection: isMobile ? "column" : "row",
            alignItems:    isMobile ? "flex-start" : "center",
            gap:           isMobile ? 6 : 0,
          }}>
            <div style={CARD_TITLE}>Cash Flow</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <LegendDot color="#059669" label="Income" />
              <LegendDot color="#dc2626" label="Expense" />
            </div>
          </div>

          {/* Numbers */}
          <div style={{ display: "flex", gap: 20, marginBottom: 14 }}>
            <div>
              <div style={STAT_LABEL}>Income</div>
              <div style={{ ...STAT_VAL, color: "#059669" }}>{fmtIDR(thisMonthIncome, true)}</div>
            </div>
            <div>
              <div style={STAT_LABEL}>Expense</div>
              <div style={{ ...STAT_VAL, color: "#dc2626" }}>{fmtIDR(thisMonthExpense, true)}</div>
            </div>
            <div>
              <div style={STAT_LABEL}>Surplus</div>
              <div style={{ ...STAT_VAL, color: surplus >= 0 ? "#059669" : "#dc2626" }}>
                {surplus >= 0 ? "+" : ""}{fmtIDR(surplus, true)}
              </div>
            </div>
          </div>

          {/* Bar chart */}
          <MiniBarChart data={cashFlowData} max={maxCF} />
        </div>

        {/* [7] Upcoming — full width */}
        <div style={{ ...BENTO_WHITE, gridColumn: isMobile ? "span 1" : "span 3" }}>
          <div style={CARD_TITLE}>Upcoming — Next 7 Days</div>

          {upcomingGroups.length === 0 ? (
            <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 10 }}>
              🎉 All clear — nothing due this week
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 10 }}>
              {upcomingGroups.map(([date, group]) => (
                <div key={date}>
                  {/* Date group header */}
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: "#9ca3af",
                    letterSpacing: "0.08em", fontFamily: "Figtree, sans-serif",
                    marginBottom: 6, textTransform: "uppercase",
                  }}>
                    {group.label}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {group.items.map(item => (
                      <UpcomingRow
                        key={item.id}
                        item={item}
                        onEdit={
                          item.type === "reminder"   ? () => openConfirmModal(item.raw, true) :
                          item.type === "receivable" ? () => openSettleModal(item.raw) :
                          item.type === "loan"       ? () => openLoanPayModal(item.raw) :
                          null
                        }
                        onConfirm={
                          item.type === "reminder"   ? () => openConfirmModal(item.raw) :
                          item.type === "receivable" ? () => openSettleModal(item.raw) :
                          item.type === "loan"       ? () => openLoanPayModal(item.raw) :
                          item.type === "reimburse"  ? () => openReimburseModal(item.raw) :
                          null
                        }
                        onSkip={
                          item.type === "reminder"                            ? () => skipReminder(item.raw) :
                          item.type === "loan" || item.type === "receivable"  ? () => dismissUpcoming(item.id) :
                          item.type === "reimburse"                           ? () => dismissReimburse(item.raw) :
                          item.type === "deposito_maturity"                   ? () => dismissUpcoming(item.id) :
                          null
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── RECENT TRANSACTIONS ── */}
      <div style={{ ...BENTO_WHITE, marginTop: 4 }}>
        <div style={CARD_ROW}>
          <div style={CARD_TITLE}>Recent Transactions</div>
          <button
            onClick={() => setTab?.("transactions")}
            style={LINK_BTN}
          >
            View all →
          </button>
        </div>

        {recentGroups.length === 0 ? (
          <EmptyState icon="📋" message="No transactions yet" />
        ) : (
          <GroupedTransactionList
            groups={recentGroups}
            accounts={accounts}
            compact
          />
        )}
      </div>

      {/* ── LOAN PAYMENT MODAL ── */}
      <Modal
        isOpen={payModal && !!payLoan}
        onClose={() => setPayModal(false)}
        title={`Record Payment — ${payLoan?.employee_name || ""}`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setPayModal(false)}>Cancel</Button>
            <Button variant="primary" size="md" busy={paySaving} disabled={!payForm.amount} onClick={handleLoanPayment}>
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
              <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>Remaining</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#d97706", fontFamily: "Figtree, sans-serif" }}>
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

      {/* ── QUICK SETTLE MODAL (receivable) ── */}
      <Modal
        isOpen={settleModal && !!settleRec}
        onClose={() => setSettleModal(false)}
        title={`Settle — ${settleRec?.entity || settleRec?.name || "Reimburse"}`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setSettleModal(false)}>Cancel</Button>
            <Button variant="primary"   size="md" busy={settleSaving} onClick={doSettle}>✓ Record</Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
            Outstanding: <strong style={{ color: "#111827" }}>{fmtIDR(Number(settleRec?.receivable_outstanding || 0))}</strong>
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
      </Modal>

      {/* ── CONFIRM / REMIND / REIMBURSE MODAL ── */}
      <Modal
        isOpen={confirmModal && !!confirmTarget}
        onClose={() => setConfirmModal(false)}
        title={
          confirmTarget?.kind === "reimburse"
            ? `Terima Reimburse — ${confirmTarget?.settlement?.entity || ""}`
            : confirmTarget?.editMode
              ? `Edit — ${confirmTarget?.tmpl?.name || ""}`
              : `Confirm — ${confirmTarget?.tmpl?.name || ""}`
        }
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            {confirmTarget?.kind !== "reimburse" && confirmTarget?.type !== "info" && (
              <Button variant="ghost" size="md" onClick={() => { skipReminder(confirmTarget?.reminder); setConfirmModal(false); }}>
                Skip
              </Button>
            )}
            <Button variant="secondary" size="md" onClick={() => setConfirmModal(false)}>Cancel</Button>
            <Button variant="primary" size="md" busy={confirmSaving} onClick={doConfirm}>
              {confirmTarget?.kind === "reimburse"
                ? "✓ Confirm & Save"
                : confirmTarget?.tmpl?.tx_type === "income"
                  ? "✓ Record Income"
                  : "✓ Record Expense"}
            </Button>
          </div>
        }
      >
        {confirmTarget && (() => {
          if (confirmTarget.kind === "reimburse") {
            const { settlement } = confirmTarget;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {confirmDupMatch && (
                  <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#92400e", fontFamily: "Figtree, sans-serif" }}>
                    ⚠ Possible duplicate — Mirip dengan: <strong>{confirmDupMatch.description || "(no desc)"}</strong> · Rp {Number(confirmDupMatch.amount_idr || 0).toLocaleString("id-ID")} · {confirmDupMatch.tx_date}
                  </div>
                )}
                <div style={{
                  background: "#f0fdf4", border: "1px solid #bbf7d0",
                  borderRadius: 10, padding: "10px 14px",
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <div style={{ fontSize: 12, color: "#166534", fontFamily: "Figtree, sans-serif" }}>
                    Entity: <strong>{settlement.entity}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: "#166534", fontFamily: "Figtree, sans-serif" }}>
                    Category: <strong>{RE_CAT_NAMES[settlement.entity] || "—"}</strong>
                  </div>
                </div>
                <FormRow>
                  <AmountInput
                    label="Nilai yang masuk"
                    value={confirmForm.amount}
                    onChange={v => setConfirmForm(f => ({ ...f, amount: v }))}
                    currency="IDR"
                  />
                  <Field label="Tanggal terima">
                    <Input
                      type="date"
                      value={confirmForm.date}
                      onChange={e => setConfirmForm(f => ({ ...f, date: e.target.value }))}
                    />
                  </Field>
                </FormRow>
                <Field label="Rekening tujuan">
                  <Select
                    value={confirmForm.toAccountId}
                    onChange={e => setConfirmForm(f => ({ ...f, toAccountId: e.target.value }))}
                    options={bankAccounts.map(a => ({ value: a.id, label: a.name }))}
                    placeholder="Pilih rekening…"
                  />
                </Field>
                <Field label="Notes (optional)">
                  <Input
                    value={confirmForm.notes}
                    onChange={e => setConfirmForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Add note…"
                  />
                </Field>
              </div>
            );
          }

          // ── Reminder (income / expense) ──
          const tmpl = confirmTarget.tmpl || {};
          const allCats = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES_LIST];
          const cat = allCats.find(c => c.id === tmpl.category_id);
          const fromAcc = accounts.find(a => a.id === tmpl.from_id);
          const toAcc   = accounts.find(a => a.id === tmpl.to_id);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {confirmDupMatch && (
                <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#92400e", fontFamily: "Figtree, sans-serif" }}>
                  ⚠ Possible duplicate — Mirip dengan: <strong>{confirmDupMatch.description || "(no desc)"}</strong> · Rp {Number(confirmDupMatch.amount_idr || 0).toLocaleString("id-ID")} · {confirmDupMatch.tx_date}
                </div>
              )}
              {/* Template info banner */}
              <div style={{
                background: "#f9fafb", borderRadius: 10, padding: "10px 14px",
                display: "flex", flexDirection: "column", gap: 4,
              }}>
                {cat && <div style={{ fontSize: 11, color: "#6b7280" }}>{cat.icon} {cat.label}</div>}
                {fromAcc && <div style={{ fontSize: 11, color: "#6b7280" }}>From: {fromAcc.name}</div>}
                {toAcc && tmpl.tx_type !== "income" && <div style={{ fontSize: 11, color: "#6b7280" }}>To: {toAcc.name}</div>}
              </div>
              <FormRow>
                <AmountInput
                  label="Amount"
                  value={confirmForm.amount}
                  onChange={v => setConfirmForm(f => ({ ...f, amount: v }))}
                  currency={tmpl.currency || "IDR"}
                />
                <Field label="Date">
                  <Input
                    type="date"
                    value={confirmForm.date}
                    onChange={e => setConfirmForm(f => ({ ...f, date: e.target.value }))}
                  />
                </Field>
              </FormRow>
              {tmpl.tx_type === "income" && (
                <Field label="Rekening tujuan">
                  <Select
                    value={confirmForm.toAccountId}
                    onChange={e => setConfirmForm(f => ({ ...f, toAccountId: e.target.value }))}
                    options={bankAccounts.map(a => ({ value: a.id, label: a.name }))}
                    placeholder="Pilih rekening…"
                  />
                </Field>
              )}
              <Field label="Notes (optional)">
                <Input
                  value={confirmForm.notes}
                  onChange={e => setConfirmForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Add note…"
                />
              </Field>
            </div>
          );
        })()}
      </Modal>


    </div>
  );
}

// ─── UPCOMING ROW ─────────────────────────────────────────────
function UpcomingRow({ item, onConfirm, onEdit, onSkip }) {
  const isInfo = item.infoOnly;
  return (
    <div style={{
      display:      "flex",
      alignItems:   "center",
      gap:          10,
      padding:      "10px 12px",
      background:   isInfo ? "#f9fafb" : "#ffffff",
      border:       `1px solid ${isInfo ? "#f3f4f6" : "#e5e7eb"}`,
      borderRadius: 12,
      opacity:      isInfo ? 0.8 : 1,
    }}>
      {/* Icon */}
      <div style={{
        width: 32, height: 32, borderRadius: 9, flexShrink: 0,
        background: item.iconBg,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14,
      }}>
        {item.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: isInfo ? 500 : 600,
          color: isInfo ? "#9ca3af" : "#111827",
          fontFamily: "Figtree, sans-serif",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {item.title}
        </div>
        {item.sub && (
          <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 1 }}>
            {item.sub}
          </div>
        )}
      </div>

      {/* Amount */}
      {item.amount > 0 && (
        <div style={{
          fontSize: 13, fontWeight: 700, flexShrink: 0,
          color: isInfo ? "#9ca3af" : item.amountColor,
          fontFamily: "Figtree, sans-serif",
        }}>
          {item.amountSign}{fmtIDR(item.amount, true)}
        </div>
      )}

      {/* Info badge */}
      {isInfo && (
        <div style={{
          fontSize: 9, fontWeight: 700, color: "#9ca3af",
          background: "#f3f4f6", borderRadius: 5, padding: "2px 6px",
          fontFamily: "Figtree, sans-serif", flexShrink: 0,
        }}>
          AUTO
        </div>
      )}

      {/* Action buttons */}
      {!isInfo && (
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {onEdit && (
            <button onClick={e => { e.stopPropagation(); onEdit(e); }} style={RUPT_GHOST} title="Edit">✏️</button>
          )}
          {onConfirm && (
            <button onClick={e => { e.stopPropagation(); onConfirm(e); }} style={RUPT_PRIMARY} title="Confirm">✓</button>
          )}
          {onSkip && (
            <button onClick={e => { e.stopPropagation(); onSkip(e); }} style={RUPT_GHOST} title="Skip">✕</button>
          )}
        </div>
      )}
    </div>
  );
}

const RUPT_PRIMARY = {
  width: 28, height: 28, borderRadius: 8, border: "none",
  background: "#dcfce7", color: "#059669", fontSize: 12, fontWeight: 700,
  cursor: "pointer", fontFamily: "Figtree, sans-serif",
  display: "flex", alignItems: "center", justifyContent: "center",
};
const RUPT_GHOST = {
  width: 28, height: 28, borderRadius: 8,
  border: "1px solid #e5e7eb", background: "#f9fafb",
  color: "#9ca3af", fontSize: 11, cursor: "pointer",
  fontFamily: "Figtree, sans-serif",
  display: "flex", alignItems: "center", justifyContent: "center",
};

// ─── BENTO TILE ───────────────────────────────────────────────
function BentoTile({ bg, icon, iconBg, label, value, sub, badge, badgeColor, onClick }) {
  return (
    <div onClick={onClick} style={{ ...BENTO_BASE, background: bg, cursor: onClick ? "pointer" : "default" }}>
      {/* Badge */}
      {badge && (
        <div style={{
          position:     "absolute", top: 12, right: 12,
          fontSize:     9, fontWeight: 700,
          fontFamily:   "Figtree, sans-serif",
          background:   badgeColor + "20",
          color:        badgeColor,
          padding:      "2px 6px",
          borderRadius: 20,
        }}>
          {badge}
        </div>
      )}
      {/* Icon */}
      <div style={{
        width: 34, height: 34, borderRadius: 10,
        background: iconBg || "rgba(0,0,0,0.07)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 16, marginBottom: 10,
      }}>
        {icon}
      </div>
      {/* Label */}
      <div style={{
        fontSize: 10, fontWeight: 700, color: "#9ca3af",
        textTransform: "uppercase", letterSpacing: "0.5px",
        fontFamily: "Figtree, sans-serif", marginBottom: 4,
      }}>
        {label}
      </div>
      {/* Value */}
      <div className="bento-value" style={{
        fontSize: 16, fontWeight: 800, color: "#111827",
        fontFamily: "Figtree, sans-serif", lineHeight: 1.2,
        marginBottom: sub ? 4 : 0,
        wordBreak: "break-all",
      }}>
        {value}
      </div>
      {/* Sub */}
      {sub && (
        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", wordBreak: "break-word", overflowWrap: "anywhere" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── MINI BAR CHART ──────────────────────────────────────────
function MiniBarChart({ data, max }) {
  const BAR_H = 72;
  const BAR_W = 10;
  const GAP   = 4;
  const GROUP = BAR_W * 2 + GAP + 8; // pair width + group gap

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: BAR_H + 20 }}>
      {data.map((d, i) => {
        const incH = max > 0 ? Math.round((d.income  / max) * BAR_H) : 0;
        const expH = max > 0 ? Math.round((d.expense / max) * BAR_H) : 0;
        const isCurrent = i === data.length - 1;
        return (
          <div key={d.m} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
            {/* Bars */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: BAR_H }}>
              <div style={{
                width:        BAR_W,
                height:       Math.max(incH, 2),
                borderRadius: "3px 3px 0 0",
                background:   isCurrent ? "#059669" : "#bbf7d0",
                transition:   "height 0.3s",
                flexShrink:   0,
              }} />
              <div style={{
                width:        BAR_W,
                height:       Math.max(expH, 2),
                borderRadius: "3px 3px 0 0",
                background:   isCurrent ? "#dc2626" : "#fecaca",
                transition:   "height 0.3s",
                flexShrink:   0,
              }} />
            </div>
            {/* Month label */}
            <div style={{
              fontSize:   9,
              fontWeight: isCurrent ? 700 : 500,
              color:      isCurrent ? "#111827" : "#9ca3af",
              fontFamily: "Figtree, sans-serif",
              marginTop:  4,
              whiteSpace: "nowrap",
            }}>
              {d.month}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── LEGEND DOT ───────────────────────────────────────────────
function LegendDot({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>{label}</span>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────
// GRID is now applied inline in render (isMobile-aware)

const BENTO_BASE = {
  borderRadius: 16,
  padding:      "16px 16px 14px",
  position:     "relative",
  overflow:     "hidden",
  minWidth:     0,  // prevent grid blowout
};

const BENTO_WHITE = {
  ...BENTO_BASE,
  background: "#ffffff",
};

const BENTO_DARK = {
  ...BENTO_BASE,
  background: "linear-gradient(135deg, #1e3a5f 0%, #4338ca 100%)",
};

const DARK_LABEL = {
  fontSize:      10,
  fontWeight:    600,
  color:         "rgba(255,255,255,0.45)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  fontFamily:    "Figtree, sans-serif",
  marginBottom:  6,
};

const DARK_VALUE = {
  fontSize:     28,
  fontWeight:   900,
  color:        "#ffffff",
  fontFamily:   "Figtree, sans-serif",
  lineHeight:   1.1,
  marginBottom: 6,
};

const DARK_STATS = {
  display:    "grid",
  // gridTemplateColumns set inline (isMobile: 2 cols, desktop: 4 cols)
  gap:        8,
  paddingTop: 12,
  borderTop:  "1px solid rgba(255,255,255,0.08)",
};

const CARD_TITLE = {
  fontSize:   13,
  fontWeight: 700,
  color:      "#111827",
  fontFamily: "Figtree, sans-serif",
};

const CARD_ROW = {
  display:        "flex",
  justifyContent: "space-between",
  alignItems:     "center",
  marginBottom:   12,
};

const STAT_LABEL = {
  fontSize:      9,
  fontWeight:    700,
  color:         "#9ca3af",
  textTransform: "uppercase",
  letterSpacing: "0.4px",
  fontFamily:    "Figtree, sans-serif",
  marginBottom:  2,
};

const STAT_VAL = {
  fontSize:   13,
  fontWeight: 800,
  fontFamily: "Figtree, sans-serif",
};

const LINK_BTN = {
  background:  "none",
  border:      "none",
  color:       "#3b5bdb",
  fontSize:    12,
  fontWeight:  700,
  cursor:      "pointer",
  fontFamily:  "Figtree, sans-serif",
  padding:     0,
};

