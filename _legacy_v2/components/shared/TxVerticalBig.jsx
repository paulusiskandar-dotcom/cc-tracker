/**
 * TransactionModal — unified self-contained modal for all transaction types.
 * Replaces TxForm + Transactions.jsx save logic everywhere in the app.
 *
 * Props:
 *   open           boolean
 *   mode           'add' | 'edit' | 'confirm'
 *   initialData    object  (for edit/confirm — pre-fills form)
 *   defaultGroup   'cashflow'|'reimburse'|'asset'|'loan'|'fx'
 *   defaultTxType  e.g. 'expense'
 *   defaultAccount { from_id?, to_id? }   — pre-fill account
 *   openCicilan    boolean  — pre-open cicilan toggle (for CC installment flow)
 *   onSave         (savedEntry) => void
 *   onDelete       () => void   (optional; shown only in edit mode)
 *   onClose        () => void
 *
 *   Data props (pass from App/parent):
 *   user, accounts, setLedger, categories, fxRates, allCurrencies,
 *   bankAccounts, creditCards, assets, liabilities, receivables,
 *   incomeSrcs, employeeLoans, setEmployeeLoans, accountCurrencies, onRefresh
 */

import { useState, useEffect } from "react";
import {
  ledgerApi, merchantApi, getTxFromToTypes,
  accountCurrenciesApi, assetsApi,
  installmentsApi, recalculateBalance, accountsApi, employeeLoanApi,
} from "../../api";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES_LIST, REIMBURSE_ENTITIES } from "../../constants";
import { fmtIDR, todayStr, toIDR } from "../../utils";
import Modal from "./Modal";
import { showToast } from "./Card";
import Input, { Field, AmountInput } from "./Input";

const FF = "Figtree, sans-serif";

// ── GROUP / TYPE METADATA ────────────────────────────────────────
export const GROUPS = [
  { id: "cashflow",  label: "Cash Flow", types: ["expense","income","transfer","pay_cc","pay_liability"] },
  { id: "reimburse", label: "Reimburse", types: ["reimburse_out","reimburse_in"] },
  { id: "asset",     label: "Asset",     types: ["buy_asset","sell_asset"] },
  { id: "loan",      label: "Loan",      types: ["give_loan","collect_loan"] },
  { id: "fx",        label: "FX",        types: ["fx_exchange"] },
];

export const TYPE_META = {
  expense:       { label: "Expense",       icon: "↑",  color: "#dc2626" },
  income:        { label: "Income",        icon: "↓",  color: "#059669" },
  transfer:      { label: "Transfer",      icon: "↔",  color: "#3b5bdb" },
  pay_cc:        { label: "Pay CC",        icon: "💳", color: "#7c3aed" },
  pay_liability: { label: "Pay Liability", icon: "📉", color: "#d97706" },
  reimburse_out: { label: "Reimburse Out", icon: "↗",  color: "#d97706" },
  reimburse_in:  { label: "Reimburse In",  icon: "↙",  color: "#059669" },
  buy_asset:     { label: "Buy Asset",     icon: "📈", color: "#0891b2" },
  sell_asset:    { label: "Sell Asset",    icon: "💰", color: "#059669" },
  give_loan:     { label: "Give Loan",     icon: "↗",  color: "#d97706" },
  collect_loan:  { label: "Collect Loan",  icon: "↙",  color: "#059669" },
  fx_exchange:   { label: "FX Exchange",   icon: "💱", color: "#0891b2" },
};

const groupForType = (txType) => {
  for (const g of GROUPS) { if (g.types.includes(txType)) return g.id; }
  return "cashflow";
};

// ── EMPTY FORM ──────────────────────────────────────────────────
const EMPTY = () => ({
  tx_date: todayStr(), description: "", amount: "", currency: "IDR",
  tx_type: "expense", from_id: null, to_id: null,
  from_type: "account", to_type: "expense",
  category_id: null, category_name: null, entity: "Personal",
  notes: "", is_reimburse: false,
  // give_loan extras
  employee_name: "", monthly_installment: "", loan_start_date: todayStr(),
  // buy_asset extras
  asset_name: "", asset_type: "Investment", asset_mode: "existing", asset_id: null,
  // fx_exchange extras
  fx_direction: "buy", fx_rate_used: "",
});

const ASSET_TYPES = ["Property","Vehicle","Investment","Crypto","Collectible","Other"];
const ENTITY_OPTS = REIMBURSE_ENTITIES;

// Shared select style
const SEL = {
  width: "100%", height: 44, padding: "0 14px",
  border: "1.5px solid #e5e7eb", borderRadius: 10,
  fontFamily: FF, fontSize: 14, fontWeight: 500,
  color: "#111827", background: "#fff", outline: "none",
  appearance: "none", WebkitAppearance: "none",
  cursor: "pointer", boxSizing: "border-box",
};

// ── GROUP TABS ─────────────────────────────────────────────────
function GroupTabs({ active, onChange, disabled }) {
  return (
    <div style={{ display: "flex", gap: 4, borderBottom: "1.5px solid #f3f4f6", paddingBottom: 0, marginBottom: 12 }}>
      {GROUPS.map(g => (
        <button
          key={g.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(g.id)}
          style={{
            padding: "7px 12px",
            borderRadius: "8px 8px 0 0",
            border: "none",
            background: active === g.id ? "#fff" : "transparent",
            color: active === g.id ? "#111827" : "#9ca3af",
            fontFamily: FF, fontSize: 12, fontWeight: active === g.id ? 700 : 500,
            cursor: disabled ? "default" : "pointer",
            borderBottom: active === g.id ? "2px solid #111827" : "2px solid transparent",
            transition: "all 0.15s",
          }}
        >
          {g.label}
        </button>
      ))}
    </div>
  );
}

