import { useState, useMemo } from "react";
import { accountsApi, recurringApi } from "../api";
import {
  ENTITIES, BANKS_L, NETWORKS, ASSET_SUBTYPES, LIAB_SUBTYPES,
  ACC_TYPE_LABEL, ACC_TYPE_ICON,
} from "../constants";
import { fmtIDR, todayStr } from "../utils";
import Modal, { ConfirmModal } from "./shared/Modal";
import Button from "./shared/Button";
import Input, { Field, AmountInput, FormRow } from "./shared/Input";
import Select from "./shared/Select";
import { EmptyState, Spinner, showToast, Badge } from "./shared/Card";

// ─── SANITIZE NUMERIC ────────────────────────────────────────
const sn = (val) => {
  if (val === "" || val === null || val === undefined) return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
};

// ─── SUBTABS ─────────────────────────────────────────────────
const SUBTABS = [
  { id: "all",         label: "All" },
  { id: "bank",        label: "Bank" },
  { id: "credit_card", label: "Credit Cards" },
  { id: "asset",       label: "Assets" },
  { id: "liability",   label: "Liabilities" },
  { id: "receivable",  label: "Receivables" },
];

// ─── TYPE COLORS / BG ────────────────────────────────────────
const TYPE_BG = {
  bank:        "#e8f4fd", credit_card: "#fde8e8",
  asset:       "#e8fdf0", liability:   "#fff0f0",
  receivable:  "#fdf6e8",
};
const TYPE_COLOR = {
  bank:        "#3b5bdb", credit_card: "#dc2626",
  asset:       "#059669", liability:   "#dc2626",
  receivable:  "#d97706",
};

