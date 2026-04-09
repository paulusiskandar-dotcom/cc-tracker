import { useState, useRef } from "react";
import { ledgerApi, gmailApi, scanApi, merchantApi, getTxFromToTypes } from "../api";
import { fmtIDR, todayStr } from "../utils";
import { LIGHT, DARK } from "../theme";
import { Button, EmptyState, Spinner, showToast, NativeAccountSelect } from "./shared/index";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES_LIST } from "../constants";

// ── TX types (dropdown) — only real tx types, not categories ─────
const IMPORT_TX_TYPES = [
  { value: "expense",       label: "Expense" },
  { value: "income",        label: "Income" },
  { value: "transfer",      label: "Transfer" },
  { value: "pay_cc",        label: "Pay CC" },
  { value: "reimburse_out", label: "Reimburse Out" },
  { value: "reimburse_in",  label: "Reimburse In" },
  { value: "give_loan",     label: "Give Loan" },
  { value: "collect_loan",  label: "Collect Loan" },
  { value: "fx_exchange",   label: "FX Exchange" },
];

// ── Normalise AI pseudo-types to real tx_type + category ─────────
const PSEUDO_TYPE_MAP = {
  bank_charges:  { tx_type: "expense", category_id: "bank_charges", category_name: "Bank Charges"  },
  materai:       { tx_type: "expense", category_id: "materai",      category_name: "Materai"       },
  tax:           { tx_type: "expense", category_id: "tax",          category_name: "Tax"           },
  bank_interest: { tx_type: "income",  category_id: "bank_interest",category_name: "Bank Interest" },
  cashback:      { tx_type: "income",  category_id: "cashback",     category_name: "Cashback"      },
};
const normaliseTxType = (raw, catId) => {
  const mapped = PSEUDO_TYPE_MAP[raw];
  if (mapped) return { tx_type: mapped.tx_type, category_id: mapped.category_id };
  return { tx_type: raw || "expense", category_id: catId };
};

// ── Keyword-based auto-classification ───────────────────────────
// Applied after AI extraction; overrides AI suggestion when matched.
const KEYWORD_RULES = [
  {
    match: /biaya\s*adm|admin\s*fee|bi-?fast\s*fee|transfer\s*fee|provisi|biaya\s*transfer|administration\s*fee|service\s*charge/i,
    tx_type: "expense", category_id: "bank_charges", category_name: "Bank Charges",
  },
  {
    // BI-Fast / bifast ≤ Rp 5.000 → bank charges
    match: /bi-?fast|bifast/i,
    maxAmount: 5000,
    tx_type: "expense", category_id: "bank_charges", category_name: "Bank Charges",
  },
  {
    match: /materai|stamp\s*duty|bea\s*materai/i,
    tx_type: "expense", category_id: "materai", category_name: "Materai",
  },
  {
    match: /\bpph\b|pajak|withholding\s*tax|interest\s*tax|pph\s*bunga/i,
    tx_type: "expense", category_id: "tax", category_name: "Tax",
  },
  {
    // "tax" alone only when NOT "cashback" or "interest" context
    match: /\btax\b/i,
    notMatch: /cashback|interest|bunga/i,
    tx_type: "expense", category_id: "tax", category_name: "Tax",
  },
  {
    match: /bunga\s*tabungan|bunga\s*deposito|jasa\s*giro|bank\s*interest|bunga\b/i,
    notMatch: /pph|pajak|tax/i,
    tx_type: "income", category_id: "bank_interest", category_name: "Bank Interest",
  },
  {
    match: /cashback|cash\s*back|reward\s*points|poin\s*reward/i,
    tx_type: "income", category_id: "cashback", category_name: "Cashback",
  },
];

const applyKeywordRules = (desc, amount) => {
  const d = (desc || "").toLowerCase();
  const amt = Number(amount) || 0;
  for (const rule of KEYWORD_RULES) {
    if (!rule.match.test(d)) continue;
    if (rule.notMatch && rule.notMatch.test(d)) continue;
    if (rule.maxAmount !== undefined && amt > rule.maxAmount) continue;
    return { tx_type: rule.tx_type, category_id: rule.category_id };
  }
  return null;
};

// ── Category visibility ─────────────────────────────────────────
const SHOW_EXPENSE_CAT  = new Set(["expense"]);
const SHOW_INCOME_CAT   = new Set(["income"]);
const NO_CAT            = new Set(["transfer","pay_cc","reimburse_out","reimburse_in","give_loan","collect_loan","fx_exchange"]);
const REIMBURSE_TYPES   = new Set(["reimburse_out","reimburse_in"]);
const REIMBURSE_ENTITIES = ["Hamasa", "SDC", "Travelio"];

const getCatOptions = (txType) =>
  SHOW_INCOME_CAT.has(txType) ? INCOME_CATEGORIES_LIST : EXPENSE_CATEGORIES;

// ── Helpers ─────────────────────────────────────────────────────
const amtColor = (type) => {
  if (["income","collect_loan","reimburse_in","fx_exchange"].includes(type)) return "#059669";
  if (["transfer","pay_cc","give_loan"].includes(type)) return "#3b5bdb";
  return "#dc2626";
};
const fmtDateShort = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
  catch { return d || ""; }
};
const fmtDate = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d || ""; }
};

