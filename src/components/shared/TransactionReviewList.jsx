// Unified Transaction Review List — used by AI Scan, E-Statement, Gmail
// Props:
//   rows            TxRow[]          — flat list of editable rows
//   selected        {[id]: bool}     — which rows are checked
//   skipped         Set<id>          — optional: skip-then-restore pattern (AIImport)
//   onUpdateRow     (id, patch) => void
//   onConfirmRow    async (row) => void
//   onSkipRow       (id) => void
//   onConfirmAll    async (validRows) => void
//   onToggleSelect  (id) => void
//   onToggleAll     () => void
//   source          'ai_scan' | 'estatement' | 'gmail'
//   accounts        Account[]
//   T               Theme
//   busy            bool
//   onRefreshScan   () => void         — optional, shows 🔄 button
//   onCreateInstallment (row) => void  — optional, estatement only

import { useState, useEffect } from "react";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES_LIST } from "../../constants";
import { showToast } from "./Card";
import { supabase } from "../../lib/supabase";

// ── TX Types (13 total) ─────────────────────────────────────────
export const TX_REVIEW_TYPES = [
  { value: "expense",        label: "Expense",        color: "#dc2626" },
  { value: "income",         label: "Income",         color: "#059669" },
  { value: "transfer",       label: "Transfer",       color: "#3b5bdb" },
  { value: "pay_cc",         label: "Pay CC",         color: "#7c3aed" },
  { value: "buy_asset",      label: "Buy Asset",      color: "#0891b2" },
  { value: "sell_asset",     label: "Sell Asset",     color: "#059669" },
  { value: "reimburse_out",  label: "Reimburse Out",  color: "#d97706" },
  { value: "reimburse_in",   label: "Reimburse In",   color: "#059669" },
  { value: "give_loan",      label: "Give Loan",      color: "#d97706" },
  { value: "collect_loan",   label: "Collect Loan",   color: "#059669" },
  { value: "pay_liability",  label: "Pay Liability",  color: "#d97706" },
  { value: "fx_exchange",    label: "FX Exchange",    color: "#0891b2" },
  { value: "cc_installment", label: "CC Installment", color: "#3b5bdb" },
];

const NO_CAT_TYPES    = new Set(["transfer","pay_cc","give_loan","collect_loan","fx_exchange",
                                  "reimburse_in","reimburse_out","buy_asset","sell_asset","pay_liability","cc_installment"]);
const REIMBURSE_TYPES = new Set(["reimburse_in","reimburse_out"]);
const INCOME_LIKE     = new Set(["income","collect_loan","reimburse_in","sell_asset"]);

// ── Account type helpers ────────────────────────────────────────
const isCashAcc = a => a.type === "cash" || a.subtype === "cash" || /-cash$/i.test(a.name || "");
const isCCAcc   = a => a.type === "credit_card";
const isBankAcc = a => a.type === "bank" && !isCashAcc(a);

// Other account types (asset, receivable, liability) — not bank/cash/cc
const OTHER_ACCT_GROUPS = [
  { type: "asset",      label: "Assets"      },
  { type: "receivable", label: "Receivables" },
  { type: "liability",  label: "Liabilities" },
];