export default function Accounts({
  user, accounts, ledger, onRefresh,
  setAccounts, setRecurTemplates, CURRENCIES,
}) {
  const [subTab,   setSubTab]   = useState("all");
  const [modal,    setModal]    = useState(null); // null | "add" | "edit" | "history" | "delete"
  const [step,     setStep]     = useState(1);
  const [formType, setFormType] = useState("bank");
  const [editAcc,  setEditAcc]  = useState(null);
  const [form,     setForm]     = useState({});
  const [saving,   setSaving]   = useState(false);
  const [histAcc,  setHistAcc]  = useState(null);
  const [deleteAcc, setDeleteAcc] = useState(null);

  // ─── FILTERED ACCOUNTS ──────────────────────────────────────
  const filtered = useMemo(() =>
    accounts.filter(a => subTab === "all" || a.type === subTab),
  [accounts, subTab]);

  // ─── SUMMARY TOTALS ─────────────────────────────────────────
  const totals = useMemo(() => ({
    bank:       accounts.filter(a => a.type === "bank")
                  .reduce((s, a) => s + Number(a.current_balance || 0), 0),
    cc:         accounts.filter(a => a.type === "credit_card")
                  .reduce((s, a) => s + Number(a.current_balance || 0), 0),
    assets:     accounts.filter(a => a.type === "asset")
                  .reduce((s, a) => s + Number(a.current_value || 0), 0),
    liabilities: accounts.filter(a => a.type === "liability")
                  .reduce((s, a) => s + Number(a.outstanding_amount || 0), 0),
    receivables: accounts.filter(a => a.type === "receivable")
                  .reduce((s, a) => s + Number(a.outstanding_amount || 0), 0),
  }), [accounts]);

  // ─── OPEN ADD MODAL ─────────────────────────────────────────
  const openAdd = () => {
    setEditAcc(null);
    setFormType("bank");
    setForm(emptyForm("bank"));
    setStep(1);
    setModal("add");
  };

  // ─── OPEN EDIT MODAL ────────────────────────────────────────
  const openEdit = (a) => {
    setEditAcc(a);
    setFormType(a.type);
    setForm({ ...a });
    setStep(2); // go straight to form when editing
    setModal("edit");
  };

  // ─── SELECT TYPE (step 1) ───────────────────────────────────
  const selectType = (type) => {
    setFormType(type);
    setForm(emptyForm(type));
    setStep(2);
  };

  // ─── SAVE ───────────────────────────────────────────────────
  const save = async () => {
    if (!form.name?.trim()) { showToast("Name is required", "error"); return; }
    setSaving(true);
    try {
      // Sanitize all numeric fields before insert/update
      const clean = {
        ...form,
        current_balance:    sn(form.current_balance),
        initial_balance:    sn(form.initial_balance),
        current_value:      sn(form.current_value),
        purchase_price:     sn(form.purchase_price),
        card_limit:         sn(form.card_limit),
        monthly_target:     sn(form.monthly_target),
        statement_day:      sn(form.statement_day),
        due_day:            sn(form.due_day),
        outstanding_amount: sn(form.outstanding_amount),
        total_amount:    sn(form.total_amount),
        monthly_payment:    sn(form.monthly_payment),
        liability_interest_rate: sn(form.liability_interest_rate),
        interest_rate:      sn(form.interest_rate),
        monthly_installment:sn(form.monthly_installment),
        receivable_total:  sn(form.receivable_total),
        sort_order:         sn(form.sort_order),
      };

      if (editAcc) {
        const updated = await accountsApi.update(editAcc.id, clean);
        setAccounts(p => p.map(a => a.id === editAcc.id ? updated : a));
        showToast("Account updated");
      } else {
        const created = await accountsApi.create(user.id, {
          ...clean, type: formType, is_active: true, sort_order: accounts.length,
        });
        setAccounts(p => [...p, created]);

        // Auto-create recurring template for employee loans
        if (formType === "receivable" && form.receivable_type === "employee_loan" && sn(form.monthly_installment) > 0) {
          try {
            const bankAccounts = accounts.filter(a => a.type === "bank");
            const tmpl = await recurringApi.createTemplate(user.id, {
              name:            `Loan — ${form.contact_name || form.name}`,
              type:            "collect_loan",
              amount:          sn(form.monthly_installment),
              currency:        "IDR",
              frequency:       "Monthly",
              entity:          "Personal",
              notes:           `Auto-created for employee loan: ${form.contact_name || form.name}`,
              from_account_id: created.id,
              to_account_id:   form.default_bank_id || bankAccounts[0]?.id || "",
            });
            setRecurTemplates?.(p => [tmpl, ...p]);
            showToast(`Account + monthly reminder created`);
          } catch { /* non-fatal */ }
        } else {
          showToast("Account created");
        }
      }
      setModal(null);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ─── DELETE ─────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteAcc) return;
    try {
      await accountsApi.delete(deleteAcc.id);
      setAccounts(p => p.filter(x => x.id !== deleteAcc.id));
      showToast("Account deleted");
    } catch (e) { showToast(e.message, "error"); }
    setDeleteAcc(null);
  };

  const bankAccounts = useMemo(() => accounts.filter(a => a.type === "bank"), [accounts]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ─── RENDER ──────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div />
        <Button onClick={openAdd} size="sm">+ Add Account</Button>
      </div>

      {/* ── SUMMARY BAR ── */}
      <div style={{
        display:             "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap:                 8,
      }}>
        {[
          { label: "Bank",        value: totals.bank,        color: "#3b5bdb", bg: "#e8f4fd" },
          { label: "CC Debt",     value: totals.cc,          color: "#dc2626", bg: "#fde8e8" },
          { label: "Assets",      value: totals.assets,      color: "#059669", bg: "#e8fdf0" },
          { label: "Receivables", value: totals.receivables, color: "#d97706", bg: "#fdf6e8" },
          { label: "Liabilities", value: totals.liabilities, color: "#dc2626", bg: "#fff0f0" },
        ].filter(s => s.value > 0).slice(0, 3).map(s => (
          <div key={s.label} style={{
            background:   s.bg,
            borderRadius: 12,
            padding:      "12px 14px",
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 4, opacity: 0.75 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
              {fmtIDR(s.value, true)}
            </div>
          </div>
        ))}
      </div>

      {/* ── SUBTABS ── */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {SUBTABS.map(t => {
          const active = subTab === t.id;
          return (
            <button key={t.id} onClick={() => setSubTab(t.id)} style={{
              height:       30,
              padding:      "0 12px",
              borderRadius: 20,
              border:       `1.5px solid ${active ? "#111827" : "#e5e7eb"}`,
              background:   active ? "#111827" : "#fff",
              color:        active ? "#fff" : "#6b7280",
              fontSize:     12,
              fontWeight:   active ? 700 : 500,
              cursor:       "pointer",
              fontFamily:   "Figtree, sans-serif",
              transition:   "all 0.15s",
            }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── ACCOUNT LIST ── */}
      {filtered.length === 0 ? (
        <EmptyState icon="🏦" title="No accounts" message="Add your first account to get started." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(a => (
            <AccountCard
              key={a.id}
              account={a}
              ledger={ledger}
              accounts={accounts}
              onEdit={() => openEdit(a)}
              onDelete={() => setDeleteAcc(a)}
              onHistory={() => { setHistAcc(a); setModal("history"); }}
            />
          ))}
        </div>
      )}

      {/* ── ADD / EDIT MODAL ── */}
      <Modal
        isOpen={modal === "add" || modal === "edit"}
        onClose={() => setModal(null)}
        title={
          modal === "edit"
            ? `Edit — ${ACC_TYPE_LABEL[formType]}`
            : step === 1
              ? "Add Account"
              : `New ${ACC_TYPE_LABEL[formType]}`
        }
        footer={
          step === 2 && (
            <div style={{ display: "flex", gap: 8 }}>
              {modal === "add" && (
                <Button variant="secondary" onClick={() => setStep(1)} style={{ flex: 0 }}>
                  ← Back
                </Button>
              )}
              <Button fullWidth onClick={save} busy={saving}>
                {modal === "edit" ? "Save Changes" : "Create Account"}
              </Button>
            </div>
          )
        }
      >
        {step === 1 ? (
          /* ── STEP 1: Choose type ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginBottom: 4 }}>
              What type of account would you like to add?
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { id: "bank",        icon: "🏦", label: "Bank Account",  bg: "#e8f4fd", color: "#3b5bdb" },
                { id: "credit_card", icon: "💳", label: "Credit Card",   bg: "#fde8e8", color: "#dc2626" },
                { id: "asset",       icon: "📈", label: "Asset",         bg: "#e8fdf0", color: "#059669" },
                { id: "liability",   icon: "📉", label: "Liability",     bg: "#fff0f0", color: "#dc2626" },
                { id: "receivable",  icon: "📋", label: "Receivable",    bg: "#fdf6e8", color: "#d97706" },
              ].map(t => (
                <button key={t.id} onClick={() => selectType(t.id)} style={{
                  background:     t.bg,
                  border:         `1.5px solid ${t.color}22`,
                  borderRadius:   12,
                  padding:        "16px 12px",
                  cursor:         "pointer",
                  display:        "flex",
                  flexDirection:  "column",
                  alignItems:     "flex-start",
                  gap:            8,
                  textAlign:      "left",
                  transition:     "border-color 0.15s",
                }}>
                  <span style={{ fontSize: 22 }}>{t.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── STEP 2: Form fields ── */
          <AccountForm
            type={formType}
            form={form}
            set={set}
            accounts={accounts}
            bankAccounts={bankAccounts}
            CURRENCIES={CURRENCIES}
          />
        )}
      </Modal>

      {/* ── HISTORY MODAL ── */}
      <Modal
        isOpen={modal === "history"}
        onClose={() => setModal(null)}
        title={histAcc ? `${histAcc.name} — History` : "History"}
        width={520}
      >
        {histAcc && (
          <AccountHistory
            account={histAcc}
            ledger={ledger}
            accounts={accounts}
          />
        )}
      </Modal>

      {/* ── DELETE CONFIRM ── */}
      <ConfirmModal
        isOpen={!!deleteAcc}
        onClose={() => setDeleteAcc(null)}
        onConfirm={confirmDelete}
        title="Delete Account"
        message={`Delete "${deleteAcc?.name}"? This will hide it from view. Existing transactions are preserved.`}
        danger
      />

    </div>
  );
}

// ─── ACCOUNT CARD ────────────────────────────────────────────
function AccountCard({ account: a, ledger, accounts, onEdit, onDelete, onHistory }) {
  const bg    = TYPE_BG[a.type]    || "#f9fafb";
  const color = TYPE_COLOR[a.type] || "#6b7280";
  const icon  = ACC_TYPE_ICON[a.type] || "🏦";
  const txCount = ledger.filter(e => e.from_account_id === a.id || e.to_account_id === a.id).length;

  // Balance display per type
  const bal = (() => {
    if (a.type === "bank") {
      const v = Number(a.current_balance || 0);
      return { label: "Balance", value: v, color: v >= 0 ? "#059669" : "#dc2626" };
    }
    if (a.type === "credit_card") {
      const v = Number(a.current_balance || 0);
      const limit = Number(a.card_limit || 0);
      const util = limit > 0 ? (v / limit) * 100 : 0;
      return { label: "Debt", value: v, color: util > 80 ? "#dc2626" : util > 60 ? "#d97706" : "#374151", util, limit };
    }
    if (a.type === "asset") {
      const v    = Number(a.current_value || 0);
      const cost = Number(a.purchase_price || 0);
      const gain = cost > 0 ? v - cost : null;
      const pct  = cost > 0 ? ((v - cost) / cost) * 100 : null;
      return { label: "Value", value: v, color: "#059669", gain, pct };
    }
    if (a.type === "liability") {
      const v    = Number(a.outstanding_amount || 0);
      const orig = Number(a.total_amount || 0);
      const paid = orig > 0 ? orig - v : null;
      const pct  = orig > 0 ? ((orig - v) / orig) * 100 : null;
      return { label: "Outstanding", value: v, color: "#dc2626", paid, pct, orig };
    }
    if (a.type === "receivable") {
      const v = Number(a.outstanding_amount || 0);
      return { label: "Outstanding", value: v, color: "#d97706" };
    }
    return { label: "Balance", value: 0, color: "#6b7280" };
  })();

  return (
    <div style={{
      background:   "#ffffff",
      borderRadius: 14,
      border:       "1px solid #f3f4f6",
      padding:      "14px 16px",
      display:      "flex",
      flexDirection: "column",
      gap:           10,
    }}>
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        {/* Icon */}
        <div style={{
          width:           40,
          height:          40,
          borderRadius:    12,
          background:      bg,
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          fontSize:        20,
          flexShrink:      0,
        }}>
          {icon}
        </div>

        {/* Name + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize:    14, fontWeight: 700, color: "#111827",
            fontFamily:  "Figtree, sans-serif",
            whiteSpace:  "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {a.name}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
              {a.bank_name || a.subtype || ACC_TYPE_LABEL[a.type]}
            </span>
            {a.last4 && <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>····{a.last4}</span>}
            {a.account_no && <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>···{String(a.account_no).slice(-4)}</span>}
            {a.currency && a.currency !== "IDR" && (
              <span style={{
                fontSize: 9, fontWeight: 700, background: "#f3f4f6", color: "#6b7280",
                padding: "1px 5px", borderRadius: 4, fontFamily: "Figtree, sans-serif",
              }}>
                {a.currency}
              </span>
            )}
            {a.entity && a.entity !== "Personal" && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                background: color + "18", color, fontFamily: "Figtree, sans-serif",
              }}>
                {a.entity}
              </span>
            )}
          </div>
        </div>

        {/* Balance */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginBottom: 2 }}>
            {bal.label}
          </div>
          <div style={{
            fontSize: 16, fontWeight: 800, color: bal.color,
            fontFamily: "Figtree, sans-serif", lineHeight: 1.2,
          }}>
            {fmtIDR(Math.abs(bal.value))}
          </div>
          {/* CC utilization % */}
          {a.type === "credit_card" && bal.limit > 0 && (
            <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
              {bal.util?.toFixed(0)}% of {fmtIDR(bal.limit, true)}
            </div>
          )}
        </div>
      </div>

      {/* CC progress bar */}
      {a.type === "credit_card" && bal.limit > 0 && (
        <ProgressBar
          value={Number(a.current_balance || 0)}
          max={bal.limit}
          color={bal.util > 80 ? "#dc2626" : bal.util > 60 ? "#d97706" : "#059669"}
        />
      )}

      {/* Liability paydown */}
      {a.type === "liability" && bal.orig > 0 && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
              Paid {fmtIDR(bal.paid, true)} of {fmtIDR(bal.orig, true)}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", fontFamily: "Figtree, sans-serif" }}>
              {bal.pct?.toFixed(0)}%
            </span>
          </div>
          <ProgressBar value={bal.paid} max={bal.orig} color="#059669" />
        </div>
      )}

      {/* Asset gain/loss */}
      {a.type === "asset" && bal.gain !== null && (
        <div style={{
          fontSize: 11, fontWeight: 600,
          color:    bal.gain >= 0 ? "#059669" : "#dc2626",
          fontFamily: "Figtree, sans-serif",
        }}>
          {bal.gain >= 0 ? "▲" : "▼"} {fmtIDR(Math.abs(bal.gain), true)}
          {bal.pct !== null && ` (${bal.pct >= 0 ? "+" : ""}${bal.pct.toFixed(1)}%)`}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={onHistory} style={ACTION_BTN}>
          📋 History ({txCount})
        </button>
        <button onClick={onEdit} style={ACTION_BTN}>
          ✏️ Edit
        </button>
        <button onClick={onDelete} style={{ ...ACTION_BTN, background: "#fee2e2", color: "#dc2626", border: "1px solid #fecaca" }}>
          🗑
        </button>
      </div>
    </div>
  );
}

// ─── PROGRESS BAR ────────────────────────────────────────────
function ProgressBar({ value, max, color = "#059669", height = 5 }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ height, background: "#f3f4f6", borderRadius: height, overflow: "hidden" }}>
      <div style={{
        height, width: `${pct}%`, background: color,
        borderRadius: height, transition: "width 0.3s",
      }} />
    </div>
  );
}

// ─── ACCOUNT HISTORY ─────────────────────────────────────────
function AccountHistory({ account, ledger, accounts }) {
  const entries = ledger
    .filter(e => e.from_account_id === account.id || e.to_account_id === account.id)
    .slice(0, 50);

  if (entries.length === 0) return (
    <EmptyState icon="📋" message="No transactions for this account yet" />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map(e => {
        const isFrom = e.from_account_id === account.id;
        const amt    = Number(e.amount_idr || e.amount || 0);
        const other  = accounts.find(a => a.id === (isFrom ? e.to_account_id : e.from_account_id));
        return (
          <div key={e.id} style={{
            display:        "flex",
            justifyContent: "space-between",
            alignItems:     "center",
            padding:        "10px 12px",
            background:     "#f9fafb",
            borderRadius:   10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                {e.description || "—"}
              </div>
              <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                {e.date}
                {other && ` · ${isFrom ? "→" : "←"} ${other.name}`}
              </div>
            </div>
            <div style={{
              fontSize:   14,
              fontWeight: 700,
              color:      isFrom ? "#dc2626" : "#059669",
              fontFamily: "Figtree, sans-serif",
              flexShrink: 0,
              marginLeft: 12,
            }}>
              {isFrom ? "−" : "+"}{fmtIDR(amt, true)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── ACCOUNT FORM ────────────────────────────────────────────
function AccountForm({ type, form, set, accounts, bankAccounts, CURRENCIES: C = [] }) {
  const FF = 16; // gap between fields

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: FF }}>

      {/* Name — all types */}
      <Input
        label="Account Name"
        value={form.name || ""}
        onChange={e => set("name", e.target.value)}
        placeholder={
          type === "bank"        ? "e.g. BCA Main Account" :
          type === "credit_card" ? "e.g. BCA Platinum" :
          type === "asset"       ? "e.g. Apartemen Sudirman" :
          type === "liability"   ? "e.g. KPR BCA" :
          type === "receivable"  ? "e.g. Reimburse SDC" :
          "Account name"
        }
      />

      {/* BANK */}
      {type === "bank" && <>
        <FormRow>
          <Select label="Bank" value={form.bank_name || "BCA"} onChange={e => set("bank_name", e.target.value)}
            options={BANKS_L} style={{ flex: 1 }} />
          <Select label="Entity" value={form.entity || "Personal"} onChange={e => set("entity", e.target.value)}
            options={ENTITIES} style={{ flex: 1 }} />
        </FormRow>
        <FormRow>
          <Input label="Account No." value={form.account_no || ""} onChange={e => set("account_no", e.target.value)}
            placeholder="Last 4 digits" style={{ flex: 1 }} />
          <Select label="Currency" value={form.currency || "IDR"} onChange={e => set("currency", e.target.value)}
            options={C.map(c => ({ value: c.code, label: `${c.flag} ${c.code}` }))}
            style={{ flex: 1 }} />
        </FormRow>
        <AmountInput label="Initial Balance" value={form.initial_balance || ""}
          onChange={v => { set("initial_balance", v); set("current_balance", v); }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" id="incl_nw" checked={form.include_networth !== false}
            onChange={e => set("include_networth", e.target.checked)}
            style={{ accentColor: "#3b5bdb", width: 16, height: 16 }} />
          <label htmlFor="incl_nw" style={{ fontSize: 13, color: "#374151", cursor: "pointer", fontFamily: "Figtree, sans-serif" }}>
            Include in Net Worth
          </label>
        </div>
      </>}

      {/* CREDIT CARD */}
      {type === "credit_card" && <>
        <FormRow>
          <Select label="Bank" value={form.bank_name || "BCA"} onChange={e => set("bank_name", e.target.value)}
            options={BANKS_L} style={{ flex: 1 }} />
          <Select label="Network" value={form.network || "Visa"} onChange={e => set("network", e.target.value)}
            options={NETWORKS} style={{ flex: 1 }} />
        </FormRow>
        <FormRow>
          <Input label="Last 4 Digits" value={form.last4 || ""} onChange={e => set("last4", e.target.value)}
            placeholder="1234" style={{ flex: 1 }} />
          <Select label="Entity" value={form.entity || "Personal"} onChange={e => set("entity", e.target.value)}
            options={ENTITIES} style={{ flex: 1 }} />
        </FormRow>
        <AmountInput label="Credit Limit" value={form.card_limit || ""}
          onChange={v => set("card_limit", v)} />
        <AmountInput label="Monthly Spend Target (optional)" value={form.monthly_target || ""}
          onChange={v => set("monthly_target", v)} />
        <FormRow>
          <Input label="Statement Day" type="number" value={form.statement_day || ""}
            onChange={e => set("statement_day", e.target.value)} placeholder="25" style={{ flex: 1 }} />
          <Input label="Due Day" type="number" value={form.due_day || ""}
            onChange={e => set("due_day", e.target.value)} placeholder="17" style={{ flex: 1 }} />
        </FormRow>
      </>}


      {/* ASSET */}
      {type === "asset" && <>
        <FormRow>
          <Select label="Category" value={form.subtype || "Property"} onChange={e => set("subtype", e.target.value)}
            options={ASSET_SUBTYPES} style={{ flex: 1 }} />
          <Select label="Entity" value={form.entity || "Personal"} onChange={e => set("entity", e.target.value)}
            options={ENTITIES} style={{ flex: 1 }} />
        </FormRow>
        <AmountInput label="Current Value" value={form.current_value || ""}
          onChange={v => set("current_value", v)} />
        <AmountInput label="Purchase Price (optional)" value={form.purchase_price || ""}
          onChange={v => set("purchase_price", v)} />
        <Input label="Purchase Date (optional)" type="date" value={form.purchase_date || ""}
          onChange={e => set("purchase_date", e.target.value)} />
      </>}

      {/* LIABILITY */}
      {type === "liability" && <>
        <FormRow>
          <Select label="Type" value={form.subtype || "Mortgage"} onChange={e => set("subtype", e.target.value)}
            options={LIAB_SUBTYPES} style={{ flex: 1 }} />
          <Select label="Entity" value={form.entity || "Personal"} onChange={e => set("entity", e.target.value)}
            options={ENTITIES} style={{ flex: 1 }} />
        </FormRow>
        <Input label="Creditor / Lender" value={form.creditor || ""} onChange={e => set("creditor", e.target.value)}
          placeholder="e.g. BCA" />
        <FormRow>
          <AmountInput label="Outstanding Balance" value={form.outstanding_amount || ""}
            onChange={v => set("outstanding_amount", v)} style={{ flex: 1 }} />
          <AmountInput label="Original Amount" value={form.total_amount || ""}
            onChange={v => set("total_amount", v)} style={{ flex: 1 }} />
        </FormRow>
        <FormRow>
          <AmountInput label="Monthly Payment" value={form.monthly_payment || ""}
            onChange={v => set("monthly_payment", v)} style={{ flex: 1 }} />
          <Input label="Interest Rate (%/yr)" type="number" value={form.liability_interest_rate || ""}
            onChange={e => set("liability_interest_rate", e.target.value)} placeholder="0" style={{ flex: 1 }} />
        </FormRow>
        <FormRow>
          <Input label="Start Date" type="date" value={form.start_date || ""}
            onChange={e => set("start_date", e.target.value)} style={{ flex: 1 }} />
          <Input label="End Date" type="date" value={form.end_date || ""}
            onChange={e => set("end_date", e.target.value)} style={{ flex: 1 }} />
        </FormRow>
      </>}

      {/* RECEIVABLE */}
      {type === "receivable" && <>
        <FormRow>
          <Select label="Type" value={form.receivable_type || "reimburse"}
            onChange={e => set("receivable_type", e.target.value)}
            options={[{ value: "reimburse", label: "Reimburse" }, { value: "employee_loan", label: "Employee Loan" }]}
            style={{ flex: 1 }} />
          <Select label="Entity" value={form.entity || "Hamasa"} onChange={e => set("entity", e.target.value)}
            options={["Hamasa", "SDC", "Travelio", "Personal", "Other"]}
            style={{ flex: 1 }} />
        </FormRow>
        <AmountInput label="Outstanding Amount" value={form.outstanding_amount || ""}
          onChange={v => set("outstanding_amount", v)} />

        {form.receivable_type === "employee_loan" && <>
          <FormRow>
            <Input label="Employee Name" value={form.contact_name || ""}
              onChange={e => set("contact_name", e.target.value)} placeholder="Full name" style={{ flex: 1 }} />
            <Input label="Department" value={form.contact_dept || ""}
              onChange={e => set("contact_dept", e.target.value)} placeholder="e.g. Engineering" style={{ flex: 1 }} />
          </FormRow>
          <FormRow>
            <AmountInput label="Monthly Installment" value={form.monthly_installment || ""}
              onChange={v => set("monthly_installment", v)} style={{ flex: 1 }} />
            <AmountInput label="Total Loan Amount" value={form.receivable_total || ""}
              onChange={v => { set("receivable_total", v); set("outstanding_amount", v); }} style={{ flex: 1 }} />
          </FormRow>
          <FormRow>
            <Input label="Start Date" type="date" value={form.start_date || ""}
              onChange={e => set("start_date", e.target.value)} style={{ flex: 1 }} />
            <Select label="Deduction Method" value={form.deduction_method || "salary_deduction"}
              onChange={e => set("deduction_method", e.target.value)}
              options={[{ value: "salary_deduction", label: "Salary Deduction" }, { value: "direct_payment", label: "Direct Payment" }]}
              style={{ flex: 1 }} />
          </FormRow>
          <Select label="Default Collection Account" value={form.default_bank_id || ""}
            onChange={e => set("default_bank_id", e.target.value)}
            placeholder="Select bank account…"
            options={bankAccounts.map(b => ({ value: b.id, label: b.name }))} />

          {form.monthly_installment && form.outstanding_amount && Number(form.monthly_installment) > 0 && (
            <div style={{
              fontSize: 11, color: "#6b7280", padding: "10px 12px",
              background: "#f9fafb", borderRadius: 8, fontFamily: "Figtree, sans-serif",
            }}>
              Duration: ~{Math.ceil(Number(form.outstanding_amount) / Number(form.monthly_installment))} months
              {form.start_date && (() => {
                const end = new Date(form.start_date);
                end.setMonth(end.getMonth() + Math.ceil(Number(form.outstanding_amount) / Number(form.monthly_installment)));
                return ` · Ends ${end.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
              })()}
            </div>
          )}
        </>}
      </>}

      {/* Color picker — bank + CC */}
      {(type === "bank" || type === "credit_card") && (
        <Field label="Card Color">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["#3b5bdb","#059669","#d97706","#7c3aed","#0891b2","#c2255c","#dc2626","#111827"].map(c => (
              <div key={c} onClick={() => set("color", c)} style={{
                width:        26,
                height:       26,
                borderRadius: "50%",
                background:   c,
                cursor:       "pointer",
                border:       form.color === c ? `3px solid #111827` : "3px solid transparent",
                outline:      form.color === c ? "2px solid #fff" : "none",
                outlineOffset: -3,
                boxSizing:    "border-box",
              }} />
            ))}
          </div>
        </Field>
      )}

      {/* Notes — all types */}
      <Input label="Notes (optional)" value={form.notes || ""}
        onChange={e => set("notes", e.target.value)} placeholder="Any extra details" />

    </div>
  );
}

// ─── EMPTY FORM DEFAULTS ─────────────────────────────────────
function emptyForm(type) {
  const base = { name: "", entity: "Personal", color: "#3b5bdb", notes: "", is_active: true };
  switch (type) {
    case "bank":        return { ...base, bank_name: "BCA", account_no: "", currency: "IDR", initial_balance: "", current_balance: 0, include_networth: true };
    case "credit_card": return { ...base, bank_name: "BCA", last4: "", network: "Visa", card_limit: "", monthly_target: "", statement_day: 25, due_day: 17, current_balance: 0 };
    case "asset":       return { ...base, subtype: "Property", current_value: "", purchase_price: "", purchase_date: "" };
    case "liability":   return { ...base, subtype: "Mortgage", creditor: "", outstanding_amount: "", total_amount: "", monthly_payment: "", liability_interest_rate: "", start_date: "", end_date: "" };
    case "receivable":  return { ...base, entity: "Hamasa", receivable_type: "reimburse", outstanding_amount: "", contact_name: "", contact_dept: "", monthly_installment: "", receivable_total: "", start_date: todayStr(), deduction_method: "salary_deduction", default_bank_id: "" };
    default:            return base;
  }
}

// ─── STYLES ──────────────────────────────────────────────────
const ACTION_BTN = {
  border:       "1px solid #e5e7eb",
  background:   "#f9fafb",
  color:        "#374151",
  borderRadius: 7,
  padding:      "5px 10px",
  fontSize:     11,
  fontWeight:   600,
  cursor:       "pointer",
  fontFamily:   "Figtree, sans-serif",
};
