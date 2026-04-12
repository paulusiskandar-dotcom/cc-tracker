/**
 * Shared transaction form components.
 * Used by both Transactions page (add + edit) and BankStatement (edit only).
 */
import { useState } from "react";
import { EXPENSE_CATEGORIES, ENTITIES } from "../../constants";
import { fmtIDR, todayStr } from "../../utils";
import Input, { Field, AmountInput, FormRow } from "./Input";
import Select from "./Select";

// ─── TYPE CHOICES ────────────────────────────────────────────
export const TYPE_CHOICES = [
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

// ─── EMPTY FORM ──────────────────────────────────────────────
export const EMPTY = {
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

// ─── TYPE PICKER GRID ────────────────────────────────────────
export function TypePickerGrid({ types, onSelect }) {
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
      <Field label="Asset">
        <select value={form.from_id || ""} onChange={e => set("from_id", e.target.value || null)} style={INP}>
          <option value="">Select asset…</option>
          {assetAccs.map(a => <option key={a.id} value={a.id}>{a.name}{a.subtype ? ` · ${a.subtype}` : ""}</option>)}
        </select>
      </Field>
      <Field label="To Account (receive funds)">
        <select value={form.to_id || ""} onChange={e => set("to_id", e.target.value || null)} style={INP}>
          <option value="">Select account…</option>
          {bankAccs.map(a => <option key={a.id} value={a.id}>{a.name}{a.bank_name && a.bank_name !== a.name ? ` · ${a.bank_name}` : ""}</option>)}
        </select>
      </Field>
      <AmountInput label="Sell Price (IDR)" value={form.amount} onChange={v => set("amount", v)} />
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

  const direction  = form.fx_direction || "buy";
  const currency   = form.currency && form.currency !== "IDR" ? form.currency : null;
  const rate       = Number(form.fx_rate_used || 0);
  const foreignAmt = Number(form.amount || 0);
  const idrEquiv   = rate > 0 && foreignAmt > 0 ? Math.round(foreignAmt * rate) : null;

  const fxCurrencies = [...new Set(
    accountCurrencies.map(r => r.currency).filter(c => c && c !== "IDR")
  )].sort();

  const bankAccs = accounts
    .filter(a => a.is_active !== false && (a.type === "bank" || a.type === "credit_card"))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const accountsWithCurrency = currency
    ? accountCurrencies.filter(r => r.currency === currency).map(r => r.account_id)
    : [];
  const toAccounts = direction === "buy"
    ? accounts.filter(a => a.is_active !== false && accountsWithCurrency.includes(a.id))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    : bankAccs.filter(a => a.type === "bank");

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

      <Input label="Date" type="date" value={form.tx_date} onChange={e => set("tx_date", e.target.value)} />

      <Field label="Currency *">
        <select value={form.currency || ""} onChange={e => { set("currency", e.target.value); set("from_id", null); set("to_id", null); }} style={INP}>
          <option value="">Select currency…</option>
          {fxCurrencies.map(c => {
            const meta = allCurrencies.find(x => x.code === c);
            return <option key={c} value={c}>{meta?.flag ? `${meta.flag} ` : ""}{c}</option>;
          })}
          {allCurrencies.filter(c => c.code !== "IDR" && !fxCurrencies.includes(c.code)).map(c => (
            <option key={c.code} value={c.code}>{c.flag ? `${c.flag} ` : ""}{c.code}</option>
          ))}
        </select>
      </Field>

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

      <Input label={`Rate: 1 ${currency || "foreign"} = ? IDR *`} type="number" min="0" step="any"
        value={form.fx_rate_used || ""}
        onChange={e => set("fx_rate_used", e.target.value)}
        placeholder="e.g. 107.5" />

      <Input label={`Amount (${currency || "foreign units"}) *`} type="number" min="0" step="any"
        value={form.amount || ""}
        onChange={e => set("amount", e.target.value)}
        placeholder="0" />

      {idrEquiv !== null && (
        <div style={{
          background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10,
          padding: "10px 14px", fontSize: 13, color: "#0369a1", fontWeight: 600,
          fontFamily: "Figtree, sans-serif",
        }}>
          IDR equivalent: {fmtIDR(idrEquiv)}
        </div>
      )}

      <Field label="Notes (optional)">
        <textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)}
          placeholder="Any details…" rows={2}
          style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 500, color: "#111827", background: "#fff", outline: "none", resize: "vertical", boxSizing: "border-box" }} />
      </Field>
    </div>
  );
}

