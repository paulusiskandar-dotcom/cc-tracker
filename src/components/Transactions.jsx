import { useState, useMemo } from "react";
import { ledgerApi, merchantApi, gmailApi, getTxFromToTypes, employeeLoanApi, accountCurrenciesApi, assetsApi } from "../api";
import { EXPENSE_CATEGORIES, ENTITIES, TX_TYPES, TX_TYPE_MAP } from "../constants";
import { fmtIDR, fmtCur, todayStr, ym, toIDR, groupByDate, fmtDateLabel } from "../utils";
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
  // buy_asset extras
  asset_name: "", asset_type: "Investment", asset_mode: "existing", asset_id: null,
  // fx_exchange extras
  fx_direction: "buy", fx_rate_used: "",
};

// ─── MAIN COMPONENT ──────────────────────────────────────────
export default function Transactions({
  user, accounts, ledger, categories, fxRates, CURRENCIES: C,
  bankAccounts, creditCards, assets, liabilities, receivables,
  onRefresh, setLedger, pendingSyncs, setPendingSyncs, incomeSrcs,
  employeeLoans = [], setEmployeeLoans,
  accountCurrencies = [],
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

  const missingTypeCount = useMemo(() => filtered.filter(e => !e.tx_type).length, [filtered]);

  // ── Open add ──
  const openAdd = () => {
    setForm({ ...EMPTY });
    setEditEntry(null);
    setStep(1);
    setModal("add");
  };

  // ── Open edit ──
  const openEdit = (e) => {
    const missingType = !e.tx_type;
    setForm({
      tx_date:         e.tx_date,
      description:     e.description || "",
      amount:          e.amount,
      currency:        e.currency || "IDR",
      tx_type:         e.tx_type || "expense",
      from_id:         e.from_id || null,
      to_id:           e.to_id   || null,
      from_type:       e.from_type || getTxFromToTypes(e.tx_type || "expense").from_type,
      to_type:         e.to_type   || getTxFromToTypes(e.tx_type || "expense").to_type,
      category_id:     e.category_id   || null,
      category_name:   e.category_name || null,
      entity:          e.entity          || "Personal",
      notes:           e.notes           || "",
      is_reimburse:    e.is_reimburse     || false,
    });
    setEditEntry(e);
    setStep(missingType ? 1 : 2);
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
    // Both accounts required (buy_asset only needs from_id + asset_name)
    if (["transfer", "pay_cc", "fx_exchange", "sell_asset", "pay_liability"].includes(type)) {
      if (!form.from_id || !form.to_id) {
        showToast("Both From and To accounts are required", "error");
        return;
      }
    }
    if (type === "buy_asset") {
      if (!form.from_id) { showToast("Select source account", "error"); return; }
      if (form.asset_mode === "existing") {
        if (!form.asset_id) { showToast("Select an asset", "error"); return; }
      } else {
        if (!form.asset_name?.trim()) { showToast("Asset name is required", "error"); return; }
      }
    }
    // FX exchange — handled separately below as early return


    // ── FX Exchange — self-contained early return ──────────────
    if (type === "fx_exchange" && !editEntry) {
      const currency  = form.currency;
      const rate      = Number(form.fx_rate_used || 0);
      const foreignAmt = Number(form.amount || 0);
      const idrAmt    = Math.round(foreignAmt * rate);
      const direction = form.fx_direction || "buy";

      if (!currency || currency === "IDR") { showToast("Select a foreign currency", "error"); return; }
      if (!form.from_id)                   { showToast("Select From account", "error"); return; }
      if (!form.to_id)                     { showToast("Select To account", "error"); return; }
      if (rate <= 0)                       { showToast("Enter a valid rate", "error"); return; }
      if (foreignAmt <= 0)                 { showToast("Enter amount", "error"); return; }

      setSaving(true);
      try {
        const uuidV = (v) => (v && typeof v === "string" && v.length === 36) ? v : null;
        const fromId = uuidV(form.from_id);
        const toId   = uuidV(form.to_id);
        const txDate = form.tx_date || todayStr();
        const notes  = form.notes || null;

        if (direction === "buy") {
          // Debit IDR from From account
          const ledgerEntry = {
            tx_date: txDate, description: `Buy ${currency}`,
            amount: idrAmt, currency: "IDR", amount_idr: idrAmt,
            fx_rate_used: rate,
            tx_type: "fx_exchange", from_type: "account", to_type: "account",
            from_id: fromId, to_id: toId,
            category_id: null, category_name: null, entity: "Personal",
            is_reimburse: false, merchant_name: null, notes,
            attachment_url: null, ai_categorized: false, ai_confidence: null,
            installment_id: null, scan_batch_id: null,
            fx_direction: "buy",
          };
          const created = await ledgerApi.create(user.id, ledgerEntry, accounts);
          setLedger(p => [created, ...p]);
          // Credit foreign currency into To account's pocket
          await accountCurrenciesApi.addBalance(toId, currency, +foreignAmt, user.id);
        } else {
          // Debit foreign currency from From account's pocket
          await accountCurrenciesApi.addBalance(fromId, currency, -foreignAmt, user.id);
          // Credit IDR into To account
          const ledgerEntry = {
            tx_date: txDate, description: `Sell ${currency}`,
            amount: idrAmt, currency: "IDR", amount_idr: idrAmt,
            fx_rate_used: rate,
            tx_type: "fx_exchange", from_type: "account", to_type: "account",
            from_id: fromId, to_id: toId,
            category_id: null, category_name: null, entity: "Personal",
            is_reimburse: false, merchant_name: null, notes,
            attachment_url: null, ai_categorized: false, ai_confidence: null,
            installment_id: null, scan_batch_id: null,
            fx_direction: "sell",
          };
          const created = await ledgerApi.create(user.id, ledgerEntry, accounts);
          setLedger(p => [created, ...p]);
        }
        showToast(`FX ${direction === "buy" ? "Buy" : "Sell"} saved`);
        await onRefresh();
        setModal(null);
      } catch (e) { showToast(e.message, "error"); }
      setSaving(false);
      return;
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

      // ── Buy Asset ──────────────────────────────────────────────
      if (type === "buy_asset" && !editEntry) {
        const price = sn(form.amount);
        const isExisting = form.asset_mode === "existing";
        const assetName = isExisting
          ? (assets.find(a => a.id === form.asset_id)?.name || "Asset Purchase")
          : (form.asset_name?.trim() || "Asset Purchase");

        if (isExisting) {
          // Pass to_id = asset account so ledgerApi.create applies +price to current_value via getDeltas
          const txEntry = {
            tx_date:       form.tx_date || todayStr(),
            description:   assetName,
            amount:        price, currency: "IDR", amount_idr: price,
            tx_type:       "buy_asset", from_type: "account", to_type: "account",
            from_id:       uuid(form.from_id), to_id: uuid(form.asset_id),
            category_id:   null, category_name: null,
            entity:        "Personal", is_reimburse: false,
            merchant_name: null, notes: form.notes || null,
            attachment_url: null, ai_categorized: false, ai_confidence: null,
            installment_id: null, scan_batch_id: null,
          };
          const created = await ledgerApi.create(user.id, txEntry, accounts);
          console.log("[buy_asset] ledger insert:", created?.id, "from_id:", txEntry.from_id, "to_id:", txEntry.to_id, "amount:", price);
          setLedger(p => [created, ...p]);
        } else {
          // New asset — no account to credit, ledger debit only
          const txEntry = {
            tx_date:       form.tx_date || todayStr(),
            description:   assetName,
            amount:        price, currency: "IDR", amount_idr: price,
            tx_type:       "buy_asset", from_type: "account", to_type: "account",
            from_id:       uuid(form.from_id), to_id: null,
            category_id:   null, category_name: null,
            entity:        "Personal", is_reimburse: false,
            merchant_name: null, notes: form.notes || null,
            attachment_url: null, ai_categorized: false, ai_confidence: null,
            installment_id: null, scan_batch_id: null,
          };
          const created = await ledgerApi.create(user.id, txEntry, accounts);
          console.log("[buy_asset] ledger insert (new asset):", created?.id, "amount:", price);
          setLedger(p => [created, ...p]);
          // Create asset record in assets table for tracking
          try {
            const newAsset = await assetsApi.create(user.id, {
              name:           form.asset_name.trim(),
              type:           form.asset_type || "Investment",
              current_value:  price,
              purchase_price: price,
              purchase_date:  form.tx_date || todayStr(),
              notes:          form.notes || null,
            });
            console.log("[buy_asset] asset record created:", newAsset?.id);
          } catch (ae) { console.warn("[buy_asset] asset record create failed:", ae.message); }
        }
        showToast("Asset purchased");
        await onRefresh();
        setModal(null);
        setSaving(false);
        return;
      }

      // ── Sell Asset ─────────────────────────────────────────────
      if (type === "sell_asset" && !editEntry) {
        const sellPrice = sn(form.amount);
        // from_id = asset account (current_value decreases via getDeltas { from: { asset: -a } })
        // to_id   = bank account  (current_balance increases via getDeltas { to: { bank: +a } })
        const txEntry = {
          tx_date:       form.tx_date || todayStr(),
          description:   assets.find(a => a.id === form.from_id)?.name ? `Sell ${assets.find(a => a.id === form.from_id).name}` : "Asset Sale",
          amount:        sellPrice, currency: "IDR", amount_idr: sellPrice,
          tx_type:       "sell_asset", from_type: "account", to_type: "account",
          from_id:       uuid(form.from_id), to_id: uuid(form.to_id),
          category_id:   null, category_name: null,
          entity:        "Personal", is_reimburse: false,
          merchant_name: null, notes: form.notes || null,
          attachment_url: null, ai_categorized: false, ai_confidence: null,
          installment_id: null, scan_batch_id: null,
        };
        const created = await ledgerApi.create(user.id, txEntry, accounts);
        console.log("[sell_asset] ledger insert:", created?.id, "from_id (asset):", txEntry.from_id, "to_id (bank):", txEntry.to_id, "amount:", sellPrice);
        setLedger(p => [created, ...p]);
        // ledgerApi.create already decrements asset current_value via getDeltas
        // No secondary update needed
        showToast("Asset sold");
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

      // For FX exchange, IDR amount = foreign amount × user-entered rate
      let computedAmtIDR = sn(amtIDR);
      let computedFxRate = null;
      if (type === "fx_exchange") {
        const rate = sn(form.fx_rate_used);
        computedFxRate = rate || null;
        if (rate > 0) computedAmtIDR = Math.round(sn(form.amount) * rate);
      }

      // Explicit full entry — every UUID field goes through uuid()
      const entry = {
        tx_date:        form.tx_date || new Date().toISOString().slice(0, 10),
        description,
        amount:         sn(form.amount),
        currency:       form.currency  || "IDR",
        amount_idr:     computedAmtIDR,
        fx_rate_used:   computedFxRate,
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
        // client-only: stripped before DB insert in ledgerApi.create
        fx_direction:   type === "fx_exchange" ? (form.fx_direction || "buy") : undefined,
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
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
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
              display: "flex", alignItems: "center", gap: 5,
            }}>
              {t.label}
              {t.id === "all" && missingTypeCount > 0 && (
                <span style={{
                  background: "#C0392B", color: "#fff",
                  fontSize: 10, fontWeight: 700,
                  padding: "0 5px", borderRadius: 99, lineHeight: "16px",
                  minWidth: 16, textAlign: "center",
                }}>{missingTypeCount}</span>
              )}
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
          {missingTypeCount > 0 && (
            <span style={{
              background: "#fee2e2", color: "#dc2626", fontWeight: 700,
              padding: "2px 7px", borderRadius: 99, fontSize: 11,
            }}>
              ⚠ {missingTypeCount} missing type
            </span>
          )}
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
          step === 1
            ? (modal === "edit" ? "Change Type" : "Add Transaction")
            : (modal === "edit" ? "Edit Transaction" : TYPE_CHOICES.find(t => t.id === form.tx_type)?.label || "Add")
        }
        footer={
          step === 2 && (
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" onClick={() => setStep(1)} style={{ flexShrink: 0 }}>
                ← Back
              </Button>
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
            assets={assets} accountCurrencies={accountCurrencies}
            onChangeType={() => setStep(1)}
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

// ─── TWO-DIRECTIONAL TYPES ────────────────────────────────────
const TWO_DIR_TYPES = new Set([
  "transfer", "pay_cc", "buy_asset", "sell_asset", "fx_exchange",
  "reimburse_out", "reimburse_in", "give_loan", "collect_loan", "pay_liability",
]);

function getTxExpandedContent(e, fromAcc, toAcc) {
  const amtIDR = Number(e.amount_idr || e.amount || 0);
  switch (e.tx_type) {
    case "transfer":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "pay_cc":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "buy_asset":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "sell_asset":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "fx_exchange": {
      const desc = e.description || "";
      const foreignCurrency = desc.split(" ")[1] || "";
      const rate = Number(e.fx_rate_used || 0);
      const isBuy = desc.startsWith("Buy");
      if (isBuy && foreignCurrency && rate > 0) {
        const foreignAmt = Math.round((amtIDR / rate) * 100) / 100;
        return { label: toAcc?.name || "?", amount: `+${fmtCur(foreignAmt, foreignCurrency)}`, positive: true };
      }
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    }
    case "reimburse_out": {
      const entityLabel = e.entity && e.entity !== "Personal" ? e.entity : (toAcc?.name || "?");
      return { label: entityLabel, amount: `+${fmtIDR(amtIDR)}`, positive: true };
    }
    case "reimburse_in":
      return { label: fromAcc?.name || "?", amount: `-${fmtIDR(amtIDR)}`, positive: false };
    case "give_loan":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "collect_loan":
      return { label: fromAcc?.name || "?", amount: `-${fmtIDR(amtIDR)}`, positive: false };
    case "pay_liability":
      return { label: toAcc?.name || "?", amount: `-${fmtIDR(amtIDR)}`, positive: false };
    default:
      return null;
  }
}

// ─── TRANSACTION ROW ─────────────────────────────────────────
function TxRow({ entry: e, accounts, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const isTwoDir = TWO_DIR_TYPES.has(e.tx_type);

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

  const expandedContent = isTwoDir ? getTxExpandedContent(e, fromAcc, toAcc) : null;
  const tealLabel = expandedContent?.label || null;
  // indent = icon (36) + gap (12)
  const expandedIndent = 48;

  const catLabel = e.category_name || catDef?.label || null;

  // ── Type badge / missing-type warning ────────────────────────
  const TX_BADGE = {
    expense:       { bg: "#FDE8E8", color: "#C0392B", label: "Expense"       },
    income:        { bg: "#DFF5E8", color: "#1A7A42", label: "Income"        },
    transfer:      { bg: "#E0EAFF", color: "#2255C4", label: "Transfer"      },
    pay_cc:        { bg: "#EDE8FF", color: "#5B2DC4", label: "Pay CC"        },
    buy_asset:     { bg: "#FDE8E8", color: "#C0392B", label: "Buy Asset"     },
    sell_asset:    { bg: "#DFF5E8", color: "#1A7A42", label: "Sell Asset"    },
    fx_exchange:   { bg: "#FFF4DC", color: "#A0620A", label: "FX Exchange"   },
    reimburse_out: { bg: "#FDE8E8", color: "#C0392B", label: "Reimburse Out" },
    reimburse_in:  { bg: "#DFF5E8", color: "#1A7A42", label: "Reimburse In"  },
    give_loan:     { bg: "#FDE8E8", color: "#C0392B", label: "Give Loan"     },
    collect_loan:  { bg: "#DFF5E8", color: "#1A7A42", label: "Collect Loan"  },
    pay_liability: { bg: "#FFE8DC", color: "#A04A0A", label: "Pay Liability" },
  };
  const bdg = e.tx_type ? TX_BADGE[e.tx_type] : null;
  const badgeEl = e.tx_type ? (bdg ? (
    <span key="badge" style={{
      display:       "inline-block",
      fontSize:      10,
      fontWeight:    500,
      lineHeight:    "1",
      padding:       "1px 6px",
      borderRadius:  4,
      background:    bdg.bg,
      color:         bdg.color,
      marginRight:   4,
      verticalAlign: "middle",
      whiteSpace:    "nowrap",
    }}>{bdg.label}</span>
  ) : null) : (
    <span key="badge" style={{
      display:       "inline-block",
      fontSize:      10,
      fontWeight:    500,
      lineHeight:    "1",
      padding:       "1px 6px",
      borderRadius:  4,
      background:    "#FDE8E8",
      color:         "#C0392B",
      marginRight:   4,
      verticalAlign: "middle",
      whiteSpace:    "nowrap",
    }}>! missing type</span>
  );

  const renderMeta = () => {
    if (!isTwoDir || !tealLabel) {
      const accLabel = isMove
        ? `${fromAcc?.name || "?"} → ${toAcc?.name || "?"}`
        : fromAcc?.name || toAcc?.name || "";
      const textStr = [accLabel, catLabel, e.entity && e.entity !== "Personal" ? e.entity : null]
        .filter(Boolean).join(" · ");
      if (!badgeEl && !textStr) return null;
      if (!badgeEl) return textStr;
      return [badgeEl, <span key="txt">{textStr}</span>];
    }

    const tealStyle = {
      color: "#0D9488", cursor: "pointer",
      textDecoration: expanded ? "underline" : "none", fontWeight: 500,
    };
    const handleTealClick = (ev) => { ev.stopPropagation(); setExpanded(x => !x); };
    const tealSpan = <span key="teal" style={tealStyle} onClick={handleTealClick}>{tealLabel}</span>;

    const parts = badgeEl ? [badgeEl] : [];
    if (e.tx_type === "transfer" || e.tx_type === "pay_cc" || e.tx_type === "fx_exchange") {
      parts.push(<span key="arrow">{fromAcc?.name || "?"} → </span>, tealSpan);
    } else {
      const mainAcc = fromAcc?.name || toAcc?.name || "";
      if (mainAcc && mainAcc !== tealLabel) {
        parts.push(<span key="acc">{mainAcc}</span>);
        parts.push(<span key="sep1"> · </span>);
      }
      parts.push(tealSpan);
    }
    if (catLabel) {
      parts.push(<span key="sep2"> · </span>);
      parts.push(<span key="cat">{catLabel}</span>);
    }
    return parts;
  };

  const meta = renderMeta();

  return (
    <div style={{ borderBottom: "1px solid #f9fafb" }}>
      {/* ── Main row ── */}
      <div
        onClick={onEdit}
        style={{
          display:    "flex",
          alignItems: "center",
          gap:        12,
          padding:    "10px 0",
          cursor:     "pointer",
        }}
      >
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
          <button onClick={ev => { ev.stopPropagation(); onEdit(); }} style={ROW_BTN}>✎</button>
          <button onClick={ev => { ev.stopPropagation(); onDelete(); }} style={{ ...ROW_BTN, color: "#dc2626", borderColor: "#fecaca" }}>✕</button>
        </div>
      </div>

      {/* ── Expanded row ── */}
      {isTwoDir && expandedContent && (
        <div style={{
          overflow:   "hidden",
          maxHeight:  expanded ? "48px" : "0px",
          transition: "max-height 0.2s ease",
        }}>
          <div style={{
            paddingLeft:   expandedIndent,
            paddingRight:  8,
            paddingBottom: 8,
            paddingTop:    2,
            display:       "flex",
            alignItems:    "center",
            justifyContent:"space-between",
            background:    "#f9fafb",
            borderRadius:  "0 0 6px 6px",
          }}>
            <span style={{
              fontSize:    12,
              color:       "#9ca3af",
              fontFamily:  "Figtree, sans-serif",
              overflow:    "hidden",
              textOverflow:"ellipsis",
              whiteSpace:  "nowrap",
            }}>
              {expandedContent.label}
            </span>
            <span style={{
              fontSize:   12,
              fontWeight: 600,
              color:      expandedContent.positive ? "#059669" : "#dc2626",
              fontFamily: "Figtree, sans-serif",
              flexShrink: 0,
              marginLeft: 12,
            }}>
              {expandedContent.amount}
            </span>
          </div>
        </div>
      )}
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

// ─── BUY ASSET FORM ──────────────────────────────────────────
const ASSET_TYPES = ["Property", "Vehicle", "Investment", "Crypto", "Collectible", "Other"];

function BuyAssetForm({ form, set, accounts, assets = [] }) {
  const INP = {
    width: "100%", height: 44, padding: "0 14px",
    border: "1.5px solid #e5e7eb", borderRadius: 10,
    fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 500,
    color: "#111827", background: "#fff", outline: "none",
    appearance: "none", WebkitAppearance: "none", boxSizing: "border-box",
  };
  const bankAccs  = accounts.filter(a => a.is_active !== false && (a.type === "bank" || a.type === "credit_card")).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const assetAccs = assets.filter(a => a.is_active !== false).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const mode = form.asset_mode || (assetAccs.length > 0 ? "existing" : "new");

  const handleAssetSelect = (id) => {
    set("asset_id", id || null);
    const a = assetAccs.find(x => x.id === id);
    if (a) {
      set("asset_name", a.name);
      set("asset_type", a.subtype || a.type || "Investment");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 8 }}>
        {["existing", "new"].map(m => (
          <button key={m} onClick={() => { set("asset_mode", m); set("asset_id", null); set("asset_name", ""); }}
            style={{
              flex: 1, height: 36, borderRadius: 8, border: "1.5px solid",
              borderColor: mode === m ? "#3b5bdb" : "#e5e7eb",
              background: mode === m ? "#eff3ff" : "#fff",
              color: mode === m ? "#3b5bdb" : "#6b7280",
              fontFamily: "Figtree, sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>
            {m === "existing" ? "Existing Asset" : "New Asset"}
          </button>
        ))}
      </div>

      {/* From account */}
      <Field label="From Account">
        <select value={form.from_id || ""} onChange={e => set("from_id", e.target.value || null)} style={INP}>
          <option value="">Select account…</option>
          {bankAccs.map(a => <option key={a.id} value={a.id}>{a.name}{a.bank_name && a.bank_name !== a.name ? ` · ${a.bank_name}` : ""}</option>)}
        </select>
      </Field>

      {mode === "existing" ? (
        <>
          <Field label="Asset *">
            <select value={form.asset_id || ""} onChange={e => handleAssetSelect(e.target.value || null)} style={INP}>
              <option value="">Select asset…</option>
              {assetAccs.map(a => <option key={a.id} value={a.id}>{a.name}{a.subtype ? ` · ${a.subtype}` : a.type ? ` · ${a.type}` : ""}</option>)}
            </select>
          </Field>
          {form.asset_id && (() => {
            const a = assetAccs.find(x => x.id === form.asset_id);
            return a?.current_value > 0 ? (
              <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#6b7280" }}>
                Current value: <strong style={{ color: "#111827" }}>Rp {Number(a.current_value).toLocaleString("id-ID")}</strong>
              </div>
            ) : null;
          })()}
        </>
      ) : (
        <>
          <Input label="Asset Name *" value={form.asset_name || ""} onChange={e => set("asset_name", e.target.value)} placeholder="e.g. Apartment Kemang, BCA Stock" />
          <Field label="Asset Type">
            <select value={form.asset_type || "Investment"} onChange={e => set("asset_type", e.target.value)} style={INP}>
              {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </>
      )}

      {/* Purchase price */}
      <AmountInput label={mode === "existing" ? "Amount to Add (IDR)" : "Purchase Price (IDR)"} value={form.amount} onChange={v => set("amount", v)} />
      {/* Notes */}
      <Field label="Notes (optional)">
        <textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)} placeholder="Any details…" rows={2}
          style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 500, color: "#111827", background: "#fff", outline: "none", resize: "vertical", boxSizing: "border-box" }} />
      </Field>
    </div>
  );
}

// ─── SELL ASSET FORM ─────────────────────────────────────────
function SellAssetForm({ form, set, accounts, assets = [] }) {
  const INP = {
    width: "100%", height: 44, padding: "0 14px",
    border: "1.5px solid #e5e7eb", borderRadius: 10,
    fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 500,
    color: "#111827", background: "#fff", outline: "none",
    appearance: "none", WebkitAppearance: "none", boxSizing: "border-box",
  };
  const bankAccs  = accounts.filter(a => a.is_active !== false && a.type === "bank").sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const assetAccs = assets.filter(a => a.is_active !== false).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const selectedAsset = assetAccs.find(a => a.id === form.from_id);
  const purchasePrice = Number(selectedAsset?.purchase_price || selectedAsset?.current_value || 0);
  const sellPrice     = Number(form.amount || 0);
  const pl            = purchasePrice > 0 && sellPrice > 0 ? sellPrice - purchasePrice : null;
  const plColor       = pl === null ? "#9ca3af" : pl >= 0 ? "#059669" : "#dc2626";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Asset selector */}
      <Field label="Asset">
        <select value={form.from_id || ""} onChange={e => set("from_id", e.target.value || null)} style={INP}>
          <option value="">Select asset…</option>
          {assetAccs.map(a => <option key={a.id} value={a.id}>{a.name}{a.subtype ? ` · ${a.subtype}` : ""}</option>)}
        </select>
      </Field>
      {/* To account */}
      <Field label="To Account (receive funds)">
        <select value={form.to_id || ""} onChange={e => set("to_id", e.target.value || null)} style={INP}>
          <option value="">Select account…</option>
          {bankAccs.map(a => <option key={a.id} value={a.id}>{a.name}{a.bank_name && a.bank_name !== a.name ? ` · ${a.bank_name}` : ""}</option>)}
        </select>
      </Field>
      {/* Sell price */}
      <AmountInput label="Sell Price (IDR)" value={form.amount} onChange={v => set("amount", v)} />
      {/* P/L display */}
      {selectedAsset && sellPrice > 0 && (
        <div style={{ background: pl !== null && pl >= 0 ? "#f0fdf4" : "#fff5f5", border: `1px solid ${plColor}33`, borderRadius: 10, padding: "10px 14px", display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", fontFamily: "Figtree, sans-serif" }}>Purchase Price</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>{purchasePrice > 0 ? `Rp ${purchasePrice.toLocaleString("id-ID")}` : "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", fontFamily: "Figtree, sans-serif" }}>Sell Price</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>Rp {sellPrice.toLocaleString("id-ID")}</div>
          </div>
          {pl !== null && (
            <div>
              <div style={{ fontSize: 9, color: plColor, fontWeight: 700, textTransform: "uppercase", fontFamily: "Figtree, sans-serif" }}>{pl >= 0 ? "Gain" : "Loss"}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: plColor, fontFamily: "Figtree, sans-serif" }}>{pl >= 0 ? "+" : ""}Rp {Math.abs(pl).toLocaleString("id-ID")}</div>
            </div>
          )}
        </div>
      )}
      {/* Notes */}
      <Field label="Notes (optional)">
        <textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)} placeholder="Any details…" rows={2}
          style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 500, color: "#111827", background: "#fff", outline: "none", resize: "vertical", boxSizing: "border-box" }} />
      </Field>
    </div>
  );
}