// ── Inline control styles ────────────────────────────────────────
const inSel = (T, extra = {}) => ({
  fontSize: 11, padding: "3px 4px", border: `1px solid ${T.border}`,
  borderRadius: 5, background: T.surface, color: T.text,
  fontFamily: "Figtree, sans-serif", width: "100%", cursor: "pointer",
  boxSizing: "border-box", ...extra,
});
const inInp = (T, extra = {}) => ({
  fontSize: 11, padding: "3px 5px", border: `1px solid ${T.border}`,
  borderRadius: 5, background: T.surface, color: T.text,
  fontFamily: "Figtree, sans-serif", width: "100%", boxSizing: "border-box", ...extra,
});

// ── Row bg based on status ────────────────────────────────────
const rowBg = (r, isSkipped, T) => {
  if (isSkipped) return T.sur2;
  if (r.flagged) return "#fff7ed";
  if (r.status === "possible_duplicate") return "#fefce8";
  return T.surface;
};

// ── Shared action button style ────────────────────────────────
const ACT_BTN = (extra = {}) => ({
  width: 26, height: 26, borderRadius: 6, border: "1px solid #e5e7eb",
  background: "#f9fafb", cursor: "pointer", fontSize: 12, fontWeight: 700,
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "Figtree, sans-serif", padding: 0, flexShrink: 0, ...extra,
});

