import { useMemo, useState } from "react";
import { fmtIDR, todayStr } from "../utils";
import { showToast } from "./shared/index";
import { ledgerApi, recurringApi } from "../api";
import BankPickerSheet from "./shared/BankPickerSheet";

function getNextDueDate(dayOfMonth) {
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
  if (due < now) due.setMonth(due.getMonth() + 1);
  return due;
}

function daysUntil(date) {
  return Math.ceil((new Date(date) - new Date()) / 86400000);
}

function formatRelativeDate(d) {
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d < 0) return `${Math.abs(d)} days ago`;
  return `In ${d} days`;
}

export default function Notifications({
  user,
  accounts,
  creditCards,
  bankAccounts,
  pendingSyncs,
  reconSessions,
  reminders,
  recurTemplates,
  installments,
  employeeLoans,
  loanPayments,
  setTab,
  openEmail,
  onRefresh,
  setLedger,
  setReminders,
  setRecurTemplates,
  fxRates,
}) {
  const [activeTab, setActiveTab] = useState("all");
  const [dismissedIds, setDismissedIds] = useState(new Set());
  const [confirming,   setConfirming]   = useState(null);
  const [pickerOpen,   setPickerOpen]   = useState(false);
  const [pickerCtx,    setPickerCtx]    = useState(null); // { template, reminder }

  // ── 1. CC DUE ────────────────────────────────────────────────
  const ccDueItems = useMemo(() => {
    return (creditCards || [])
      .filter(c => c.is_active && c.due_day && Number(c.outstanding_amount || 0) > 0)
      .map(c => {
        const days = daysUntil(getNextDueDate(c.due_day));
        return {
          id: `cc-${c.id}`,
          type: "cc_due",
          severity: days <= 1 ? "high" : days <= 3 ? "medium" : "low",
          icon: "💳",
          title: `${c.name} payment due`,
          subtitle: formatRelativeDate(days),
          amount: c.outstanding_amount,
          amountColor: "#dc2626",
          amountSign: "−",
          actionLabel: "Pay",
          actionStyle: "danger",
          sortKey: days,
          raw: c,
        };
      })
      .filter(it => it.sortKey <= 14 && !dismissedIds.has(it.id))
      .sort((a, b) => a.sortKey - b.sortKey);
  }, [creditCards, dismissedIds]);

  // ── 2. EMAIL PENDING ─────────────────────────────────────────
  const emailItems = useMemo(() => {
    return (pendingSyncs || [])
      .map((e, idx) => ({
        id: `email-${e.id || idx}`,
        type: "email_pending",
        severity: "medium",
        icon: "📧",
        title: e.subject || "Email pending review",
        subtitle: e.sender_email || e.from || "Gmail Sync",
        amount: null,
        actionLabel: "Review",
        actionStyle: "primary",
        sortKey: idx,
        raw: e,
      }))
      .filter(it => !dismissedIds.has(it.id));
  }, [pendingSyncs, dismissedIds]);

  // ── 3. RECONCILE NEEDED ──────────────────────────────────────
  const reconcileItems = useMemo(() => {
    const lastReconciled = {};
    (reconSessions || [])
      .filter(s => s.status === "completed")
      .forEach(s => {
        if (!lastReconciled[s.account_id] || new Date(s.completed_at) > new Date(lastReconciled[s.account_id])) {
          lastReconciled[s.account_id] = s.completed_at;
        }
      });

    const now = new Date();
    return (accounts || [])
      .filter(a => a.is_active && (a.type === "bank" || a.type === "credit_card"))
      .map(a => {
        const lastDate = lastReconciled[a.id];
        const days = lastDate ? Math.floor((now - new Date(lastDate)) / 86400000) : null;
        if (lastDate && days <= 7) return null;
        return {
          id: `recon-${a.id}`,
          type: "reconcile",
          severity: !lastDate ? "high" : days > 30 ? "high" : "low",
          icon: "⚖️",
          title: `${a.name} needs reconcile`,
          subtitle: !lastDate ? "Never reconciled" : `Last: ${days} days ago`,
          amount: null,
          actionLabel: "Reconcile",
          actionStyle: "primary",
          sortKey: days || 999,
          raw: a,
        };
      })
      .filter(Boolean)
      .filter(it => !dismissedIds.has(it.id))
      .sort((a, b) => b.sortKey - a.sortKey);
  }, [accounts, reconSessions, dismissedIds]);

  // ── 4. RECURRING DUE ─────────────────────────────────────────
  const recurringItems = useMemo(() => {
    const items = [];

    // 4A — already-generated reminder rows
    (reminders || []).forEach(r => {
      const tmpl = r.recurring_templates;
      if (!tmpl) return;
      const days = daysUntil(r.due_date);
      items.push({
        id: `recur-rem-${r.id}`,
        type: "recurring_reminder",
        severity: days <= 0 ? "high" : days <= 3 ? "medium" : "low",
        icon: "🔄",
        title: tmpl.name,
        subtitle: `${tmpl.tx_type === "income" ? "Income" : "Expense"} · ${formatRelativeDate(days)}`,
        amount: tmpl.amount,
        amountColor: tmpl.tx_type === "income" ? "#059669" : "#dc2626",
        amountSign: tmpl.tx_type === "income" ? "+" : "−",
        actionLabel: "Confirm",
        actionStyle: "primary",
        sortKey: days,
        raw: { reminder: r, template: tmpl },
      });
    });

    // 4B — template-based upcoming (no reminder row yet)
    const reminderTemplateIds = new Set((reminders || []).map(r => r.template_id));
    (recurTemplates || []).forEach(t => {
      if (!t.is_active || !t.day_of_month) return;
      if (reminderTemplateIds.has(t.id)) return;
      const days = daysUntil(getNextDueDate(t.day_of_month));
      if (days < 0 || days > 14) return;
      items.push({
        id: `recur-tmpl-${t.id}`,
        type: "recurring_template",
        severity: days <= 3 ? "medium" : "low",
        icon: "🔄",
        title: t.name,
        subtitle: `${t.tx_type === "income" ? "Income" : "Expense"} · ${formatRelativeDate(days)}`,
        amount: t.amount,
        amountColor: t.tx_type === "income" ? "#059669" : "#dc2626",
        amountSign: t.tx_type === "income" ? "+" : "−",
        actionLabel: "Log",
        actionStyle: "primary",
        sortKey: days,
        raw: t,
      });
    });

    return items
      .filter(it => !dismissedIds.has(it.id))
      .sort((a, b) => a.sortKey - b.sortKey);
  }, [reminders, recurTemplates, dismissedIds]);

  // ── 5. INSTALLMENTS ──────────────────────────────────────────
  const installmentItems = useMemo(() => {
    return (installments || [])
      .filter(i => (i.paid_months || 0) < (i.total_months ?? i.tenor_months ?? 0))
      .filter(i => {
        if (!i.next_payment_date) return true;
        return daysUntil(i.next_payment_date) <= 14;
      })
      .map(i => {
        const days = i.next_payment_date ? daysUntil(i.next_payment_date) : 0;
        return {
          id: `inst-${i.id}`,
          type: "installment",
          severity: "low",
          icon: "📦",
          title: i.description,
          subtitle: `Month ${(i.paid_months || 0) + 1}/${i.total_months ?? i.tenor_months} · ${formatRelativeDate(days)}`,
          amount: i.monthly_amount,
          amountColor: "#9ca3af",
          amountSign: "−",
          actionLabel: null,
          sortKey: days,
          raw: i,
        };
      })
      .filter(it => !dismissedIds.has(it.id))
      .sort((a, b) => a.sortKey - b.sortKey);
  }, [installments, dismissedIds]);

  // ── ALL COMBINED ──────────────────────────────────────────────
  const allItems = useMemo(() => {
    const sevWeight = { high: 0, medium: 1, low: 2 };
    return [
      ...ccDueItems,
      ...emailItems,
      ...reconcileItems,
      ...recurringItems,
      ...installmentItems,
    ].sort((a, b) => {
      const sd = (sevWeight[a.severity] || 99) - (sevWeight[b.severity] || 99);
      return sd !== 0 ? sd : (a.sortKey || 0) - (b.sortKey || 0);
    });
  }, [ccDueItems, emailItems, reconcileItems, recurringItems, installmentItems]);

  const activeItems = useMemo(() => {
    switch (activeTab) {
      case "cc":          return ccDueItems;
      case "email":       return emailItems;
      case "reconcile":   return reconcileItems;
      case "recurring":   return recurringItems;
      case "installment": return installmentItems;
      default:            return allItems;
    }
  }, [activeTab, allItems, ccDueItems, emailItems, reconcileItems, recurringItems, installmentItems]);

  // ── RECURRING CONFIRM HELPERS ────────────────────────────────
  const doInsertRecurring = async (template, reminder, overrideBankId) => {
    const isExpense = !["income", "reimburse_in", "collect_loan", "sell_asset"].includes(template.tx_type);
    const date = todayStr();
    const amount = Number(template.amount || 0);
    const currency = template.currency || "IDR";
    const rate = currency !== "IDR"
      ? Number(fxRates?.[currency]?.rate || fxRates?.[currency] || 1)
      : 1;
    const amount_idr = currency === "IDR" ? amount : Math.round(amount * rate);
    try {
      const created = await ledgerApi.create(user.id, {
        tx_type:  template.tx_type,
        tx_date:  date,
        amount,   currency,  amount_idr,
        from_type: template.from_type || (isExpense ? "account" : "income_source"),
        from_id:   template.from_id   || (isExpense ? overrideBankId : null),
        to_type:   template.to_type   || (!isExpense ? "account" : "expense"),
        to_id:     template.to_id     || (!isExpense ? overrideBankId : null),
        category_id: template.category_id || null,
        entity:    template.entity || "Personal",
        description: template.name || template.description || "Recurring",
        merchant_name: null, attachment_url: null,
        ai_categorized: false, ai_confidence: null,
        installment_id: null, scan_batch_id: null, notes: null,
      }, accounts);
      await recurringApi.updateTemplate(template.id, { last_generated_date: date });
      if (reminder?.id) await recurringApi.confirmReminder(reminder.id);
      if (created && setLedger)    setLedger(p => [created, ...p]);
      if (setRecurTemplates) setRecurTemplates(p => p.map(t => t.id === template.id ? { ...t, last_generated_date: date } : t));
      if (reminder?.id && setReminders) setReminders(p => p.map(r => r.id === reminder.id ? { ...r, status: "confirmed", confirmed_at: new Date().toISOString() } : r));
      setDismissedIds(prev => new Set([...prev, reminder ? `recur-rem-${reminder.id}` : `recur-tmpl-${template.id}`]));
      showToast(`✓ Logged: ${template.name}`);
    } catch (e) {
      showToast("Gagal log recurring: " + (e.message || "Error"), "error");
    } finally {
      setConfirming(null);
    }
  };

  const confirmRecurringEntry = (template, reminder) => {
    if (!template) return;
    const isExpense = !["income", "reimburse_in", "collect_loan", "sell_asset"].includes(template.tx_type);
    const needPicker = isExpense ? !template.from_id : !template.to_id;
    if (needPicker) {
      setPickerCtx({ template, reminder });
      setPickerOpen(true);
      return;
    }
    const key = reminder ? `recur-rem-${reminder.id}` : `recur-tmpl-${template.id}`;
    setConfirming(key);
    doInsertRecurring(template, reminder, null);
  };

  const skipRecurringReminder = async (reminder) => {
    if (!reminder?.id) return;
    setConfirming(`recur-rem-${reminder.id}`);
    try {
      await recurringApi.skipReminder(reminder.id);
      if (setReminders) setReminders(p => p.map(r => r.id === reminder.id ? { ...r, status: "skipped" } : r));
      setDismissedIds(prev => new Set([...prev, `recur-rem-${reminder.id}`]));
      showToast("Skipped");
    } catch (e) {
      showToast("Gagal skip", "error");
    } finally {
      setConfirming(null);
    }
  };

  // ── HANDLERS ─────────────────────────────────────────────────
  const handleAction = (item) => {
    switch (item.type) {
      case "cc_due":
        setTab?.("cards");
        break;
      case "email_pending":
        openEmail?.("pending");
        break;
      case "reconcile":
        setTab?.("reconcile");
        break;
      case "recurring_reminder":
        confirmRecurringEntry(item.raw.template, item.raw.reminder);
        break;
      case "recurring_template":
        confirmRecurringEntry(item.raw, null);
        break;
      default:
        break;
    }
  };

  const handleDismiss = (item) => {
    setDismissedIds(prev => new Set([...prev, item.id]));
  };

  // ── BANK PICKER CONFIRM ──────────────────────────────────────
  const handlePickerSelect = (bank) => {
    setPickerOpen(false);
    const ctx = pickerCtx;
    setPickerCtx(null);
    if (!ctx) return;
    const key = ctx.reminder ? `recur-rem-${ctx.reminder.id}` : `recur-tmpl-${ctx.template.id}`;
    setConfirming(key);
    doInsertRecurring(ctx.template, ctx.reminder, bank.id);
  };

  // ── TABS ─────────────────────────────────────────────────────
  const tabs = [
    { id: "all",         label: "All",         count: allItems.length },
    { id: "cc",          label: "CC Due",       count: ccDueItems.length },
    { id: "email",       label: "Email",        count: emailItems.length },
    { id: "reconcile",   label: "Reconcile",    count: reconcileItems.length },
    { id: "recurring",   label: "Recurring",    count: recurringItems.length },
    { id: "installment", label: "Installment",  count: installmentItems.length },
  ];

  return (
    <div style={{ padding: 16, fontFamily: "Figtree, sans-serif", maxWidth: 900, margin: "0 auto" }}>

      {/* HEADER */}
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => setTab?.("dashboard")}
          style={{
            background: "transparent", border: "none",
            color: "#6b7280", fontSize: 13, cursor: "pointer",
            padding: "4px 0", marginBottom: 8, fontFamily: "inherit",
          }}
        >
          ← Back to Dashboard
        </button>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>Notifications</h1>
        {allItems.length === 0 && (
          <div style={{ fontSize: 13, color: "#16a34a", marginTop: 6 }}>🎉 All caught up</div>
        )}
      </div>

      {/* TABS */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, overflowX: "auto", padding: "4px 0" }}>
        {tabs.map(t => {
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: "8px 14px",
                background: isActive ? "#14532d" : "#f9fafb",
                color: isActive ? "#fff" : "#374151",
                border: isActive ? "none" : "1px solid #e5e7eb",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexShrink: 0,
              }}
            >
              {t.label}
              {t.count > 0 && (
                <span style={{
                  background: isActive ? "rgba(255,255,255,0.22)" : "#e5e7eb",
                  color: isActive ? "#fff" : "#6b7280",
                  fontSize: 10, fontWeight: 700,
                  padding: "1px 6px", borderRadius: 8,
                  minWidth: 18, textAlign: "center",
                }}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* LIST */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {activeItems.length === 0 ? (
          <div style={{
            padding: 40, textAlign: "center", color: "#9ca3af",
            fontSize: 13, background: "#f9fafb",
            borderRadius: 12, border: "1px solid #e5e7eb",
          }}>
            No items in this category
          </div>
        ) : (
          activeItems.map(item => (
            <NotifRow
              key={item.id}
              item={item}
              onAction={() => handleAction(item)}
              onDismiss={() => handleDismiss(item)}
              onSkip={item.type === "recurring_reminder" ? () => skipRecurringReminder(item.raw.reminder) : undefined}
              busy={confirming === (item.type === "recurring_reminder" ? `recur-rem-${item.raw?.reminder?.id}` : `recur-tmpl-${item.raw?.id}`)}
            />
          ))
        )}
      </div>

      {/* Bank picker for recurring with missing account */}
      <BankPickerSheet
        isOpen={pickerOpen}
        onClose={() => { setPickerOpen(false); setPickerCtx(null); }}
        onSelect={handlePickerSelect}
        bankAccounts={bankAccounts}
        contextLabel={pickerCtx ? `Pilih akun untuk ${pickerCtx.template?.name || "Recurring"}` : ""}
        contextAmount={pickerCtx ? fmtIDR(pickerCtx.template?.amount || 0) : ""}
        mode="default"
      />

    </div>
  );
}

// ── ROW COMPONENT ─────────────────────────────────────────────
function NotifRow({ item, onAction, onDismiss, onSkip, busy }) {
  const [hovered, setHovered] = useState(false);

  const sevColor = item.severity === "high" ? "#dc2626" : item.severity === "medium" ? "#d97706" : "#9ca3af";

  const actionBtnStyle = (() => {
    const base = {
      border: "none", padding: "6px 12px", borderRadius: 8,
      fontSize: 11, fontWeight: 600, cursor: "pointer",
      fontFamily: "Figtree, sans-serif", flexShrink: 0,
    };
    if (item.actionStyle === "danger") return { ...base, background: "#fee2e2", color: "#dc2626" };
    if (item.actionStyle === "amber")  return { ...base, background: "#fef3c7", color: "#d97706" };
    return { ...base, background: "#dcfce7", color: "#059669" };
  })();

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderLeft: `3px solid ${sevColor}`,
        borderRadius: 10,
        transition: "box-shadow 0.15s",
        boxShadow: hovered ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
      }}
    >
      {/* Icon */}
      <div style={{
        width: 36, height: 36, borderRadius: 9,
        background: "#f9fafb",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18, flexShrink: 0,
      }}>
        {item.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: "#111827",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontFamily: "Figtree, sans-serif",
        }}>
          {item.title}
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2, fontFamily: "Figtree, sans-serif" }}>
          {item.subtitle}
        </div>
      </div>

      {/* Amount */}
      {item.amount != null && (
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: item.amountColor || "#111827",
          whiteSpace: "nowrap",
          fontFamily: "Figtree, sans-serif",
          flexShrink: 0,
        }}>
          {item.amountSign || ""}{fmtIDR(item.amount, true)}
        </div>
      )}

      {/* Skip (recurring reminders only) */}
      {onSkip && (
        <button
          onClick={onSkip}
          disabled={busy}
          style={{
            border: "1px solid #e5e7eb", padding: "6px 10px", borderRadius: 8,
            fontSize: 11, fontWeight: 600, cursor: "pointer",
            fontFamily: "Figtree, sans-serif", background: "#f9fafb", color: "#6b7280",
            flexShrink: 0, opacity: busy ? 0.5 : 1,
          }}
        >
          Skip
        </button>
      )}

      {/* Action */}
      {item.actionLabel ? (
        <button onClick={onAction} disabled={busy} style={{ ...actionBtnStyle, opacity: busy ? 0.5 : 1 }}>
          {busy ? "…" : item.actionLabel}
        </button>
      ) : (
        <span style={{
          background: "#f3f4f6", color: "#9ca3af",
          padding: "4px 8px", borderRadius: 6,
          fontSize: 10, fontWeight: 600, letterSpacing: "0.5px",
          flexShrink: 0, fontFamily: "Figtree, sans-serif",
        }}>
          AUTO
        </span>
      )}

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent", border: "none",
          color: "#9ca3af", fontSize: 14, cursor: "pointer",
          padding: 4, flexShrink: 0,
          opacity: hovered ? 1 : 0,
          transition: "opacity 0.15s",
          fontFamily: "Figtree, sans-serif",
        }}
      >
        ✕
      </button>
    </div>
  );
}