// ── TYPE PILLS ─────────────────────────────────────────────────
function TypePills({ group, active, onChange, disabled }) {
  const grp = GROUPS.find(g => g.id === group);
  if (!grp) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", overflowX: "auto", marginBottom: 16, paddingBottom: 2, scrollbarWidth: "none", msOverflowStyle: "none" }}>
      {grp.types.map(t => {
        const m = TYPE_META[t];
        const isActive = active === t;
        return (
          <button
            key={t}
            type="button"
            disabled={disabled}
            onClick={() => onChange(t)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 12px", borderRadius: 20, flexShrink: 0, whiteSpace: "nowrap",
              border: `1.5px solid ${isActive ? m.color : "#e5e7eb"}`,
              background: isActive ? m.color + "15" : "#f9fafb",
              color: isActive ? m.color : "#6b7280",
              fontFamily: FF, fontSize: 12, fontWeight: isActive ? 700 : 500,
              cursor: disabled ? "default" : "pointer",
              transition: "all 0.15s",
            }}
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── CICILAN TOGGLE ─────────────────────────────────────────────
function CicilanSection({ enabled, onToggle, form, set }) {
  const total     = Number(form.amount || 0);
  const count     = Number(form.cicilan_count || 0);
  const monthly   = count > 0 && total > 0 ? Math.ceil(total / count) : null;
  return (
    <div style={{ border: "1.5px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", background: enabled ? "#eff6ff" : "#f9fafb",
          border: "none", cursor: "pointer", fontFamily: FF,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: enabled ? "#3b5bdb" : "#374151" }}>
          💳 Cicilan (Installment)
        </span>
        <span style={{
          width: 36, height: 20, borderRadius: 10,
          background: enabled ? "#3b5bdb" : "#d1d5db",
          display: "flex", alignItems: "center",
          padding: "2px", transition: "background 0.2s",
        }}>
          <span style={{
            width: 16, height: 16, borderRadius: "50%", background: "#fff",
            transform: enabled ? "translateX(16px)" : "translateX(0)",
            transition: "transform 0.2s", display: "block",
          }} />
        </span>
      </button>

      {enabled && (
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <Field label="Jumlah Cicilan" style={{ flex: 1 }}>
              <input
                type="number" min="2" max="60" step="1"
                value={form.cicilan_count || ""}
                onChange={e => set("cicilan_count", e.target.value)}
                placeholder="e.g. 3"
                style={{ ...SEL }}
              />
            </Field>
            {monthly && (
              <div style={{ paddingBottom: 2, textAlign: "right" }}>
                <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", fontFamily: FF }}>Per bulan</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#3b5bdb", fontFamily: FF }}>{fmtIDR(monthly)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ACCOUNT LABEL ──────────────────────────────────────────────
const accLabel = a => a.name + (a.bank_name && a.bank_name !== a.name ? ` · ${a.bank_name}` : "");

// ── MAIN COMPONENT ─────────────────────────────────────────────
export default function TxVerticalBig({
  open, mode = "add", initialData = null,
  defaultGroup, defaultTxType, defaultAccount,
  defaultEmployeeName = "",
  openCicilan = false,
  onSave, onDelete, onClose,
  // data
  user, accounts = [], setLedger,
  categories = [], fxRates = {}, allCurrencies = [],
  bankAccounts = [], creditCards = [], assets = [],
  liabilities = [], receivables = [], incomeSrcs = [],
  employeeLoans = [], setEmployeeLoans,
  accountCurrencies = [], onRefresh,
}) {
  const [form,    setFormState] = useState(EMPTY);
  const [group,   setGroup]     = useState("cashflow");
  const [saving,  setSaving]    = useState(false);
  const [confirm, setConfirm]   = useState(false); // delete confirm
  const [cicilan, setCicilan]   = useState(false);
  const [newBorrowerName,    setNewBorrowerName]    = useState("");
  const [newMonthlyInstall,  setNewMonthlyInstall]  = useState("");
  const [newTotalMonths,     setNewTotalMonths]     = useState("");
  const [creatingBorrower,   setCreatingBorrower]   = useState(false);
  const [loanAccTab,         setLoanAccTab]         = useState("bank");
  const [fetchedLoans,       setFetchedLoans]       = useState([]);

  // ── Fetch employee loans when needed but not provided ─────────
  const type = form.tx_type;
  useEffect(() => {
    const needsLoans = type === "give_loan" || type === "collect_loan";
    if (!needsLoans || employeeLoans.length > 0) return;
    if (!user?.id) return;
    employeeLoanApi.getAll(user.id).then(setFetchedLoans).catch(() => {});
  }, [type, employeeLoans.length, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveLoans = employeeLoans.length > 0 ? employeeLoans : fetchedLoans;

  // ── Reset on open ──────────────────────────────────────────
  useEffect(() => {
    if (!open) return;

    setNewBorrowerName("");
    setNewMonthlyInstall("");
    setNewTotalMonths("");
    setCreatingBorrower(false);
    setLoanAccTab("bank");

    if ((mode === "edit" || mode === "confirm") && initialData) {
      const txType = initialData.tx_type || "expense";
      // For loan types, the "borrower" field in the form uses employee_loan_id,
      // not the account-level from_id/to_id stored in the ledger.
      const formFromId = txType === "collect_loan"
        ? (initialData.employee_loan_id || null)
        : (initialData.from_id || null);
      const formToId = txType === "give_loan"
        ? (initialData.employee_loan_id || null)
        : (initialData.to_id || null);

      setFormState({
        ...EMPTY(),
        tx_date:          initialData.tx_date     || todayStr(),
        description:      initialData.description || "",
        amount:           initialData.amount      || initialData.amount_idr || "",
        currency:         initialData.currency    || "IDR",
        tx_type:          txType,
        from_id:          formFromId,
        to_id:            formToId,
        from_type:        initialData.from_type   || getTxFromToTypes(txType).from_type,
        to_type:          initialData.to_type     || getTxFromToTypes(txType).to_type,
        category_id:      initialData.category_id || null,
        category_name:    initialData.category_name || null,
        entity:           initialData.entity      || "Personal",
        notes:            initialData.notes       || "",
        is_reimburse:     initialData.is_reimburse || false,
        employee_name:    initialData.employee_name || "",
        monthly_installment: initialData.monthly_installment || "",
        loan_start_date:  initialData.loan_start_date || todayStr(),
        fx_direction:     initialData.fx_direction || "buy",
        fx_rate_used:     initialData.fx_rate_used || "",
      });
      setGroup(groupForType(txType));

      // Set loanAccTab based on the relevant account's subtype
      if (txType === "collect_loan" && initialData.to_id) {
        const toAcc = accounts.find(a => a.id === initialData.to_id);
        setLoanAccTab(toAcc?.subtype === "cash" ? "cash" : "bank");
      } else if (txType === "give_loan" && initialData.from_id) {
        const fromAcc = accounts.find(a => a.id === initialData.from_id);
        setLoanAccTab(fromAcc?.subtype === "cash" ? "cash" : "bank");
      }
    } else {
      // Add mode
      const txType = defaultTxType || "expense";
      const g      = defaultGroup  || groupForType(txType);
      const base   = EMPTY();
      // Auto-fill amount for collect_loan when borrower is preset
      if (txType === "collect_loan" && defaultAccount?.from_id) {
        const presetLoan = effectiveLoans.find(l => l.id === defaultAccount.from_id);
        if (presetLoan?.monthly_installment) base.amount = String(presetLoan.monthly_installment);
      }
      setFormState({
        ...base,
        tx_type: txType,
        from_id: defaultAccount?.from_id || null,
        to_id:   defaultAccount?.to_id   || null,
      });
      setGroup(g);
      setCicilan(openCicilan || false);
      // Pre-fill new borrower name for give_loan (e.g., "+ New Loan" from settled card)
      if (txType === "give_loan" && defaultEmployeeName) {
        setCreatingBorrower(true);
        setNewBorrowerName(defaultEmployeeName);
      }
    }
  }, [open, mode, initialData, defaultGroup, defaultTxType, defaultAccount, openCicilan, defaultEmployeeName]);

  const set = (k, v) => setFormState(f => ({ ...f, [k]: v }));

  // ── Switch type (also update group) ──────────────────────────
  const handleTypeChange = (txType) => {
    setFormState(f => ({
      ...f,
      tx_type: txType,
      from_id: null, to_id: null,
      entity: txType === "reimburse_out" ? (f.entity || "Hamasa") : "Personal",
    }));
    if (!cicilan) setCicilan(false);
    setLoanAccTab("bank");
  };

  const handleGroupChange = (g) => {
    setGroup(g);
    const firstType = GROUPS.find(x => x.id === g)?.types[0] || "expense";
    handleTypeChange(firstType);
  };

  // ── Derived account lists ────────────────────────────────────
  const bankAccs  = bankAccounts.filter(a => a.is_active !== false && a.subtype !== "cash");
  const cashAccs  = bankAccounts.filter(a => a.is_active !== false && a.subtype === "cash");
  const ccAccs    = creditCards.filter(a => a.is_active !== false);
  const assetAccs = assets.filter(a => a.is_active !== false);

  // FX stuff
  const fxCurrencies = [...new Set(
    accountCurrencies.map(r => r.currency).filter(c => c && c !== "IDR")
  )].sort();
  const fxRate = Number(form.fx_rate_used || 0);
  const foreignAmt = Number(form.amount || 0);
  const idrEquiv   = fxRate > 0 && foreignAmt > 0 ? Math.round(foreignAmt * fxRate) : null;
  const fxDir = form.fx_direction || "buy";
  const fxCurrency = form.currency && form.currency !== "IDR" ? form.currency : null;
  const accsWithCurrency = fxCurrency
    ? accountCurrencies.filter(r => r.currency === fxCurrency).map(r => r.account_id)
    : [];

  // IDR equivalent for non-IDR amounts
  const amtIDR = toIDR ? toIDR(Number(form.amount || 0), form.currency || "IDR", fxRates, allCurrencies) : Number(form.amount || 0);

  // Categories — income uses static list; expense uses DB categories (falling back to static)
  const isIncome = type === "income";
  let catOptions;
  if (isIncome) {
    catOptions = INCOME_CATEGORIES_LIST.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` }));
  } else {
    catOptions = categories.filter(c => c.is_active !== false).map(c => ({ value: c.id, label: `${c.icon || ""} ${c.name || c.label}` }));
    if (!catOptions.length) {
      EXPENSE_CATEGORIES.forEach(c => catOptions.push({ value: c.id, label: `${c.icon} ${c.label}` }));
    }
  }

  // ── UUID sanitizer ────────────────────────────────────────────
  const uuid = v => (v && typeof v === "string" && v.length === 36) ? v : null;
  const sn   = v => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };

  // ── Save ──────────────────────────────────────────────────────
  const save = async () => {
    // Basic validation
    if (type !== "fx_exchange" && (!form.amount || sn(form.amount) <= 0)) {
      showToast("Amount is required", "error"); return;
    }

    setSaving(true);
    try {
      const isEdit = mode === "edit" && initialData;

      // ── FX Exchange ──────────────────────────────────────────
      if (type === "fx_exchange" && !isEdit) {
        const currency = form.currency;
        const rate     = sn(form.fx_rate_used);
        const fAmt     = sn(form.amount);
        const iAmt     = Math.round(fAmt * rate);
        const direction = form.fx_direction || "buy";

        if (!currency || currency === "IDR") { showToast("Select a foreign currency", "error"); setSaving(false); return; }
        if (!form.from_id)  { showToast("Select From account", "error"); setSaving(false); return; }
        if (!form.to_id)    { showToast("Select To account", "error"); setSaving(false); return; }
        if (rate <= 0)      { showToast("Enter a valid rate", "error"); setSaving(false); return; }
        if (fAmt <= 0)      { showToast("Enter amount", "error"); setSaving(false); return; }

        if (direction === "buy") {
          const entry = {
            tx_date: form.tx_date, description: `Buy ${currency}`,
            amount: iAmt, currency: "IDR", amount_idr: iAmt, fx_rate_used: rate,
            tx_type: "fx_exchange", from_type: "account", to_type: "account",
            from_id: uuid(form.from_id), to_id: uuid(form.to_id),
            category_id: null, category_name: null, entity: "Personal",
            is_reimburse: false, merchant_name: null, notes: form.notes || null,
            attachment_url: null, ai_categorized: false, ai_confidence: null,
            installment_id: null, scan_batch_id: null, fx_direction: "buy",
          };
          const created = await ledgerApi.create(user.id, entry, accounts);
          setLedger?.(p => [created, ...p]);
          await accountCurrenciesApi.addBalance(uuid(form.to_id), currency, +fAmt, user.id);
        } else {
          await accountCurrenciesApi.addBalance(uuid(form.from_id), currency, -fAmt, user.id);
          const entry = {
            tx_date: form.tx_date, description: `Sell ${currency}`,
            amount: iAmt, currency: "IDR", amount_idr: iAmt, fx_rate_used: rate,
            tx_type: "fx_exchange", from_type: "account", to_type: "account",
            from_id: uuid(form.from_id), to_id: uuid(form.to_id),
            category_id: null, category_name: null, entity: "Personal",
            is_reimburse: false, merchant_name: null, notes: form.notes || null,
            attachment_url: null, ai_categorized: false, ai_confidence: null,
            installment_id: null, scan_batch_id: null, fx_direction: "sell",
          };
          const created = await ledgerApi.create(user.id, entry, accounts);
          setLedger?.(p => [created, ...p]);
        }
        showToast(`FX ${direction === "buy" ? "Buy" : "Sell"} saved`);
        await onRefresh?.();
        onSave?.(null);
        onClose();
        setSaving(false);
        return;
      }

      // ── Give Loan ─────────────────────────────────────────────
      if (type === "give_loan" && !isEdit) {
        if (!form.from_id) { showToast("Select from account", "error"); setSaving(false); return; }
        const amt = sn(form.amount);
        let loanId;
        let empName;

        if (creatingBorrower) {
          if (!newBorrowerName.trim()) { showToast("Employee name is required", "error"); setSaving(false); return; }
          if (!sn(newMonthlyInstall))  { showToast("Monthly installment is required", "error"); setSaving(false); return; }
          if (!sn(newTotalMonths))     { showToast("Total months is required", "error"); setSaving(false); return; }
          const monthly  = sn(newMonthlyInstall);
          const months   = sn(newTotalMonths);
          const totalAmt = monthly * months;
          const newLoan  = await employeeLoanApi.create(user.id, {
            employee_name:        newBorrowerName.trim(),
            total_amount:         totalAmt,
            monthly_installment:  monthly,
            start_date:           form.tx_date,
            status:               "active",
            paid_months:          0,
          });
          loanId  = newLoan.id;
          empName = newLoan.employee_name;
          setEmployeeLoans?.(p => [...p, newLoan]);
        } else {
          if (!form.to_id) { showToast("Select or create a borrower", "error"); setSaving(false); return; }
          loanId = form.to_id;
          const loan = effectiveLoans.find(l => l.id === loanId);
          empName = loan?.employee_name || "Employee";
          const newTotal = Number(loan?.total_amount || 0) + amt;
          const updated = await employeeLoanApi.update(loanId, { total_amount: newTotal });
          setEmployeeLoans?.(p => p.map(l => l.id === loanId ? updated : l));
        }

        const desc = form.description?.trim() || empName;
        const entry = {
          tx_date: form.tx_date, description: desc,
          amount: amt, currency: form.currency || "IDR", amount_idr: amt,
          tx_type: "give_loan", from_type: "account", to_type: "employee_loan",
          from_id: uuid(form.from_id), to_id: null,
          entity: "Personal", employee_loan_id: loanId,
          is_reimburse: false, merchant_name: null, notes: form.notes || null,
          attachment_url: null, ai_categorized: false, ai_confidence: null,
          installment_id: null, scan_batch_id: null, category_id: null, category_name: null,
        };
        const created = await ledgerApi.create(user.id, entry, accounts);
        setLedger?.(p => [created, ...p]);
        await recalculateBalance(uuid(form.from_id), user.id);
        showToast("Loan given");
        await onRefresh?.();
        onSave?.(created);
        onClose();
        setSaving(false);
        return;
      }

      // ── Collect Loan ──────────────────────────────────────────
      if (type === "collect_loan" && !isEdit) {
        if (!form.from_id) { showToast("Select borrower", "error"); setSaving(false); return; }
        if (!form.to_id)   { showToast("Select destination account", "error"); setSaving(false); return; }
        const amt  = sn(form.amount);
        const loan = effectiveLoans.find(l => l.id === form.from_id);
        if (!loan) { showToast("Loan not found", "error"); setSaving(false); return; }

        const newPaidMonths = Number(loan.paid_months || 0) + 1;
        const totalMonths   = Number(loan.monthly_installment || 0) > 0
          ? Math.ceil(Number(loan.total_amount || 0) / Number(loan.monthly_installment))
          : 0;
        const isFullyPaid = totalMonths > 0 && newPaidMonths >= totalMonths;
        const updates     = { paid_months: newPaidMonths, ...(isFullyPaid ? { status: "settled" } : {}) };
        const updated     = await employeeLoanApi.update(loan.id, updates);
        setEmployeeLoans?.(p => p.map(l => l.id === loan.id ? updated : l));

        const autoNotes = totalMonths > 0
          ? `Payment ${newPaidMonths} of ${totalMonths}`
          : `Payment ${newPaidMonths}`;
        const desc = form.description?.trim() || loan.employee_name;
        const entry = {
          tx_date: form.tx_date, description: desc,
          amount: amt, currency: form.currency || "IDR", amount_idr: amt,
          tx_type: "collect_loan", from_type: "employee_loan", to_type: "account",
          from_id: null, to_id: uuid(form.to_id),
          entity: "Personal", employee_loan_id: loan.id,
          is_reimburse: false, merchant_name: null,
          notes: form.notes?.trim() || autoNotes,
          attachment_url: null, ai_categorized: false, ai_confidence: null,
          installment_id: null, scan_batch_id: null, category_id: null, category_name: null,
        };
        const created = await ledgerApi.create(user.id, entry, accounts);
        setLedger?.(p => [created, ...p]);
        await recalculateBalance(uuid(form.to_id), user.id);
        showToast(isFullyPaid ? "Loan fully paid! 🎉" : `Payment ${newPaidMonths}${totalMonths > 0 ? ` of ${totalMonths}` : ""} recorded`);
        await onRefresh?.();
        onSave?.(created);
        onClose();
        setSaving(false);
        return;
      }

      // ── Buy Asset ─────────────────────────────────────────────
      if (type === "buy_asset" && !isEdit) {
        if (!form.from_id) { showToast("Select source account", "error"); setSaving(false); return; }
        const price  = sn(form.amount);
        const isExst = form.asset_mode === "existing";
        if (isExst && !form.asset_id) { showToast("Select an asset", "error"); setSaving(false); return; }
        if (!isExst && !form.asset_name?.trim()) { showToast("Asset name is required", "error"); setSaving(false); return; }
        const assetName = isExst
          ? (assetAccs.find(a => a.id === form.asset_id)?.name || "Asset")
          : form.asset_name.trim();
        const toId = isExst ? uuid(form.asset_id) : null;
        const entry = {
          tx_date: form.tx_date, description: assetName,
          amount: price, currency: "IDR", amount_idr: price,
          tx_type: "buy_asset", from_type: "account", to_type: "account",
          from_id: uuid(form.from_id), to_id: toId,
          category_id: null, category_name: null, entity: "Personal", is_reimburse: false,
          merchant_name: null, notes: form.notes || null,
          attachment_url: null, ai_categorized: false, ai_confidence: null,
          installment_id: null, scan_batch_id: null,
        };
        const created = await ledgerApi.create(user.id, entry, accounts);
        setLedger?.(p => [created, ...p]);
        if (!isExst) {
          try {
            await assetsApi.create(user.id, {
              name: form.asset_name.trim(), type: form.asset_type || "Investment",
              current_value: price, purchase_price: price,
              purchase_date: form.tx_date, notes: form.notes || null,
            });
          } catch (ae) { console.warn("[buy_asset] asset create failed:", ae.message); }
        }
        showToast("Asset purchased");
        await onRefresh?.();
        onSave?.(created);
        onClose();
        setSaving(false);
        return;
      }

      // ── Sell Asset ────────────────────────────────────────────
      if (type === "sell_asset" && !isEdit) {
        if (!form.from_id || !form.to_id) { showToast("Both accounts required", "error"); setSaving(false); return; }
        const sellPrice = sn(form.amount);
        const assetName = assetAccs.find(a => a.id === form.from_id)?.name;
        const entry = {
          tx_date: form.tx_date, description: assetName ? `Sell ${assetName}` : "Asset Sale",
          amount: sellPrice, currency: "IDR", amount_idr: sellPrice,
          tx_type: "sell_asset", from_type: "account", to_type: "account",
          from_id: uuid(form.from_id), to_id: uuid(form.to_id),
          category_id: null, category_name: null, entity: "Personal", is_reimburse: false,
          merchant_name: null, notes: form.notes || null,
          attachment_url: null, ai_categorized: false, ai_confidence: null,
          installment_id: null, scan_batch_id: null,
        };
        const created = await ledgerApi.create(user.id, entry, accounts);
        setLedger?.(p => [created, ...p]);
        showToast("Asset sold");
        await onRefresh?.();
        onSave?.(created);
        onClose();
        setSaving(false);
        return;
      }

      // ── General path ──────────────────────────────────────────
      const { from_type, to_type } = getTxFromToTypes(type);
      const desc = form.description?.trim() || null;
      const cat  = categories.find(c => c.id === form.category_id);

      let computedAmtIDR = sn(amtIDR);
      let computedFxRate = null;
      if (type === "fx_exchange") {
        const rate = sn(form.fx_rate_used);
        computedFxRate = rate || null;
        if (rate > 0) computedAmtIDR = Math.round(sn(form.amount) * rate);
      }

      // Handle cicilan — create installment record first if enabled
      let installmentId = null;
      if (cicilan && type === "expense" && !isEdit) {
        const count = sn(form.cicilan_count);
        if (count >= 2) {
          const total   = sn(form.amount);
          const monthly = Math.ceil(total / count);
          try {
            const inst = await installmentsApi.create(user.id, {
              total_amount:      total,
              installment_count: count,
              monthly_amount:    monthly,
              from_id:           uuid(form.from_id),
              start_date:        form.tx_date,
              description:       desc,
              status:            "active",
            });
            installmentId = inst.id;
          } catch (ie) { console.warn("[cicilan] installment create failed:", ie.message); }
        }
      }

      const isReimb = type === "reimburse_out" || type === "reimburse_in";
      const entry = {
        tx_date:        form.tx_date || todayStr(),
        description:    desc,
        amount:         sn(form.amount),
        currency:       form.currency || "IDR",
        amount_idr:     computedAmtIDR,
        fx_rate_used:   computedFxRate,
        tx_type:        type,
        from_type:      type === "reimburse_in" ? "expense" : (type === "reimburse_out" ? "account" : from_type),
        to_type:        type === "reimburse_out" ? "expense" : (type === "reimburse_in" ? "account" : to_type),
        from_id:        type === "reimburse_in" ? null : uuid(form.from_id),
        to_id:          type === "reimburse_out" ? null : uuid(form.to_id),
        category_id:    isReimb ? null : uuid(form.category_id),
        category_name:  isReimb ? null : (cat?.name || form.category_name || null),
        entity:         (type === "reimburse_out" || type === "reimburse_in") ? (form.entity || "Hamasa") : "Personal",
        is_reimburse:   isReimb,
        merchant_name:  null,
        notes:          form.notes || null,
        attachment_url: null,
        ai_categorized: false,
        ai_confidence:  null,
        installment_id: installmentId,
        scan_batch_id:  null,
        fx_direction:   type === "fx_exchange" ? (form.fx_direction || "buy") : undefined,
      };

      let savedEntry;
      if (isEdit) {
        savedEntry = await ledgerApi.update(initialData.id, entry);
        setLedger?.(p => p.map(e => e.id === initialData.id ? savedEntry : e));
        const affectedIds = [
          ...(entry.from_type === "account" && entry.from_id ? [entry.from_id] : []),
          ...(entry.to_type   === "account" && entry.to_id   ? [entry.to_id]   : []),
          ...(initialData.from_type === "account" && initialData.from_id ? [initialData.from_id] : []),
          ...(initialData.to_type   === "account" && initialData.to_id   ? [initialData.to_id]   : []),
        ];
        await Promise.all([...new Set(affectedIds)].map(id => recalculateBalance(id, user.id)));
        showToast("Transaction updated");
      } else {
        savedEntry = await ledgerApi.create(user.id, entry, accounts);
        setLedger?.(p => [savedEntry, ...p]);
        const affectedIds = [
          ...(entry.from_type === "account" && entry.from_id ? [entry.from_id] : []),
          ...(entry.to_type   === "account" && entry.to_id   ? [entry.to_id]   : []),
        ];
        await Promise.all([...new Set(affectedIds)].map(id => recalculateBalance(id, user.id)));
        showToast(mode === "confirm" ? "Transaction confirmed" : "Transaction added");
        await onRefresh?.();
      }

      // Merchant mapping
      if (desc && form.category_id) {
        merchantApi?.upsert(user.id, desc, form.category_id, cat?.name || "").catch(() => {});
      }

      onSave?.(savedEntry);
      onClose();
    } catch (e) {
      showToast(e.message, "error");
    }
    setSaving(false);
  };

  // ── Delete ────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!initialData) return;
    setSaving(true);
    try {
      await ledgerApi.delete(initialData.id, initialData, accounts);
      setLedger?.(p => p.filter(e => e.id !== initialData.id));
      const affectedIds = [
        ...(initialData.from_type === "account" && initialData.from_id ? [initialData.from_id] : []),
        ...(initialData.to_type   === "account" && initialData.to_id   ? [initialData.to_id]   : []),
      ];
      await Promise.all([...new Set(affectedIds)].map(id => recalculateBalance(id, user.id)));
      showToast("Transaction deleted");
      await onRefresh?.();
      onDelete?.();
      onClose();
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
    setConfirm(false);
  };

  // ── Grouped account dropdown ──────────────────────────────────
  const renderFromSelect = (label = "From Account") => {
    const needsCC = ["expense","reimburse_out","transfer"].includes(type);
    const byName  = (a, b) => (a.name || "").localeCompare(b.name || "");
    const banks   = bankAccs.sort(byName);
    const cash    = cashAccs.sort(byName);
    const ccs     = ccAccs.sort(byName);
    const assts = assetAccs.sort(byName);

    let groups = [];
    if (type === "sell_asset") {
      groups = [{ label: "ASSET", items: assts }];
    } else {
      groups = [
        banks.length ? { label: "BANK",    items: banks } : null,
        cash.length  ? { label: "CASH",    items: cash  } : null,
        needsCC && ccs.length ? { label: "CREDIT CARD", items: ccs } : null,
      ].filter(Boolean);
    }

    return (
      <Field label={label}>
        <select value={form.from_id || ""} onChange={e => set("from_id", e.target.value.length === 36 ? e.target.value : null)} style={SEL}>
          <option value="">Select account…</option>
          {groups.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map(a => {
                let extra = "";
                if (type === "sell_asset" || g.label === "CREDIT CARD") {
                  extra = (a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : "";
                } else {
                  extra = a.bank_name && a.bank_name !== a.name ? ` · ${a.bank_name}` : "";
                }
                return <option key={a.id} value={a.id}>{a.name}{extra}</option>;
              })}
            </optgroup>
          ))}
        </select>
      </Field>
    );
  };

  const renderToSelect = (label = "To Account") => {
    const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
    const banks  = [...bankAccs, ...cashAccs].sort(byName);
    const ccs    = ccAccs.sort(byName);
    const libs   = liabilities.filter(l => l.id?.length === 36).sort(byName);
    const assts  = assetAccs.sort(byName);

    let groups = [];
    if (type === "pay_cc")        groups = [{ label: "CREDIT CARD", items: ccs }];
    else if (type === "pay_liability") groups = [{ label: "LIABILITY", items: libs }];
    else if (type === "buy_asset") groups = [{ label: "ASSET", items: assts }];
    else if (type === "transfer") groups = [
      ...(banks.length ? [{ label: "BANK / CASH", items: banks }] : []),
      ...(ccs.length   ? [{ label: "CREDIT CARD", items: ccs   }] : []),
    ];
    else groups = [{ label: "BANK / CASH", items: banks }];

    return (
      <Field label={label}>
        <select value={form.to_id || ""} onChange={e => set("to_id", e.target.value.length === 36 ? e.target.value : null)} style={SEL}>
          <option value="">Select account…</option>
          {groups.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map(a => {
                let extra = "";
                if (type === "pay_cc" || g.label === "CREDIT CARD") {
                  extra = (a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : "";
                } else {
                  extra = a.bank_name && a.bank_name !== a.name ? ` · ${a.bank_name}` : "";
                }
                return <option key={a.id} value={a.id}>{a.name}{extra}</option>;
              })}
            </optgroup>
          ))}
        </select>
      </Field>
    );
  };

  // ── Entity pills ─────────────────────────────────────────────
  const renderEntityPills = () => {
    const entColor = type === "reimburse_out" ? "#d97706" : "#059669";
    return (
      <Field label="Entity *">
        <div style={{ display: "flex", gap: 6 }}>
          {ENTITY_OPTS.map(ent => {
            const active = form.entity === ent;
            return (
              <button key={ent} type="button"
                onClick={() => set("entity", ent)}
                style={{
                  flex: 1, height: 36, borderRadius: 8,
                  border: `1.5px solid ${active ? entColor : "#e5e7eb"}`,
                  background: active ? entColor + "15" : "#f9fafb",
                  color: active ? entColor : "#6b7280",
                  fontFamily: FF, fontSize: 12, fontWeight: active ? 700 : 500, cursor: "pointer",
                }}
              >
                {ent}
              </button>
            );
          })}
        </div>
      </Field>
    );
  };

  // ── Field rendering by type ───────────────────────────────────
  const renderFields = () => {
    // Shared sub-renders used across all type branches
    const DIVIDER = <hr style={{ border: "none", borderTop: "0.5px solid #e5e7eb", margin: "2px 0" }} />;

    const notesField = (
      <Field label="Notes (optional)">
        <textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)} placeholder="Any extra details…" rows={2}
          style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: FF, fontSize: 14, fontWeight: 500, color: "#111827", background: "#fff", outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.5 }} />
      </Field>
    );

    const dateCurrencyRow = (
      <div style={{ display: "flex", gap: 8 }}>
        <Input label="Date" type="date" value={form.tx_date} onChange={e => set("tx_date", e.target.value)} style={{ flex: 1 }} />
        <Field label="Currency" style={{ width: 90, flexShrink: 0 }}>
          <select value={form.currency || "IDR"} onChange={e => set("currency", e.target.value)} style={{ ...SEL, padding: "0 8px", fontSize: 13, fontWeight: 600 }}>
            {allCurrencies.length > 0
              ? allCurrencies.map(c => <option key={c.code} value={c.code}>{c.flag ? `${c.flag} ` : ""}{c.code}</option>)
              : ["IDR","USD","SGD","EUR","GBP","AUD","JPY","MYR","HKD"].map(c => <option key={c} value={c}>{c}</option>)
            }
          </select>
        </Field>
      </div>
    );

    // ── FX Exchange ──────────────────────────────────────────────
    if (type === "fx_exchange") {
      const fxFromAccs = fxDir === "sell" && fxCurrency
        ? accounts.filter(a => a.is_active !== false && accsWithCurrency.includes(a.id))
        : [...bankAccs, ...cashAccs, ...ccAccs];
      const fxToAccs = fxDir === "buy"
        ? accounts.filter(a => a.is_active !== false && accsWithCurrency.includes(a.id))
        : [...bankAccs, ...cashAccs];
      return (
        <>
          {DIVIDER}
          {/* Direction toggle — above FROM since it determines FROM/TO options */}
          <div style={{ display: "flex", gap: 8 }}>
            {["buy","sell"].map(d => (
              <button key={d} type="button"
                onClick={() => { set("fx_direction", d); set("from_id", null); set("to_id", null); }}
                style={{
                  flex: 1, height: 36, borderRadius: 8, border: "1.5px solid",
                  borderColor: fxDir === d ? "#0891b2" : "#e5e7eb",
                  background:  fxDir === d ? "#e0f2fe" : "#fff",
                  color:       fxDir === d ? "#0891b2" : "#6b7280",
                  fontFamily: FF, fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}>
                {d === "buy" ? "Buy Foreign" : "Sell Foreign"}
              </button>
            ))}
          </div>
          {/* 3. FROM */}
          <Field label={fxDir === "buy" ? "From Account (IDR) *" : "From Account (foreign) *"}>
            <select value={form.from_id || ""} onChange={e => set("from_id", e.target.value || null)} style={SEL}>
              <option value="">Select account…</option>
              {fxFromAccs.map(a => {
                const pocket = fxDir === "sell" && fxCurrency
                  ? accountCurrencies.find(r => r.account_id === a.id && r.currency === fxCurrency)
                  : null;
                const suffix = pocket ? ` — ${fxCurrency} ${Number(pocket.balance).toLocaleString("id-ID")}` : "";
                return <option key={a.id} value={a.id}>{accLabel(a)}{suffix}</option>;
              })}
            </select>
          </Field>
          {/* 4. TO */}
          <Field label={fxDir === "buy" ? "To Account (receives foreign) *" : "To Account (receives IDR) *"}>
            <select value={form.to_id || ""} onChange={e => set("to_id", e.target.value || null)} style={SEL}>
              <option value="">Select account…</option>
              {fxToAccs.length > 0
                ? fxToAccs.map(a => <option key={a.id} value={a.id}>{accLabel(a)}</option>)
                : fxDir === "buy" && fxCurrency
                  ? <option disabled>No accounts hold {fxCurrency} yet</option>
                  : null
              }
            </select>
          </Field>
          {/* 5. Date + Currency (foreign) side by side */}
          <div style={{ display: "flex", gap: 8 }}>
            <Input label="Date" type="date" value={form.tx_date} onChange={e => set("tx_date", e.target.value)} style={{ flex: 1 }} />
            <Field label="Currency *" style={{ width: 110, flexShrink: 0 }}>
              <select value={form.currency || ""} onChange={e => { set("currency", e.target.value); set("from_id", null); set("to_id", null); }} style={{ ...SEL, padding: "0 8px", fontSize: 13, fontWeight: 600 }}>
                <option value="">— Select —</option>
                {fxCurrencies.map(c => {
                  const meta = allCurrencies.find(x => x.code === c);
                  return <option key={c} value={c}>{meta?.flag ? `${meta.flag} ` : ""}{c}</option>;
                })}
                {allCurrencies.filter(c => c.code !== "IDR" && !fxCurrencies.includes(c.code)).map(c => (
                  <option key={c.code} value={c.code}>{c.flag ? `${c.flag} ` : ""}{c.code}</option>
                ))}
              </select>
            </Field>
          </div>
          {/* 6. Rate + Amount + IDR equiv */}
          <Input label={`Rate: 1 ${fxCurrency || "foreign"} = ? IDR *`} type="number" min="0" step="any"
            value={form.fx_rate_used || ""} onChange={e => set("fx_rate_used", e.target.value)} placeholder="e.g. 107.5" />
          <Input label={`Amount (${fxCurrency || "foreign units"}) *`} type="number" min="0" step="any"
            value={form.amount || ""} onChange={e => set("amount", e.target.value)} placeholder="0" />
          {idrEquiv !== null && (
            <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#0369a1", fontWeight: 600, fontFamily: FF }}>
              IDR equivalent: {fmtIDR(idrEquiv)}
            </div>
          )}
          {/* 11. Notes */}
          {notesField}
        </>
      );
    }

    // ── Buy Asset ────────────────────────────────────────────────
    if (type === "buy_asset") {
      const modeVal = form.asset_mode || "existing";
      const selectedAsset = assetAccs.find(a => a.id === form.asset_id);
      return (
        <>
          {DIVIDER}
          {/* 3. FROM */}
          {renderFromSelect("From Account")}
          {/* Asset mode toggle — above TO since it determines what TO shows */}
          <div style={{ display: "flex", gap: 8 }}>
            {["existing","new"].map(m => (
              <button key={m} type="button"
                onClick={() => { set("asset_mode", m); set("asset_id", null); set("asset_name", ""); }}
                style={{
                  flex: 1, height: 36, borderRadius: 8, border: "1.5px solid",
                  borderColor: modeVal === m ? "#3b5bdb" : "#e5e7eb",
                  background:  modeVal === m ? "#eff3ff" : "#fff",
                  color:       modeVal === m ? "#3b5bdb" : "#6b7280",
                  fontFamily: FF, fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}>
                {m === "existing" ? "Existing Asset" : "New Asset"}
              </button>
            ))}
          </div>
          {/* 4. TO (asset selector) */}
          {modeVal === "existing" ? (
            <>
              <Field label="Asset *">
                <select value={form.asset_id || ""} onChange={e => {
                  const id = e.target.value || null;
                  set("asset_id", id);
                  const a = assetAccs.find(x => x.id === id);
                  if (a) { set("asset_name", a.name); set("asset_type", a.subtype || a.type || "Investment"); }
                }} style={SEL}>
                  <option value="">Select asset…</option>
                  {assetAccs.map(a => <option key={a.id} value={a.id}>{a.name}{a.subtype ? ` · ${a.subtype}` : ""}</option>)}
                </select>
              </Field>
              {selectedAsset?.current_value > 0 && (
                <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#6b7280", fontFamily: FF }}>
                  Current value: <strong style={{ color: "#111827" }}>{fmtIDR(selectedAsset.current_value)}</strong>
                </div>
              )}
            </>
          ) : (
            <>
              <Input label="Asset Name *" value={form.asset_name || ""} onChange={e => set("asset_name", e.target.value)} placeholder="e.g. Apartment Kemang" />
              <Field label="Asset Type">
                <select value={form.asset_type || "Investment"} onChange={e => set("asset_type", e.target.value)} style={SEL}>
                  {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </>
          )}
          {/* 5. Date (assets are always IDR — no currency picker) */}
          <Input label="Date" type="date" value={form.tx_date} onChange={e => set("tx_date", e.target.value)} />
          {/* 6. Amount */}
          <AmountInput label={modeVal === "existing" ? "Amount to Add (IDR)" : "Purchase Price (IDR)"} value={form.amount} onChange={v => set("amount", v)} />
          {/* 11. Notes */}
          {notesField}
        </>
      );
    }

    // ── Sell Asset ────────────────────────────────────────────────
    if (type === "sell_asset") {
      const selAss  = assetAccs.find(a => a.id === form.from_id);
      const sp      = sn(form.amount);
      const pp      = Number(selAss?.purchase_price || selAss?.current_value || 0);
      const pl      = pp > 0 && sp > 0 ? sp - pp : null;
      const plColor = pl === null ? "#9ca3af" : pl >= 0 ? "#059669" : "#dc2626";
      return (
        <>
          {DIVIDER}
          {/* 3. FROM (asset) */}
          {renderFromSelect("Asset")}
          {/* 4. TO (bank) */}
          {renderToSelect("To Account (receive funds)")}
          {/* 5. Date */}
          <Input label="Date" type="date" value={form.tx_date} onChange={e => set("tx_date", e.target.value)} />
          {/* 6. Amount + P&L preview */}
          <AmountInput label="Sell Price (IDR)" value={form.amount} onChange={v => set("amount", v)} />
          {selAss && sp > 0 && (
            <div style={{ background: pl !== null && pl >= 0 ? "#f0fdf4" : "#fff5f5", border: `1px solid ${plColor}33`, borderRadius: 10, padding: "10px 14px", display: "flex", gap: 20, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", fontFamily: FF }}>Purchase Price</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", fontFamily: FF }}>{pp > 0 ? fmtIDR(pp) : "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", fontFamily: FF }}>Sell Price</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", fontFamily: FF }}>{fmtIDR(sp)}</div>
              </div>
              {pl !== null && (
                <div>
                  <div style={{ fontSize: 9, color: plColor, fontWeight: 700, textTransform: "uppercase", fontFamily: FF }}>{pl >= 0 ? "Gain" : "Loss"}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: plColor, fontFamily: FF }}>{pl >= 0 ? "+" : ""}{fmtIDR(Math.abs(pl))}</div>
                </div>
              )}
            </div>
          )}
          {/* 11. Notes */}
          {notesField}
        </>
      );
    }

    // ── Give Loan ────────────────────────────────────────────────
    if (type === "give_loan") {
      const loanFromAccs = loanAccTab === "bank" ? bankAccs : cashAccs;
      const loanList     = [...effectiveLoans]
        .filter(l => l.status !== "settled")
        .sort((a, b) => (a.employee_name || "").localeCompare(b.employee_name || ""));
      const prevMonthly  = sn(newMonthlyInstall);
      const prevMonths   = sn(newTotalMonths);
      const prevTotal    = prevMonthly > 0 && prevMonths > 0 ? prevMonthly * prevMonths : null;
      const pill = (active, onClick, label, color = "#3b5bdb", bg = "#eff3ff") => (
        <button type="button" onClick={onClick} style={{
          flex: 1, height: 34, borderRadius: 8, border: "1.5px solid",
          borderColor: active ? color : "#e5e7eb",
          background:  active ? bg    : "#fff",
          color:       active ? color : "#6b7280",
          fontFamily: FF, fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}>{label}</button>
      );
      return (
        <>
          {DIVIDER}
          {/* 3. FROM ACCOUNT — Bank / Cash tabs */}
          <Field label="From Account *">
            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
              {pill(loanAccTab === "bank", () => { setLoanAccTab("bank"); set("from_id", null); }, "Bank")}
              {pill(loanAccTab === "cash", () => { setLoanAccTab("cash"); set("from_id", null); }, "Cash")}
            </div>
            <select value={form.from_id || ""} onChange={e => set("from_id", e.target.value || null)} style={SEL}>
              <option value="">Select account…</option>
              {loanFromAccs.map(a => <option key={a.id} value={a.id}>{a.name}{a.bank_name && a.bank_name !== a.name ? ` · ${a.bank_name}` : ""}</option>)}
            </select>
          </Field>
          {/* 4. BORROWER — Existing / New toggle */}
          <Field label="Borrower *">
            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
              {pill(!creatingBorrower, () => { setCreatingBorrower(false); setNewBorrowerName(""); setNewMonthlyInstall(""); setNewTotalMonths(""); set("to_id", null); }, "Existing Borrower")}
              {pill(creatingBorrower,  () => { setCreatingBorrower(true); set("to_id", null); }, "New Borrower")}
            </div>
            {!creatingBorrower ? (
              <select value={form.to_id || ""} onChange={e => set("to_id", e.target.value || null)} style={SEL}>
                <option value="">Select borrower…</option>
                {loanList.map(l => {
                  const outstanding = Math.max(0, Number(l.total_amount || 0) - Number(l.paid_months || 0) * Number(l.monthly_installment || 0));
                  return (
                    <option key={l.id} value={l.id}>
                      {l.employee_name}{outstanding > 0 ? ` · ${fmtIDR(outstanding)} outstanding` : ""}
                    </option>
                  );
                })}
              </select>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input autoFocus type="text" placeholder="Employee name *"
                  value={newBorrowerName} onChange={e => setNewBorrowerName(e.target.value)}
                  style={{ ...SEL }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" min="0" placeholder="Monthly installment (Rp) *"
                    value={newMonthlyInstall} onChange={e => setNewMonthlyInstall(e.target.value)}
                    style={{ ...SEL, flex: 1 }} />
                  <input type="number" min="1" placeholder="Total months *"
                    value={newTotalMonths} onChange={e => setNewTotalMonths(e.target.value)}
                    style={{ ...SEL, width: 110, flexShrink: 0 }} />
                </div>
                {prevTotal !== null && (
                  <div style={{ background: "#eff3ff", border: "1px solid #c7d2fe", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#3b5bdb", fontWeight: 600, fontFamily: FF }}>
                    {fmtIDR(prevMonthly)}/mo × {prevMonths} months = {fmtIDR(prevTotal)} total
                  </div>
                )}
              </div>
            )}
          </Field>
          {/* 5. Date + Currency */}
          {dateCurrencyRow}
          {/* 6. Amount */}
          <AmountInput label="Amount *" value={form.amount} onChange={v => set("amount", v)} />
          {/* 7. Description */}
          <Input label="Description (optional)" value={form.description || ""} onChange={e => set("description", e.target.value)} placeholder="Optional" />
          {/* 8. Notes */}
          {notesField}
        </>
      );
    }

    // ── Collect Loan ─────────────────────────────────────────────
    if (type === "collect_loan") {
      const activeLoans = [...effectiveLoans]
        .filter(l => l.status !== "settled")
        .sort((a, b) => (a.employee_name || "").localeCompare(b.employee_name || ""));
      const loanToAccs  = loanAccTab === "bank" ? bankAccs : cashAccs;
      const pill = (active, onClick, label) => (
        <button type="button" onClick={onClick} style={{
          flex: 1, height: 34, borderRadius: 8, border: "1.5px solid",
          borderColor: active ? "#059669" : "#e5e7eb",
          background:  active ? "#f0fdf4" : "#fff",
          color:       active ? "#059669" : "#6b7280",
          fontFamily: FF, fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}>{label}</button>
      );
      return (
        <>
          {DIVIDER}
          {/* 3. BORROWER */}
          <Field label="Borrower *">
            <select value={form.from_id || ""} onChange={e => {
              const id = e.target.value || null;
              set("from_id", id);
              if (id) {
                const loan = effectiveLoans.find(l => l.id === id);
                if (loan?.monthly_installment) set("amount", String(loan.monthly_installment));
              } else {
                set("amount", "");
              }
            }} style={SEL}>
              <option value="">Select borrower…</option>
              {activeLoans.map(l => {
                const outstanding = Math.max(0, Number(l.total_amount || 0) - Number(l.paid_months || 0) * Number(l.monthly_installment || 0));
                const monthly     = Number(l.monthly_installment || 0);
                return (
                  <option key={l.id} value={l.id}>
                    {l.employee_name}
                    {outstanding > 0 ? ` · ${fmtIDR(outstanding)} outstanding` : ""}
                    {monthly > 0 ? ` · ${fmtIDR(monthly)}/mo` : ""}
                  </option>
                );
              })}
            </select>
          </Field>
          {/* 4. TO ACCOUNT — Bank / Cash tabs */}
          <Field label="To Account *">
            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
              {pill(loanAccTab === "bank", () => { setLoanAccTab("bank"); set("to_id", null); }, "Bank")}
              {pill(loanAccTab === "cash", () => { setLoanAccTab("cash"); set("to_id", null); }, "Cash")}
            </div>
            <select value={form.to_id || ""} onChange={e => set("to_id", e.target.value || null)} style={SEL}>
              <option value="">Select account…</option>
              {loanToAccs.map(a => <option key={a.id} value={a.id}>{a.name}{a.bank_name && a.bank_name !== a.name ? ` · ${a.bank_name}` : ""}</option>)}
            </select>
          </Field>
          {/* 5. Date + Currency */}
          {dateCurrencyRow}
          {/* 6. Amount (pre-filled from monthly_installment, editable) */}
          <AmountInput label="Amount *" value={form.amount} onChange={v => set("amount", v)} />
          {/* 7. Notes */}
          {notesField}
        </>
      );
    }

    // ── General (expense, income, transfer, pay_cc, pay_liability, reimburse_out, reimburse_in) ──
    const showFrom    = !["income", "reimburse_in"].includes(type);
    const showTo      = ["income","transfer","pay_cc","pay_liability","reimburse_in"].includes(type);
    const showCat     = type === "expense" || type === "income";
    const showEntity  = ["reimburse_out","reimburse_in"].includes(type);
    const showCicilan = type === "expense";

    return (
      <>
        {DIVIDER}
        {/* 3. FROM */}
        {showFrom && renderFromSelect("From Account")}
        {/* 4. TO */}
        {showTo && renderToSelect(
          type === "pay_cc"        ? "Credit Card" :
          type === "pay_liability" ? "Liability"   :
          "To Account"
        )}
        {/* 5. Date + Currency */}
        {dateCurrencyRow}
        {/* 6. Amount */}
        <AmountInput label="Amount" value={form.amount} onChange={v => set("amount", v)} currency={form.currency} />
        {/* 7. FX Rate + IDR equivalent (non-IDR only) */}
        {(form.currency || "IDR") !== "IDR" && Number(form.amount) > 0 && (
          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, marginTop: -8 }}>
            ≈ {fmtIDR(amtIDR)} IDR
          </div>
        )}
        {/* 8. Category (Expense only) */}
        {showCat && (
          <Field label="Category">
            <select value={form.category_id || ""} onChange={e => {
              const found = categories.find(c => c.id === e.target.value);
              set("category_id", e.target.value || null);
              set("category_name", found?.name || null);
            }} style={SEL}>
              <option value="">Select category…</option>
              {catOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )}
        {/* 9. Entity (Reimburse only) */}
        {showEntity && renderEntityPills()}
        {/* 10. Merchant / Description */}
        <Input
          label="Merchant / Description (optional)"
          value={form.description || ""}
          onChange={e => set("description", e.target.value)}
          placeholder={
            type === "income"        ? "e.g. Monthly salary"  :
            type === "reimburse_out" ? "e.g. Lunch SDC team"  :
            type === "expense"       ? "e.g. Lunch at Warung"  :
            "Optional"
          }
        />
        {/* 11. Cicilan (Expense only) */}
        {showCicilan && (
          <CicilanSection enabled={cicilan} onToggle={() => setCicilan(v => !v)} form={form} set={set} />
        )}
        {/* 12. Notes */}
        {notesField}
      </>
    );
  };

  // ── Title ─────────────────────────────────────────────────────
  const titleMap = { add: "Add Transaction", edit: "Edit Transaction", confirm: "Confirm Transaction" };
  const title = titleMap[mode] || "Transaction";

  // ── Footer ────────────────────────────────────────────────────
  const footer = (
    <div style={{ display: "flex", gap: 8 }}>
      {mode === "edit" && onDelete && (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={saving}
          style={{
            height: 44, borderRadius: 10, border: "1.5px solid #fee2e2",
            background: "#fff5f5", color: "#dc2626",
            fontFamily: FF, fontSize: 14, fontWeight: 600,
            cursor: saving ? "default" : "pointer", padding: "0 16px",
            opacity: saving ? 0.6 : 1,
          }}
        >
          Delete
        </button>
      )}
      <button type="button" onClick={onClose} disabled={saving}
        style={{
          flex: 1, height: 44, borderRadius: 10, border: "1.5px solid #e5e7eb",
          background: "#fff", color: "#374151",
          fontFamily: FF, fontSize: 14, fontWeight: 600,
          cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
        }}>
        Cancel
      </button>
      <button type="button" onClick={save} disabled={saving}
        style={{
          flex: 2, height: 44, borderRadius: 10, border: "none",
          background: "#111827", color: "#fff",
          fontFamily: FF, fontSize: 14, fontWeight: 700,
          cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
        }}>
        {saving ? "Saving…" : mode === "confirm" ? "✓ Confirm" : mode === "edit" ? "Save Changes" : "Add Transaction"}
      </button>
    </div>
  );

  return (
    <>
      <Modal isOpen={open} onClose={onClose} title={title} width={520} footer={footer}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Group tabs + type pills — in add and edit mode */}
          {(mode === "add" || mode === "edit") && (
            <>
              <GroupTabs active={group} onChange={handleGroupChange} disabled={saving} />
              <TypePills group={group} active={type} onChange={handleTypeChange} disabled={saving} />
            </>
          )}

          {/* In confirm mode, show type badge */}
          {mode === "confirm" && (() => {
            const m = TYPE_META[type] || { label: type, color: "#6b7280" };
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "4px 12px", borderRadius: 20,
                  border: `1.5px solid ${m.color}33`, background: m.color + "15",
                  color: m.color, fontFamily: FF, fontSize: 12, fontWeight: 700,
                }}>
                  {m.icon} {m.label}
                </span>
                <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF }}>Review and confirm</span>
              </div>
            );
          })()}

          {renderFields()}
        </div>
      </Modal>

      {/* Delete confirm */}
      {confirm && (
        <div onClick={e => { if (e.target === e.currentTarget) setConfirm(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 360, width: "100%", fontFamily: FF }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 8 }}>Delete transaction?</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>This will reverse the balance impact. This cannot be undone.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setConfirm(false)} style={{ flex: 1, height: 40, borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", color: "#374151", fontFamily: FF, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleDelete} disabled={saving} style={{ flex: 1, height: 40, borderRadius: 8, border: "none", background: "#fee2e2", color: "#dc2626", fontFamily: FF, fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
                {saving ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
