import { useState, useMemo } from "react";
import { ledgerApi, merchantApi, gmailApi, getTxFromToTypes, employeeLoanApi } from "../api";
import { EXPENSE_CATEGORIES, ENTITIES, TX_TYPES } from "../constants";
import { fmtIDR, todayStr, ym, toIDR, groupByDate, fmtDateLabel } from "../utils";
import Modal, { ConfirmModal } from "./shared/Modal";
import Button from "./shared/Button";
import Input, { Field, AmountInput, FormRow, Toggle, Textarea } from "./shared/Input";
import Select from "./shared/Select";
import { EmptyState, showToast } from "./shared/Card";

// ─── CONSTANTS ───────────────────────────────────────────────
const SUBTABS = [
  { id: "all",       label: "All" },
  { id: "expense",   label: "Expenses" },
  { id: "income",    label: "Income" },
  { id: "transfer",  label: "Transfers" },
  { id: "reimburse", label: "Reimburse" },
];

const TYPE_CHOICES = [
  { id: "expense",       label: "Expense",       icon: "↑",  color: "#dc2626", desc: "Spending" },
  { id: "income",        label: "Income",        icon: "↓",  color: "#059669", desc: "Receiving" },
  { id: "transfer",      label: "Transfer",      icon: "↔",  color: "#3b5bdb", desc: "Move funds" },
  { id: "pay_cc",        label: "Pay CC",        icon: "💳", color: "#7c3aed", desc: "CC payment" },
  { id: "buy_asset",     label: "Buy Asset",     icon: "📈", color: "#0891b2", desc: "Purchase asset" },
  { id: "sell_asset",    label: "Sell Asset",    icon: "💰", color: "#059669", desc: "Sell asset" },
  { id: "reimburse_out", label: "Reimburse Out", icon: "↗",  color: "#d97706", desc: "Paid for others" },
  { id: "reimburse_in",  label: "Reimburse In",  icon: "↙",  color: "#059669", desc: "Got reimbursed" },
  { id: "give_loan",     label: "Give Loan",     icon: "↗",  color: "#d97706", desc: "Lend money" },
  { id: "collect_loan",  label: "Collect Loan",  icon: "↙",  color: "#059669", desc: "Receive repay" },
  { id: "pay_liability", label: "Pay Liability", icon: "📉", color: "#d97706", desc: "Pay off debt" },
  { id: "fx_exchange",   label: "FX Exchange",   icon: "💱", color: "#0891b2", desc: "Currency swap" },
];

const EMPTY = {
  tx_date: todayStr(), description: "", amount: "", currency: "IDR",
  tx_type: "expense", from_id: null, to_id: null,
  from_type: "account", to_type: "expense",
  category_id: null, category_name: null, entity: "Personal",
  notes: "", is_reimburse: false,
  // give_loan extras
  employee_name: "", monthly_installment: "", loan_start_date: todayStr(),
};

