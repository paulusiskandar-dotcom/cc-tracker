import { useMemo, useState, useEffect, useCallback } from "react";
import { ledgerApi, recurringApi, reimburseSettlementsApi, loanPaymentsApi, employeeLoanApi } from "../api";
import { fmtIDR, ym, mlShort, getGreeting, todayStr, groupByDate, checkDuplicateTransaction } from "../utils";
import { showToast, EmptyState, Modal, Button, AmountInput, Field, Input, FormRow } from "./shared/index";
import Select from "./shared/Select";
import { GroupedTransactionList } from "./shared/TransactionRow";
import GlobalReconcileButton from "./shared/GlobalReconcileButton";
import { detectRecurringPatterns } from "../lib/recurringDetection";
import TxVerticalBig from "./shared/TxVerticalBig";
import BudgetWidget from "./shared/BudgetWidget";
import BankPickerSheet from "./shared/BankPickerSheet";


// ── Recurring Suggestions widget ──────────────────────────────
const REC_FF   = "Figtree, sans-serif";
const recFmtAmt = n => fmtIDR(Math.round(n));

function RecurringSuggestionsWidget({ user, ledger, recurringTemplates, onCreated }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("recurring_dismissed") || "[]")); }
    catch { return new Set(); }
  });

  const suggestions = useMemo(() => {
    const patterns = detectRecurringPatterns(ledger);
    const existingKeys = new Set(
      (recurringTemplates || []).map(t => {
        const desc = ((t.description || t.name || "")).toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().slice(0, 20);
        return `${t.tx_type}|${desc}`;
      })
    );
    return patterns.filter(p => !existingKeys.has(p.key) && !dismissed.has(p.key)).slice(0, 5);
  }, [ledger, recurringTemplates, dismissed]);

  const handleDismiss = key => {
    const next = new Set(dismissed);
    next.add(key);
    setDismissed(next);
    localStorage.setItem("recurring_dismissed", JSON.stringify([...next]));
  };

  const handleCreate = async pattern => {
    const tx = pattern.txSample;
    try {
      await recurringApi.createTemplate(user.id, {
        name:               (tx.description || tx.merchant_name || "Recurring").slice(0, 50),
        description:        tx.description || "",
        amount:             pattern.avgAmount,
        currency:           tx.currency || "IDR",
        tx_type:            tx.tx_type,
        from_type:          tx.from_type,
        from_id:            tx.from_id,
        to_type:            tx.to_type,
        to_id:              tx.to_id,
        category_id:        tx.category_id,
        entity:             tx.entity,
        is_reimburse:       tx.is_reimburse,
        frequency:          pattern.frequency,
        day_of_month:       pattern.frequency === "monthly" ? pattern.avgDay : null,
        remind_days_before: 3,
        is_active:          true,
        notes:              `Auto-detected from ${pattern.occurrences} past transactions`,
      });
      handleDismiss(pattern.key);
      onCreated?.();
    } catch (e) { console.error(e); }
  };

  if (!suggestions.length) return null;

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 16, fontFamily: REC_FF }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#111827", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Recurring Suggestions
        </span>
        <span style={{ fontSize: 10, color: "#6b7280" }}>{suggestions.length} detected</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {suggestions.map(p => (
          <div key={p.key} style={{ padding: "10px 12px", background: "#f9fafb", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.txSample.description || p.txSample.merchant_name || "(untitled)"}
              </div>
              <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>
                {recFmtAmt(p.avgAmount)} · {p.frequency}{p.frequency === "monthly" ? ` on ${p.avgDay}th` : ""} · {p.occurrences}× past
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button onClick={() => handleCreate(p)}
                style={{ fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 5, border: "none", background: "#3b5bdb", color: "#fff", cursor: "pointer", fontFamily: REC_FF }}>
                Create
              </button>
              <button onClick={() => handleDismiss(p.key)}
                style={{ fontSize: 10, fontWeight: 600, padding: "4px 8px", borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer", fontFamily: REC_FF }}>
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function getNextDueDate(dueDay) {
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), dueDay);
  if (due < now) due.setMonth(due.getMonth() + 1);
  return due;
}

export default function Dashboard({
  user, accounts, ledger, thisMonthLedger, categories,
  reminders, recurTemplates, netWorth, bankAccounts,
  creditCards, assets, receivables, liabilities,
  installments = [],
  curMonth, pendingSyncs, setTab, setSettingsTab, openEmail,
  setLedger, setReminders, onRefresh, setPendingReconcileNav,
  employeeLoans = [], loanPayments = [],
  setLoanPayments, setEmployeeLoans,
  reimburseSettlements = [], setReimburseSettlements,
  budgets = [], fxRates = {}, incomeSrcs = [], CURRENCIES: allCurrencies = [],
}) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

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
  const [showAddTxModal, setShowAddTxModal] = useState(false);
  const [nwPeriod, setNwPeriod]             = useState("month");
  const [bankPickerState, setBankPickerState] = useState({
    isOpen: false, onSelect: null, contextLabel: "", contextAmount: "", mode: "default",
  });
  const closeBankPicker = useCallback(() => setBankPickerState(s => ({ ...s, isOpen: false })), []);
  const [upcomingExpanded, setUpcomingExpanded] = useState(false);
  // ─── DERIVED STATS ───────────────────────────────────────────
  const nw = netWorth || { total: 0, bank: 0, cash: 0, assets: 0, receivables: 0, ccDebt: 0, liabilities: 0, reimburseOutstanding: 0 };

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
    creditCards.reduce((s, c) => s + Number(c.outstanding_amount || 0) * (fxRates?.[c.currency] || 1), 0),
  [creditCards, fxRates]);

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
      g.totalDebt += Number(cc.outstanding_amount || 0);
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

  const topCategories = useMemo(() => {
    const map = {};
    thisMonthLedger
      .filter(e => e.tx_type === "expense")
      .forEach(e => {
        const key  = e.category_id || "other";
        const cat  = (categories || []).find(c => c.id === e.category_id);
        const name = cat?.name || e.category_name || "Other";
        const icon = cat?.icon || "💸";
        const color = cat?.color || "#9ca3af";
        if (!map[key]) map[key] = { name, icon, color, total: 0 };
        map[key].total += Number(e.amount_idr || e.amount || 0);
      });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [thisMonthLedger, categories]);

  const savingsRate = useMemo(() => {
    if (!thisMonthIncome) return 0;
    return Math.round(((thisMonthIncome - thisMonthExpense) / thisMonthIncome) * 100);
  }, [thisMonthIncome, thisMonthExpense]);

  const netWorthHistory = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.toISOString().slice(0, 7));
    }
    const deltas = months.map(m =>
      ledger.filter(e => ym(e.tx_date) === m).reduce((s, e) => {
        if (e.tx_type === "income")  return s + Number(e.amount_idr || 0);
        if (e.tx_type === "expense") return s - Number(e.amount_idr || 0);
        return s;
      }, 0)
    );
    const values = new Array(12).fill(0);
    values[11] = nw.total;
    for (let i = 10; i >= 0; i--) values[i] = values[i + 1] - deltas[i + 1];
    return months.map((m, i) => ({ month: m, value: values[i] }));
  }, [ledger, nw.total]);

  const alerts = useMemo(() => {
    const result = [];
    const now = new Date();
    // CC due soon
    (accounts || []).filter(a => a.type === "credit_card" && a.due_day && Number(a.outstanding_amount || 0) > 0).forEach(a => {
      const nextDue   = getNextDueDate(a.due_day);
      const daysUntil = Math.ceil((nextDue - now) / 86400000);
      if (daysUntil <= 7 && daysUntil >= 0) {
        result.push({
          icon: "⚠",
          message: `CC due in ${daysUntil}d`,
          value: `${a.name} · ${fmtIDR(Number(a.outstanding_amount || 0))}`,
          severity: daysUntil <= 3 ? "high" : "medium",
        });
      }
    });
    // Budget overruns
    (budgets || []).forEach(b => {
      const spent = (ledger || [])
        .filter(t => t.category_id === b.category_id && t.tx_type === "expense")
        .filter(t => { const d = new Date(t.tx_date + "T00:00:00"); return d.getFullYear() === b.period_year && d.getMonth() + 1 === b.period_month; })
        .reduce((s, t) => s + Number(t.amount_idr || 0), 0);
      const pct = (spent / b.amount) * 100;
      if (pct >= 100) {
        result.push({ icon: "⚠", message: `${b.category_name} overbudget`, value: `${Math.round(pct)}% of ${fmtIDR(b.amount)}`, severity: "high" });
      }
    });
    // Stale reimbursements (>14 days)
    const byEntity = {};
    (ledger || [])
      .filter(t => t.tx_type === "reimburse_out" && !t.reimburse_settlement_id && (now - new Date(t.tx_date + "T00:00:00")) / 86400000 > 14)
      .forEach(t => { byEntity[t.entity] = (byEntity[t.entity] || 0) + Number(t.amount_idr || 0); });
    Object.entries(byEntity).forEach(([entity, total]) => {
      result.push({ icon: "🕐", message: `${entity} reimburse >14d`, value: `${fmtIDR(total)} pending`, severity: "medium" });
    });
    return result.slice(0, 5);
  }, [accounts, budgets, ledger]);

  // Recent transactions, grouped by date (last 10)
  const recentGroups = useMemo(() => {
    const recent = ledger.slice(0, 5);
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

  // ── UNIFIED UPCOMING ITEMS (next 14 days, max 10) ─────────────
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
      .filter(inst => (inst.paid_months || 0) < (inst.total_months ?? inst.months ?? 0))
      .slice(0, 3)
      .forEach(inst => {
        const cc = creditCards.find(c => c.id === inst.account_id);
        all.push({
          id:   `i-${inst.id}`, type: "installment", raw: inst,
          date: today,
          title: inst.description || "CC Installment",
          sub: `${cc?.name || "CC"} · Month ${(inst.paid_months || 0) + 1}/${inst.total_months ?? inst.months ?? "?"}`,
          amount: Number(inst.monthly_amount || 0),
          amountColor: "#9ca3af", amountSign: "−",
          icon: "📅", iconBg: "#f3f4f6", iconColor: "#9ca3af",
          actionable: false, infoOnly: true,
        });
      });

    // F) Deposito jatuh tempo — within 14 days
    const todayDate = new Date(today);
    const cutoffDate = new Date(todayDate.getTime() + 14 * 86400000);
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

    // Helper: given a day-of-month integer, return the next date string on or after today
    const nextDueDateStr = (dayOfMonth) => {
      const d = Number(dayOfMonth);
      let next = new Date(todayDate.getFullYear(), todayDate.getMonth(), d);
      if (next < todayDate) next = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, d);
      return next.toISOString().slice(0, 10);
    };

    // G) CC payment due dates within next 14 days
    creditCards
      .filter(cc => cc.due_day && Number(cc.outstanding_amount || 0) > 0)
      .forEach(cc => {
        const dueDateStr = nextDueDateStr(cc.due_day);
        if (dueDateStr > cutoffDate.toISOString().slice(0, 10)) return;
        all.push({
          id: `cc-${cc.id}`, type: "cc_due", raw: cc,
          date: dueDateStr,
          title: cc.name,
          sub: "Payment due",
          amount: Number(cc.outstanding_amount || 0),
          amountColor: "#dc2626", amountSign: "−",
          icon: "💳", iconBg: "#fee2e2", iconColor: "#dc2626",
          actionable: true, confirmLabel: "Pay", confirmStyle: "danger",
        });
      });

    // H) Recurring income/expense with day_of_month within next 14 days
    recurTemplates
      .filter(t => t.day_of_month && (t.tx_type === "income" || t.tx_type === "expense"))
      .forEach(t => {
        const dueDateStr = nextDueDateStr(t.day_of_month);
        if (dueDateStr > cutoffDate.toISOString().slice(0, 10)) return;
        const isInc = t.tx_type === "income";
        all.push({
          id: `rt-${t.id}`, type: "recurring", raw: t,
          date: dueDateStr,
          title: t.name || "Recurring",
          sub: `Recurring ${isInc ? "income" : "expense"}`,
          amount: Number(t.amount || 0),
          amountColor: isInc ? "#059669" : "#dc2626",
          amountSign: isInc ? "+" : "−",
          icon: "🔄", iconBg: isInc ? "#dcfce7" : "#fee2e2", iconColor: isInc ? "#059669" : "#dc2626",
          actionable: true, confirmLabel: "Log", confirmStyle: "primary",
        });
      });

    // I) Pending reimburse settlements — no date filter, show all pending
    reimburseSettlements.forEach(s => {
      // Skip if already added by section D (same id prefix used there is 'rs-')
      if (all.some(x => x.id === `rs-${s.id}`)) return;
      const outstanding = Math.max(0, Number(s.total_out || 0) - Number(s.total_in || 0));
      all.push({
        id: `rsp-${s.id}`, type: "reimburse_pending", raw: s,
        date: today,
        title: s.entity,
        sub: "Pending reimbursement",
        amount: outstanding,
        amountColor: "#059669", amountSign: "+",
        icon: "🧾", iconBg: "#dcfce7", iconColor: "#059669",
        actionable: true, confirmLabel: "Mark", confirmStyle: "primary",
      });
    });

    return all
      .filter(item => !dismissed.has(item.id))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.type === "installment" ? 1 : -1))
      .slice(0, 8);
  }, [reminders, loansWithStats, receivables, installments, creditCards, dismissed, reimburseSettlements, assets, bankAccounts, recurTemplates]);

  // Group upcoming by date
  const UPCOMING_DEFAULT_VISIBLE = 4;
  const upcomingGroups = useMemo(() => {
    const today    = todayStr();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const visible  = upcomingExpanded ? upcomingItems : upcomingItems.slice(0, UPCOMING_DEFAULT_VISIBLE);
    const groups   = {};
    visible.forEach(item => {
      const d = item.date;
      if (!groups[d]) {
        let label;
        if (d === today)         label = "TODAY";
        else if (d === tomorrow) label = "TOMORROW";
        else label = new Date(d + "T00:00:00").toLocaleDateString("en-US", {
          weekday: "short", month: "short", day: "numeric",
        }).toUpperCase();
        groups[d] = { label, items: [] };
      }
      groups[d].items.push(item);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [upcomingItems, upcomingExpanded]);

  // Last sync time — reads from gmail_last_sync_at setting (updated every time gmail-sync runs)

  const monthlyChange = useMemo(() => {
    const inc  = thisMonthLedger.filter(e => e.tx_type === "income").reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
    const exp  = thisMonthLedger.filter(e => e.tx_type === "expense").reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
    return inc - exp;
  }, [thisMonthLedger]);

  // Aggregate notification count: gmail pending + alert center items
  const notifCount = useMemo(() =>
    (pendingSyncs?.length || 0) + (alerts?.length || 0),
  [pendingSyncs, alerts]);

  // 14-day cash flow forecast from upcoming items
  const upcomingForecast = useMemo(() => {
    const income  = upcomingItems.filter(i => i.amountSign === "+").reduce((s, i) => s + (i.amount || 0), 0);
    const expense = upcomingItems.filter(i => i.amountSign === "−" || i.amountSign === "-").reduce((s, i) => s + (i.amount || 0), 0);
    return { income, expense, net: income - expense };
  }, [upcomingItems]);

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
  const doConfirmReminder = doConfirm; // eslint-disable-line no-unused-vars

  // ── 1-click: Pay CC (opens bank picker, then inserts pay_cc ledger) ──
  const quickPayCC = useCallback((cc) => {
    if (!cc) return;
    setBankPickerState({
      isOpen: true, mode: "default",
      contextLabel: "Pay " + cc.name,
      contextAmount: fmtIDR(cc.outstanding_amount || 0),
      onSelect: async (bank) => {
        closeBankPicker();
        try {
          const created = await ledgerApi.create(user.id, {
            tx_type: "pay_cc", tx_date: todayStr(),
            amount: cc.outstanding_amount || 0, currency: cc.currency || "IDR",
            amount_idr: cc.outstanding_amount || 0,
            from_type: "account", from_id: bank.id,
            to_type: "account",   to_id: cc.id,
            description: "Pay " + cc.name, entity: "Personal",
            merchant_name: null, attachment_url: null,
            ai_categorized: false, ai_confidence: null,
            installment_id: null, scan_batch_id: null, notes: null,
          }, accounts);
          if (created) setLedger(p => [created, ...p]);
          showToast(`✓ Paid ${fmtIDR(cc.outstanding_amount || 0, true)} to ${cc.name}`);
        } catch (e) { showToast("Gagal bayar CC: " + (e.message || "Error"), "error"); }
      },
    });
  }, [user, accounts, setLedger, closeBankPicker]);

  // ── 1-click: Log recurring template (day_of_month type, no reminder row) ──
  const quickConfirmRecurring = useCallback((template) => {
    if (!template) return;
    const isExpense = template.tx_type === "expense";
    const needPicker = isExpense ? !template.from_id : !template.to_id;

    const doInsert = async (overrideBankId) => {
      try {
        const created = await ledgerApi.create(user.id, {
          tx_type: template.tx_type, tx_date: todayStr(),
          amount: template.amount, currency: template.currency || "IDR",
          amount_idr: template.amount,
          from_type: template.from_type || (isExpense ? "account" : "income_source"),
          from_id:   template.from_id || (isExpense ? overrideBankId : null),
          to_type:   template.to_type || (!isExpense ? "account" : "expense"),
          to_id:     template.to_id || (!isExpense ? overrideBankId : null),
          category_id: template.category_id || null,
          entity: template.entity || "Personal",
          description: template.name || template.description || "Recurring",
          merchant_name: null, attachment_url: null,
          ai_categorized: false, ai_confidence: null,
          installment_id: null, scan_batch_id: null, notes: null,
        }, accounts);
        if (created) setLedger(p => [created, ...p]);
        await recurringApi.updateTemplate(template.id, { last_generated_date: todayStr() });
        showToast(`✓ Logged: ${template.name}`);
      } catch (e) { showToast("Gagal log recurring: " + (e.message || "Error"), "error"); }
    };

    if (needPicker) {
      setBankPickerState({
        isOpen: true, mode: !isExpense ? "credit" : "default",
        contextLabel: (isExpense ? "Pay: " : "Receive: ") + template.name,
        contextAmount: fmtIDR(template.amount),
        onSelect: async (bank) => { closeBankPicker(); await doInsert(bank.id); },
      });
    } else {
      doInsert(null);
    }
  }, [user, accounts, setLedger, closeBankPicker]);

  // ── 1-click: Mark reimburse_pending as received ──
  const quickMarkReimbursePending = useCallback((settlement) => {
    if (!settlement) return;
    const outstanding = Math.max(0, Number(settlement.total_out || 0) - Number(settlement.total_in || 0));
    setBankPickerState({
      isOpen: true, mode: "credit",
      contextLabel: "Receive from " + (settlement.entity || "Reimburse"),
      contextAmount: fmtIDR(outstanding),
      onSelect: async (bank) => {
        closeBankPicker();
        try {
          const receivableAcc = receivables.find(r => r.entity === settlement.entity);
          const created = await ledgerApi.create(user.id, {
            tx_type: "reimburse_in", tx_date: todayStr(),
            amount: outstanding, currency: "IDR", amount_idr: outstanding,
            from_type: "account", from_id: receivableAcc?.id || null,
            to_type: "account",   to_id: bank.id,
            entity: settlement.entity || "Personal",
            description: (settlement.entity || "Reimburse") + " received",
            merchant_name: null, attachment_url: null,
            ai_categorized: false, ai_confidence: null,
            installment_id: null, scan_batch_id: null, notes: null,
          }, accounts);
          if (created) setLedger(p => [created, ...p]);
          showToast(`✓ Recorded ${fmtIDR(outstanding, true)} from ${settlement.entity}`);
        } catch (e) { showToast("Gagal record reimburse: " + (e.message || "Error"), "error"); }
      },
    });
  }, [user, accounts, setLedger, closeBankPicker, receivables]);

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

  const handleReconcileNavigate = (acc, year, month, txs, filename, blobUrl, closingBal, openingBal) => {
    const isCC = acc.type === "credit_card";
    if (isCC) {
      const stDay = Number(acc.statement_day);
      let from, to;
      if (stDay > 0) {
        const endDate = new Date(year, month - 1, stDay);
        const startDate = new Date(endDate);
        startDate.setMonth(startDate.getMonth() - 1);
        startDate.setDate(startDate.getDate() + 1);
        from = startDate.toISOString().slice(0, 10);
        to   = endDate.toISOString().slice(0, 10);
      } else {
        from = `${year}-${String(month).padStart(2, "0")}-01`;
        to   = new Date(year, month, 0).toISOString().slice(0, 10);
      }
      const selectedMonth = `${year}-${String(month).padStart(2, "0")}`;
      setPendingReconcileNav?.({ accType: "credit_card", acc, seeds: { from, to, selectedMonth, txs, filename, blobUrl, closingBal, openingBal } });
      setTab?.("cards");
    } else {
      const from = `${year}-${String(month).padStart(2, "0")}-01`;
      const to   = new Date(year, month, 0).toISOString().slice(0, 10);
      setPendingReconcileNav?.({ accType: "bank", acc, seeds: { from, to, txs, filename, blobUrl, closingBal, openingBal } });
      setTab?.("bank");
    }
  };

  // ─── RENDER ──────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 24 }}>

      {/* ════════════ SECTION 1 — HERO NET WORTH (Soft Mint) ════════════ */}
      <div style={{
        background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
        border: "1px solid #bbf7d0",
        borderRadius: 20,
        padding: isMobile ? "18px 16px 20px" : "26px 26px 22px",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Top row: greeting + icon actions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#16a34a", fontFamily: "Figtree, sans-serif" }}>
            {getGreeting()}, Paulus
          </span>

          {/* Icon row — order: 🔔 ✉ 📷 ⚖ ➕ */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>

            {/* 1. Notification Bell */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setTab?.("notifications")}
                title="Notifications"
                aria-label="Notifications"
                style={HERO_MINT_BTN}
              >
                🔔
              </button>
              {notifCount > 0 && <span style={NOTIF_DOT} />}
            </div>

            {/* 2. Email Sync */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => openEmail?.("pending")}
                title="Email Sync"
                aria-label="Email Sync"
                style={HERO_MINT_BTN}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </button>
              {(pendingSyncs?.length || 0) > 0 && <span style={NOTIF_DOT} />}
            </div>

            {/* 3. AI Scan (Camera) */}
            <button
              onClick={() => setTab?.("scan")}
              title="AI Scan"
              aria-label="AI Scan"
              style={HERO_MINT_BTN}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </button>

            {/* 4. Reconcile (icon-only ⚖) */}
            <GlobalReconcileButton
              type="all"
              accounts={accounts}
              user={user}
              onNavigate={handleReconcileNavigate}
              iconOnly={true}
            />

            {/* 5. Add Transaction (primary green) */}
            <button
              onClick={() => setShowAddTxModal(true)}
              title="Add Transaction"
              aria-label="Add Transaction"
              style={{
                width: 32, height: 32, borderRadius: 8, border: "none",
                background: "#14532d", color: "#fff",
                cursor: "pointer", fontSize: 18, fontWeight: 500,
                display: "flex", alignItems: "center", justifyContent: "center",
                lineHeight: 1,
              }}
            >
              +
            </button>
          </div>
        </div>

        {/* Label + period selector */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "1.4px", fontFamily: "Figtree, sans-serif" }}>
            Total Net Worth
          </span>
          <div style={{ display: "flex", gap: 2 }}>
            {[["month", "1M"], ["3m", "3M"], ["ytd", "YTD"]].map(([val, lbl]) => (
              <button key={val} onClick={() => setNwPeriod(val)} style={{
                fontSize: 10, fontWeight: 700, fontFamily: "Figtree, sans-serif",
                padding: "3px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                background: nwPeriod === val ? "#14532d" : "rgba(20,83,45,0.08)",
                color: nwPeriod === val ? "#fff" : "rgba(20,83,45,0.5)",
                transition: "all 0.15s",
              }}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Big number */}
        <div style={{
          fontSize: isMobile ? 30 : 38,
          fontWeight: 900,
          color: "#14532d",
          fontFamily: "Figtree, sans-serif",
          lineHeight: 1.1,
          marginBottom: 6,
          overflow: "hidden",
          textOverflow: isMobile ? "ellipsis" : "unset",
          whiteSpace: isMobile ? "nowrap" : "normal",
        }}>
          {isMobile ? fmtIDR(nw.total, true) : fmtIDR(nw.total)}
        </div>

        {/* Monthly delta */}
        {monthlyChange !== 0 && (
          <div style={{ fontSize: 12, fontWeight: 600, color: monthlyChange >= 0 ? "#059669" : "#dc2626", fontFamily: "Figtree, sans-serif", marginBottom: 16 }}>
            {monthlyChange >= 0 ? "↑" : "↓"} {fmtIDR(Math.abs(monthlyChange), true)} this month
          </div>
        )}

        {/* 6-month sparkline */}
        {netWorthHistory.length > 1 && (() => {
          const vals  = netWorthHistory.slice(-6).map(m => m.value);
          const minV  = Math.min(...vals);
          const maxV  = Math.max(...vals);
          const range = maxV - minV || 1;
          const pts   = vals.map((v, i) => `${4 + (i / (vals.length - 1)) * 292},${38 - ((v - minV) / range) * 30}`).join(" ");
          const area  = `4,42 ${pts} 296,42`;
          return (
            <svg viewBox="0 0 300 44" style={{ width: "100%", height: 28, marginBottom: 16, opacity: 0.75 }}>
              <polygon points={area} fill="#16a34a" opacity="0.12" />
              <polyline points={pts} fill="none" stroke="#16a34a" strokeWidth="1.5" />
            </svg>
          );
        })()}

        {/* 5-col stat grid: LIQUIDITY / ASSETS / RECEIVABLES / CC DEBT / LIABILITIES */}
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(5, 1fr)",
          gap: isMobile ? "14px 12px" : "0 16px",
          paddingTop: 14,
          borderTop: "1px solid #bbf7d0",
        }}>
          {(() => {
            const liquidity = (nw.bank || 0) + (nw.cash || 0);
            const totalRecv = (nw.receivables || 0) + (nw.employeeLoanTotal || 0) + (nw.reimburseOutstanding || 0);
            return [
              { label: "LIQUIDITY",    value: liquidity,          color: "#047857", prefix: "" },
              { label: "ASSETS",       value: nw.assets || 0,    color: "#047857", prefix: "" },
              { label: "RECEIVABLES",  value: totalRecv,          color: "#047857", prefix: "" },
              { label: "CC DEBT",      value: nw.ccDebt || 0,    color: "#b91c1c", prefix: (nw.ccDebt || 0) > 0 ? "−" : "" },
              { label: "LIABILITIES",  value: nw.liabilities || 0, color: "#9ca3af", prefix: "" },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 9, fontWeight: 500, color: "#16a34a", letterSpacing: "0.6px", fontFamily: "Figtree, sans-serif", marginBottom: 3, whiteSpace: "nowrap" }}>
                  {s.label}
                </div>
                <div style={{ fontSize: isMobile ? 12 : 13, fontWeight: 600, color: s.value === 0 ? "#9ca3af" : s.color, fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap" }}>
                  {s.prefix}{fmtIDR(s.value, true)}
                </div>
              </div>
            ));
          })()}
        </div>
      </div>

      {/* ════════════ SECTION 3 — THIS MONTH METRICS ════════════ */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
        gap: 12,
      }}>
        {/* Col 1: Cash Flow */}
        <div style={SEC_CARD}>
          <div style={SEC_HEAD}>
            <span style={SEC_TITLE}>Cash Flow</span>
            {thisMonthIncome > 0 && (
              <span style={{
                fontSize: 10, fontFamily: "Figtree, sans-serif", fontWeight: 700,
                color: savingsRate >= 0 ? "#0F6E56" : "#A32D2D",
                background: savingsRate >= 0 ? "#E1F5EE" : "#FCEBEB",
                padding: "2px 8px", borderRadius: 20,
              }}>
                {savingsRate >= 0 ? `${savingsRate}% saved` : `${savingsRate}%`}
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            {[
              { label: "Income",  value: thisMonthIncome,  color: "#059669", prefix: "" },
              { label: "Expense", value: thisMonthExpense, color: "#dc2626", prefix: "" },
              { label: "Surplus", value: surplus,          color: surplus >= 0 ? "#059669" : "#dc2626", prefix: surplus >= 0 ? "+" : "" },
            ].map(s => (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>{s.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: s.color, fontFamily: "Figtree, sans-serif" }}>
                  {s.prefix}{fmtIDR(Math.abs(s.value), true)}
                </span>
              </div>
            ))}
          </div>
          <MiniBarChart data={cashFlowData} max={maxCF} />
        </div>

        {/* Col 2: CC Spending */}
        <div style={SEC_CARD}>
          <div style={SEC_HEAD}>
            <span style={SEC_TITLE}>CC Spending</span>
            {creditCards.length > 0 && (
              <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                {creditCards.length} card{creditCards.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div style={{ fontSize: 26, fontWeight: 900, color: "#111827", fontFamily: "Figtree, sans-serif", marginBottom: 4 }}>
            {fmtIDR(thisMonthCCSpend, true)}
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "Figtree, sans-serif", marginBottom: 14 }}>
            This month · <strong style={{ color: "#dc2626" }}>{fmtIDR(totalCCDebt, true)}</strong> outstanding
          </div>
          {/* Top shared group utilization */}
          {Object.values(ccGroupMap).slice(0, 1).map(g => {
            const util = g.sharedLimit > 0 ? Math.min(100, (g.totalDebt / g.sharedLimit) * 100) : 0;
            const utilColor = util > 80 ? "#dc2626" : util > 50 ? "#d97706" : "#059669";
            return (
              <div key={g.id}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: "#374151", fontFamily: "Figtree, sans-serif" }}>{g.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: utilColor, fontFamily: "Figtree, sans-serif" }}>{util.toFixed(0)}% used</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "#f3f4f6" }}>
                  <div style={{ width: `${util}%`, height: "100%", background: utilColor, borderRadius: 3, transition: "width 0.3s" }} />
                </div>
                <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 3 }}>
                  {fmtIDR(g.totalDebt, true)} of {fmtIDR(g.sharedLimit, true)}
                </div>
              </div>
            );
          })}
          {/* Standalone top card if no groups */}
          {Object.keys(ccGroupMap).length === 0 && creditCards.filter(c => Number(c.card_limit || 0) > 0 && Number(c.outstanding_amount || 0) > 0).slice(0, 1).map(c => {
            const debt = Number(c.outstanding_amount || 0);
            const limit = Number(c.card_limit || 0);
            const util = Math.min(100, (debt / limit) * 100);
            const utilColor = util > 80 ? "#dc2626" : util > 50 ? "#d97706" : "#059669";
            return (
              <div key={c.id}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: "#374151", fontFamily: "Figtree, sans-serif" }}>{c.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: utilColor, fontFamily: "Figtree, sans-serif" }}>{util.toFixed(0)}% used</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "#f3f4f6" }}>
                  <div style={{ width: `${util}%`, height: "100%", background: utilColor, borderRadius: 3 }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Col 3: Top Category (icons/colors from DB) */}
        <div style={SEC_CARD}>
          <div style={SEC_HEAD}><span style={SEC_TITLE}>Top Category</span></div>
          {topCategories.length === 0 ? (
            <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 8 }}>
              No spending this month
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: (topCategories[0]?.color || "#9ca3af") + "22",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
                }}>
                  {topCategories[0]?.icon || "💸"}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>{topCategories[0]?.name || "Other"}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: topCategories[0]?.color || "#dc2626", fontFamily: "Figtree, sans-serif" }}>
                    {fmtIDR(topCategories[0]?.total || 0, true)}
                  </div>
                </div>
              </div>
              {topCategories.slice(1, 5).map((cat, i) => {
                const pct = topCategories[0]?.total > 0 ? (cat.total / topCategories[0].total) * 100 : 0;
                return (
                  <div key={cat.name + i} style={{ marginBottom: 7 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                      <span style={{ fontSize: 11, color: "#374151", fontFamily: "Figtree, sans-serif" }}>{cat.icon} {cat.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#374151", fontFamily: "Figtree, sans-serif" }}>{fmtIDR(cat.total, true)}</span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: "#f3f4f6" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: cat.color || "#9ca3af", borderRadius: 2 }} />
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* ════════════ SECTION 4 — CC OVERVIEW ════════════ */}
      {creditCards.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={SEC_TITLE}>CC Overview</span>
            <span style={{ fontSize: 10, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
              {creditCards.length} card{creditCards.length !== 1 ? "s" : ""} · {fmtIDR(totalCCDebt, true)} total
            </span>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile
              ? "repeat(2, 1fr)"
              : `repeat(${Math.min(4, Math.max(1, Object.keys(ccGroupMap).length + creditCards.filter(c => !ccGroupedIds.has(c.id)).length))}, 1fr)`,
            gap: 10,
          }}>
            {Object.values(ccGroupMap).map(g => {
              const util = g.sharedLimit > 0 ? Math.min(100, (g.totalDebt / g.sharedLimit) * 100) : 0;
              const utilColor = util > 80 ? "#dc2626" : util > 50 ? "#d97706" : "#059669";
              return (
                <div key={g.id} style={{ background: "#f9fafb", borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", fontFamily: "Figtree, sans-serif", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {g.name}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: "#111827", fontFamily: "Figtree, sans-serif", marginBottom: 6 }}>
                    {fmtIDR(g.totalDebt, true)}
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: "#e5e7eb", marginBottom: 4 }}>
                    <div style={{ width: `${util}%`, height: "100%", background: utilColor, borderRadius: 3, transition: "width 0.3s" }} />
                  </div>
                  <div style={{ fontSize: 9, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                    {util.toFixed(0)}% · {fmtIDR(g.sharedLimit, true)} limit · {g.members.length} cards
                  </div>
                </div>
              );
            })}
            {creditCards.filter(c => !ccGroupedIds.has(c.id)).map(c => {
              const debt = Number(c.outstanding_amount || 0);
              const limit = Number(c.card_limit || 0);
              const util = limit > 0 ? Math.min(100, (debt / limit) * 100) : 0;
              const utilColor = util > 80 ? "#dc2626" : util > 50 ? "#d97706" : "#059669";
              return (
                <div key={c.id} style={{ background: "#f9fafb", borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", fontFamily: "Figtree, sans-serif", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: debt > 0 ? "#111827" : "#9ca3af", fontFamily: "Figtree, sans-serif", marginBottom: limit > 0 ? 6 : 0 }}>
                    {fmtIDR(debt, true)}
                  </div>
                  {limit > 0 && (
                    <>
                      <div style={{ height: 5, borderRadius: 3, background: "#e5e7eb", marginBottom: 4 }}>
                        <div style={{ width: `${util}%`, height: "100%", background: utilColor, borderRadius: 3, transition: "width 0.3s" }} />
                      </div>
                      <div style={{ fontSize: 9, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                        {util.toFixed(0)}% · {fmtIDR(limit, true)} limit
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Budget widget */}
      {budgets.length > 0 && (
        <BudgetWidget budgets={budgets} ledger={ledger} onAddBudget={() => setTab?.("budget")} />
      )}

      {/* ════════════ SECTION 5 — UPCOMING ════════════ */}
      <div style={{ background: "#fff", borderRadius: 16, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={SEC_TITLE}>Upcoming — Next 14 Days</span>
            {upcomingItems.length > 0 && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, fontFamily: "Figtree, sans-serif", alignItems: "center" }}>
                <span style={{ color: "#9ca3af" }}>{upcomingItems.length} item{upcomingItems.length !== 1 ? "s" : ""}</span>
                {upcomingForecast.income > 0 && (
                  <span style={{ color: "#059669" }}>↑ {fmtIDR(upcomingForecast.income, true)}</span>
                )}
                {upcomingForecast.expense > 0 && (
                  <span style={{ color: "#dc2626" }}>↓ {fmtIDR(upcomingForecast.expense, true)}</span>
                )}
                <span style={{ fontWeight: 600, color: upcomingForecast.net >= 0 ? "#059669" : "#dc2626" }}>
                  Net {upcomingForecast.net >= 0 ? "+" : "−"}{fmtIDR(Math.abs(upcomingForecast.net), true)}
                </span>
              </div>
            )}
          </div>
        </div>
        {upcomingGroups.length === 0 ? (
          <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
            🎉 All clear — nothing due this week
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {upcomingGroups.map(([date, group]) => (
              <div key={date}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: "#9ca3af",
                  letterSpacing: "0.08em", fontFamily: "Figtree, sans-serif",
                  marginBottom: 6, textTransform: "uppercase",
                }}>
                  {group.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {group.items.map(item => {
                    const handleConfirm = (() => {
                      switch (item.type) {
                        case "reminder":          return () => openConfirmModal(item.raw);
                        case "receivable":        return () => openSettleModal(item.raw);
                        case "loan":              return () => openLoanPayModal(item.raw);
                        case "reimburse":         return () => openReimburseModal(item.raw);
                        case "cc_due":            return () => quickPayCC(item.raw);
                        case "recurring":         return () => quickConfirmRecurring(item.raw);
                        case "reimburse_pending": return () => quickMarkReimbursePending(item.raw);
                        default:                  return null;
                      }
                    })();
                    const handleSkip = (() => {
                      switch (item.type) {
                        case "reminder":          return () => skipReminder(item.raw);
                        case "reimburse":         return () => dismissReimburse(item.raw);
                        default:                  return () => dismissUpcoming(item.id);
                      }
                    })();
                    return (
                      <UpcomingRow
                        key={item.id}
                        item={item}
                        onEdit={
                          item.type === "reminder"   ? () => openConfirmModal(item.raw, true) :
                          item.type === "receivable" ? () => openSettleModal(item.raw) :
                          item.type === "loan"       ? () => openLoanPayModal(item.raw) :
                          null
                        }
                        onConfirm={handleConfirm}
                        onSkip={item.type === "installment" ? null : handleSkip}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {upcomingItems.length > UPCOMING_DEFAULT_VISIBLE && (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 8, paddingBottom: 2 }}>
            <button
              onClick={() => setUpcomingExpanded(p => !p)}
              style={{
                background: "transparent", border: "none",
                color: "#16a34a", fontSize: 12, fontWeight: 500,
                cursor: "pointer", padding: "6px 12px",
                fontFamily: "Figtree, sans-serif",
              }}
            >
              {upcomingExpanded ? "Show less ↑" : `View all (${upcomingItems.length}) ↓`}
            </button>
          </div>
        )}
      </div>

      {/* ════════════ SECTION 6 — ACTIVITY ════════════ */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr",
        gap: 12,
      }}>
        {/* Recent Transactions */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={SEC_TITLE}>Recent Transactions</span>
            <button onClick={() => setTab?.("transactions")} style={LINK_BTN}>View all →</button>
          </div>
          {recentGroups.length === 0 ? (
            <EmptyState icon="📋" message="No transactions yet" />
          ) : (
            <GroupedTransactionList groups={recentGroups} accounts={accounts} categories={categories} compact />
          )}
        </div>

        {/* Spending by Category (icons/colors from DB — not constants) */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "16px 18px" }}>
          <div style={{ marginBottom: 14 }}><span style={SEC_TITLE}>Spending by Category</span></div>
          {topCategories.length === 0 ? (
            <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
              No spending this month
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {topCategories.slice(0, 7).map((cat, i) => {
                const maxTotal = topCategories[0]?.total || 1;
                const pct = (cat.total / maxTotal) * 100;
                return (
                  <div key={cat.name + i}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: 14, flexShrink: 0 }}>{cat.icon}</span>
                        <span style={{ fontSize: 11, color: "#374151", fontFamily: "Figtree, sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {cat.name}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif", flexShrink: 0, marginLeft: 8 }}>
                        {fmtIDR(cat.total, true)}
                      </span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: "#f3f4f6" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: cat.color || "#9ca3af", borderRadius: 2, transition: "width 0.3s" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recurring Suggestions */}
      <RecurringSuggestionsWidget
        user={user}
        ledger={ledger}
        recurringTemplates={recurTemplates}
        onCreated={() => onRefresh?.()}
      />

      {/* ── BANK PICKER SHEET ── */}
      <BankPickerSheet
        isOpen={bankPickerState.isOpen}
        onClose={closeBankPicker}
        onSelect={bankPickerState.onSelect}
        bankAccounts={bankAccounts}
        contextLabel={bankPickerState.contextLabel}
        contextAmount={bankPickerState.contextAmount}
        mode={bankPickerState.mode}
      />

      {/* ── QUICK ADD TRANSACTION MODAL ── */}
      {showAddTxModal && (
        <TxVerticalBig
          open={showAddTxModal}
          mode="add"
          initialData={null}
          user={user}
          accounts={accounts}
          setLedger={setLedger}
          categories={categories}
          fxRates={fxRates}
          allCurrencies={allCurrencies}
          bankAccounts={bankAccounts}
          creditCards={creditCards}
          assets={assets}
          liabilities={liabilities}
          receivables={receivables}
          incomeSrcs={incomeSrcs}
          employeeLoans={employeeLoans}
          setEmployeeLoans={setEmployeeLoans}
          onRefresh={onRefresh}
          onSave={() => { setShowAddTxModal(false); onRefresh?.(); }}
          onDelete={null}
          onClose={() => setShowAddTxModal(false)}
        />
      )}

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
          const cat = (categories || []).find(c => c.id === tmpl.category_id)
            || incomeSrcs?.find(c => c.id === tmpl.category_id);
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
                {cat && <div style={{ fontSize: 11, color: "#6b7280" }}>{cat.icon} {cat.name || cat.label}</div>}
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
  const [hovered, setHovered] = useState(false);
  const isInfo = item.infoOnly;
  const { confirmLabel, confirmStyle } = item;

  const confirmBtnStyle = (() => {
    const base = { border: "none", padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "Figtree, sans-serif", flexShrink: 0 };
    if (confirmStyle === "danger") return { ...base, background: "#fee2e2", color: "#dc2626" };
    if (confirmStyle === "amber")  return { ...base, background: "#fef3c7", color: "#d97706" };
    return { ...base, background: "#dcfce7", color: "#059669" };
  })();

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
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
        <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
          {onEdit && (
            <button onClick={e => { e.stopPropagation(); onEdit(e); }} style={RUPT_GHOST} title="Edit">✏️</button>
          )}
          {onConfirm && (
            <button onClick={e => { e.stopPropagation(); onConfirm(e); }} style={confirmBtnStyle} title="Confirm">
              {confirmLabel || "✓"}
            </button>
          )}
          {onSkip && (
            <button
              onClick={e => { e.stopPropagation(); onSkip(e); }}
              style={{ ...RUPT_GHOST, opacity: hovered ? 1 : 0, transition: "opacity 0.15s" }}
              title="Dismiss"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const RUPT_GHOST = {
  width: 28, height: 28, borderRadius: 8,
  border: "1px solid #e5e7eb", background: "#f9fafb",
  color: "#9ca3af", fontSize: 11, cursor: "pointer",
  fontFamily: "Figtree, sans-serif",
  display: "flex", alignItems: "center", justifyContent: "center",
};

// ─── MINI BAR CHART ──────────────────────────────────────────
function MiniBarChart({ data, max }) {
  const BAR_H = 72;
  const BAR_W = 10;

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: BAR_H + 20 }}>
      {data.map((d, i) => {
        const incH = max > 0 ? Math.round((d.income  / max) * BAR_H) : 0;
        const expH = max > 0 ? Math.round((d.expense / max) * BAR_H) : 0;
        const isCurrent = i === data.length - 1;
        return (
          <div key={d.m} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: BAR_H }}>
              <div style={{
                width: BAR_W, height: Math.max(incH, 2),
                borderRadius: "3px 3px 0 0",
                background: isCurrent ? "#059669" : "#bbf7d0",
                transition: "height 0.3s", flexShrink: 0,
              }} />
              <div style={{
                width: BAR_W, height: Math.max(expH, 2),
                borderRadius: "3px 3px 0 0",
                background: isCurrent ? "#dc2626" : "#fecaca",
                transition: "height 0.3s", flexShrink: 0,
              }} />
            </div>
            <div style={{
              fontSize: 9,
              fontWeight: isCurrent ? 700 : 500,
              color: isCurrent ? "#111827" : "#9ca3af",
              fontFamily: "Figtree, sans-serif",
              marginTop: 4, whiteSpace: "nowrap",
            }}>
              {d.month}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────

const LINK_BTN = {
  background: "none",
  border: "none",
  color: "#3b5bdb",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "Figtree, sans-serif",
  padding: 0,
};

// Hero icon button — Soft Mint theme
const HERO_MINT_BTN = {
  width: 32, height: 32, borderRadius: 8, border: "none",
  background: "rgba(20,83,45,0.08)", color: "#14532d",
  cursor: "pointer", fontSize: 13,
  display: "flex", alignItems: "center", justifyContent: "center",
};

// Red dot indicator for notification/pending badges
const NOTIF_DOT = {
  position: "absolute", top: 4, right: 4,
  width: 8, height: 8,
  background: "#ef4444",
  borderRadius: "50%",
  border: "1.5px solid #f0fdf4",
  pointerEvents: "none",
};

// Section card base
const SEC_CARD = {
  background: "#ffffff",
  borderRadius: 16,
  padding: "16px 18px",
};

// Section card header row
const SEC_HEAD = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 14,
};

// Section title
const SEC_TITLE = {
  fontSize: 13,
  fontWeight: 700,
  color: "#111827",
  fontFamily: "Figtree, sans-serif",
};
