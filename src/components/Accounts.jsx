import { useState, useMemo } from "react";
import { accountsApi, accountCurrenciesApi, ledgerApi, getTxFromToTypes } from "../api";
import {
  BANKS_L, NETWORKS, ASSET_SUBTYPES, LIAB_SUBTYPES,
  ACC_TYPE_LABEL, ACC_TYPE_ICON,
} from "../constants";
import { fmtIDR, fmtCur } from "../utils";
import Modal, { ConfirmModal } from "./shared/Modal";
import Button from "./shared/Button";
import Input, { Field, AmountInput, FormRow } from "./shared/Input";
import Select from "./shared/Select";
import { EmptyState, showToast } from "./shared/Card";

const MULTICURRENCY_BANKS = ["BCA", "OCBC", "Jenius", "Danamon"];

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
  { id: "cash",        label: "Cash" },
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
  setAccounts, setAccountCurrencies, accountCurrencies = [], CURRENCIES = [], fxRates = {},
}) {
  const [subTab,   setSubTab]   = useState("all");
  const [modal,    setModal]    = useState(null); // null | "add" | "edit" | "history" | "delete" | "updateNilai"
  const [step,     setStep]     = useState(1);
  const [formType, setFormType] = useState("bank");
  const [editAcc,  setEditAcc]  = useState(null);
  const [form,     setForm]     = useState({});
  const [saving,   setSaving]   = useState(false);
  const [histAcc,  setHistAcc]  = useState(null);
  const [deleteAcc, setDeleteAcc] = useState(null);
  // PT Investment "Update Nilai"
  const [nilaiAcc,  setNilaiAcc]  = useState(null);
  const [nilaiForm, setNilaiForm] = useState({ value: "", date: "", notes: "" });
  const [nilaiSaving, setNilaiSaving] = useState(false);

  // ─── FILTERED ACCOUNTS ──────────────────────────────────────
  const filtered = useMemo(() => {
    if (subTab === "all") return accounts;
    if (subTab === "cash") return accounts.filter(a => a.type === "bank" && a.subtype === "cash");
    if (subTab === "bank") return accounts.filter(a => a.type === "bank" && a.subtype !== "cash");
    return accounts.filter(a => a.type === subTab);
  }, [accounts, subTab]);

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
                  .reduce((s, a) => s + Number(a.receivable_outstanding || 0), 0),
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
    const ft = (a.type === "bank" && a.subtype === "cash") ? "cash" : a.type;
    setFormType(ft);
    const fxBalances = accountCurrencies
      .filter(r => r.account_id === a.id)
      .map(r => ({ currency: r.currency, balance: r.balance }));
    setForm({ ...a, fxBalances });
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
      const { fxBalances: _fb, ...formWithoutFx } = form;
      const clean = {
        ...formWithoutFx,
        current_balance:    sn(form.current_balance),
        initial_balance:    sn(form.initial_balance),
        current_value:      sn(form.current_value),
        purchase_price:     sn(form.purchase_price),
        card_limit:         sn(form.card_limit),
        monthly_target:     sn(form.monthly_target),
        statement_day:      sn(form.statement_day),
        due_day:            sn(form.due_day),
        outstanding_amount:    sn(form.outstanding_amount),
        receivable_outstanding: sn(form.receivable_outstanding),
        total_amount:    sn(form.total_amount),
        monthly_payment:    sn(form.monthly_payment),
        liability_interest_rate: sn(form.liability_interest_rate),
        interest_rate:      sn(form.interest_rate),
        monthly_installment:sn(form.monthly_installment),
        receivable_total:  sn(form.receivable_total),
        sort_order:         sn(form.sort_order),
      };

      let savedAccount;
      if (editAcc) {
        // For cash type, map back to bank; strip entity for non-receivable
        let updateData = formType === "cash"
          ? { ...clean, type: "bank", subtype: "cash" }
          : { ...clean };
        if (formType !== "receivable") updateData.entity = null;
        savedAccount = await accountsApi.update(editAcc.id, updateData);
        setAccounts(p => p.map(a => a.id === editAcc.id ? savedAccount : a));
        showToast("Account updated");
      } else {
        let insertData;
        if (formType === "cash") {
          insertData = {
            name:            form.name?.trim(),
            type:            "bank",
            subtype:         "cash",
            currency:        form.currency || "IDR",
            initial_balance: sn(form.initial_balance),
            current_balance: sn(form.initial_balance),
            entity:          null,
            notes:           form.notes || null,
            include_networth: true,
            is_active:       true,
            sort_order:      accounts.length,
          };
        } else if (formType === "receivable") {
          insertData = {
            name:                   form.name?.trim(),
            type:                   "receivable",
            subtype:                "reimburse",
            entity:                 form.entity || "Hamasa",
            notes:                  form.notes  || null,
            include_networth:       true,
            receivable_outstanding: 0,
            sort_order:             accounts.length,
          };
        } else {
          insertData = { ...clean, type: formType, entity: null, is_active: true, sort_order: accounts.length };
        }
        savedAccount = await accountsApi.create(user.id, insertData);
        setAccounts(p => [...p, savedAccount]);
        showToast("Account created");

        // PT Investment: create buy_asset ledger entry if "Deduct from bank?" is checked
        if (formType === "asset" && form.subtype === "PT Investment" && form.deductFromBank && form.bankDeductId && savedAccount?.id) {
          try {
            const { from_type, to_type } = getTxFromToTypes("buy_asset");
            await ledgerApi.create(user.id, {
              tx_type:     "buy_asset",
              tx_date:     form.purchase_date || new Date().toISOString().slice(0, 10),
              amount:      sn(form.purchase_price),
              amount_idr:  sn(form.purchase_price),
              description: `Invest: ${form.name?.trim()}`,
              from_id:     form.bankDeductId,
              to_id:       savedAccount.id,
              from_type,
              to_type,
            }, accounts);
          } catch (le) { showToast("Account created but ledger entry failed: " + le.message, "error"); }
        }
      }

      // Handle multicurrency fx balances
      if (formType === "bank" && form.is_multicurrency && savedAccount?.id && form.fxBalances?.length) {
        const upserts = form.fxBalances
          .filter(r => r.currency && r.balance !== "" && r.balance !== null)
          .map(r => accountCurrenciesApi.upsert(savedAccount.id, r.currency, Number(r.balance || 0)));
        await Promise.all(upserts);
        const newRows = await accountCurrenciesApi.getForAccount(savedAccount.id);
        setAccountCurrencies(prev => [
          ...prev.filter(r => r.account_id !== savedAccount.id),
          ...newRows,
        ]);
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

  const bankAccountsOnly = useMemo(() => accounts.filter(a => a.type === "bank" && a.subtype !== "cash"), [accounts]);
  const bankAccounts = useMemo(() => accounts.filter(a => a.type === "bank"), [accounts]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ─── UPDATE NILAI (PT Investment) ────────────────────────────
  const openUpdateNilai = (acc) => {
    setNilaiAcc(acc);
    setNilaiForm({ value: String(acc.current_value || ""), date: new Date().toISOString().slice(0, 10), notes: "" });
    setModal("updateNilai");
  };

  const saveNilai = async () => {
    if (!nilaiAcc) return;
    const newValue = Number(nilaiForm.value) || 0;
    setNilaiSaving(true);
    try {
      const updated = await accountsApi.update(nilaiAcc.id, { current_value: newValue });
      setAccounts(p => p.map(a => a.id === nilaiAcc.id ? updated : a));
      showToast("Nilai updated");
      setModal(null);
    } catch (e) { showToast(e.message, "error"); }
    setNilaiSaving(false);
  };

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
              accountCurrencies={accountCurrencies}
              fxRates={fxRates}
              onEdit={() => openEdit(a)}
              onDelete={() => setDeleteAcc(a)}
              onHistory={() => { setHistAcc(a); setModal("history"); }}
              onUpdateNilai={() => openUpdateNilai(a)}
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
            ? `Edit — ${formType === "cash" ? "Cash Account" : ACC_TYPE_LABEL[formType]}`
            : step === 1
              ? "Add Account"
              : `New ${formType === "cash" ? "Cash Account" : ACC_TYPE_LABEL[formType]}`
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
                { id: "cash",        icon: "💵", label: "Cash",          bg: "#f0fdf4", color: "#059669" },
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

      {/* ── UPDATE NILAI MODAL (PT Investment) ── */}
      <Modal
        isOpen={modal === "updateNilai"}
        onClose={() => setModal(null)}
        title="Update Nilai Investasi"
        footer={
          <Button fullWidth onClick={saveNilai} busy={nilaiSaving}>Update Nilai</Button>
        }
      >
        {nilaiAcc && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "#f0f9ff", borderRadius: 10, padding: "10px 14px", fontFamily: "Figtree, sans-serif" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{nilaiAcc.name}</div>
              {nilaiAcc.interest_rate > 0 && (
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                  Kepemilikan {nilaiAcc.interest_rate}% · Modal {fmtIDR(Number(nilaiAcc.purchase_price || 0), true)}
                </div>
              )}
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                Nilai sekarang: {fmtIDR(Number(nilaiAcc.current_value || 0), true)}
              </div>
            </div>
            <AmountInput label="Nilai Buku Baru (Rp)" value={nilaiForm.value}
              onChange={v => setNilaiForm(f => ({ ...f, value: v }))} />
            <Input label="Tanggal Update" type="date" value={nilaiForm.date}
              onChange={e => setNilaiForm(f => ({ ...f, date: e.target.value }))} />
            <Input label="Catatan (opsional)" value={nilaiForm.notes}
              onChange={e => setNilaiForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        )}
      </Modal>

    </div>
  );
}

// ─── ACCOUNT CARD ────────────────────────────────────────────
function AccountCard({ account: a, ledger, accounts, accountCurrencies = [], fxRates = {}, onEdit, onDelete, onHistory, onUpdateNilai }) {
  const isCash = a.type === "bank" && a.subtype === "cash";
  const bg    = isCash ? "#f0fdf4" : (TYPE_BG[a.type]    || "#f9fafb");
  const color = isCash ? "#059669" : (TYPE_COLOR[a.type] || "#6b7280");
  const icon  = isCash ? "💵" : (ACC_TYPE_ICON[a.type] || "🏦");
  const txCount = ledger.filter(e => e.from_id === a.id || e.to_id === a.id).length;

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
      const v = Number(a.receivable_outstanding || 0);
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
            {a.type === "receivable" && a.entity && a.entity !== "Personal" && (
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
          {/* Cash non-IDR: show foreign amount + IDR equiv */}
          {isCash && a.currency && a.currency !== "IDR" ? (
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: bal.color, fontFamily: "Figtree, sans-serif", lineHeight: 1.2 }}>
                {fmtCur(Math.abs(bal.value), a.currency)}
              </div>
              <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                ≈ {fmtIDR(Math.abs(bal.value) * (fxRates[a.currency] || 1), true)}
              </div>
            </div>
          ) : a.is_multicurrency ? (
            <div style={{ fontSize: 13, fontWeight: 700, color: "#3b5bdb", fontFamily: "Figtree, sans-serif" }}>
              Multi-currency
            </div>
          ) : (
            <div style={{
              fontSize: 16, fontWeight: 800, color: bal.color,
              fontFamily: "Figtree, sans-serif", lineHeight: 1.2,
            }}>
              {fmtIDR(Math.abs(bal.value))}
            </div>
          )}
          {/* CC utilization % */}
          {a.type === "credit_card" && bal.limit > 0 && (
            <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
              {bal.util?.toFixed(0)}% of {fmtIDR(bal.limit, true)}
            </div>
          )}
        </div>
      </div>

      {/* Multi-currency balance rows */}
      {a.is_multicurrency && (() => {
        const rows = accountCurrencies.filter(r => r.account_id === a.id);
        if (!rows.length) return null;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
            {rows.map(r => (
              <div key={r.currency} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>{r.currency}</span>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                    {fmtCur(r.balance, r.currency)}
                  </span>
                  {r.currency !== "IDR" && (
                    <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginLeft: 4 }}>
                      ≈ {fmtIDR(Number(r.balance || 0) * (fxRates[r.currency] || 1), true)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

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

      {/* Asset gain/loss (non-Deposit, non-PT Investment) */}
      {a.type === "asset" && a.subtype !== "Deposit" && a.subtype !== "PT Investment" && bal.gain !== null && (
        <div style={{
          fontSize: 11, fontWeight: 600,
          color:    bal.gain >= 0 ? "#059669" : "#dc2626",
          fontFamily: "Figtree, sans-serif",
        }}>
          {bal.gain >= 0 ? "▲" : "▼"} {fmtIDR(Math.abs(bal.gain), true)}
          {bal.pct !== null && ` (${bal.pct >= 0 ? "+" : ""}${bal.pct.toFixed(1)}%)`}
        </div>
      )}

      {/* PT Investment details */}
      {a.type === "asset" && a.subtype === "PT Investment" && (() => {
        const capital   = Number(a.purchase_price || 0);
        const bookVal   = Number(a.current_value || 0);
        const ownership = Number(a.interest_rate || 0);
        const since     = a.purchase_date ? new Date(a.purchase_date).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : null;
        const gain      = capital > 0 ? bookVal - capital : null;
        const gainPct   = capital > 0 ? ((bookVal - capital) / capital) * 100 : null;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {ownership > 0 && (
                <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
                  Kepemilikan <strong style={{ color: "#374151" }}>{ownership}%</strong>
                </span>
              )}
              {since && (
                <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
                  Sejak <strong style={{ color: "#374151" }}>{since}</strong>
                </span>
              )}
            </div>
            {capital > 0 && (
              <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
                Modal: {fmtIDR(capital, true)}
                {gain !== null && (
                  <span style={{ marginLeft: 8, fontWeight: 600, color: gain >= 0 ? "#059669" : "#dc2626" }}>
                    {gain >= 0 ? "▲" : "▼"} {fmtIDR(Math.abs(gain), true)}
                    {gainPct !== null && ` (${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}%)`}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Deposit card detail */}
      {a.type === "asset" && a.subtype === "Deposit" && (() => {
        const rate = Number(a.interest_rate || 0);
        const principal = Number(a.current_value || 0);
        const netRate = rate * 0.8;
        const netMonthly = principal * (netRate / 100) / 12;
        const daysLeft = a.end_date
          ? Math.ceil((new Date(a.end_date) - new Date()) / 86400000)
          : null;
        const maturityStr = a.end_date
          ? new Date(a.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : null;
        const rolloverLabel = {
          non_aro: "Non ARO", aro: "ARO", aro_plus: "ARO+",
        }[a.deposit_rollover_type] || a.deposit_rollover_type;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {rate > 0 && (
              <div style={{ fontSize: 11, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
                {rate}% p.a. → Net {netRate.toFixed(2)}% after tax
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {rolloverLabel && (
                <span style={{ fontSize: 10, fontWeight: 700, background: "#dbeafe", color: "#3b5bdb", padding: "2px 7px", borderRadius: 5, fontFamily: "Figtree, sans-serif" }}>
                  {rolloverLabel}
                </span>
              )}
              {a.deposit_status && (
                <span style={{ fontSize: 10, fontWeight: 700, background: "#d1fae5", color: "#059669", padding: "2px 7px", borderRadius: 5, fontFamily: "Figtree, sans-serif" }}>
                  {a.deposit_status}
                </span>
              )}
              {a.monthly_interest_payout && (
                <span style={{ fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#d97706", padding: "2px 7px", borderRadius: 5, fontFamily: "Figtree, sans-serif" }}>
                  Monthly payout
                </span>
              )}
            </div>
            {maturityStr && (
              <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
                Maturity: {maturityStr}
                {daysLeft !== null && (
                  <span style={{ marginLeft: 6, color: daysLeft <= 30 ? "#dc2626" : daysLeft <= 90 ? "#d97706" : "#9ca3af" }}>
                    {daysLeft > 0 ? `⏰ ${daysLeft} days` : "⚠️ Matured"}
                  </span>
                )}
              </div>
            )}
            {netMonthly > 0 && (
              <div style={{ fontSize: 11, fontWeight: 600, color: "#059669", fontFamily: "Figtree, sans-serif" }}>
                Est. net/month: {fmtIDR(netMonthly, true)}
              </div>
            )}
          </div>
        );
      })()}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={onHistory} style={ACTION_BTN}>
          📋 History ({txCount})
        </button>
        {a.type === "asset" && a.subtype === "PT Investment" && (
          <button onClick={onUpdateNilai} style={{ ...ACTION_BTN, background: "#e8f4fd", color: "#3b5bdb", border: "1px solid #bfdbfe" }}>
            📊 Update Nilai
          </button>
        )}
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
    .filter(e => e.from_id === account.id || e.to_id === account.id)
    .slice(0, 50);

  if (entries.length === 0) return (
    <EmptyState icon="📋" message="No transactions for this account yet" />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map(e => {
        const isFrom = e.from_id === account.id;
        const amt    = Number(e.amount_idr || e.amount || 0);
        const other  = accounts.find(a => a.id === (isFrom ? e.to_id : e.from_id));
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
                {e.tx_date}
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

  // FX balance row helpers
  const addFxRow = () => set("fxBalances", [...(form.fxBalances || []), { currency: "USD", balance: "" }]);
  const removeFxRow = (i) => set("fxBalances", (form.fxBalances || []).filter((_, idx) => idx !== i));
  const updateFxRow = (i, key, val) => set("fxBalances", (form.fxBalances || []).map((r, idx) => idx === i ? { ...r, [key]: val } : r));

  // Deposit maturity auto-calc
  const calcMaturity = (startDate, tenorMonths) => {
    if (!startDate || !tenorMonths) return "";
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + Number(tenorMonths));
    return d.toISOString().slice(0, 10);
  };

  const isDeposit = type === "asset" && form.subtype === "Deposit";
  const depositRate = Number(form.interest_rate || 0);
  const depositPrincipal = Number(form.current_value || 0);
  const depositGrossMonthly = depositPrincipal * (depositRate / 100) / 12;
  const depositNetMonthly   = depositGrossMonthly * 0.8;
  const depositNetYield     = depositRate * 0.8;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: FF }}>

      {/* Name — all types */}
      <Input
        label="Account Name"
        value={form.name || ""}
        onChange={e => set("name", e.target.value)}
        placeholder={
          type === "bank"        ? "e.g. BCA Main Account" :
          type === "cash"        ? "e.g. IDR Cash, USD Cash" :
          type === "credit_card" ? "e.g. BCA Platinum" :
          type === "asset"       ? "e.g. Apartemen Sudirman" :
          type === "liability"   ? "e.g. KPR BCA" :
          type === "receivable"  ? "e.g. Reimburse SDC" :
          "Account name"
        }
      />

      {/* CASH */}
      {type === "cash" && <>
        <Select label="Currency" value={form.currency || "IDR"} onChange={e => set("currency", e.target.value)}
          options={C.map(c => ({ value: c.code, label: `${c.flag} ${c.code}` }))} />
        <AmountInput label="Initial Balance" value={form.initial_balance || ""}
          onChange={v => { set("initial_balance", v); set("current_balance", v); }} />
      </>}

      {/* BANK */}
      {type === "bank" && <>
        <Select label="Bank" value={form.bank_name || "BCA"} onChange={e => set("bank_name", e.target.value)}
          options={BANKS_L} />
        <FormRow>
          <Input label="Account No." value={form.account_no || ""} onChange={e => set("account_no", e.target.value)}
            placeholder="Last 4 digits" style={{ flex: 1 }} />
          <Select label="Currency" value={form.currency || "IDR"} onChange={e => set("currency", e.target.value)}
            options={C.map(c => ({ value: c.code, label: `${c.flag} ${c.code}` }))}
            style={{ flex: 1 }} />
        </FormRow>
        <AmountInput label="Initial Balance" value={form.initial_balance || ""}
          onChange={v => { set("initial_balance", v); set("current_balance", v); }} />

        {/* Multi-currency toggle — only for supported banks */}
        {MULTICURRENCY_BANKS.includes(form.bank_name) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" id="is_multi_cur" checked={form.is_multicurrency || false}
              onChange={e => set("is_multicurrency", e.target.checked)}
              style={{ accentColor: "#3b5bdb", width: 16, height: 16 }} />
            <label htmlFor="is_multi_cur" style={{ fontSize: 13, color: "#374151", cursor: "pointer", fontFamily: "Figtree, sans-serif" }}>
              Multi-currency account
            </label>
          </div>
        )}

        {/* FX balance rows */}
        {form.is_multicurrency && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", fontFamily: "Figtree, sans-serif", marginBottom: 8 }}>
              Foreign Currency Balances
            </div>
            {(form.fxBalances || []).map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-end" }}>
                <Select
                  label={i === 0 ? "Currency" : ""}
                  value={row.currency}
                  onChange={e => updateFxRow(i, "currency", e.target.value)}
                  options={C.filter(c => c.code !== "IDR").map(c => ({ value: c.code, label: `${c.flag} ${c.code}` }))}
                  style={{ width: 110 }}
                />
                <AmountInput
                  label={i === 0 ? "Balance" : ""}
                  value={row.balance}
                  onChange={v => updateFxRow(i, "balance", v)}
                  style={{ flex: 1 }}
                />
                <button onClick={() => removeFxRow(i)} style={{
                  border: "none", background: "#fee2e2", color: "#dc2626",
                  borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 13,
                  marginBottom: 0,
                }}>✕</button>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={addFxRow}>+ Add Currency</Button>
          </div>
        )}

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
        <Input label="Last 4 Digits" value={form.last4 || ""} onChange={e => set("last4", e.target.value)}
          placeholder="1234" />
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

      {/* ASSET — common fields */}
      {type === "asset" && <>
        <Select label="Category" value={form.subtype || "Property"} onChange={e => set("subtype", e.target.value)}
          options={ASSET_SUBTYPES} />

        {/* Deposit-specific fields */}
        {isDeposit ? (<>
          <Input label="Bank Name" value={form.bank_name || ""} onChange={e => set("bank_name", e.target.value)}
            placeholder="e.g. BCA" />
          <AmountInput label="Principal (Rp)" value={form.current_value || ""}
            onChange={v => set("current_value", v)} />
          <FormRow>
            <Input label="Interest Rate (% p.a.)" type="number" value={form.interest_rate || ""}
              onChange={e => set("interest_rate", e.target.value)} placeholder="5.5" style={{ flex: 1 }} />
            <Select label="Tenor (months)" value={form.deposit_tenor || "6"}
              onChange={e => {
                set("deposit_tenor", e.target.value);
                const mat = calcMaturity(form.start_date, e.target.value);
                if (mat) set("end_date", mat);
              }}
              options={["1","3","6","9","12","24"].map(v => ({ value: v, label: `${v} months` }))}
              style={{ flex: 1 }} />
          </FormRow>
          <FormRow>
            <Input label="Start Date" type="date" value={form.start_date || ""}
              onChange={e => {
                set("start_date", e.target.value);
                const mat = calcMaturity(e.target.value, form.deposit_tenor || 6);
                if (mat) set("end_date", mat);
              }}
              style={{ flex: 1 }} />
            <Input label="Maturity Date" type="date" value={form.end_date || ""}
              onChange={e => set("end_date", e.target.value)} style={{ flex: 1 }} />
          </FormRow>

          {/* Rollover type */}
          <Field label="Rollover Type">
            <div style={{ display: "flex", gap: 12 }}>
              {[
                { id: "non_aro", label: "Non ARO" },
                { id: "aro",     label: "ARO" },
                { id: "aro_plus",label: "ARO+" },
              ].map(opt => (
                <label key={opt.id} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
                  fontSize: 13, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
                  <input type="radio" name="deposit_rollover"
                    checked={(form.deposit_rollover_type || "non_aro") === opt.id}
                    onChange={() => set("deposit_rollover_type", opt.id)}
                    style={{ accentColor: "#3b5bdb" }} />
                  {opt.label}
                </label>
              ))}
            </div>
          </Field>

          {/* Monthly payout toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" id="monthly_payout" checked={form.monthly_interest_payout || false}
              onChange={e => set("monthly_interest_payout", e.target.checked)}
              style={{ accentColor: "#3b5bdb", width: 16, height: 16 }} />
            <label htmlFor="monthly_payout" style={{ fontSize: 13, color: "#374151", cursor: "pointer", fontFamily: "Figtree, sans-serif" }}>
              Monthly interest payout
            </label>
          </div>

          {/* Auto-calc info box */}
          {depositPrincipal > 0 && depositRate > 0 && (
            <div style={{
              background: "#f0fdf4", borderRadius: 10, padding: "12px 14px",
              border: "1px solid #bbf7d0", fontFamily: "Figtree, sans-serif",
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#059669", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Interest Projection
              </div>
              {[
                ["Monthly gross", fmtIDR(depositGrossMonthly, true)],
                ["PPh 20%", "−" + fmtIDR(depositGrossMonthly * 0.2, true)],
                ["Net monthly", fmtIDR(depositNetMonthly, true)],
                ["Effective yield", depositNetYield.toFixed(2) + "% p.a."],
              ].map(([label, val]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 12, color: "#374151" }}>{label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#059669" }}>{val}</span>
                </div>
              ))}
            </div>
          )}
        </>) : form.subtype === "PT Investment" ? (<>
          {/* PT Investment fields */}
          <Input label="Ownership %" type="number" value={form.interest_rate || ""}
            onChange={e => set("interest_rate", e.target.value)} placeholder="e.g. 30" />
          <AmountInput label="Capital Invested (Rp)" value={form.purchase_price || ""}
            onChange={v => set("purchase_price", v)} />
          <Input label="Investment Date" type="date" value={form.purchase_date || ""}
            onChange={e => set("purchase_date", e.target.value)} />
          <AmountInput label="Current Book Value (Rp)" value={form.current_value || ""}
            onChange={v => set("current_value", v)} />
          {/* Deduct from bank toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" id="deduct_bank" checked={form.deductFromBank || false}
              onChange={e => set("deductFromBank", e.target.checked)}
              style={{ accentColor: "#3b5bdb", width: 16, height: 16 }} />
            <label htmlFor="deduct_bank" style={{ fontSize: 13, color: "#374151", cursor: "pointer", fontFamily: "Figtree, sans-serif" }}>
              Deduct from bank account (creates Buy Asset entry)
            </label>
          </div>
          {form.deductFromBank && (
            <Select
              label="Deduct from Bank"
              value={form.bankDeductId || ""}
              onChange={e => set("bankDeductId", e.target.value)}
              options={[
                { value: "", label: "— select bank —" },
                ...(bankAccounts || []).map(b => ({ value: b.id, label: b.name })),
              ]}
            />
          )}
        </>) : (<>
          {/* Non-deposit, non-PT asset fields */}
          <AmountInput label="Current Value" value={form.current_value || ""}
            onChange={v => set("current_value", v)} />
          <AmountInput label="Purchase Price (optional)" value={form.purchase_price || ""}
            onChange={v => set("purchase_price", v)} />
          <Input label="Purchase Date (optional)" type="date" value={form.purchase_date || ""}
            onChange={e => set("purchase_date", e.target.value)} />
        </>)}
      </>}

      {/* LIABILITY */}
      {type === "liability" && <>
        <Select label="Type" value={form.subtype || "Mortgage"} onChange={e => set("subtype", e.target.value)}
          options={LIAB_SUBTYPES} />
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

      {/* RECEIVABLE — reimburse only (employee loans are managed in Receivables page) */}
      {type === "receivable" && (
        <Select
          label="Entity"
          value={form.entity || "Hamasa"}
          onChange={e => set("entity", e.target.value)}
          options={["Hamasa", "SDC", "Travelio"]}
        />
      )}

      {/* Color picker — bank + CC */}
      {(type === "bank" || type === "credit_card" || type === "cash") && (
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
  const base = { name: "", color: "#3b5bdb", notes: "", is_active: true };
  switch (type) {
    case "bank":        return { ...base, bank_name: "BCA", account_no: "", currency: "IDR", initial_balance: "", current_balance: 0, include_networth: true, is_multicurrency: false, fxBalances: [] };
    case "cash":        return { ...base, currency: "IDR", initial_balance: "", current_balance: 0 };
    case "credit_card": return { ...base, bank_name: "BCA", last4: "", network: "Visa", card_limit: "", monthly_target: "", statement_day: 25, due_day: 17, current_balance: 0 };
    case "asset":       return { ...base, subtype: "Property", current_value: "", purchase_price: "", purchase_date: "", deposit_rollover_type: "non_aro", monthly_interest_payout: false, deposit_status: "active", deposit_tenor: "6" };
    case "liability":   return { ...base, subtype: "Mortgage", creditor: "", outstanding_amount: "", total_amount: "", monthly_payment: "", liability_interest_rate: "", start_date: "", end_date: "" };
    case "receivable":  return { ...base, entity: "Hamasa" };
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