// ── Tabbed account select (Bank / Cash / CC tabs) ────────────────
function TabbedAcctSelect({ accounts, value, onChange, placeholder = "Select…", showLast4 = false, T }) {
  const bankAccs  = accounts.filter(isBankAcc);
  const cashAccs  = accounts.filter(isCashAcc);
  const ccAccs    = accounts.filter(isCCAcc);
  const otherAccs = accounts.filter(a => !isBankAcc(a) && !isCashAcc(a) && !isCCAcc(a));

  const tabs = [
    bankAccs.length > 0 && { id: "bank", label: "Bank", accs: bankAccs },
    cashAccs.length > 0 && { id: "cash", label: "Cash", accs: cashAccs },
    ccAccs.length   > 0 && { id: "cc",   label: "CC",   accs: ccAccs   },
  ].filter(Boolean);

  const initTab = () => {
    if (value) {
      if (bankAccs.some(a => a.id === value)) return "bank";
      if (cashAccs.some(a => a.id === value)) return "cash";
      if (ccAccs.some(a   => a.id === value)) return "cc";
    }
    return tabs[0]?.id || "bank";
  };
  const [activeTab, setActiveTab] = useState(initTab);

  const activeAccs = (tabs.find(t => t.id === activeTab)?.accs || accounts).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const tabBtn = (id, label) => (
    <button key={id} type="button" onClick={() => setActiveTab(id)}
      style={{
        padding: "1px 7px", borderRadius: 4, border: "none", cursor: "pointer",
        fontSize: 10, fontWeight: activeTab === id ? 700 : 500,
        fontFamily: "Figtree, sans-serif",
        background: activeTab === id ? "#3b5bdb" : "transparent",
        color: activeTab === id ? "#fff" : "#9ca3af",
      }}>
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      {tabs.length > 1 && (
        <div style={{ display: "flex", gap: 1, flexShrink: 0 }}>
          {tabs.map(t => tabBtn(t.id, t.label))}
        </div>
      )}
      <select style={{ ...inSel(T), flex: 1, minWidth: 0 }}
        value={value || ""}
        onChange={e => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {activeAccs.map(a => (
          <option key={a.id} value={a.id}>
            {a.name}{showLast4 && (a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : ""}
          </option>
        ))}
        {/* Non-bank/cash/cc accounts (assets, receivables, liabilities) always visible */}
        {otherAccs.length > 0 && OTHER_ACCT_GROUPS.map(g => {
          const grp = otherAccs.filter(a => a.type === g.type).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
          if (!grp.length) return null;
          return (
            <optgroup key={g.type} label={g.label}>
              {grp.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}{showLast4 && (a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : ""}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}

const REIMBURSE_ENTITY_NAMES = ["Hamasa", "SDC", "Travelio"];

// ── Account filter/mode per tx_type ────────────────────────────
function getAcctCfg(txType, accounts) {
  const bc      = accounts.filter(a => ["bank","cash"].includes(a.type));
  const bccc    = accounts.filter(a => ["bank","cash","credit_card"].includes(a.type));
  const cc      = accounts.filter(a => a.type === "credit_card");
  const asset    = accounts.filter(a => a.type === "asset");
  const loanRecv = accounts.filter(a => a.type === "receivable" && !REIMBURSE_ENTITY_NAMES.includes(a.name));
  const loanRecvWithBal = loanRecv.filter(a => Number(a.current_balance || 0) > 0);
  const liab    = accounts.filter(a => a.type === "liability");
  const all     = accounts;
  switch (txType) {
    case "income":        return { mode: "to",       to: bc };
    case "reimburse_in":  return { mode: "to",       to: bc };
    case "sell_asset":    return { mode: "from_to",  from: asset, to: bc };
    case "collect_loan":  return { mode: "from_to",  from: loanRecvWithBal.length ? loanRecvWithBal : loanRecv, to: bc };
    case "transfer":      return { mode: "from_to",  from: all,   to: all };
    case "pay_cc":        return { mode: "from_to",  from: bc,    to: cc };
    case "buy_asset":     return { mode: "from_to",  from: bc,    to: asset };
    case "give_loan":     return { mode: "from_to",  from: bc,    to: loanRecv };
    case "pay_liability": return { mode: "from_to",  from: bc,    to: liab };
    case "fx_exchange":   return { mode: "from_to",  from: all,   to: all };
    case "cc_installment":return { mode: "from",     from: cc };
    default:              return { mode: "from",     from: bccc }; // expense, reimburse_out
  }
}

// ── Validation ─────────────────────────────────────────────────
function validateRow(r, accounts) {
  const cfg = getAcctCfg(r.tx_type, accounts);
  const isUUID = v => typeof v === "string" && v.length === 36;
  // collect_loan uses a dedicated employee_loan_id field (from_id holds the same value but may also hold a receivable account UUID from AI scan)
  if (r.tx_type === "collect_loan") {
    if (!isUUID(r.employee_loan_id)) return "Pilih borrower";
    if (!isUUID(r.to_id)) return "Pilih akun tujuan";
    return null;
  }
  if ((cfg.mode === "from" || cfg.mode === "from_to") && !isUUID(r.from_id))
    return "Pilih akun sumber";
  if ((cfg.mode === "to"   || cfg.mode === "from_to") && !isUUID(r.to_id))
    return "Pilih akun tujuan";
  if (!NO_CAT_TYPES.has(r.tx_type) && !r.category_id)
    return "Pilih kategori";
  // entity required only for reimburse_in (reimburse_out entity is optional)
  if (r.tx_type === "reimburse_in" && !r.entity)
    return "Pilih entity reimburse";
  if (r.tx_type === "fx_exchange" && (!r.fx_rate || Number(r.fx_rate) <= 0))
    return "Isi FX rate";
  return null;
}

// ── Amount helpers ──────────────────────────────────────────────
const amtColor = (t) =>
  INCOME_LIKE.has(t) || t === "fx_exchange" ? "#059669"
  : t === "transfer" || t === "pay_cc"      ? "#3b5bdb"
  : "#dc2626";

const amtSign = (t) =>
  INCOME_LIKE.has(t) ? "+" : t === "transfer" || t === "pay_cc" || t === "fx_exchange" ? "" : "-";

const fmtAmt = (v) => {
  const n = Math.abs(Math.round(Number(v) || 0));
  return "Rp " + n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const fmtDateShort = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
  catch { return d || ""; }
};

// ── Inline style helpers ────────────────────────────────────────
const inSel = (T, extra = {}) => ({
  fontSize: 11, padding: "3px 4px", border: `1px solid ${T.border}`,
  borderRadius: 5, background: T.surface, color: T.text,
  fontFamily: "Figtree, sans-serif", cursor: "pointer",
  boxSizing: "border-box", ...extra,
});
const inInp = (T, extra = {}) => ({
  fontSize: 11, padding: "3px 5px", border: `1px solid ${T.border}`,
  borderRadius: 5, background: T.surface, color: T.text,
  fontFamily: "Figtree, sans-serif", boxSizing: "border-box", ...extra,
});
const ACT_BTN = (extra = {}) => ({
  width: 26, height: 26, borderRadius: 6, border: "1px solid #e5e7eb",
  background: "#f9fafb", cursor: "pointer", fontSize: 12, fontWeight: 700,
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "Figtree, sans-serif", padding: 0, flexShrink: 0, ...extra,
});
const BADGE = (bg, color) => ({
  fontSize: 9, fontWeight: 800, background: bg, color,
  padding: "2px 5px", borderRadius: 4, whiteSpace: "nowrap", flexShrink: 0,
});

// ─── COLLECT LOAN CELL ──────────────────────────────────────────
// Separate component so useEffect can be called unconditionally (React hook rules)
function CollectLoanCell({ r, onUpdate, T, accounts, employeeLoans }) {
  const activeLoans = (employeeLoans || []).filter(l => {
    const s = (l.status || "active").toLowerCase();
    return s === "active" || s === "partial";
  });
  const bc = accounts.filter(a => ["bank", "cash"].includes(a.type));

  // Auto-detect borrower from description on first render
  useEffect(() => {
    if (r.employee_loan_id || r.from_id || !r.description || !activeLoans.length) return;
    const descLower = (r.description || "").toLowerCase();
    const match = activeLoans.find(l =>
      (l.employee_name || "").split(/\s+/).some(w => w.length >= 3 && descLower.includes(w.toLowerCase()))
    );
    if (match) onUpdate({ employee_loan_id: match.id, from_id: match.id });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <select style={{ ...inSel(T), width: "100%" }}
          value={r.employee_loan_id || ""}
          onChange={e => onUpdate({ employee_loan_id: e.target.value, from_id: e.target.value })}>
          <option value="">Borrower…</option>
          {activeLoans.map(l => {
            const outstanding = Math.max(0, Number(l.total_amount || 0) - Number(l.paid_months || 0) * Number(l.monthly_installment || 0));
            return (
              <option key={l.id} value={l.id}>
                {l.employee_name} ({fmtAmt(outstanding)})
              </option>
            );
          })}
        </select>
      </div>
      <span style={{ fontSize: 10, color: T.text3, flexShrink: 0 }}>→</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TabbedAcctSelect
          accounts={bc}
          value={r.to_id || ""}
          onChange={v => onUpdate({ to_id: v })}
          placeholder="To Account…"
          showLast4
          T={T}
        />
      </div>
    </div>
  );
}

// ─── ACCOUNT CELL ───────────────────────────────────────────────
function AccountCell({ r, onUpdate, T, accounts, employeeLoans }) {
  const cfg = getAcctCfg(r.tx_type, accounts);

  // ── collect_loan: rendered by dedicated component to satisfy hook rules ──
  if (r.tx_type === "collect_loan") {
    return <CollectLoanCell r={r} onUpdate={onUpdate} T={T} accounts={accounts} employeeLoans={employeeLoans} />;
  }

  if (cfg.mode === "to") return (
    <TabbedAcctSelect
      accounts={cfg.to}
      value={r.to_id || ""}
      onChange={v => onUpdate({ to_id: v })}
      placeholder="To Account…"
      showLast4
      T={T}
    />
  );

  if (cfg.mode === "from_to") return (
    <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TabbedAcctSelect
          accounts={cfg.from}
          value={r.from_id || ""}
          onChange={v => onUpdate({ from_id: v })}
          placeholder="From…"
          showLast4
          T={T}
        />
      </div>
      <span style={{ fontSize: 10, color: T.text3, flexShrink: 0 }}>→</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TabbedAcctSelect
          accounts={cfg.to}
          value={r.to_id || ""}
          onChange={v => onUpdate({ to_id: v })}
          placeholder="To…"
          showLast4
          T={T}
        />
      </div>
    </div>
  );

  return (
    <TabbedAcctSelect
      accounts={cfg.from}
      value={r.from_id || ""}
      onChange={v => onUpdate({ from_id: v })}
      placeholder="From Account…"
      showLast4
      T={T}
    />
  );
}

// ─── SINGLE TX REVIEW CARD ─────────────────────────────────────
function TxReviewCard({
  r, isSelected, isSkipped, isNotesOpen, T,
  source, accounts, employeeLoans, txTypes,
  onUpdate, onConfirm, onSkip, onToggleSelect, onToggleNotes,
  onCreateInstallment, confirmingId,
}) {
  const [validErr, setValidErr] = useState(null);
  const [dupDismissed, setDupDismissed] = useState(false);
  const rawDupLevel = r.status === "duplicate" ? 3
                    : r.status === "possible_duplicate" ? 2
                    : r.status === "review" ? 1 : 0;
  const dupLevel = dupDismissed ? 0 : rawDupLevel;

  const cardBg = isSkipped ? T.sur2
               : dupLevel === 3 ? "#fff1f2"
               : dupLevel === 2 ? "#fff7ed"
               : dupLevel === 1 ? "#fefce8"
               : T.surface;
  const cardBorder = dupLevel === 3 ? "1.5px solid #dc2626"
                   : dupLevel === 2 ? "1.5px solid #ea580c"
                   : dupLevel === 1 ? "1.5px solid #ca8a04"
                   : r.flagged    ? "1.5px solid #f97316"
                   : `1px solid ${T.border}`;

  const color   = amtColor(r.tx_type);
  const sign    = amtSign(r.tx_type);
  const isFX    = r.currency && r.currency !== "IDR";
  const showCat = !NO_CAT_TYPES.has(r.tx_type);
  const cats    = r.tx_type === "income" ? INCOME_CATEGORIES_LIST : EXPENSE_CATEGORIES;
  const typeColor = TX_REVIEW_TYPES.find(t => t.value === r.tx_type)?.color || T.text;

  const amtStr = isFX
    ? (source === "estatement"
        ? `${sign}${r.currency} ${Number(r.amount || 0).toLocaleString("id-ID")}`
        : `${sign}${r.currency} ${Number(r.amount || 0).toLocaleString("id-ID")} ≈ ${fmtAmt(r.amount_idr || 0)}`)
    : `${sign}${fmtAmt(r.amount_idr || r.amount || 0)}`;

  const handleConfirm = () => {
    const err = validateRow(r, accounts);
    if (err) { setValidErr(err); return; }
    setValidErr(null);
    onConfirm();
  };

  const isConfirming = confirmingId === r._id;

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 10, opacity: isSkipped ? 0.55 : 1, overflow: "hidden" }}>

      {/* ── ROW 1: ☑ date desc [badges] amount ✓ ✗ ✏️ ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px 4px" }}>
        <input type="checkbox" checked={isSelected && !isSkipped}
          onChange={onToggleSelect} disabled={isSkipped}
          style={{ accentColor: "#3b5bdb", width: 14, height: 14, flexShrink: 0, cursor: "pointer" }} />

        <span style={{ width: 44, fontSize: 11, color: T.text3, fontFamily: "Figtree, sans-serif", flexShrink: 0, whiteSpace: "nowrap" }}>
          {fmtDateShort(r.tx_date)}
        </span>

        <input
          style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none",
            fontSize: 12, fontWeight: 600, color: isSkipped ? T.text3 : T.text,
            fontFamily: "Figtree, sans-serif", textDecoration: isSkipped ? "line-through" : "none" }}
          value={r.description || ""}
          onChange={e => onUpdate({ description: e.target.value })}
          placeholder="Description…"
        />

        {/* Inline badges next to description */}
        {r._invalidAmount && <span style={BADGE("#fee2e2","#dc2626")}>Amount!</span>}
        {dupLevel === 3 && <span style={BADGE("#fee2e2","#dc2626")}>DUP</span>}
        {dupLevel === 2 && <span style={BADGE("#ffedd5","#ea580c")}>⚠ Dup?</span>}
        {dupLevel === 1 && <span style={BADGE("#fef9c3","#ca8a04")}>REVIEW</span>}
        {r.flagged && dupLevel === 0 && <span style={BADGE("#fff7ed","#f97316")}>⚠ Reimb</span>}
        {source === "estatement" && r._isInstallment && (
          <span style={BADGE("#dbeafe","#1d4ed8")}>
            CICILAN{r._instNo ? ` ${r._instNo}${r._instTotal ? `/${r._instTotal}` : ""}` : ""}
          </span>
        )}
        {source === "ai_scan" && r.learned_cat?.confidence >= 2 && r.learned_cat?.category_id === r.category_id && (
          <span style={BADGE("#dcfce7","#059669")}>✓ Learned</span>
        )}
        {source === "ai_scan" && r.learned_cat?.confidence === 1 && (
          <span style={BADGE("#fef9c3","#a16207")}>Suggest</span>
        )}

        <span style={{ fontSize: 12, fontWeight: 800, color, fontFamily: "Figtree, sans-serif", flexShrink: 0, whiteSpace: "nowrap" }}>
          {amtStr}
        </span>

        <button onClick={handleConfirm} disabled={isSkipped || isConfirming || r._invalidAmount}
          style={ACT_BTN({ background: "#dcfce7", color: "#059669", border: "1px solid #bbf7d0" })}
          title="Import">
          {isConfirming ? "…" : "✓"}
        </button>

        <button onClick={() => onSkip(r._id)}
          style={ACT_BTN({ color: isSkipped ? "#059669" : "#9ca3af" })}
          title={isSkipped ? "Restore" : "Skip"}>
          {isSkipped ? "↩" : "✕"}
        </button>

        <button onClick={onToggleNotes}
          style={ACT_BTN({ background: isNotesOpen ? "#dbeafe" : T.sur2, color: isNotesOpen ? "#3b5bdb" : T.text3, width: 24, height: 24, fontSize: 11 })}
          title="Notes">
          ✏️
        </button>
      </div>

      {/* ── ROW 2: type [cat/entity] [fx] [B][C][CC] account — single line ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 10px 8px 32px", flexWrap: "nowrap", overflow: "hidden" }}>

        {/* Type dropdown */}
        <select
          style={{ ...inSel(T), width: 112, flexShrink: 0, color: typeColor, fontWeight: 600 }}
          value={r.tx_type}
          onChange={e => {
            const t = e.target.value;
            onUpdate({
              tx_type:     t,
              category_id: NO_CAT_TYPES.has(t) ? null : r.category_id,
              entity:      REIMBURSE_TYPES.has(t) ? (r.entity || "") : "",
            });
          }}>
          {txTypes.map(t => (
            <option key={t.value} value={t.value} style={{ color: t.color, fontWeight: 600 }}>{t.label}</option>
          ))}
        </select>

        {/* Category */}
        {showCat && (
          <select style={{ ...inSel(T), width: 118, flexShrink: 0 }}
            value={r.category_id || ""}
            onChange={e => {
              const cat = cats.find(c => c.id === e.target.value);
              onUpdate({ category_id: e.target.value, category_name: cat?.label || "" });
            }}>
            <option value="">Category…</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ${c.label}` : c.label}</option>)}
          </select>
        )}

        {/* Entity (reimburse — inline, no separate row) */}
        {REIMBURSE_TYPES.has(r.tx_type) && (
          <select
            style={{ ...inSel(T), width: 90, flexShrink: 0, fontWeight: 600, color: r.entity ? "#92400e" : "#6b7280" }}
            value={r.entity || ""}
            onChange={e => onUpdate({ entity: e.target.value })}>
            <option value="">Entity…</option>
            {["Hamasa", "SDC", "Travelio"].map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        )}

        {/* FX rate — hidden for estatement (amount stays in original currency) */}
        {(r.tx_type === "fx_exchange" || isFX) && source !== "estatement" && (
          <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: T.text3, whiteSpace: "nowrap", fontFamily: "Figtree, sans-serif" }}>Rate:</span>
            <input type="number"
              style={inInp(T, { width: 60, fontSize: 11, textAlign: "right" })}
              value={r.fx_rate ?? ""}
              onChange={e => {
                const rate = e.target.value;
                const idr  = Math.round(Number(r.amount || 0) * Number(rate || 0));
                onUpdate({ fx_rate: rate, amount_idr: String(idr) });
              }}
            />
          </div>
        )}

        {/* Account cell — TabbedAcctSelect renders [B][C][CC] tabs inline */}
        <div style={{ flex: 1, minWidth: 120, overflow: "hidden" }}>
          <AccountCell r={r} onUpdate={onUpdate} T={T} accounts={accounts} employeeLoans={employeeLoans} />
        </div>
      </div>

      {/* ── Validation error ── */}
      {validErr && (
        <div style={{ borderTop: "1px solid #fecaca", background: "#fff5f5", padding: "5px 10px 5px 32px" }}>
          <span style={{ fontSize: 10, color: "#dc2626", fontFamily: "Figtree, sans-serif", fontWeight: 600 }}>
            ⚠ {validErr}
          </span>
        </div>
      )}

      {/* ── Duplicate info panel ── */}
      {rawDupLevel > 0 && !dupDismissed && r._dupEntry && (
        <div style={{ borderTop: "1px solid #fde68a", background: "#fffbeb", padding: "5px 10px 6px 32px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#92400e", fontFamily: "Figtree, sans-serif", flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>Similar to:</span>{" "}
            <strong>{r._dupEntry.description || r._dupEntry.merchant_name || "(no desc)"}</strong>
            {" · "}{r._dupEntry.tx_date}
            {" · Rp "}{Number(r._dupEntry.amount_idr || 0).toLocaleString("id-ID")}
            {r._dupReasons?.length > 0 && (
              <span style={{ marginLeft: 6 }}>
                {r._dupReasons.map(reason => (
                  <span key={reason} style={{ display: "inline-block", background: "#fde68a", color: "#78350f", borderRadius: 3, padding: "1px 5px", fontSize: 9, fontWeight: 700, marginLeft: 3 }}>
                    {reason}
                  </span>
                ))}
              </span>
            )}
          </span>
          <button
            onClick={() => setDupDismissed(true)}
            style={{ fontSize: 10, fontWeight: 700, color: "#059669", background: "none", border: "1px solid #6ee7b7", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap", flexShrink: 0 }}>
            It's different
          </button>
        </div>
      )}

      {/* ── Cicilan cross-check (estatement only) ── */}
      {source === "estatement" && r._isInstallment && (
        <div style={{ borderTop: "1px solid #bfdbfe", background: "#eff6ff", padding: "6px 10px 7px 32px", display: "flex", alignItems: "center", gap: 8 }}>
          {r._instMatch ? (
            <span style={{ fontSize: 10, color: "#1d4ed8", fontFamily: "Figtree, sans-serif" }}>
              ✓ Tracked: {r._instMatch.description}
              {r._instMatch.paid_months != null ? ` (${r._instMatch.paid_months}/${r._instMatch.total_months || "?"} paid)` : ""}
            </span>
          ) : (
            <>
              <span style={{ fontSize: 10, color: "#374151", fontFamily: "Figtree, sans-serif" }}>Not in installments</span>
              {onCreateInstallment && (
                <button onClick={() => onCreateInstallment(r)}
                  style={{ fontSize: 10, fontWeight: 700, color: "#1d4ed8", background: "none", border: "1px solid #bfdbfe", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: "Figtree, sans-serif" }}>
                  + Create Installment
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Notes ── */}
      {isNotesOpen && (
        <div style={{ borderTop: `1px solid ${T.border}`, background: T.sur2, padding: "6px 10px 8px 32px", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap" }}>Notes</span>
          <input
            style={{ ...inSel(T), flex: 1, border: `1px solid ${T.border}`, padding: "3px 5px" }}
            value={r.notes || ""}
            onChange={e => onUpdate({ notes: e.target.value })}
            placeholder="Optional notes…"
          />
        </div>
      )}
    </div>
  );
}

// ─── MAIN EXPORT ───────────────────────────────────────────────
export default function TransactionReviewList({
  rows = [],
  selected = {},
  skipped,
  onUpdateRow,
  onConfirmRow,
  onSkipRow,
  onConfirmAll,
  onToggleSelect,
  onToggleAll,
  source = "ai_scan",
  accounts = [],
  employeeLoans = [],
  T,
  busy = false,
  onRefreshScan,
  onRetrySonnet,
  retrySonnet = false,
  onClearAll,
  onCreateInstallment,
}) {
  const [notesOpen,    setNotesOpen]    = useState(new Set());
  const [confirmingId, setConfirmingId] = useState(null);
  const [confirmingAll,setConfirmingAll]= useState(false);
  const [confirmedIds,  setConfirmedIds]  = useState(new Set());
  const [fetchedLoans,  setFetchedLoans]  = useState([]);

  // Fallback: fetch employee loans directly if prop arrives empty and rows contain collect_loan
  useEffect(() => {
    const needsLoans = rows.some(r => r.tx_type === "collect_loan");
    if (!needsLoans || employeeLoans.length > 0) return;
    let cancelled = false;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || cancelled) return;
      supabase
        .from("employee_loans")
        .select("id, employee_name, status, total_amount, monthly_installment, paid_months")
        .eq("user_id", user.id)
        .in("status", ["active", "partial"])
        .then(({ data }) => {
          if (!cancelled && data?.length) setFetchedLoans(data);
        });
    });
    return () => { cancelled = true; };
  }, [rows, employeeLoans]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefer prop data; fall back to locally fetched loans
  const effectiveLoans = employeeLoans.length > 0 ? employeeLoans : fetchedLoans;

  const toggleNotes = (id) => setNotesOpen(s => {
    const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns;
  });

  const handleConfirmRow = async (row) => {
    setConfirmingId(row._id);
    try {
      await onConfirmRow(row);
      setConfirmedIds(s => { const ns = new Set(s); ns.add(row._id); return ns; });
    } finally { setConfirmingId(null); }
  };

  // visible = not yet confirmed locally, not already-imported from server
  const visibleRows = rows.filter(r =>
    !confirmedIds.has(r._id) &&
    r.status !== "imported" &&
    r.status !== "confirmed"
  );

  const handleConfirmAll = async () => {
    const toConfirm = visibleRows.filter(r =>
      selected[r._id] && !skipped?.has(r._id) && !validateRow(r, accounts)
    );
    const invalid = visibleRows.filter(r =>
      selected[r._id] && !skipped?.has(r._id) && validateRow(r, accounts)
    );
    if (invalid.length) showToast(`${invalid.length} baris belum lengkap`, "warning");
    if (!toConfirm.length) { showToast("Tidak ada yang valid", "warning"); return; }
    setConfirmingAll(true);
    try { await onConfirmAll(toConfirm); }
    finally { setConfirmingAll(false); }
  };

  // Show cc_installment only for estatement
  const txTypes = source === "estatement"
    ? TX_REVIEW_TYPES
    : TX_REVIEW_TYPES.filter(t => t.value !== "cc_installment");

  const activeRows    = visibleRows.filter(r => !skipped?.has(r._id));
  const countSelected = activeRows.filter(r => selected[r._id]).length;
  const allSelected   = activeRows.length > 0 && activeRows.every(r => selected[r._id]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      {/* ── Top bar ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>
            {countSelected} / {activeRows.length} selected
          </span>
          <button onClick={onToggleAll}
            style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.sur2, color: T.text2, cursor: "pointer", fontFamily: "Figtree, sans-serif", fontWeight: 600 }}>
            {allSelected ? "Deselect All" : "Select All"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {onRefreshScan && (
            <button onClick={onRefreshScan}
              style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.sur2, color: T.text2, cursor: "pointer", fontFamily: "Figtree, sans-serif", fontWeight: 600 }}>
              🔄 Refresh Scan
            </button>
          )}
          {onRetrySonnet && (
            <button onClick={onRetrySonnet} disabled={retrySonnet}
              style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.sur2, color: T.text2, cursor: retrySonnet ? "default" : "pointer", fontFamily: "Figtree, sans-serif", fontWeight: 600, opacity: retrySonnet ? 0.6 : 1 }}>
              {retrySonnet ? "Scanning…" : "✨ Try Sonnet"}
            </button>
          )}
          {onClearAll && (
            <button onClick={onClearAll}
              style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.text3, cursor: "pointer", fontFamily: "Figtree, sans-serif", fontWeight: 600 }}>
              Clear All
            </button>
          )}
          <button
            onClick={handleConfirmAll}
            disabled={busy || confirmingAll || countSelected === 0}
            style={{
              fontSize: 11, padding: "4px 12px", borderRadius: 6, border: "none",
              background: countSelected > 0 ? "#3b5bdb" : "#e5e7eb",
              color: countSelected > 0 ? "#fff" : "#9ca3af",
              cursor: countSelected > 0 && !busy && !confirmingAll ? "pointer" : "default",
              fontFamily: "Figtree, sans-serif", fontWeight: 700,
            }}>
            {confirmingAll ? "Importing…" : `Accept All ✓ (${countSelected})`}
          </button>
        </div>
      </div>

      {/* ── Cards ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {visibleRows.map(r => (
          <TxReviewCard
            key={r._id}
            r={r}
            isSelected={!!selected[r._id]}
            isSkipped={!!skipped?.has(r._id)}
            isNotesOpen={notesOpen.has(r._id)}
            T={T}
            source={source}
            accounts={accounts}
            employeeLoans={effectiveLoans}
            txTypes={txTypes}
            onUpdate={patch => onUpdateRow(r._id, patch)}
            onConfirm={() => handleConfirmRow(r)}
            onSkip={onSkipRow}
            onToggleSelect={() => onToggleSelect(r._id)}
            onToggleNotes={() => toggleNotes(r._id)}
            onCreateInstallment={onCreateInstallment}
            confirmingId={confirmingId}
          />
        ))}
      </div>
    </div>
  );
}