// ─── FX EXCHANGE FORM ────────────────────────────────────────
function FxExchangeForm({ form, set, accounts, accountCurrencies = [], allCurrencies = [] }) {
  const INP = {
    width: "100%", height: 44, padding: "0 14px",
    border: "1.5px solid #e5e7eb", borderRadius: 10,
    fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 500,
    color: "#111827", background: "#fff", outline: "none",
    appearance: "none", WebkitAppearance: "none", boxSizing: "border-box",
  };

  const direction = form.fx_direction || "buy";
  const currency  = form.currency && form.currency !== "IDR" ? form.currency : null;
  const rate      = Number(form.fx_rate_used || 0);
  const foreignAmt = Number(form.amount || 0);
  const idrEquiv  = rate > 0 && foreignAmt > 0 ? Math.round(foreignAmt * rate) : null;

  // Unique non-IDR currencies from account_currencies
  const fxCurrencies = [...new Set(
    accountCurrencies
      .map(r => r.currency)
      .filter(c => c && c !== "IDR")
  )].sort();

  // All bank accounts as From (IDR source for Buy, any account for Sell)
  const bankAccs = accounts
    .filter(a => a.is_active !== false && (a.type === "bank" || a.type === "credit_card"))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  // To accounts: filtered by selected currency
  // Buy: only accounts that have the chosen currency in account_currencies
  // Sell: bank accounts (to receive IDR)
  const accountsWithCurrency = currency
    ? accountCurrencies.filter(r => r.currency === currency).map(r => r.account_id)
    : [];
  const toAccounts = direction === "buy"
    ? accounts.filter(a => a.is_active !== false && accountsWithCurrency.includes(a.id))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    : bankAccs.filter(a => a.type === "bank");

  // From accounts for Sell: only accounts that hold the chosen currency
  const fromAccounts = direction === "sell" && currency
    ? accounts.filter(a => a.is_active !== false && accountsWithCurrency.includes(a.id))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    : bankAccs;

  const accLabel = a => a.name + (a.bank_name && a.bank_name !== a.name ? ` · ${a.bank_name}` : "");

  const handleDirectionChange = (d) => {
    set("fx_direction", d);
    set("from_id", null);
    set("to_id", null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Direction toggle */}
      <div style={{ display: "flex", gap: 8 }}>
        {["buy", "sell"].map(d => (
          <button key={d} type="button" onClick={() => handleDirectionChange(d)}
            style={{
              flex: 1, height: 36, borderRadius: 8, border: "1.5px solid",
              borderColor: direction === d ? "#0891b2" : "#e5e7eb",
              background: direction === d ? "#e0f2fe" : "#fff",
              color: direction === d ? "#0891b2" : "#6b7280",
              fontFamily: "Figtree, sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}>
            {d === "buy" ? "Buy Foreign" : "Sell Foreign"}
          </button>
        ))}
      </div>

      {/* Date */}
      <Input label="Date" type="date" value={form.tx_date} onChange={e => set("tx_date", e.target.value)} />

      {/* Currency */}
      <Field label="Currency *">
        <select value={form.currency || ""} onChange={e => { set("currency", e.target.value); set("from_id", null); set("to_id", null); }} style={INP}>
          <option value="">Select currency…</option>
          {fxCurrencies.map(c => {
            const meta = allCurrencies.find(x => x.code === c);
            return <option key={c} value={c}>{meta?.flag ? `${meta.flag} ` : ""}{c}</option>;
          })}
          {/* also show currencies from allCurrencies not already listed */}
          {allCurrencies.filter(c => c.code !== "IDR" && !fxCurrencies.includes(c.code)).map(c => (
            <option key={c.code} value={c.code}>{c.flag ? `${c.flag} ` : ""}{c.code}</option>
          ))}
        </select>
      </Field>

      {/* From account */}
      <Field label={direction === "buy" ? "From Account (IDR) *" : "From Account (foreign) *"}>
        <select value={form.from_id || ""} onChange={e => set("from_id", e.target.value || null)} style={INP}>
          <option value="">Select account…</option>
          {fromAccounts.map(a => {
            const pocket = direction === "sell" && currency
              ? accountCurrencies.find(r => r.account_id === a.id && r.currency === currency)
              : null;
            const suffix = pocket ? ` — ${currency} ${Number(pocket.balance).toLocaleString("id-ID")}` : "";
            return <option key={a.id} value={a.id}>{accLabel(a)}{suffix}</option>;
          })}
        </select>
      </Field>

      {/* To account */}
      <Field label={direction === "buy" ? "To Account (receives foreign) *" : "To Account (receives IDR) *"}>
        <select value={form.to_id || ""} onChange={e => set("to_id", e.target.value || null)} style={INP}>
          <option value="">Select account…</option>
          {toAccounts.length > 0 ? toAccounts.map(a => <option key={a.id} value={a.id}>{accLabel(a)}</option>) : (
            direction === "buy" && currency
              ? <option disabled value="">No accounts hold {currency} yet — add one in Accounts</option>
              : null
          )}
        </select>
      </Field>

      {/* Rate */}
      <Input label={`Rate: 1 ${currency || "foreign"} = ? IDR *`} type="number" min="0" step="any"
        value={form.fx_rate_used || ""}
        onChange={e => set("fx_rate_used", e.target.value)}
        placeholder="e.g. 107.5" />

      {/* Amount (foreign units) */}
      <Input label={`Amount (${currency || "foreign units"}) *`} type="number" min="0" step="any"
        value={form.amount || ""}
        onChange={e => set("amount", e.target.value)}
        placeholder="0" />

      {/* IDR equivalent */}
      {idrEquiv !== null && (
        <div style={{
          background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10,
          padding: "10px 14px", fontSize: 13, color: "#0369a1", fontWeight: 600,
          fontFamily: "Figtree, sans-serif",
        }}>
          IDR equivalent: {fmtIDR(idrEquiv)}
        </div>
      )}

      {/* Notes */}
      <Field label="Notes (optional)">
        <textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)}
          placeholder="Any details…" rows={2}
          style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 500, color: "#111827", background: "#fff", outline: "none", resize: "vertical", boxSizing: "border-box" }} />
      </Field>
    </div>
  );
}