// ─── MAIN COMPONENT ──────────────────────────────────────────
export default function Transactions({
  user, accounts, ledger, categories, fxRates, CURRENCIES: C,
  bankAccounts, creditCards, assets, liabilities, receivables,
  onRefresh, setLedger, pendingSyncs, setPendingSyncs, incomeSrcs,
  employeeLoans = [], setEmployeeLoans,
}) {
  const allCurrencies = C || [];
  const pendingCount  = pendingSyncs?.length || 0;

  // ── UI state ──
  const [subTab,  setSubTab]  = useState("all");
  const [modal,   setModal]   = useState(null); // "add" | "edit" | "delete" | null
  const [step,    setStep]    = useState(1);
  const [form,    setForm]    = useState({ ...EMPTY });
  const [editEntry, setEditEntry] = useState(null);
  const [deleteEntry, setDeleteEntry] = useState(null);
  const [saving,  setSaving]  = useState(false);

  // ── Filters ──
  const [filterMonth,  setFilterMonth]  = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [filterAccId,  setFilterAccId]  = useState("");
  const [search,       setSearch]       = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ── Account options per tx type ──
  const fromOptions = useMemo(() => ({
    expense:       [...bankAccounts, ...creditCards],
    income:        [],
    transfer:      [...bankAccounts],
    pay_cc:        [...bankAccounts],
    buy_asset:     [...bankAccounts, ...creditCards],
    sell_asset:    [...assets],
    pay_liability: [...bankAccounts],
    reimburse_out: [...bankAccounts, ...creditCards],
    reimburse_in:  [...receivables],
    give_loan:     [...bankAccounts],
    collect_loan:  [...receivables],
    fx_exchange:   [...bankAccounts],
  })[form.tx_type] || accounts, [form.tx_type, bankAccounts, creditCards, assets, liabilities, receivables, accounts]);

  const toOptions = useMemo(() => ({
    expense:       [],
    income:        [...bankAccounts],
    transfer:      [...bankAccounts],
    pay_cc:        [...creditCards],
    buy_asset:     [...assets],
    sell_asset:    [...bankAccounts],
    pay_liability: [...liabilities],
    reimburse_out: [...receivables],
    reimburse_in:  [...bankAccounts],
    give_loan:     [...receivables],
    collect_loan:  [...bankAccounts],
    fx_exchange:   [...bankAccounts],
  })[form.tx_type] || [], [form.tx_type, bankAccounts, creditCards, assets, liabilities, receivables]);

  const amtIDR = toIDR(Number(form.amount || 0), form.currency || "IDR", fxRates, allCurrencies);

  // ── Filtering ──
  const filtered = useMemo(() => {
    let list = [...ledger];
    if (subTab === "expense")   list = list.filter(e => e.tx_type === "expense");
    else if (subTab === "income")    list = list.filter(e => e.tx_type === "income");
    else if (subTab === "transfer")  list = list.filter(e => ["transfer","pay_cc","fx_exchange"].includes(e.tx_type));
    else if (subTab === "reimburse") list = list.filter(e => e.is_reimburse || e.tx_type === "reimburse_out" || e.tx_type === "reimburse_in");
    if (filterMonth)  list = list.filter(e => ym(e.tx_date) === filterMonth);
    if (filterEntity) list = list.filter(e => e.entity === filterEntity);
    if (filterAccId)  list = list.filter(e => e.from_id === filterAccId || e.to_id === filterAccId);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        e.description?.toLowerCase().includes(q) ||
        e.merchant_name?.toLowerCase().includes(q) ||
        e.category_name?.toLowerCase().includes(q));
    }
    return list;
  }, [ledger, subTab, filterMonth, filterEntity, filterAccId, search]);

  const grouped = useMemo(() => groupByDate(filtered), [filtered]);

  // ── Totals ──
  const outTotal = useMemo(() =>
    filtered.filter(e => ["expense","pay_cc","buy_asset","pay_liability","reimburse_out","give_loan"].includes(e.tx_type))
      .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0),
  [filtered]);

  const inTotal = useMemo(() =>
    filtered.filter(e => ["income","sell_asset","reimburse_in","collect_loan"].includes(e.tx_type))
      .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0),
  [filtered]);

  // ── Open add ──
  const openAdd = () => {
    setForm({ ...EMPTY });
    setEditEntry(null);
    setStep(1);
    setModal("add");
  };

  // ── Open edit ──
  const openEdit = (e) => {
    setForm({
      tx_date:         e.tx_date,
      description:     e.description || "",
      amount:          e.amount,
      currency:        e.currency || "IDR",
      tx_type:         e.tx_type,
      from_id:         e.from_id || null,
      to_id:           e.to_id   || null,
      from_type:       e.from_type || getTxFromToTypes(e.tx_type).from_type,
      to_type:         e.to_type   || getTxFromToTypes(e.tx_type).to_type,
      category_id:     e.category_id   || null,
      category_name:   e.category_name || null,
      entity:          e.entity          || "Personal",
      notes:           e.notes           || "",
      is_reimburse:    e.is_reimburse     || false,
    });
    setEditEntry(e);
    setStep(2);
    setModal("edit");
  };

  // ── Save ──
  const save = async () => {
    const type = form.tx_type;

    if (!form.amount || Number(form.amount) <= 0) {
      showToast("Amount is required", "error");
      return;
    }
    // Description required only for these types
    if (["expense", "income", "reimburse_out"].includes(type) && !form.description?.trim()) {
      showToast("Description is required", "error");
      return;
    }
    // Both accounts required
    if (["transfer", "pay_cc", "fx_exchange", "buy_asset", "sell_asset", "pay_liability"].includes(type)) {
      if (!form.from_id || !form.to_id) {
        showToast("Both From and To accounts are required", "error");
        return;
      }
    }

    setSaving(true);
    try {
      // UUID sanitizer — only accept exactly 36-char strings
      const uuid = (v) => {
        if (!v || v === "" || v === "null" || v === "undefined") return null;
        if (typeof v === "string" && v.length === 36) return v;
        return null;
      };
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };

      // ── Give Loan (Method A): create employee_loan first, then ledger ──
      if (type === "give_loan" && !editEntry) {
        if (!form.from_id) { showToast("Select bank account", "error"); setSaving(false); return; }
        if (!form.employee_name?.trim()) { showToast("Employee name is required", "error"); setSaving(false); return; }
        const loan = await employeeLoanApi.create(user.id, {
          employee_name:       form.employee_name.trim(),
          monthly_installment: sn(form.monthly_installment),
          total_amount:        sn(form.amount),
          start_date:          form.loan_start_date || form.tx_date,
          notes:               form.notes || null,
          status:              "active",
        });
        setEmployeeLoans?.(prev => [loan, ...prev]);
        const loanEntry = {
          tx_date:        form.tx_date,
          description:    `Employee Loan — ${loan.employee_name}`,
          amount:         sn(form.amount),
          currency:       "IDR",
          amount_idr:     sn(form.amount),
          tx_type:        "give_loan",
          from_type:      "account",
          to_type:        "employee_loan",
          from_id:        uuid(form.from_id),
          to_id:          loan.id,
          entity:         "Personal",
          is_reimburse:   false,
          merchant_name:  null,
          notes:          form.notes || null,
          attachment_url: null,
          ai_categorized: false,
          ai_confidence:  null,
          installment_id: null,
          scan_batch_id:  null,
          category_id:    null,
          category_name:  null,
        };
        const created = await ledgerApi.create(user.id, loanEntry, accounts);
        setLedger(p => [created, ...p]);
        showToast(`Loan of ${fmtIDR(sn(form.amount), true)} created for ${loan.employee_name}`);
        await onRefresh();
        setModal(null);
        setSaving(false);
        return;
      }

      const cat = categories.find(c => c.id === form.category_id);
      const { from_type, to_type } = getTxFromToTypes(type);

      // Auto-generate description for types that don't require manual input
      const AUTO_DESC = {
        transfer:      "Transfer",
        pay_cc:        "CC Payment",
        buy_asset:     "Asset Purchase",
        sell_asset:    "Asset Sale",
        give_loan:     "Employee Loan",
        collect_loan:  "Loan Collection",
        reimburse_in:  "Reimburse Received",
        pay_liability: "Liability Payment",
        fx_exchange:   "FX Exchange",
      };
      const description = form.description?.trim() || AUTO_DESC[type] || "Transaction";

      // Explicit full entry — every UUID field goes through uuid()
      const entry = {
        tx_date:        form.tx_date || new Date().toISOString().slice(0, 10),
        description,
        amount:         sn(form.amount),
        currency:       form.currency  || "IDR",
        amount_idr:     sn(amtIDR),
        tx_type:        type,
        from_type,
        to_type,
        from_id:        uuid(form.from_id),
        to_id:          uuid(form.to_id),
        category_id:    uuid(form.category_id),
        category_name:  cat?.name || form.category_name || null,
        entity:         type === "reimburse_out" ? (form.entity || "Hamasa") : "Personal",
        is_reimburse:   type === "reimburse_out",
        merchant_name:  null,
        notes:          form.notes || null,
        attachment_url: null,
        ai_categorized: false,
        ai_confidence:  null,
        installment_id: null,
        scan_batch_id:  null,
      };

      console.log("Inserting ledger entry:", entry);
      if (editEntry) {
        const updated = await ledgerApi.update(editEntry.id, entry);
        setLedger(p => p.map(e => e.id === editEntry.id ? updated : e));
        showToast("Transaction updated");
      } else {
        const created = await ledgerApi.create(user.id, entry, accounts);
        setLedger(p => [created, ...p]);
        showToast("Transaction added");
        await onRefresh();
      }
      // Save merchant mapping
      if (description && form.category_id) {
        merchantApi.upsert(user.id, description, form.category_id, cat?.name || "").catch(() => {});
      }
      setModal(null);
    } catch (e) {
      showToast(e.message, "error");
    }
    setSaving(false);
  };

  // ── Delete ──
  const confirmDelete = async () => {
    if (!deleteEntry) return;
    try {
      await ledgerApi.delete(deleteEntry.id, deleteEntry, accounts);
      setLedger(p => p.filter(e => e.id !== deleteEntry.id));
      showToast("Deleted");
      await onRefresh();
    } catch (e) { showToast(e.message, "error"); }
    setDeleteEntry(null);
  };

  // ── Months for filter ──
  const monthOptions = useMemo(() => {
    const seen = new Set();
    ledger.forEach(e => seen.add(ym(e.tx_date)));
    return Array.from(seen).sort((a, b) => b.localeCompare(a)).slice(0, 12).map(m => ({
      value: m,
      label: new Date(m + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" }),
    }));
  }, [ledger]);

  // ─── RENDER ───────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── ACTION BAR ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search transactions…"
            style={{
              width: "100%", height: 36, padding: "0 12px 0 32px",
              border: "1.5px solid #e5e7eb", borderRadius: 10,
              fontFamily: "Figtree, sans-serif", fontSize: 13, fontWeight: 500,
              color: "#111827", background: "#fff", outline: "none", boxSizing: "border-box",
            }}
          />
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#9ca3af" }}>🔍</span>
        </div>
        <button onClick={openAdd} style={BTN_PRIMARY}>+ Add</button>
      </div>

      {/* ── FILTERS ROW ── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={FILTER_SELECT}>
          <option value="">All months</option>
          {monthOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={FILTER_SELECT}>
          <option value="">All entities</option>
          {ENTITIES.map(en => <option key={en} value={en}>{en}</option>)}
        </select>
        <select value={filterAccId} onChange={e => setFilterAccId(e.target.value)} style={FILTER_SELECT}>
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {(filterMonth || filterEntity || filterAccId || search) && (
          <button
            onClick={() => { setFilterMonth(""); setFilterEntity(""); setFilterAccId(""); setSearch(""); }}
            style={{ ...FILTER_SELECT, background: "#fee2e2", color: "#dc2626", border: "1.5px solid #fecaca", cursor: "pointer" }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* ── SUBTABS ── */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {[...SUBTABS, ...(pendingCount > 0 ? [{ id: "pending", label: `Pending (${pendingCount})` }] : [])].map(t => {
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

      {/* ── SUMMARY STRIP ── */}
      {subTab !== "pending" && (
        <div style={{
          display: "flex", gap: 16, alignItems: "center",
          padding: "8px 0", borderBottom: "1px solid #f3f4f6",
          fontSize: 12, fontFamily: "Figtree, sans-serif",
        }}>
          <span style={{ color: "#9ca3af" }}>{filtered.length} transactions</span>
          <span style={{ color: "#dc2626", fontWeight: 700 }}>−{fmtIDR(outTotal, true)}</span>
          <span style={{ color: "#059669", fontWeight: 700 }}>+{fmtIDR(inTotal, true)}</span>
          <span style={{ color: inTotal - outTotal >= 0 ? "#059669" : "#dc2626", fontWeight: 700, marginLeft: "auto" }}>
            Net: {inTotal - outTotal >= 0 ? "+" : ""}{fmtIDR(inTotal - outTotal, true)}
          </span>
        </div>
      )}

      {/* ── PENDING TAB ── */}
      {subTab === "pending" && (
        <PendingTab
          pendingSyncs={pendingSyncs} setPendingSyncs={setPendingSyncs}
          accounts={accounts} categories={categories} user={user}
          ledger={ledger} setLedger={setLedger} onRefresh={onRefresh}
        />
      )}

      {/* ── TRANSACTION LIST ── */}
      {subTab !== "pending" && (
        grouped.length === 0
          ? <EmptyState icon="📋" title="No transactions" message="Add your first transaction or adjust the filters." />
          : grouped.map(([date, rows]) => {
              const dayNet = rows.reduce((sum, e) => {
                const a = Number(e.amount_idr || e.amount || 0);
                if (["income","reimburse_in","collect_loan","sell_asset"].includes(e.tx_type)) return sum + a;
                if (["transfer","pay_cc","fx_exchange","opening_balance"].includes(e.tx_type)) return sum;
                return sum - a;
              }, 0);

              return (
                <div key={date}>
                  {/* Date header */}
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 0 6px",
                  }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: "#9ca3af",
                      textTransform: "uppercase", letterSpacing: "0.5px",
                      fontFamily: "Figtree, sans-serif",
                    }}>
                      {fmtDateLabel(date)}
                    </div>
                    <div style={{
                      fontSize: 11, fontWeight: 600, fontFamily: "Figtree, sans-serif",
                      color: dayNet >= 0 ? "#059669" : "#dc2626",
                    }}>
                      {dayNet >= 0 ? "+" : ""}{fmtIDR(dayNet, true)}
                    </div>
                  </div>

                  {/* Rows */}
                  {rows.map(e => (
                    <TxRow
                      key={e.id}
                      entry={e}
                      accounts={accounts}
                      onEdit={() => openEdit(e)}
                      onDelete={() => setDeleteEntry(e)}
                    />
                  ))}
                </div>
              );
            })
      )}

      {/* ── ADD / EDIT MODAL ── */}
      <Modal
        isOpen={modal === "add" || modal === "edit"}
        onClose={() => setModal(null)}
        title={
          modal === "edit"
            ? "Edit Transaction"
            : step === 1 ? "Add Transaction" : TYPE_CHOICES.find(t => t.id === form.tx_type)?.label || "Add"
        }
        footer={
          step === 2 && (
            <div style={{ display: "flex", gap: 8 }}>
              {modal === "add" && (
                <Button variant="secondary" onClick={() => setStep(1)} style={{ flexShrink: 0 }}>
                  ← Back
                </Button>
              )}
              <Button fullWidth onClick={save} busy={saving}>
                {modal === "edit" ? "Save Changes" : "Add Transaction"}
              </Button>
            </div>
          )
        }
      >
        {step === 1 ? (
          <TypePickerGrid
            types={TYPE_CHOICES}
            onSelect={type => { set("tx_type", type); setStep(2); }}
          />
        ) : (
          <TxForm
            form={form} set={set}
            fromOptions={fromOptions} toOptions={toOptions}
            accounts={accounts} categories={categories}
            incomeSrcs={incomeSrcs} allCurrencies={allCurrencies}
            amtIDR={amtIDR} receivables={receivables}
          />
        )}
      </Modal>

      {/* ── DELETE CONFIRM ── */}
      <ConfirmModal
        isOpen={!!deleteEntry}
        onClose={() => setDeleteEntry(null)}
        onConfirm={confirmDelete}
        title="Delete Transaction"
        message={`Delete "${deleteEntry?.description}"? This cannot be undone and will reverse the balance update.`}
        danger
      />
    </div>
  );
}