// ─── TRANSACTION FORM ────────────────────────────────────────
export function TxForm({ form, set, fromOptions, toOptions, accounts, categories, incomeSrcs = [], allCurrencies = [], amtIDR, receivables = [], assets = [], accountCurrencies = [], onChangeType }) {
  const type = form.tx_type;
  const [fromSource, setFromSource] = useState("bank");

  const accLabel = a => a.name + (a.bank_name && a.bank_name !== a.name ? ` · ${a.bank_name}` : "");

  const bankAccs = accounts.filter(a => a.type === "bank"        && a.is_active !== false);
  const ccAccs   = accounts.filter(a => a.type === "credit_card" && a.is_active !== false);

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

  const needsTo  = toOptions.length > 0 && !["reimburse_out", "give_loan"].includes(type);
  const needsCat = type === "expense";

  const switchFromSource = (src) => {
    setFromSource(src);
    set("from_id", null);
  };

  const ENTITY_OPTS = ["Hamasa", "SDC", "Travelio"];
  const pickEntity = (ent) => {
    set("entity", ent);
    const rec = receivables.find(r => r.entity === ent);
    set("to_id", rec?.id || null);
  };

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

      {/* Date — hidden for fx_exchange */}
      {type !== "fx_exchange" && (
        <Input label="Date" type="date" value={form.tx_date} onChange={e => set("tx_date", e.target.value)} />
      )}

      {/* ── FX EXCHANGE form ────────────────────────────────────── */}
      {type === "fx_exchange" && <FxExchangeForm form={form} set={set} accounts={accounts} accountCurrencies={accountCurrencies} allCurrencies={allCurrencies} />}

      {/* ── BUY ASSET form ──────────────────────────────────────── */}
      {type === "buy_asset" && <BuyAssetForm form={form} set={set} accounts={accounts} assets={assets} />}

      {/* ── SELL ASSET form ─────────────────────────────────────── */}
      {type === "sell_asset" && <SellAssetForm form={form} set={set} accounts={accounts} assets={assets} />}

      {/* Description */}
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

      {/* Amount + Currency */}
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
              {allCurrencies.length > 0
                ? allCurrencies.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)
                : ["IDR","USD","SGD","EUR","GBP","AUD","JPY","MYR"].map(c => <option key={c} value={c}>{c}</option>)
              }
            </select>
          </Field>
        </div>
        {form.currency !== "IDR" && form.amount && (
          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: -8 }}>
            ≈ {fmtIDR(amtIDR)} IDR
          </div>
        )}
      </>}

      {/* Give Loan — employee details */}
      {type === "give_loan" && (
        <Input
          label="Employee Name *"
          value={form.employee_name || ""}
          onChange={e => set("employee_name", e.target.value)}
          placeholder="Full name"
        />
      )}

      {/* FROM ACCOUNT — grouped dropdown */}
      {hasTwoStep && !["buy_asset","sell_asset","fx_exchange"].includes(type) && (() => {
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

      {/* Give Loan — installment + start date */}
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

      {/* FROM ACCOUNT — regular select for non-two-step types */}
      {!hasTwoStep && fromOptions.length > 0 && !["buy_asset","sell_asset","fx_exchange"].includes(type) && (
        <Select
          label={(type === "collect_loan" || type === "reimburse_in") ? "Receivable" : "From Account"}
          value={form.from_id || ""}
          onChange={e => set("from_id", e.target.value.length === 36 ? e.target.value : null)}
          options={fromOpts}
          placeholder="Select…"
        />
      )}

      {/* ENTITY toggle for reimburse_out */}
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

      {/* TO ACCOUNT */}
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

      {/* Notes */}
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