// ─── TRANSACTION FORM ────────────────────────────────────────
function TxForm({ form, set, fromOptions, toOptions, accounts, categories, incomeSrcs = [], allCurrencies = [], amtIDR, receivables = [], assets = [], accountCurrencies = [], onChangeType }) {
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
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map(a => ({ value: a.id, label: accLabel(a) }));

  const toOpts = toOptions
    .filter(a => a.id && a.id.length === 36)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map(a => ({
      value: a.id,
      label: a.type === "credit_card"
        ? `${a.name}${(a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : ""}`
        : accLabel(a),
    }));

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

      {/* Type badge — clickable to change type */}
      <button
        type="button"
        onClick={onChangeType}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 10px", borderRadius: 20,
          background: (TYPE_CHOICES.find(t => t.id === type)?.color || "#9ca3af") + "18",
          border: `1.5px solid ${(TYPE_CHOICES.find(t => t.id === type)?.color || "#9ca3af")}33`,
          cursor: onChangeType ? "pointer" : "default",
          width: "fit-content",
        }}
      >
        <span style={{ fontSize: 14 }}>{TYPE_CHOICES.find(t => t.id === type)?.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
          {TYPE_CHOICES.find(t => t.id === type)?.label}
        </span>
        {onChangeType && (
          <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginLeft: 2 }}>
            ✎
          </span>
        )}
      </button>

      {/* Date — hidden for fx_exchange (handled inside FxExchangeForm) */}
      {type !== "fx_exchange" && (
        <Input label="Date" type="date" value={form.tx_date} onChange={e => set("tx_date", e.target.value)} />
      )}

      {/* ── FX EXCHANGE form ────────────────────────────────────── */}
      {type === "fx_exchange" && <FxExchangeForm form={form} set={set} accounts={accounts} accountCurrencies={accountCurrencies} allCurrencies={allCurrencies} />}

      {/* ── BUY ASSET form ──────────────────────────────────────── */}
      {type === "buy_asset" && <BuyAssetForm form={form} set={set} accounts={accounts} assets={assets} />}

      {/* ── SELL ASSET form ─────────────────────────────────────── */}
      {type === "sell_asset" && <SellAssetForm form={form} set={set} accounts={accounts} assets={assets} />}

      {/* Description — skip for buy/sell asset (handled inside their forms) */}
      {!["transfer","pay_cc","reimburse_in","collect_loan","pay_liability","fx_exchange","buy_asset","sell_asset"].includes(type) && (
        <Input
          label="Description"
          value={form.description}
          onChange={e => set("description", e.target.value)}
          placeholder={type === "income" ? "e.g. Monthly salary" : "e.g. Lunch at Warung Makan"}
        />
      )}
      {["transfer","pay_cc"].includes(type) && (
        <Input
          label="Notes / Reference (optional)"
          value={form.description}
          onChange={e => set("description", e.target.value)}
          placeholder="Optional"
        />
      )}

      {/* Amount + Currency — hidden for buy/sell asset and fx_exchange (their own forms handle it) */}
      {!["buy_asset","sell_asset","fx_exchange"].includes(type) && <>
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
      </>}

      {/* Give Loan — employee details (before From Account) */}
      {type === "give_loan" && (
        <Input
          label="Employee Name *"
          value={form.employee_name || ""}
          onChange={e => set("employee_name", e.target.value)}
          placeholder="Full name"
        />
      )}

      {/* FROM ACCOUNT — grouped dropdown (hidden for buy/sell asset and fx_exchange) */}
      {hasTwoStep && !["buy_asset","sell_asset","fx_exchange"].includes(type) && (() => {
        // Types that allow both Bank AND CC as source
        const showBothGroups = ["expense", "reimburse_out", "buy_asset"].includes(type);
        const byName  = (a, b) => (a.name || "").localeCompare(b.name || "");
        const allBank = bankAccs.filter(a => a.id && a.id.length === 36);
        const bankGrp = allBank.filter(a => a.subtype !== "cash").sort(byName);
        const cashGrp = allBank.filter(a => a.subtype === "cash").sort(byName);
        const ccGrp   = ccAccs.filter(a => a.id && a.id.length === 36).sort(byName);
        return (
          <Field label={type === "give_loan" ? "From Bank Account" : "From Account"}>
            <select
              value={form.from_id || ""}
              onChange={e => set("from_id", e.target.value.length === 36 ? e.target.value : null)}
              style={SEL_STYLE}
            >
              <option value="">Select account…</option>
              {bankGrp.length > 0 && (
                <optgroup label="BANK">
                  {bankGrp.map(a => <option key={a.id} value={a.id}>{accLabel(a)}</option>)}
                </optgroup>
              )}
              {cashGrp.length > 0 && (
                <optgroup label="CASH">
                  {cashGrp.map(a => <option key={a.id} value={a.id}>{accLabel(a)}</option>)}
                </optgroup>
              )}
              {showBothGroups && ccGrp.length > 0 && (
                <optgroup label="CREDIT CARDS">
                  {ccGrp.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name}{(a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
        );
      })()}

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

      {/* FROM ACCOUNT — regular select for non-two-step types (sell_asset and fx_exchange handled inside their own forms) */}
      {!hasTwoStep && fromOptions.length > 0 && !["buy_asset","sell_asset","fx_exchange"].includes(type) && (
        <Select
          label={(type === "collect_loan" || type === "reimburse_in") ? "Receivable" : "From Account"}
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

      {/* TO ACCOUNT — skip for reimburse_out, give_loan, buy/sell asset, fx_exchange */}
      {needsTo && !["buy_asset","sell_asset","fx_exchange"].includes(type) && (
        <Select
          label={type === "give_loan" ? "Receivable" : type === "pay_cc" ? "Credit Card" : type === "pay_liability" ? "Liability" : "To Account"}
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

      {/* Pay CC fees */}
      {type === "pay_cc" && (
        <FormRow>
          <AmountInput label="Admin Fee (optional)" value={form.admin_fee || ""} onChange={v => set("admin_fee", v)} style={{ flex: 1 }} />
          <AmountInput label="Stamp Duty (optional)" value={form.stamp_duty || ""} onChange={v => set("stamp_duty", v)} style={{ flex: 1 }} />
        </FormRow>
      )}

      {/* Transfer fee */}
      {type === "transfer" && (
        <AmountInput label="Transfer Fee (optional)" value={form.transfer_fee || ""} onChange={v => set("transfer_fee", v)} />
      )}

      {/* Notes — hidden for buy/sell asset and fx_exchange (handled inside their forms) */}
      {!["buy_asset","sell_asset","fx_exchange"].includes(type) && (
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
      )}

    </div>
  );
}

// ─── PENDING TAB ─────────────────────────────────────────────
function PendingTab({ pendingSyncs, setPendingSyncs, accounts, categories, user, ledger, setLedger, onRefresh }) {
  const [checked,   setChecked]   = useState(() => new Set((pendingSyncs || []).map(s => s.id)));
  const [importing, setImporting] = useState(false);
  const [progress,  setProgress]  = useState({ done: 0, total: 0 });

  if (!pendingSyncs?.length) return (
    <EmptyState icon="📧" title="No pending emails" message="Gmail sync will surface transactions here for review." />
  );

  const selectedSyncs = pendingSyncs.filter(s => checked.has(s.id));
  const allChecked    = selectedSyncs.length === pendingSyncs.length && pendingSyncs.length > 0;

  const buildEntry = (sync) => {
    const txType = sync.tx_type || "expense";
    const { from_type, to_type } = getTxFromToTypes(txType);
    const catMatch = categories.find(c =>
      c.name?.toLowerCase() === (sync.suggested_category_label || "").toLowerCase()
    );
    return {
      tx_date:       sync.transaction_date || sync.received_at?.slice(0, 10) || todayStr(),
      description:   sync.merchant_name || sync.subject || "Gmail transaction",
      amount:        Number(sync.amount || 0),
      currency:      sync.currency || "IDR",
      amount_idr:    Number(sync.amount_idr || sync.amount || 0),
      tx_type:       txType, from_type, to_type,
      from_id:       sync.matched_account_id || null,
      to_id:         null,
      category_id:   catMatch?.id || null,
      category_name: catMatch?.name || null,
      entity:        sync.entity || "Personal",
      notes:         `Imported from Gmail: ${sync.subject || ""}`,
    };
  };

  const removeOne = (id) => {
    setPendingSyncs(p => p.filter(s => s.id !== id));
    setChecked(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const confirm = async (sync) => {
    try {
      const created = await ledgerApi.create(user.id, buildEntry(sync), accounts);
      setLedger(p => [created, ...p]);
      await gmailApi.updateSync(sync.id, { status: "confirmed" });
      removeOne(sync.id);
      showToast("Imported");
      onRefresh();
    } catch (e) { showToast(e.message, "error"); }
  };

  const skip = async (sync) => {
    try {
      await gmailApi.updateSync(sync.id, { status: "skipped" });
      removeOne(sync.id);
      showToast("Skipped");
    } catch (e) { showToast(e.message, "error"); }
  };

  const importAll = async () => {
    const toImport = [...selectedSyncs];
    if (!toImport.length) return;
    setImporting(true);
    setProgress({ done: 0, total: toImport.length });
    let count = 0;
    for (const sync of toImport) {
      try {
        const created = await ledgerApi.create(user.id, buildEntry(sync), accounts);
        setLedger(p => [created, ...p]);
        await gmailApi.updateSync(sync.id, { status: "confirmed" });
        setPendingSyncs(p => p.filter(s => s.id !== sync.id));
        setChecked(prev => { const n = new Set(prev); n.delete(sync.id); return n; });
        count++;
        setProgress({ done: count, total: toImport.length });
      } catch (_) { /* skip failures, continue */ }
    }
    setImporting(false);
    showToast(`${count} transaction${count !== 1 ? "s" : ""} imported`);
    onRefresh();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* ── Bulk action bar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 14px", background: "#ffffff",
        border: "0.5px solid #e5e7eb", borderRadius: 12,
      }}>
        <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif", flex: 1 }}>
          {importing
            ? `Importing ${progress.done} of ${progress.total}…`
            : `${selectedSyncs.length} of ${pendingSyncs.length} selected`}
        </span>
        <button
          onClick={() => setChecked(allChecked ? new Set() : new Set(pendingSyncs.map(s => s.id)))}
          disabled={importing}
          style={{ height: 28, padding: "0 10px", border: "1px solid #e5e7eb", borderRadius: 7, cursor: "pointer", background: "#fff", color: "#6b7280", fontSize: 11, fontWeight: 600, fontFamily: "Figtree, sans-serif" }}
        >
          {allChecked ? "Deselect All" : "Select All"}
        </button>
        <button
          onClick={importAll}
          disabled={importing || !selectedSyncs.length}
          style={{
            height: 28, padding: "0 12px", border: "none", borderRadius: 7,
            cursor: importing || !selectedSyncs.length ? "not-allowed" : "pointer",
            background: !importing && selectedSyncs.length ? "#111827" : "#e5e7eb",
            color:      !importing && selectedSyncs.length ? "#fff"     : "#9ca3af",
            fontSize: 11, fontWeight: 700, fontFamily: "Figtree, sans-serif",
          }}
        >
          Import All Selected ▶
        </button>
      </div>

      {/* ── Transaction rows ── */}
      {pendingSyncs.map(s => (
        <div key={s.id} style={{
          background: "#fef9ec", border: "1.5px solid #fde68a",
          borderRadius: 12, padding: "12px 14px",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <input
            type="checkbox"
            checked={checked.has(s.id)}
            onChange={() => setChecked(prev => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
            disabled={importing}
            style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#111827", flexShrink: 0 }}
          />
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
            <button onClick={() => confirm(s)} disabled={importing} style={{ ...BTN_CONFIRM, opacity: importing ? 0.5 : 1 }}>✓</button>
            <button onClick={() => skip(s)}    disabled={importing} style={{ ...BTN_SKIP,    opacity: importing ? 0.5 : 1 }}>Skip</button>
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
