import { useState, useMemo } from "react";
import { ledgerApi, installmentsApi, recurringApi } from "../api";
import { ENTITIES } from "../constants";
import { fmtIDR, todayStr, ym, daysUntil } from "../utils";
import Modal, { ConfirmModal } from "./shared/Modal";
import Button from "./shared/Button";
import Input, { Field, AmountInput, FormRow } from "./shared/Input";
import Select from "./shared/Select";
import { EmptyState, showToast } from "./shared/Card";

const SUBTABS = [
  { id: "overview",     label: "Overview" },
  { id: "transactions", label: "Transactions" },
  { id: "installments", label: "Installments" },
  { id: "recurring",    label: "Recurring" },
];

// ─── NETWORK BADGE TEXT ──────────────────────────────────────
const NETWORK_STYLE = {
  Visa:       { text: "VISA",       style: { fontStyle: "italic", fontWeight: 800, letterSpacing: 1 } },
  Mastercard: { text: "MC",         style: { fontWeight: 900 } },
  JCB:        { text: "JCB",        style: { fontWeight: 800 } },
  Amex:       { text: "AMEX",       style: { fontWeight: 800, letterSpacing: 1 } },
  UnionPay:   { text: "UnionPay",   style: { fontWeight: 700, fontSize: 9 } },
};

// Derive a darker accent from hex color
function darkenHex(hex, amount = 40) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, (n >> 16) - amount);
  const g = Math.max(0, ((n >> 8) & 0xff) - amount);
  const b = Math.max(0, (n & 0xff) - amount);
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
}