// ─── TRANSACTION ROW ─────────────────────────────────────────
function TxRow({ entry: e, accounts, onEdit, onDelete }) {
  const fromAcc = accounts.find(a => a.id === e.from_id);
  const toAcc   = accounts.find(a => a.id === e.to_id);
  const amt     = Number(e.amount_idr || e.amount || 0);

  const isOut    = ["expense","pay_cc","buy_asset","pay_liability","reimburse_out","give_loan"].includes(e.tx_type);
  const isIn     = ["income","sell_asset","reimburse_in","collect_loan"].includes(e.tx_type);
  const isMove   = ["transfer","fx_exchange"].includes(e.tx_type);

  const catDef   = EXPENSE_CATEGORIES.find(c => c.id === e.category_id || c.id === e.category);
  const amtColor = isOut ? "#dc2626" : isIn ? "#059669" : "#3b5bdb";
  const prefix   = isOut ? "−" : isIn ? "+" : "";

  const iconEmoji = catDef?.icon || (isOut ? "↑" : isIn ? "↓" : "↔");
  const iconBg    = catDef ? catDef.color + "18" : isOut ? "#fee2e2" : isIn ? "#dcfce7" : "#dbeafe";

  const accLabel = isMove
    ? `${fromAcc?.name || "?"} → ${toAcc?.name || "?"}`
    : fromAcc?.name || toAcc?.name || "";

  const meta = [
    accLabel,
    e.category_name || catDef?.label,
    e.entity && e.entity !== "Personal" ? e.entity : null,
  ].filter(Boolean).join(" · ");

  return (
    <div style={{
      display:      "flex",
      alignItems:   "center",
      gap:          12,
      padding:      "10px 0",
      borderBottom: "1px solid #f9fafb",
    }}>
      {/* Icon */}
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: iconBg,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 16, flexShrink: 0,
      }}>
        {iconEmoji}
      </div>

      {/* Center */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: "#111827",
          fontFamily: "Figtree, sans-serif",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {e.description || "—"}
        </div>
        {meta && (
          <div style={{
            fontSize: 11, color: "#9ca3af",
            fontFamily: "Figtree, sans-serif",
            marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {meta}
          </div>
        )}
      </div>

      {/* Amount */}
      <div style={{
        fontSize: 13, fontWeight: 700,
        color: amtColor, fontFamily: "Figtree, sans-serif",
        flexShrink: 0, textAlign: "right",
      }}>
        {prefix}{fmtIDR(amt)}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        <button onClick={onEdit} style={ROW_BTN}>✎</button>
        <button onClick={onDelete} style={{ ...ROW_BTN, color: "#dc2626", borderColor: "#fecaca" }}>✕</button>
      </div>
    </div>
  );
}

// ─── TYPE PICKER GRID ────────────────────────────────────────
function TypePickerGrid({ types, onSelect }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginBottom: 12 }}>
        What kind of transaction?
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {types.map(t => (
          <button key={t.id} onClick={() => onSelect(t.id)} style={{
            padding:       "14px 8px",
            borderRadius:  12,
            border:        `1.5px solid ${t.color}22`,
            background:    t.color + "0d",
            cursor:        "pointer",
            display:       "flex",
            flexDirection: "column",
            alignItems:    "center",
            gap:           6,
            transition:    "border-color 0.15s",
          }}>
            <span style={{ fontSize: 20 }}>{t.icon}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
              {t.label}
            </span>
            <span style={{ fontSize: 9, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
              {t.desc}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── TRANSACTION FORM ────────────────────────────────────────
function TxForm({ form, set, fromOptions, toOptions, accounts, categories, incomeSrcs = [], allCurrencies = [], amtIDR, receivables = [] }) {
  const type = form.tx_type;
  const [fromSource, setFromSource] = useState("bank");

  // Fix "Jenius · Jenius" — only append bank_name if different from name
  const accLabel = a => a.name + (a.bank_name && a.bank_name !== a.name ? ` · ${a.bank_name}` : "");

  // Derived bank / CC lists from full accounts array
  const bankAccs = accounts.filter(a => a.type === "bank"        && a.is_active !== false);
  const ccAccs   = accounts.filter(a => a.type === "credit_card" && a.is_active !== false);

  // Two-step from-source toggle applies to these tx types
  const TWO_STEP_FROM = ["expense", "reimburse_out", "transfer", "pay_cc", "buy_asset", "give_loan"];
  const hasTwoStep    = TWO_STEP_FROM.includes(type);

  const fromList = hasTwoStep
    ? (fromSource === "bank" ? bankAccs : ccAccs)
    : fromOptions;

  const fromOpts = fromList
    .filter(a => a.id && a.id.length === 36)
    .map(a => ({ value: a.id, label: accLabel(a) }));

  const toOpts = toOptions
    .filter(a => a.id && a.id.length === 36)
    .map(a => ({ value: a.id, label: accLabel(a) }));

  const incOpts = (incomeSrcs || [])
    .filter(s => s.id && s.id.length === 36)
    .map(s => ({ value: s.id, label: s.name }));

  const catOptions = categories.filter(c => c.is_active !== false)
    .map(c => ({ value: c.id, label: `${c.icon || ""} ${c.name || c.label}` }));
  if (!catOptions.length) {
    EXPENSE_CATEGORIES.forEach(c => catOptions.push({ value: c.id, label: `${c.icon} ${c.label}` }));
  }

  // to_id is auto-set for reimburse_out (entity toggle) and give_loan (auto-created)
  const needsTo  = toOptions.length > 0 && !["reimburse_out", "give_loan"].includes(type);
  const needsCat = type === "expense";

  // Switch bank/CC source and reset from_id
  const switchFromSource = (src) => {
    setFromSource(src);
    set("from_id", null);
  };

  // For reimburse_out: selecting entity auto-sets to_id
  const ENTITY_OPTS = ["Hamasa", "SDC", "Travelio"];
  const pickEntity = (ent) => {
    set("entity", ent);
    const rec = receivables.find(r => r.entity === ent);
    set("to_id", rec?.id || null);
  };

  // Pill button style helper
  const pillStyle = (active, activeColor = "#111827") => ({
    flex: 1, height: 36, borderRadius: 8, border: "1.5px solid",
    borderColor: active ? activeColor : "#e5e7eb",
    background:  active ? activeColor : "#f9fafb",
    color:       active ? "#fff" : "#6b7280",
    fontSize: 12, fontWeight: active ? 700 : 500,
    cursor: "pointer", fontFamily: "Figtree, sans-serif",
    transition: "all 0.15s",
  });

  const SEL_STYLE = {
    width: "100%", height: 44, padding: "0 14px",
    border: "1.5px solid #e5e7eb", borderRadius: 10,
    fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 500,
    color: "#111827", background: "#fff", outline: "none",
    appearance: "none", WebkitAppearance: "none",
    cursor: "pointer", boxSizing: "border-box",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Type badge */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 20,
        background: (TYPE_CHOICES.find(t => t.id === type)?.color || "#9ca3af") + "18",
        width: "fit-content",
      }}>
        <span style={{ fontSize: 14 }}>{TYPE_CHOICES.find(t => t.id === type)?.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
          {TYPE_CHOICES.find(t => t.id === type)?.label}
        </span>
      </div>

      {/* Date */}
      <Input label="Date" type="date" value={form.tx_date} onChange={e => set("tx_date", e.target.value)} />

      {/* Description */}
      {!["transfer","pay_cc","reimburse_in","collect_loan","pay_liability","fx_exchange"].includes(type) && (
        <Input
          label="Description"
          value={form.description}
          onChange={e => set("description", e.target.value)}
          placeholder={type === "income" ? "e.g. Monthly salary" : "e.g. Lunch at Warung Makan"}
        />
      )}
      {["transfer","pay_cc","fx_exchange"].includes(type) && (
        <Input
          label="Notes / Reference (optional)"
          value={form.description}
          onChange={e => set("description", e.target.value)}
          placeholder="Optional"
        />
      )}

      {/* Amount + Currency */}
      <div style={{ display: "flex", gap: 8 }}>
        <AmountInput label="Amount" value={form.amount} onChange={v => set("amount", v)} currency={form.currency} style={{ flex: 1 }} />
        <Field label="Currency" style={{ width: 90, flexShrink: 0 }}>
          <select value={form.currency} onChange={e => set("currency", e.target.value)} style={{
            width: "100%", height: 44, border: "1.5px solid #e5e7eb", borderRadius: 10,
            fontFamily: "Figtree, sans-serif", fontSize: 13, fontWeight: 600,
            color: "#111827", background: "#fff", outline: "none",
            appearance: "none", padding: "0 8px", cursor: "pointer",
          }}>
            {allCurrencies.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
          </select>
        </Field>
      </div>
      {form.currency !== "IDR" && form.amount && (
        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: -8 }}>
          ≈ {fmtIDR(amtIDR)} IDR
        </div>
      )}

      {/* Give Loan — employee details (before From Account) */}
      {type === "give_loan" && (
        <Input
          label="Employee Name *"
          value={form.employee_name || ""}
          onChange={e => set("employee_name", e.target.value)}
          placeholder="Full name"
        />
      )}

      {/* FROM ACCOUNT — two-step (Bank / CC toggle + dropdown) */}
      {hasTwoStep && (
        <Field label={type === "give_loan" ? "From Bank Account" : "From Account"}>
          {type !== "give_loan" && (
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <button type="button" onClick={() => switchFromSource("bank")}        style={pillStyle(fromSource === "bank")}>🏦 Bank Account</button>
              <button type="button" onClick={() => switchFromSource("credit_card")} style={pillStyle(fromSource === "credit_card")}>💳 Credit Card</button>
            </div>
          )}
          <select
            value={form.from_id || ""}
            onChange={e => set("from_id", e.target.value.length === 36 ? e.target.value : null)}
            style={SEL_STYLE}
          >
            <option value="">Select bank account…</option>
            {(type === "give_loan" ? bankAccs.filter(a => a.id && a.id.length === 36).map(a => ({ value: a.id, label: accLabel(a) })) : fromOpts).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
      )}

      {/* Give Loan — installment + start date + auto-calc */}
      {type === "give_loan" && (() => {
        const total   = Number(form.amount || 0);
        const monthly = Number(form.monthly_installment || 0);
        const totalMo = total > 0 && monthly > 0 ? Math.ceil(total / monthly) : null;
        const endDate = totalMo && form.loan_start_date
          ? (() => { const d = new Date(form.loan_start_date + "T00:00:00"); d.setMonth(d.getMonth() + totalMo); return d.toLocaleDateString("en-US", { month: "long", year: "numeric" }); })()
          : null;
        return (
          <>
            <AmountInput label="Monthly Installment" value={form.monthly_installment || ""} onChange={v => set("monthly_installment", v)} />
            <Input label="Start Date" type="date" value={form.loan_start_date || form.tx_date || todayStr()} onChange={e => set("loan_start_date", e.target.value)} />
            {totalMo && (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 14px", display: "flex", gap: 20 }}>
                <div><div style={{ fontSize: 9, color: "#059669", fontWeight: 700, textTransform: "uppercase" }}>Duration</div><div style={{ fontSize: 13, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>{totalMo} months</div></div>
                <div><div style={{ fontSize: 9, color: "#059669", fontWeight: 700, textTransform: "uppercase" }}>Monthly</div><div style={{ fontSize: 13, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>{fmtIDR(monthly)}</div></div>
                {endDate && <div><div style={{ fontSize: 9, color: "#059669", fontWeight: 700, textTransform: "uppercase" }}>Ends</div><div style={{ fontSize: 13, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>{endDate}</div></div>}
              </div>
            )}
          </>
        );
      })()}

      {/* FROM ACCOUNT — regular select for non-two-step types (sell_asset, collect_loan, etc.) */}
      {!hasTwoStep && fromOptions.length > 0 && (
        <Select
          label={type === "sell_asset" ? "Asset" : (type === "collect_loan" || type === "reimburse_in") ? "Receivable" : "From Account"}
          value={form.from_id || ""}
          onChange={e => set("from_id", e.target.value.length === 36 ? e.target.value : null)}
          options={fromOpts}
          placeholder="Select…"
        />
      )}

      {/* ENTITY toggle for reimburse_out — auto-sets to_id */}
      {type === "reimburse_out" && (
        <Field label="Entity">
          <div style={{ display: "flex", gap: 6 }}>
            {ENTITY_OPTS.map(ent => (
              <button key={ent} type="button" onClick={() => pickEntity(ent)} style={pillStyle(form.entity === ent, "#d97706")}>
                {ent}
              </button>
            ))}
          </div>
        </Field>
      )}

      {/* TO ACCOUNT — skip for reimburse_out (entity toggle sets it) */}
      {needsTo && (
        <Select
          label={type === "buy_asset" ? "Asset" : type === "give_loan" ? "Receivable" : type === "pay_cc" ? "Credit Card" : type === "pay_liability" ? "Liability" : "To Account"}
          value={form.to_id || ""}
          onChange={e => set("to_id", e.target.value.length === 36 ? e.target.value : null)}
          options={toOpts}
          placeholder="Select…"
        />
      )}

      {/* Income source */}
      {type === "income" && incOpts.length > 0 && (
        <Select
          label="Income Source (optional)"
          value={form.income_source_id || ""}
          onChange={e => set("income_source_id", e.target.value)}
          options={incOpts}
          placeholder="Select source…"
        />
      )}

      {/* Category — expense only */}
      {needsCat && (
        <Select
          label="Category"
          value={form.category_id || ""}
          onChange={e => {
            const found = categories.find(c => c.id === e.target.value);
            set("category_id", e.target.value || null);
            set("category_name", found?.name || null);
          }}
          options={catOptions}
          placeholder="Select category…"
        />
      )}

      {/* FX Exchange extra field */}
      {type === "fx_exchange" && (
        <Input label="To Amount (received currency)" type="number" value={form.to_amount || ""}
          onChange={e => set("to_amount", e.target.value)} placeholder="0" />
      )}

      {/* Pay CC fees */}
      {type === "pay_cc" && (
        <FormRow>
          <AmountInput label="Admin Fee (optional)" value={form.admin_fee || ""} onChange={v => set("admin_fee", v)} style={{ flex: 1 }} />
          <AmountInput label="Materai (optional)"   value={form.materai || ""}   onChange={v => set("materai", v)}   style={{ flex: 1 }} />
        </FormRow>
      )}

      {/* Transfer fee */}
      {type === "transfer" && (
        <AmountInput label="Transfer Fee (optional)" value={form.transfer_fee || ""} onChange={v => set("transfer_fee", v)} />
      )}

      {/* Notes */}
      <Field label="Notes (optional)">
        <textarea
          value={form.notes}
          onChange={e => set("notes", e.target.value)}
          placeholder="Any extra details…"
          rows={2}
          style={{
            width: "100%", padding: "10px 14px", border: "1.5px solid #e5e7eb",
            borderRadius: 10, fontFamily: "Figtree, sans-serif", fontSize: 14,
            fontWeight: 500, color: "#111827", background: "#fff", outline: "none",
            resize: "vertical", boxSizing: "border-box", lineHeight: 1.5,
          }}
        />
      </Field>

    </div>
  );
}

// ─── PENDING TAB ─────────────────────────────────────────────
function PendingTab({ pendingSyncs, setPendingSyncs, accounts, categories, user, ledger, setLedger, onRefresh }) {

  if (!pendingSyncs?.length) return (
    <EmptyState icon="📧" title="No pending emails" message="Gmail sync will surface transactions here for review." />
  );

  const confirm = async (sync) => {
    try {
      const txType = sync.tx_type || "expense";
      const { from_type, to_type } = getTxFromToTypes(txType);
      const catMatch = categories.find(c =>
        c.name?.toLowerCase() === (sync.suggested_category_label || "").toLowerCase()
      );
      const entry = {
        tx_date:         sync.transaction_date || sync.received_at?.slice(0, 10) || todayStr(),
        description:     sync.merchant_name || sync.subject || "Gmail transaction",
        amount:          Number(sync.amount || 0),
        currency:        sync.currency || "IDR",
        amount_idr:      Number(sync.amount_idr || sync.amount || 0),
        tx_type:         txType,
        from_type,
        to_type,
        from_id:         sync.matched_account_id || null,
        to_id:           null,
        category_id:     catMatch?.id || null,
        category_name:   catMatch?.name || null,
        entity:          sync.entity || "Personal",
        notes:           `Imported from Gmail: ${sync.subject || ""}`,
      };
      const created = await ledgerApi.create(user.id, entry, accounts);
      setLedger(p => [created, ...p]);
      await gmailApi.updateSync(sync.id, { status: "confirmed" });
      setPendingSyncs(p => p.filter(s => s.id !== sync.id));
      showToast("Imported");
      onRefresh();
    } catch (e) { showToast(e.message, "error"); }
  };

  const skip = async (sync) => {
    try {
      await gmailApi.updateSync(sync.id, { status: "skipped" });
      setPendingSyncs(p => p.filter(s => s.id !== sync.id));
      showToast("Skipped");
    } catch (e) { showToast(e.message, "error"); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
        {pendingSyncs.length} transaction{pendingSyncs.length !== 1 ? "s" : ""} from Gmail pending review
      </div>
      {pendingSyncs.map(s => (
        <div key={s.id} style={{
          background: "#fef9ec", border: "1.5px solid #fde68a",
          borderRadius: 12, padding: "12px 14px",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
              {s.merchant_name || s.subject || "Gmail transaction"}
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
              {s.transaction_date || s.received_at?.slice(0, 10)}
              {s.amount && ` · ${fmtIDR(s.amount)}`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button onClick={() => confirm(s)} style={BTN_CONFIRM}>✓ Import</button>
            <button onClick={() => skip(s)} style={BTN_SKIP}>Skip</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── STYLES ──────────────────────────────────────────────────
const BTN_PRIMARY = {
  height: 36, padding: "0 14px", borderRadius: 10, border: "none",
  background: "#111827", color: "#fff", fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap", flexShrink: 0,
};

const FILTER_SELECT = {
  height: 32, padding: "0 10px", borderRadius: 8,
  border: "1.5px solid #e5e7eb", background: "#fff",
  fontFamily: "Figtree, sans-serif", fontSize: 12, fontWeight: 500,
  color: "#374151", outline: "none", cursor: "pointer",
  appearance: "none", WebkitAppearance: "none",
};

const ROW_BTN = {
  width: 26, height: 26, borderRadius: 6,
  border: "1px solid #e5e7eb", background: "#f9fafb",
  color: "#9ca3af", fontSize: 11, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "Figtree, sans-serif",
};

const BTN_CONFIRM = {
  height: 30, padding: "0 12px", borderRadius: 8, border: "none",
  background: "#dcfce7", color: "#059669", fontSize: 11, fontWeight: 700,
  cursor: "pointer", fontFamily: "Figtree, sans-serif",
};

const BTN_SKIP = {
  height: 30, padding: "0 10px", borderRadius: 8,
  border: "1px solid #e5e7eb", background: "#fff",
  color: "#9ca3af", fontSize: 11, fontWeight: 600,
  cursor: "pointer", fontFamily: "Figtree, sans-serif",
};