// ─────────────────────────────────────────────────────────────────
export default function AIImport({ user, accounts, ledger, onRefresh, setLedger, dark, merchantMaps = [], fxRates = {}, CURRENCIES = [], setPendingSyncs }) {
  const T = dark ? DARK : LIGHT;
  const fileRef = useRef();

  const [mode,        setMode]        = useState("scan");
  const [scanning,    setScanning]    = useState(false);
  const [results,     setResults]     = useState([]);
  const [selected,    setSelected]    = useState({});
  const [skipped,     setSkipped]     = useState(new Set());
  const [notesOpen,   setNotesOpen]   = useState(new Set());
  const [importing,   setImporting]   = useState(false);
  const [importingId, setImportingId] = useState(null);

  const [gmailPending, setGmailPending] = useState([]); // raw email_sync rows
  const [gmailRows,   setGmailRows]    = useState([]); // flattened tx rows for TxCard
  const [gmailSel,    setGmailSel]     = useState({});
  const [gmailSkip,   setGmailSkip]    = useState(new Set());
  const [gmailNotes,  setGmailNotes]   = useState(new Set());
  const [gmailImpId,  setGmailImpId]   = useState(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailLoaded,  setGmailLoaded]  = useState(false);

  const bankAccounts  = accounts.filter(a => a.type === "bank");
  const ccAccounts    = accounts.filter(a => a.type === "credit_card");
  const spendAccounts = [...bankAccounts, ...ccAccounts];

  // ── FX rate lookup ────────────────────────────────────────────
  const getDefaultRate = (currency) => {
    if (!currency || currency.toUpperCase() === "IDR") return 1;
    const upper = currency.toUpperCase();
    // fxRates keys may be uppercase or lowercase — check both
    const rate = fxRates[upper] || fxRates[currency] || fxRates[upper.toLowerCase()];
    if (rate) return rate;
    const c = CURRENCIES.find(c => c.code.toUpperCase() === upper);
    return c ? c.rate : 1;
  };

  // ── Transfer detection ────────────────────────────────────────
  const isOwnAccount = (accountNo) => {
    if (!accountNo) return false;
    const no = String(accountNo).replace(/\s/g, "");
    return accounts.some(a => {
      const aNo = String(a.account_no || "").replace(/\s/g, "");
      return (aNo && (aNo.includes(no) || no.includes(aNo))) ||
             (a.last4 && no.slice(-4) === a.last4);
    });
  };

  const fixTransferType = (tx) => {
    if (tx.tx_type !== "transfer") return tx;
    const toOwn   = tx.to_account_id
      ? accounts.some(a => a.id === tx.to_account_id)
      : isOwnAccount(tx.to_account_no);
    const fromOwn = tx.from_account_id
      ? accounts.some(a => a.id === tx.from_account_id)
      : isOwnAccount(tx.from_account_no);
    if (toOwn && fromOwn) return tx;                           // both own → keep transfer
    if (toOwn && !fromOwn) return { ...tx, tx_type: "income" }; // money in from outside
    return { ...tx, tx_type: "expense", to_id: null, to_account_id: null }; // outgoing to external
  };

  // ── Merchant learning ─────────────────────────────────────────
  const lookupLearned = (desc) => {
    if (!desc || !merchantMaps.length) return null;
    const lower = desc.toLowerCase();
    return merchantMaps.find(m => {
      const mn = (m.merchant_name || "").toLowerCase();
      return mn && (lower.includes(mn) || mn.includes(lower));
    }) || null;
  };

  const saveMerchantMapping = (r) => {
    const name = (r.description || r.merchant_name || "").trim();
    if (!name || !r.category_id || NO_CAT.has(r.tx_type)) return;
    const cat = EXPENSE_CATEGORIES.find(c => c.id === r.category_id)
             || INCOME_CATEGORIES_LIST.find(c => c.id === r.category_id);
    merchantApi.upsert(user.id, name, r.category_id, cat?.label || r.category_id).catch(() => {});
  };

  const updateRow = (id, patch) =>
    setResults(prev => prev.map(r => r._id === id ? { ...r, ...patch } : r));

  const isReimburseAccount = (acc) =>
    String(acc.account_no || "").includes("0830267743") ||
    acc.name?.toLowerCase().includes("reimburse") ||
    acc.subtype === "reimburse";

  const checkDuplicate = (date, amount, description) => {
    const amt = Number(amount);
    return ledger.some(l =>
      l.tx_date === date &&
      Math.abs(Number(l.amount_idr || l.amount) - amt) < 5 &&
      (l.description || "").trim().toLowerCase() === (description || "").trim().toLowerCase()
    );
  };

  // ── File scan ────────────────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return;
    setScanning(true);
    setResults([]);
    setSelected({});
    setSkipped(new Set());
    setNotesOpen(new Set());
    try {
      const parsed = await scanApi.scan(user.id, file, { accounts });
      const items = (parsed || []).map((r, i) => {
        let txType = r.type || r.tx_type || "expense";
        const defaultFrom = SHOW_EXPENSE_CAT.has(txType) || txType === "pay_cc" || txType === "reimburse_out"
          ? (spendAccounts[0]?.id || "") : "";
        const defaultTo = SHOW_INCOME_CAT.has(txType) || txType === "transfer" || txType === "reimburse_in"
          ? (bankAccounts[0]?.id || "") : "";
        let fromId  = r.from_account_id || defaultFrom;
        let toId    = r.to_account_id   || defaultTo;
        let flagged = false;

        if (txType !== "reimburse_in" && toId) {
          const toAcc = accounts.find(a => a.id === toId);
          if (toAcc && isReimburseAccount(toAcc)) { txType = "reimburse_in"; flagged = true; }
        }
        if (txType === "reimburse_in" && fromId) {
          const fromAcc = accounts.find(a => a.id === fromId);
          if (fromAcc && isReimburseAccount(fromAcc)) flagged = true;
        }
        if (txType === "reimburse_in") flagged = true;

        let aiCatId  = r.category || r.suggested_category || "other";
        const txDate = r.date || r.tx_date || todayStr();
        const desc   = r.description || r.merchant_name || "";

        // FX setup — must happen before amount_idr calc
        const currency = (r.currency || "IDR").toUpperCase();
        const isFX     = currency !== "IDR";
        const fxRate   = isFX
          ? String(r.fx_rate_used || r.rate || getDefaultRate(currency))
          : "1";
        // For FX: amount = raw foreign amount (e.g. 6.66 USD)
        // For IDR: amount = IDR amount from AI
        const amount   = Number(r.amount || 0);
        // Always compute IDR from rate — never trust AI's amount_idr for FX rows
        const amtIDR   = isFX
          ? String(Math.round(amount * Number(fxRate)))
          : String(r.amount_idr || amount);

        // Normalise pseudo-types (bank_charges, materai, tax, bank_interest, cashback)
        const norm = normaliseTxType(txType, aiCatId);
        txType = norm.tx_type;
        aiCatId = norm.category_id;

        // Apply transfer detection
        const fixed = fixTransferType({ tx_type: txType, from_account_id: fromId, to_account_id: toId, to_account_no: r.to_account_no, from_account_no: r.from_account_no });
        txType = fixed.tx_type;
        if (fixed.to_account_id === null) toId = "";

        // Apply keyword-based auto-classification (overrides AI suggestion)
        // Pass IDR-equivalent for maxAmount threshold check
        const kwMatch = applyKeywordRules(desc, isFX ? Number(amtIDR) : amount);
        if (kwMatch) {
          txType  = kwMatch.tx_type;
          aiCatId = kwMatch.category_id;
        }

        // Apply merchant learning
        const learned = lookupLearned(desc);
        let catId = NO_CAT.has(txType) ? null : aiCatId;
        let learnedCat = null;
        if (learned && !NO_CAT.has(txType)) {
          learnedCat = learned;
          if (learned.confidence >= 2) catId = learned.category_id; // confident → override
        }

        return {
          _id:          i,
          tx_date:      txDate,
          description:  desc,
          merchant_name: r.merchant_name || "",
          amount:       String(amount),        // original foreign amount (or IDR)
          currency,
          fx_rate:      fxRate,               // editable rate
          amount_idr:   amtIDR,               // IDR equivalent, auto-recalculated
          tx_type:      txType,
          from_id:      fromId,
          to_id:        toId,
          entity:       REIMBURSE_ENTITIES.includes(r.entity) ? r.entity : "Hamasa",
          category_id:  catId,
          ai_category:  aiCatId,
          learned_cat:  learnedCat,
          notes:        r.notes || "",
          flagged,
          status:       checkDuplicate(txDate, amtIDR, desc) ? "possible_duplicate" : "new",
        };
      });
      setResults(items);
      const sel = {};
      items.forEach(r => { sel[r._id] = true; });
      setSelected(sel);
    } catch (e) {
      showToast(e.message || "Scan failed", "error");
    }
    setScanning(false);
  };

  // ── Build ledger entry ────────────────────────────────────────
  const buildEntry = (r) => {
    const { from_type, to_type } = getTxFromToTypes(r.tx_type);
    const isFX     = r.currency && r.currency !== "IDR";
    const fxRate   = isFX ? (Number(r.fx_rate) || 1) : 1;
    const amtOrig  = Number(r.amount) || 0;
    const amtIDR   = isFX
      ? (Number(r.amount_idr) || Math.round(amtOrig * fxRate))
      : amtOrig;
    return {
      tx_date:       r.tx_date,
      description:   r.description,
      amount:        amtOrig,
      currency:      r.currency || "IDR",
      fx_rate_used:  isFX ? fxRate : null,
      amount_idr:    amtIDR,
      tx_type:       r.tx_type,
      from_type, to_type,
      from_id:       r.from_id || null,
      to_id:         r.to_id   || null,
      entity:        REIMBURSE_TYPES.has(r.tx_type) ? (r.entity || "Hamasa") : "Personal",
      category_id:   r.category_id || null,
      category_name: r.category_id || null,
      notes:         r.notes || "",
    };
  };

  // ── Import selected ───────────────────────────────────────────
  const importSelected = async () => {
    const toImport = results.filter(r => selected[r._id] && !skipped.has(r._id));
    if (!toImport.length) return showToast("Select at least one entry", "warning");
    setImporting(true);
    let ok = 0;
    for (const r of toImport) {
      try {
        const created = await ledgerApi.create(user.id, buildEntry(r), accounts);
        if (created) {
          setLedger(prev => [created, ...prev]);
          ok++;
          saveMerchantMapping(r);
        }
      } catch { /* continue */ }
    }
    await onRefresh();
    showToast(`Imported ${ok} of ${toImport.length} entries`);
    setResults([]);
    setSelected({});
    setImporting(false);
  };

  // ── Import single row ─────────────────────────────────────────
  const importOne = async (r) => {
    setImportingId(r._id);
    try {
      const created = await ledgerApi.create(user.id, buildEntry(r), accounts);
      if (created) {
        setLedger(prev => [created, ...prev]);
        saveMerchantMapping(r);
        setResults(prev => prev.filter(x => x._id !== r._id));
        setSelected(s => { const ns = { ...s }; delete ns[r._id]; return ns; });
        showToast(`Imported: ${r.description}`);
      }
    } catch (e) { showToast(e.message, "error"); }
    setImportingId(null);
  };

  // ── Gmail ─────────────────────────────────────────────────────
  // Convert email_sync rows → TxCard-compatible rows
  const flattenEmailSync = (rows) => {
    const out = [];
    for (const es of rows) {
      const txList = Array.isArray(es.ai_raw_result) ? es.ai_raw_result : [];
      if (!txList.length) continue;
      txList.forEach((tx, i) => {
        const rawType = tx.suggested_tx_type || "expense";
        const { tx_type, category_id: overrideCat } = normaliseTxType(rawType, tx.category_id);
        const txCurrency = (tx.currency || "IDR").toUpperCase();
        const txIsFX     = txCurrency !== "IDR";
        const txAmount   = Number(tx.amount || 0);
        const txRate     = txIsFX ? getDefaultRate(txCurrency) : 1;
        const txAmtIDR   = txIsFX
          ? Math.round(txAmount * txRate)
          : Number(tx.amount_idr || tx.amount || 0);

        // Apply transfer detection — same logic as scan flow
        let resolvedType = tx_type;
        let resolvedToId = tx.to_account_id || null;
        if (resolvedType === "transfer") {
          const fixed = fixTransferType({
            tx_type:         resolvedType,
            from_account_id: tx.from_account_id || null,
            to_account_id:   resolvedToId,
            to_account_no:   tx.to_account_no   || null,
            from_account_no: tx.from_account_no || null,
          });
          resolvedType = fixed.tx_type;
          if (fixed.tx_type !== "transfer") resolvedToId = null;
        }
        // Category: null for no-cat types, else use AI suggestion or "other" as fallback
        const resolvedCatId = NO_CAT.has(resolvedType)
          ? null
          : (overrideCat || tx.category_id || "other");

        out.push({
          _id:             `${es.id}__${i}`,
          _email_sync_id:  es.id,
          _email_subject:  es.subject,
          tx_date:         tx.date || es.received_at?.slice(0, 10) || todayStr(),
          description:     tx.description || es.subject || "(no description)",
          merchant_name:   tx.merchant_name || null,
          amount:          txAmount,
          amount_idr:      txAmtIDR,
          currency:        txCurrency,
          fx_rate:         String(txRate),
          tx_type:         resolvedType,
          category_id:     resolvedCatId,
          category_name:   tx.suggested_category || null,
          from_id:         tx.from_account_id || null,
          to_id:           resolvedToId,
          status:          "new",
          notes:           es.subject || "",
          conf:            Number(tx.confidence || 0) >= 0.85 ? 1 : 0,
          is_qris:         tx.is_qris || false,
          learned_cat:     null,
          flagged:         false,
        });
      });
    }
    return out;
  };

  const loadGmailPending = async () => {
    if (gmailLoaded) return;
    setGmailLoading(true);
    try {
      const data = await gmailApi.getPending(user.id);
      setGmailPending(data || []);
      const rows = flattenEmailSync(data || []);
      setGmailRows(rows);
      const sel = {};
      rows.forEach(r => { sel[r._id] = true; });
      setGmailSel(sel);
      setGmailLoaded(true);
    } catch { showToast("Could not load Gmail pending", "error"); }
    setGmailLoading(false);
  };

  const updateGmailRow = (id, patch) => {
    setGmailRows(prev => prev.map(r => r._id === id ? { ...r, ...patch } : r));
  };

  const importOneGmail = async (r) => {
    setGmailImpId(r._id);
    try {
      const { from_type, to_type } = getTxFromToTypes(r.tx_type);
      const entry = {
        tx_date: r.tx_date, description: r.description,
        merchant_name: r.merchant_name,
        amount: r.amount, currency: r.currency, amount_idr: r.amount_idr,
        tx_type: r.tx_type, from_type, to_type,
        from_id: r.from_id || null, to_id: r.to_id || null,
        entity: "Personal",
        category_id: r.category_id || null,
        notes: r.notes || null,
        ai_categorized: true, ai_confidence: r.conf || null,
        scan_batch_id: null,
      };
      const created = await ledgerApi.create(user.id, entry, accounts);
      if (created) setLedger(prev => [created, ...prev]);
      // Remove all rows from same email, mark email confirmed
      const syncId = r._email_sync_id;
      setGmailRows(prev => prev.filter(x => x._email_sync_id !== syncId));
      setGmailPending(prev => prev.filter(x => x.id !== syncId));
      setPendingSyncs?.(prev => (prev || []).filter(x => x.id !== syncId));
      await gmailApi.markImported(user.id, syncId);
      showToast(`Imported: ${r.description}`);
    } catch (e) { showToast(e.message, "error"); }
    setGmailImpId(null);
  };

  const skipOneGmail = async (r) => {
    const syncId = r._email_sync_id;
    setGmailRows(prev => prev.filter(x => x._email_sync_id !== syncId));
    setGmailPending(prev => prev.filter(x => x.id !== syncId));
    setPendingSyncs?.(prev => (prev || []).filter(x => x.id !== syncId));
    try { await gmailApi.markSkipped(user.id, syncId); } catch {}
  };

  // ── Summary ────────────────────────────────────────────────────
  const countSelected = results.filter(r => selected[r._id] && !skipped.has(r._id)).length;
  const countDup      = results.filter(r => r.status === "possible_duplicate").length;
  const allSelected   = results.length > 0 && results.every(r => selected[r._id] && !skipped.has(r._id));

  const toggleSelectAll = () => {
    const cur = results.every(r => selected[r._id] && !skipped.has(r._id));
    const ns = {};
    results.forEach(r => { ns[r._id] = !cur; });
    setSelected(ns);
  };

  const toggleNotes = (id) => setNotesOpen(s => {
    const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns;
  });

  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── MODE TABS ── */}
      <div style={{ display: "flex", gap: 4 }}>
        {[
          { id: "scan",  label: "📷 Scan Document" },
          { id: "gmail", label: "✉️ Gmail Pending" },
        ].map(t => (
          <button key={t.id}
            onClick={() => { setMode(t.id); if (t.id === "gmail") loadGmailPending(); }}
            style={{
              padding: "7px 16px", borderRadius: 99, border: "none",
              cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "Figtree, sans-serif",
              background: mode === t.id ? T.text : T.sur2,
              color:      mode === t.id ? T.darkText : T.text2,
              transition: "background .15s, color .15s",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════ SCAN TAB ═════════════════ */}
      {mode === "scan" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            style={{
              border: `2px dashed ${T.border}`, borderRadius: 16, padding: "28px 24px",
              textAlign: "center", cursor: "pointer", background: T.sur2,
            }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>
              Drop receipt, invoice, or bank statement
            </div>
            <div style={{ fontSize: 12, color: T.text3 }}>
              JPG · PNG · PDF — AI extracts all transactions automatically
            </div>
            <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: "none" }}
              onChange={e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ""; }} />
            {!scanning
              ? <div style={{ marginTop: 12 }}><Button variant="primary" size="sm">Choose File</Button></div>
              : <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: T.text2 }}>
                  <Spinner size={16} /> Scanning with AI…
                </div>
            }
          </div>

          {/* ── RESULTS ── */}
          {results.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Summary header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                flexWrap: "wrap", gap: 8,
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>
                    {results.length} transactions found
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 3 }}>
                    <span style={{ fontSize: 12, color: "#059669", fontFamily: "Figtree, sans-serif" }}>
                      ✅ {countSelected} new
                    </span>
                    {countDup > 0 && (
                      <span style={{ fontSize: 12, color: "#d97706", fontFamily: "Figtree, sans-serif" }}>
                        ⚠️ {countDup} possible duplicate{countDup > 1 ? "s" : ""}
                      </span>
                    )}
                    {skipped.size > 0 && (
                      <span style={{ fontSize: 12, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                        ✕ {skipped.size} skipped
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="secondary" size="sm" onClick={toggleSelectAll}>
                    {allSelected ? "Deselect All" : "Select All"}
                  </Button>
                  <Button variant="primary" size="sm" busy={importing} onClick={importSelected}>
                    Import {countSelected} Selected ▶
                  </Button>
                </div>
              </div>

              {/* Transaction cards — unified desktop + mobile */}
              <TxCardList
                results={results} selected={selected} skipped={skipped} notesOpen={notesOpen}
                importingId={importingId} T={T}
                accounts={accounts}
                updateRow={updateRow} setSelected={setSelected} setSkipped={setSkipped}
                toggleNotes={toggleNotes} importOne={importOne}
              />
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════ GMAIL TAB ════════════════ */}
      {mode === "gmail" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {gmailLoading ? (
            <div style={{ textAlign: "center", padding: 32 }}>
              <Spinner size={24} />
              <div style={{ fontSize: 12, color: T.text3, marginTop: 8 }}>Loading Gmail…</div>
            </div>
          ) : gmailRows.length === 0 ? (
            <EmptyState icon="✉️" message="No pending Gmail transactions. Connect Gmail in Settings → Email Sync." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>
                    {gmailRows.length} transaction{gmailRows.length !== 1 ? "s" : ""} pending
                  </div>
                  <div style={{ fontSize: 11, color: T.text3, marginTop: 2, fontFamily: "Figtree, sans-serif" }}>
                    {gmailPending.length} email{gmailPending.length !== 1 ? "s" : ""} from Gmail
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => {
                  const all = {};
                  gmailRows.forEach(r => { all[r._id] = true; });
                  setGmailSel(all);
                  setGmailSkip(new Set());
                }}>Select All</Button>
              </div>
              {/* Cards — same TxCard style as scan tab */}
              <TxCardList
                results={gmailRows}
                selected={gmailSel} skipped={gmailSkip} notesOpen={gmailNotes}
                importingId={gmailImpId} T={T}
                accounts={accounts}
                updateRow={updateGmailRow}
                setSelected={setGmailSel}
                setSkipped={(fn) => {
                  setGmailSkip(fn);
                }}
                toggleNotes={(id) => setGmailNotes(s => { const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns; })}
                importOne={importOneGmail}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Amount formatter — rounds to whole IDR, dot thousands separator
const fmtAmt = (v) => {
  const n = Math.round(Number(v) || 0);
  return "Rp " + n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

// ── Type → text color ─────────────────────────────────────────────
const TYPE_COLOR = {
  income:       "#3B6D11",
  collect_loan: "#3B6D11",
  reimburse_in: "#3B6D11",
  expense:      "#A32D2D",
  reimburse_out:"#c05e00",
  give_loan:    "#6b21a8",
  transfer:     "#185FA5",
  pay_cc:       "#185FA5",
  fx_exchange:  "#185FA5",
};

// ── Amount sign helper ────────────────────────────────────────────
const amtSign = (type) => {
  if (["income","collect_loan","reimburse_in","fx_exchange"].includes(type)) return "+";
  if (["expense","give_loan","reimburse_out"].includes(type)) return "-";
  return "";
};

// ── Amount cell — formatted display, raw on focus ─────────────────
function AmountCell({ r, color, T, updateRow }) {
  const [focused, setFocused] = useState(false);
  const raw = r.amount_idr || r.amount || "";
  return (
    <div style={{ padding: "4px 6px" }}>
      <input
        type={focused ? "number" : "text"}
        style={inInp(T, { textAlign: "right", color, fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" })}
        value={focused ? raw : fmtAmt(raw)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={e => updateRow(r._id, { amount_idr: e.target.value, amount: e.target.value })}
      />
    </div>
  );
}


// ── Card account cell — adapts to tx type, uses NativeAccountSelect ─
function CardAccountCell({ r, updateRow, T, accounts }) {
  const t      = r.tx_type;
  const sel    = inSel(T, { fontSize: 11, width: "100%" });
  const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
  const bankAccs = accounts.filter(a => a.type === "bank");
  const ccAccs   = accounts.filter(a => a.type === "credit_card").sort(byName);

  if (t === "pay_cc") return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <NativeAccountSelect
        accounts={bankAccs} style={{ ...sel, flex: 1 }}
        value={r.from_id} placeholder="From Bank…"
        onChange={e => updateRow(r._id, { from_id: e.target.value })} />
      <span style={{ fontSize: 10, color: T.text3, flexShrink: 0 }}>→</span>
      <select style={{ ...sel, flex: 1 }} value={r.to_id || ""}
        onChange={e => updateRow(r._id, { to_id: e.target.value })}>
        <option value="">To CC…</option>
        {ccAccs.map(a => (
          <option key={a.id} value={a.id}>
            {a.name}{(a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : ""}
          </option>
        ))}
      </select>
    </div>
  );

  if (t === "transfer") return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <NativeAccountSelect
        accounts={bankAccs} style={{ ...sel, flex: 1 }}
        value={r.from_id} placeholder="From…"
        onChange={e => updateRow(r._id, { from_id: e.target.value })} />
      <span style={{ fontSize: 10, color: T.text3, flexShrink: 0 }}>→</span>
      <NativeAccountSelect
        accounts={bankAccs} style={{ ...sel, flex: 1 }}
        value={r.to_id} placeholder="To…"
        onChange={e => updateRow(r._id, { to_id: e.target.value })} />
    </div>
  );

  if (["income", "collect_loan", "reimburse_in"].includes(t)) return (
    <NativeAccountSelect
      accounts={bankAccs} style={sel}
      value={r.to_id} placeholder="To Account…"
      onChange={e => updateRow(r._id, { to_id: e.target.value })} />
  );

  // expense / reimburse_out / give_loan / fx_exchange — bank + CC
  return (
    <NativeAccountSelect
      accounts={accounts} showCC style={sel}
      value={r.from_id} placeholder="From Account…"
      onChange={e => updateRow(r._id, { from_id: e.target.value })} />
  );
}

// ══ TRANSACTION CARD ═════════════════════════════════════════════
// 2-row card: ROW1 = ☑ date desc amount ✓ ✕
//             ROW2 = type [badge] [category] account [entity] [fx]
function TxCard({
  r, selected, skipped, notesOpen, importingId, T,
  accounts,
  updateRow, setSelected, setSkipped, toggleNotes, importOne,
}) {
  const isSkipped  = skipped.has(r._id);
  const isSelected = !!selected[r._id];
  const isNotes    = notesOpen.has(r._id);
  const color      = amtColor(r.tx_type);
  const showCat    = !NO_CAT.has(r.tx_type);
  const showEntity = REIMBURSE_TYPES.has(r.tx_type) || r.flagged;
  const cats       = getCatOptions(r.tx_type);
  const isFX       = r.currency && r.currency !== "IDR";
  const displayDesc = r.description || r.merchant_name || r.notes || "";

  // Card appearance
  const isDup     = r.status === "possible_duplicate";
  const cardBg    = isSkipped ? T.sur2 : isDup ? "#fffbeb" : T.surface;
  const cardBorder = r.flagged ? "1.5px solid #f97316"
                   : isDup     ? "1.5px solid #d97706"
                   : `1px solid ${T.border}`;

  // Amount string
  const sign = amtSign(r.tx_type);
  const amtStr = isFX
    ? `${sign}${r.currency} ${Number(r.amount || 0).toLocaleString("id-ID")} ≈ ${fmtAmt(r.amount_idr || 0)}`
    : `${sign}${fmtAmt(r.amount_idr || r.amount || 0)}`;

  // Badge — only Learned / Suggest; no AI badge
  const badge = showCat
    ? (r.learned_cat && r.learned_cat.confidence >= 2 && r.learned_cat.category_id === r.category_id)
        ? { label: "✓ Learned", bg: "#dcfce7", color: "#059669" }
      : (r.learned_cat && r.learned_cat.confidence === 1)
        ? { label: "Suggest",   bg: "#fef9c3", color: "#a16207" }
      : null
    : null;

  const sel11 = inSel(T, { fontSize: 11 });

  return (
    <div style={{
      background: cardBg, border: cardBorder, borderRadius: 10,
      opacity: isSkipped ? 0.55 : 1,
      overflow: "hidden",
    }}>
      {/* ── ROW 1: ☑ date desc amount ✓ ✕ ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 12px 5px",
      }}>
        {/* Checkbox */}
        <input type="checkbox" checked={isSelected && !isSkipped}
          onChange={e => setSelected(s => ({ ...s, [r._id]: e.target.checked }))}
          disabled={isSkipped}
          style={{ accentColor: "#3b5bdb", width: 15, height: 15, flexShrink: 0, cursor: "pointer" }} />

        {/* Date */}
        <span style={{
          width: 52, fontSize: 11, color: T.text3,
          fontFamily: "Figtree, sans-serif", flexShrink: 0, whiteSpace: "nowrap",
        }}>
          {fmtDateShort(r.tx_date)}
        </span>

        {/* Description */}
        <input
          style={{
            flex: 1, minWidth: 0, border: "none", background: "transparent",
            outline: "none", fontSize: 13, fontWeight: 600,
            color: isSkipped ? T.text3 : T.text,
            fontFamily: "Figtree, sans-serif",
            textDecoration: isSkipped ? "line-through" : "none",
          }}
          value={displayDesc}
          onChange={e => updateRow(r._id, { description: e.target.value })}
          placeholder="Description…"
        />

        {/* Amount */}
        <span style={{
          fontSize: 13, fontWeight: 800, color,
          fontFamily: "Figtree, sans-serif", flexShrink: 0, whiteSpace: "nowrap",
          marginLeft: 4,
        }}>
          {amtStr}
        </span>

        {/* ✓ import */}
        <button onClick={() => importOne(r)}
          disabled={isSkipped || importingId === r._id}
          style={ACT_BTN({ background: "#dcfce7", color: "#059669", border: "1px solid #bbf7d0" })}
          title="Import">
          {importingId === r._id ? "…" : "✓"}
        </button>

        {/* ✕ / ↩ skip */}
        <button
          onClick={() => {
            setSkipped(s => { const ns = new Set(s); ns.has(r._id) ? ns.delete(r._id) : ns.add(r._id); return ns; });
            setSelected(s => ({ ...s, [r._id]: false }));
          }}
          style={ACT_BTN({ color: isSkipped ? "#059669" : "#9ca3af" })}
          title={isSkipped ? "Restore" : "Skip"}>
          {isSkipped ? "↩" : "✕"}
        </button>
      </div>

      {/* ── ROW 2: type [badge] [category] account [entity] [fx] [✏️] ── */}
      <div style={{
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5,
        padding: "2px 12px 9px 35px",
      }}>
        {/* Type — colored text based on type */}
        <select
          style={{ ...sel11, width: 100, color: TYPE_COLOR[r.tx_type] || T.text, fontWeight: 600 }}
          value={r.tx_type}
          onChange={e => {
            const t = e.target.value;
            updateRow(r._id, { tx_type: t, category_id: NO_CAT.has(t) ? null : r.category_id });
          }}>
          {IMPORT_TX_TYPES.map(t => (
            <option key={t.value} value={t.value} style={{ color: TYPE_COLOR[t.value] || "inherit", fontWeight: 600 }}>
              {t.label}
            </option>
          ))}
        </select>

        {/* Badge */}
        {badge && (
          <span style={{
            fontSize: 9, fontWeight: 800, background: badge.bg, color: badge.color,
            padding: "2px 5px", borderRadius: 4, fontFamily: "Figtree, sans-serif",
            whiteSpace: "nowrap", flexShrink: 0,
          }}>
            {badge.label}
          </span>
        )}

        {/* Category */}
        {showCat && (
          <select style={{ ...sel11, width: 130 }}
            value={r.category_id || ""}
            onChange={e => updateRow(r._id, { category_id: e.target.value })}>
            {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}

        {/* Account */}
        <div style={{ flex: 1, minWidth: 160 }}>
          <CardAccountCell r={r} updateRow={updateRow} T={T}
            accounts={accounts} />
        </div>

        {/* Entity toggle (reimburse only) */}
        {showEntity && (
          <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
            {REIMBURSE_ENTITIES.map(en => (
              <button key={en} onClick={() => updateRow(r._id, { entity: en })}
                title={en}
                style={{
                  padding: "2px 8px", borderRadius: 4,
                  border: `1.5px solid ${r.entity === en ? "#3b5bdb" : T.border}`,
                  background: r.entity === en ? "#dbeafe" : T.surface,
                  color: r.entity === en ? "#1d4ed8" : T.text3,
                  fontSize: 10, fontWeight: 700, cursor: "pointer",
                  fontFamily: "Figtree, sans-serif",
                }}>
                {en}
              </button>
            ))}
          </div>
        )}

        {/* FX rate input */}
        {isFX && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span style={{
              fontSize: 10, color: T.text3, fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap",
            }}>Rate:</span>
            <input
              type="number"
              style={inInp(T, { width: 64, fontSize: 11, textAlign: "right" })}
              value={r.fx_rate ?? ""}
              onChange={e => {
                const rate = e.target.value;
                const idr  = Math.round(Number(r.amount || 0) * Number(rate || 0));
                updateRow(r._id, { fx_rate: rate, amount_idr: String(idr) });
              }}
            />
          </div>
        )}

        {/* ✏️ notes toggle */}
        <button
          onClick={() => toggleNotes(r._id)}
          style={ACT_BTN({
            background: isNotes ? "#dbeafe" : T.sur2,
            color: isNotes ? "#3b5bdb" : T.text3,
            width: 24, height: 24, fontSize: 11,
          })}
          title="Notes">
          ✏️
        </button>
      </div>

      {/* ── Notes row ── */}
      {isNotes && (
        <div style={{
          borderTop: `1px solid ${T.border}`, background: T.sur2,
          padding: "6px 12px 8px 35px",
          display: "flex", gap: 6, alignItems: "center",
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: T.text3, textTransform: "uppercase",
            letterSpacing: "0.04em", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap",
          }}>Notes</span>
          <input
            style={inInp(T, { fontSize: 11, flex: 1 })}
            value={r.notes || ""}
            onChange={e => updateRow(r._id, { notes: e.target.value })}
            placeholder="Optional notes…"
          />
        </div>
      )}
    </div>
  );
}

// ══ TRANSACTION CARD LIST ════════════════════════════════════════
function TxCardList({
  results, selected, skipped, notesOpen, importingId, T,
  accounts,
  updateRow, setSelected, setSkipped, toggleNotes, importOne,
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {results.map(r => (
        <TxCard
          key={r._id} r={r}
          selected={selected} skipped={skipped} notesOpen={notesOpen}
          importingId={importingId} T={T}
          accounts={accounts}
          updateRow={updateRow} setSelected={setSelected} setSkipped={setSkipped}
          toggleNotes={toggleNotes} importOne={importOne}
        />
      ))}
    </div>
  );
}