export default function CreditCards({
  user, accounts, ledger, thisMonthLedger, categories,
  installments, recurTemplates,
  setAccounts, setLedger, setInstallments, setRecurTemplates,
  onRefresh, bankAccounts: propBankAccounts,
}) {
  const [subTab,       setSubTab]       = useState("overview");
  const [selectedCard, setSelectedCard] = useState(null);
  const [filterMonth,  setFilterMonth]  = useState(ym(todayStr()));
  const [modal,        setModal]        = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [deleteInstId, setDeleteInstId] = useState(null);

  // Pay CC form
  const [payForm, setPayForm] = useState({
    cardId: "", bankId: "", amount: "", admin_fee: "", materai: "", notes: "",
  });
  const setP = (k, v) => setPayForm(f => ({ ...f, [k]: v }));

  // Installment form
  const [instForm, setInstForm] = useState({
    account_id: "", description: "", total_amount: "", months: 12,
    monthly_amount: "", start_date: todayStr(), entity: "Personal",
  });
  const setI = (k, v) => setInstForm(f => ({ ...f, [k]: v }));

  const creditCards  = useMemo(() => accounts.filter(a => a.type === "credit_card"), [accounts]);
  const bankAccounts = useMemo(() =>
    propBankAccounts || accounts.filter(a => a.type === "bank"),
  [propBankAccounts, accounts]);

  // ── Card stats ──
  const cardStats = useMemo(() => creditCards.map(cc => {
    const debt   = Number(cc.current_balance || 0);
    const limit  = Number(cc.card_limit || 0);
    const avail  = Math.max(0, limit - debt);
    const util   = limit > 0 ? (debt / limit) * 100 : 0;
    const target = Number(cc.monthly_target || 0);
    const monthSpent = ledger
      .filter(e => ym(e.date) === filterMonth && e.from_account_id === cc.id && e.type === "expense")
      .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
    const dueIn  = cc.due_day       ? daysUntil(cc.due_day)       : null;
    const stmtIn = cc.statement_day ? daysUntil(cc.statement_day) : null;
    return { ...cc, debt, limit, avail, util, target, monthSpent, dueIn, stmtIn };
  }), [creditCards, ledger, filterMonth]);

  const ccLedger = useMemo(() =>
    ledger.filter(e => {
      const isCC   = creditCards.some(c => c.id === e.from_account_id || c.id === e.to_account_id);
      const inMon  = !filterMonth || ym(e.date) === filterMonth;
      const forCard= !selectedCard || e.from_account_id === selectedCard || e.to_account_id === selectedCard;
      return isCC && inMon && forCard;
    }),
  [ledger, creditCards, filterMonth, selectedCard]);

  const ccInstallments = useMemo(() =>
    installments.filter(i => creditCards.some(c => c.id === i.account_id)),
  [installments, creditCards]);

  const ccRecurring = useMemo(() =>
    recurTemplates.filter(r => creditCards.some(c => c.id === r.from_account_id)),
  [recurTemplates, creditCards]);

  // ── Pay CC ──
  const payBill = async () => {
    if (!payForm.cardId || !payForm.bankId || !payForm.amount) {
      showToast("Select card, bank, and amount", "error"); return;
    }
    setSaving(true);
    try {
      const amt  = Number(payForm.amount);
      const cc   = accounts.find(a => a.id === payForm.cardId);
      const total = amt + Number(payForm.admin_fee || 0) + Number(payForm.materai || 0);
      const entry = {
        date:            todayStr(),
        description:     `Pay ${cc?.name || "CC"} bill`,
        amount:          total,
        currency:        "IDR",
        amount_idr:      total,
        type:            "pay_cc",
        from_account_id: payForm.bankId,
        to_account_id:   payForm.cardId,
        entity:          "Personal",
        notes:           payForm.notes || "",
      };
      const created = await ledgerApi.create(user.id, entry, accounts);
      if (created) setLedger(p => [created, ...p]);
      await onRefresh();
      showToast(`Paid ${fmtIDR(amt)} to ${cc?.name}`);
      setModal(null);
      setPayForm({ cardId: "", bankId: "", amount: "", admin_fee: "", materai: "", notes: "" });
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── Add installment ──
  const saveInst = async () => {
    if (!instForm.account_id || !instForm.description || !instForm.total_amount) {
      showToast("Fill required fields", "error"); return;
    }
    setSaving(true);
    try {
      const monthlyAmt = instForm.monthly_amount
        || Math.round(Number(instForm.total_amount) / Number(instForm.months || 12));
      const d = {
        ...instForm,
        monthly_amount: Number(monthlyAmt),
        total_amount:   Number(instForm.total_amount),
        months:         Number(instForm.months),
        paid_months:    0,
      };
      const created = await installmentsApi.create(user.id, d);
      if (created) setInstallments(p => [created, ...p]);
      showToast("Installment plan added");
      setModal(null);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── Mark installment month paid ──
  const markInstPaid = async (inst) => {
    try {
      const newPaid = Math.min(inst.paid_months + 1, inst.months);
      await installmentsApi.update(inst.id, { paid_months: newPaid });
      setInstallments(p => p.map(x => x.id === inst.id ? { ...x, paid_months: newPaid } : x));
      const entry = {
        date:            todayStr(),
        description:     `${inst.description} — Month ${newPaid}/${inst.months}`,
        amount:          Number(inst.monthly_amount),
        currency:        inst.currency || "IDR",
        amount_idr:      Number(inst.monthly_amount),
        type:            "cc_installment",
        from_account_id: inst.account_id,
        entity:          inst.entity || "Personal",
        notes:           "CC Installment",
      };
      const created = await ledgerApi.create(user.id, entry, accounts);
      if (created) setLedger(p => [created, ...p]);
      showToast(`Month ${newPaid} marked paid`);
    } catch (e) { showToast(e.message, "error"); }
  };

  const deleteInstallment = async () => {
    if (!deleteInstId) return;
    try {
      await installmentsApi.delete(deleteInstId);
      setInstallments(p => p.filter(x => x.id !== deleteInstId));
      showToast("Deleted");
    } catch (e) { showToast(e.message, "error"); }
    setDeleteInstId(null);
  };

  // ── Toggle recurring active ──
  const toggleRecurring = async (r) => {
    try {
      const updated = await recurringApi.updateTemplate(r.id, { active: !r.active });
      setRecurTemplates(p => p.map(x => x.id === r.id ? updated : x));
      showToast(updated.active ? "Activated" : "Paused");
    } catch (e) { showToast(e.message, "error"); }
  };

  // ── Apply recurring now ──
  const applyRecurringNow = async (r) => {
    try {
      const cc = accounts.find(a => a.id === r.from_account_id);
      const entry = {
        date:            todayStr(),
        description:     r.name,
        amount:          Number(r.amount),
        currency:        r.currency || "IDR",
        amount_idr:      Number(r.amount),
        type:            r.type || "expense",
        from_account_id: r.from_account_id || "",
        to_account_id:   r.to_account_id   || "",
        entity:          r.entity          || "Personal",
        notes:           `Applied from recurring template`,
      };
      const created = await ledgerApi.create(user.id, entry, accounts);
      if (created) setLedger(p => [created, ...p]);
      await onRefresh();
      showToast(`Applied: ${r.name}`);
    } catch (e) { showToast(e.message, "error"); }
  };

  // ─── RENDER ────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button variant="secondary" size="sm" onClick={() => { setInstForm({ account_id: "", description: "", total_amount: "", months: 12, monthly_amount: "", start_date: todayStr(), entity: "Personal" }); setModal("inst"); }}>
          + Installment
        </Button>
        <Button size="sm" onClick={() => { setPayForm({ cardId: "", bankId: "", amount: "", admin_fee: "", materai: "", notes: "" }); setModal("pay"); }}>
          💳 Pay Bill
        </Button>
      </div>

      {/* ── SUBTABS ── */}
      <div style={{ display: "flex", gap: 4 }}>
        {SUBTABS.map(t => {
          const active = subTab === t.id;
          return (
            <button key={t.id} onClick={() => setSubTab(t.id)} style={{
              height: 30, padding: "0 12px", borderRadius: 20,
              border: `1.5px solid ${active ? "#111827" : "#e5e7eb"}`,
              background: active ? "#111827" : "#fff",
              color: active ? "#fff" : "#6b7280",
              fontSize: 12, fontWeight: active ? 700 : 500,
              cursor: "pointer", fontFamily: "Figtree, sans-serif",
            }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ══ OVERVIEW ══ */}
      {subTab === "overview" && (
        creditCards.length === 0
          ? <EmptyState icon="💳" title="No credit cards" message="Add a credit card from Accounts." />
          : <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {cardStats.map(cc => <CCCard key={cc.id} cc={cc} onPay={() => { setPayForm(f => ({ ...f, cardId: cc.id, amount: cc.debt })); setModal("pay"); }} onTransactions={() => { setSelectedCard(cc.id); setSubTab("transactions"); }} />)}
            </div>
      )}

      {/* ══ TRANSACTIONS ══ */}
      {subTab === "transactions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Filters */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={FILTER_SEL}>
              <option value="">All months</option>
              {Array.from({ length: 12 }).map((_, i) => {
                const d = new Date(); d.setMonth(d.getMonth() - i);
                const m = d.toISOString().slice(0, 7);
                return <option key={m} value={m}>{d.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</option>;
              })}
            </select>
            <select value={selectedCard || ""} onChange={e => setSelectedCard(e.target.value || null)} style={FILTER_SEL}>
              <option value="">All Cards</option>
              {creditCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
            {ccLedger.length} transactions · {fmtIDR(ccLedger.reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0), true)}
          </div>
          {ccLedger.length === 0
            ? <EmptyState icon="📋" message="No CC transactions found" />
            : ccLedger.map(e => {
                const cc  = creditCards.find(c => c.id === e.from_account_id);
                const cat = categories.find(c => c.id === e.category_id);
                const isPayment = e.type === "pay_cc";
                return (
                  <div key={e.id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 0", borderBottom: "1px solid #f3f4f6",
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: isPayment ? "#dcfce7" : "#fee2e2",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0,
                    }}>
                      {isPayment ? "✓" : cat?.icon || "💳"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {e.description}
                      </div>
                      <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                        {e.date}
                        {cc && <span style={{ color: cc.color || "#3b5bdb" }}> · ····{cc.last4}</span>}
                        {(cat || e.category_label) && ` · ${cat?.name || e.category_label}`}
                        {e.entity && e.entity !== "Personal" && ` · ${e.entity}`}
                        {e.is_reimburse && <span style={{ color: "#d97706" }}> · ↗ Reimb</span>}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 13, fontWeight: 700,
                      color: isPayment ? "#059669" : "#dc2626",
                      fontFamily: "Figtree, sans-serif", flexShrink: 0,
                    }}>
                      {isPayment ? "+" : "−"}{fmtIDR(Number(e.amount_idr || e.amount || 0))}
                    </div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ══ INSTALLMENTS ══ */}
      {subTab === "installments" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button size="sm" onClick={() => setModal("inst")}>+ Add Installment</Button>
          </div>
          {ccInstallments.length === 0
            ? <EmptyState icon="📅" title="No installments" message="Track 0% installment plans here." />
            : ccInstallments.map(inst => {
                const cc        = creditCards.find(c => c.id === inst.account_id);
                const remaining = inst.months - inst.paid_months;
                const pct       = inst.months > 0 ? (inst.paid_months / inst.months) * 100 : 0;
                const isDone    = inst.paid_months >= inst.months;
                return (
                  <div key={inst.id} style={{
                    background: "#ffffff", borderRadius: 14,
                    border: `1px solid ${isDone ? "#bbf7d0" : "#f3f4f6"}`,
                    padding: "14px 16px",
                  }}>
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                          {inst.description}
                        </div>
                        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 3, display: "flex", gap: 8 }}>
                          <span>{cc?.name || "CC"}</span>
                          <span>{inst.months} months</span>
                          <span style={{ fontWeight: 700, color: "#374151" }}>{fmtIDR(inst.monthly_amount)}/mo</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: isDone ? "#059669" : "#3b5bdb", fontFamily: "Figtree, sans-serif" }}>
                          {isDone ? "✓ Done" : fmtIDR(Number(inst.monthly_amount || 0) * remaining, true)}
                        </div>
                        <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                          {isDone ? "Fully paid" : "remaining"}
                        </div>
                      </div>
                    </div>

                    {/* Progress dots */}
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                      {Array.from({ length: inst.months }).map((_, i) => (
                        <div key={i} style={{
                          width: Math.min(16, Math.max(8, Math.floor(240 / inst.months))),
                          height: 14, borderRadius: 3,
                          background: i < inst.paid_months ? "#059669" : "#f3f4f6",
                          border: `1px solid ${i < inst.paid_months ? "#059669" : "#e5e7eb"}`,
                          title: `Month ${i + 1}`,
                          cursor: "default",
                          flexShrink: 0,
                        }} />
                      ))}
                    </div>

                    {/* Progress bar + label */}
                    <BarWithLabel
                      value={inst.paid_months}
                      max={inst.months}
                      color={isDone ? "#059669" : "#3b5bdb"}
                      label={`${inst.paid_months}/${inst.months} months paid`}
                      labelRight={`${pct.toFixed(0)}%`}
                    />

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      {!isDone && (
                        <Button size="sm" onClick={() => markInstPaid(inst)}>
                          ✓ Mark Month {inst.paid_months + 1} Paid
                        </Button>
                      )}
                      <Button size="sm" variant="danger" onClick={() => setDeleteInstId(inst.id)}>
                        🗑
                      </Button>
                    </div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ══ RECURRING ══ */}
      {subTab === "recurring" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ccRecurring.length === 0
            ? <EmptyState icon="🔄" title="No recurring templates" message="Add recurring CC templates in Settings → Recurring." />
            : ccRecurring.map(r => {
                const cc = creditCards.find(c => c.id === r.from_account_id);
                return (
                  <div key={r.id} style={{
                    background: "#ffffff", borderRadius: 12,
                    border: `1.5px solid ${r.active ? "#e5e7eb" : "#f3f4f6"}`,
                    padding: "14px 16px",
                    opacity: r.active ? 1 : 0.65,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                          {r.name}
                        </div>
                        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 3, display: "flex", gap: 8 }}>
                          <span>{cc?.name || "CC"}</span>
                          <span>{r.frequency}</span>
                          {r.day_of_month && <span>Day {r.day_of_month}</span>}
                          {r.entity && r.entity !== "Personal" && <span style={{ color: "#3b5bdb" }}>{r.entity}</span>}
                        </div>
                      </div>

                      {/* Amount */}
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", fontFamily: "Figtree, sans-serif", flexShrink: 0 }}>
                        {fmtIDR(Number(r.amount || 0), true)}
                      </div>

                      {/* Active toggle */}
                      <button
                        onClick={() => toggleRecurring(r)}
                        style={{
                          height:       26,
                          padding:      "0 10px",
                          borderRadius: 20,
                          border:       "none",
                          background:   r.active ? "#dcfce7" : "#f3f4f6",
                          color:        r.active ? "#059669" : "#9ca3af",
                          fontSize:     11,
                          fontWeight:   700,
                          cursor:       "pointer",
                          fontFamily:   "Figtree, sans-serif",
                          flexShrink:   0,
                        }}
                      >
                        {r.active ? "Active" : "Paused"}
                      </button>
                    </div>

                    {/* Apply now */}
                    {r.active && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f3f4f6" }}>
                        <Button size="sm" variant="secondary" onClick={() => applyRecurringNow(r)}>
                          ▶ Apply Now
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ══ PAY CC MODAL ══ */}
      <Modal
        isOpen={modal === "pay"}
        onClose={() => setModal(null)}
        title="💳 Pay Credit Card"
        footer={
          <Button fullWidth onClick={payBill} busy={saving}>
            Pay Now →
          </Button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Select label="Credit Card"
            value={payForm.cardId} onChange={e => setP("cardId", e.target.value)}
            placeholder="Select card…"
            options={cardStats.map(c => ({ value: c.id, label: `${c.name} — Debt: ${fmtIDR(c.debt, true)}` }))}
          />
          <Select label="Pay From (Bank)"
            value={payForm.bankId} onChange={e => setP("bankId", e.target.value)}
            placeholder="Select bank…"
            options={bankAccounts.map(b => ({ value: b.id, label: `${b.name} — ${fmtIDR(Number(b.current_balance || 0), true)}` }))}
          />

          {payForm.cardId && (() => {
            const cc = cardStats.find(c => c.id === payForm.cardId);
            return cc ? (
              <div style={{ padding: "10px 12px", background: "#fef9ec", borderRadius: 10, border: "1px solid #fde68a" }}>
                <div style={{ fontSize: 11, color: "#92400e", fontFamily: "Figtree, sans-serif", fontWeight: 600 }}>
                  Full balance: {fmtIDR(cc.debt)} — you can pay a partial amount
                </div>
                <button
                  onClick={() => setP("amount", cc.debt)}
                  style={{ fontSize: 11, color: "#d97706", background: "none", border: "none", cursor: "pointer", fontFamily: "Figtree, sans-serif", fontWeight: 700, padding: "4px 0 0" }}
                >
                  Pay full balance →
                </button>
              </div>
            ) : null;
          })()}

          <AmountInput label="Payment Amount" value={payForm.amount} onChange={v => setP("amount", v)} />

          <FormRow>
            <AmountInput label="Admin Fee (optional)" value={payForm.admin_fee} onChange={v => setP("admin_fee", v)} style={{ flex: 1 }} />
            <AmountInput label="Materai (optional)"   value={payForm.materai}   onChange={v => setP("materai", v)}   style={{ flex: 1 }} />
          </FormRow>

          <Input label="Notes (optional)" value={payForm.notes} onChange={e => setP("notes", e.target.value)} placeholder="Optional" />
        </div>
      </Modal>

      {/* ══ ADD INSTALLMENT MODAL ══ */}
      <Modal
        isOpen={modal === "inst"}
        onClose={() => setModal(null)}
        title="Add Installment Plan"
        footer={<Button fullWidth onClick={saveInst} busy={saving}>Save Installment</Button>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Select label="Credit Card" value={instForm.account_id} onChange={e => setI("account_id", e.target.value)}
            placeholder="Select card…" options={creditCards.map(c => ({ value: c.id, label: c.name }))} />
          <Input label="Description" value={instForm.description} onChange={e => setI("description", e.target.value)}
            placeholder="e.g. MacBook Pro 0%" />
          <FormRow>
            <AmountInput label="Total Amount" value={instForm.total_amount} onChange={v => setI("total_amount", v)} style={{ flex: 1 }} />
            <Field label="Months" style={{ width: 90, flexShrink: 0 }}>
              <input type="number" value={instForm.months} onChange={e => setI("months", e.target.value)}
                min={1} max={60}
                style={{ width: "100%", height: 44, padding: "0 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 700, color: "#111827", background: "#fff", outline: "none", boxSizing: "border-box" }}
              />
            </Field>
          </FormRow>
          <AmountInput
            label={`Monthly Amount (auto: ${instForm.total_amount && instForm.months ? fmtIDR(Math.round(Number(instForm.total_amount) / Number(instForm.months)), true) : "—"})`}
            value={instForm.monthly_amount}
            onChange={v => setI("monthly_amount", v)}
          />
          <FormRow>
            <Input label="Start Date" type="date" value={instForm.start_date} onChange={e => setI("start_date", e.target.value)} style={{ flex: 1 }} />
            <Select label="Entity" value={instForm.entity} onChange={e => setI("entity", e.target.value)} options={ENTITIES} style={{ flex: 1 }} />
          </FormRow>
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmModal
        isOpen={!!deleteInstId}
        onClose={() => setDeleteInstId(null)}
        onConfirm={deleteInstallment}
        title="Delete Installment"
        message="Remove this installment plan? Transaction history is preserved."
        danger
      />
    </div>
  );
}

// ─── CC VISUAL CARD ──────────────────────────────────────────
function CCCard({ cc, onPay, onTransactions }) {
  const base      = cc.color || "#3b5bdb";
  const dark      = darkenHex(base, 50);
  const utilColor = cc.util > 80 ? "#dc2626" : cc.util > 60 ? "#d97706" : "#059669";
  const netw      = NETWORK_STYLE[cc.network] || NETWORK_STYLE.Visa;

  return (
    <div style={{ background: "#ffffff", borderRadius: 16, border: "1px solid #f3f4f6", overflow: "hidden" }}>

      {/* ── Visual card face ── */}
      <div style={{
        background:  `linear-gradient(135deg, ${base} 0%, ${dark} 100%)`,
        padding:     "20px 20px 18px",
        color:       "#fff",
        position:    "relative",
        overflow:    "hidden",
        minHeight:   140,
      }}>
        {/* Decorative circles */}
        <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, background: "rgba(255,255,255,0.07)", borderRadius: "50%" }} />
        <div style={{ position: "absolute", bottom: -30, left: 40,  width: 80,  height: 80,  background: "rgba(255,255,255,0.05)", borderRadius: "50%" }} />

        {/* Row 1: bank · network */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, position: "relative" }}>
          <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.8, fontFamily: "Figtree, sans-serif" }}>
            {cc.bank_name || "Bank"}{cc.entity && cc.entity !== "Personal" ? ` · ${cc.entity}` : ""}
          </div>
          <div style={{ fontSize: 14, color: "#fff", fontFamily: "Figtree, sans-serif", ...netw.style, opacity: 0.9 }}>
            {netw.text}
          </div>
        </div>

        {/* Card number */}
        <div style={{
          fontSize:      17,
          fontWeight:    700,
          letterSpacing: "3px",
          fontFamily:    "Figtree, sans-serif",
          marginBottom:  16,
          position:      "relative",
        }}>
          ···· ···· ···· {cc.last4 || "????"}
        </div>

        {/* Row 3: Debt + Available */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", position: "relative" }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: "Figtree, sans-serif", marginBottom: 2 }}>Current Debt</div>
            <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "Figtree, sans-serif", lineHeight: 1 }}>
              {fmtIDR(cc.debt, true)}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, fontWeight: 600, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: "Figtree, sans-serif", marginBottom: 2 }}>Available</div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "Figtree, sans-serif" }}>
              {fmtIDR(cc.avail, true)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats section ── */}
      <div style={{ padding: "14px 16px" }}>

        {/* Utilization bar */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
            <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
              Limit: {fmtIDR(cc.limit, true)}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: utilColor, fontFamily: "Figtree, sans-serif" }}>
              {cc.util.toFixed(0)}% used
            </span>
          </div>
          <BarSimple value={cc.debt} max={cc.limit || 1} color={utilColor} height={6} />
        </div>

        {/* Monthly target bar (with target marker) */}
        {cc.target > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>This month</span>
              <span style={{
                fontSize: 11, fontWeight: 700, fontFamily: "Figtree, sans-serif",
                color: cc.monthSpent > cc.target ? "#dc2626" : "#059669",
              }}>
                {fmtIDR(cc.monthSpent, true)} / {fmtIDR(cc.target, true)}
              </span>
            </div>
            <BarWithTarget value={cc.monthSpent} max={cc.target * 1.5} target={cc.target}
              color={cc.monthSpent > cc.target ? "#dc2626" : "#059669"} />
          </div>
        )}

        {/* Due / Statement dates */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          {cc.dueIn !== null && (
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 8,
              background: cc.dueIn <= 3 ? "#fee2e2" : cc.dueIn <= 7 ? "#fef3c7" : "#f9fafb",
              border: `1px solid ${cc.dueIn <= 3 ? "#fecaca" : cc.dueIn <= 7 ? "#fde68a" : "#f3f4f6"}`,
            }}>
              <span style={{ fontSize: 12 }}>{cc.dueIn <= 3 ? "🔴" : cc.dueIn <= 7 ? "🟡" : "🟢"}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
                Due in {cc.dueIn}d
              </span>
            </div>
          )}
          {cc.stmtIn !== null && (
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 8,
              background: "#f9fafb", border: "1px solid #f3f4f6",
            }}>
              <span style={{ fontSize: 12 }}>📄</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
                Statement in {cc.stmtIn}d
              </span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" fullWidth onClick={onPay}>💳 Pay Bill</Button>
          <Button size="sm" variant="secondary" onClick={onTransactions}>📋 Transactions</Button>
        </div>
      </div>
    </div>
  );
}

// ─── SIMPLE PROGRESS BAR ─────────────────────────────────────
function BarSimple({ value, max, color = "#059669", height = 5 }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ height, background: "#f3f4f6", borderRadius: height, overflow: "hidden" }}>
      <div style={{ height, width: `${pct}%`, background: color, borderRadius: height, transition: "width 0.3s" }} />
    </div>
  );
}

// ─── BAR WITH TARGET MARKER ──────────────────────────────────
function BarWithTarget({ value, max, target, color }) {
  const pct       = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const targetPct = max > 0 ? Math.min((target / max) * 100, 100) : 0;
  return (
    <div style={{ position: "relative", height: 8, background: "#f3f4f6", borderRadius: 8, overflow: "visible" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 8, transition: "width 0.3s" }} />
      {/* Target marker */}
      <div style={{
        position:  "absolute",
        left:      `${targetPct}%`,
        top:       -3,
        width:     2,
        height:    14,
        background: "#374151",
        borderRadius: 1,
        transform: "translateX(-50%)",
      }} />
    </div>
  );
}

// ─── BAR WITH LABEL ──────────────────────────────────────────
function BarWithLabel({ value, max, color, label, labelRight }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div>
      <div style={{ height: 5, background: "#f3f4f6", borderRadius: 5, overflow: "hidden", marginBottom: 4 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 5, transition: "width 0.3s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>{label}</span>
        {labelRight && <span style={{ fontSize: 10, fontWeight: 700, color, fontFamily: "Figtree, sans-serif" }}>{labelRight}</span>}
      </div>
    </div>
  );
}

// ─── STYLES ──────────────────────────────────────────────────
const FILTER_SEL = {
  height: 32, padding: "0 10px", borderRadius: 8,
  border: "1.5px solid #e5e7eb", background: "#fff",
  fontFamily: "Figtree, sans-serif", fontSize: 12, fontWeight: 500,
  color: "#374151", outline: "none", cursor: "pointer",
  appearance: "none", WebkitAppearance: "none",
};
