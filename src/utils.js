// ─── NUMBER FORMATTING ────────────────────────────────────────
// Always use dot as thousand separator (Indonesian locale)
// e.g. Rp 1.250.750.000

export const fmt = (n) =>
  "Rp " + Math.round(Math.abs(Number(n || 0))).toLocaleString("id-ID");

export const fmtIDR = (n, short = false) => {
  const v = Math.round(Math.abs(Number(n || 0)));
  if (short && v >= 1e9) return "Rp " + (v / 1e9).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "B";
  if (short && v >= 1e6) return "Rp " + (v / 1e6).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "M";
  if (short && v >= 1e3) return "Rp " + Math.round(v / 1e3).toLocaleString("id-ID") + "K";
  return "Rp " + v.toLocaleString("id-ID");
};

export const fmtCur = (amount, currency) => {
  if (!currency || currency === "IDR") return fmtIDR(amount);
  const symbols = { USD: "$", SGD: "S$", MYR: "RM", JPY: "¥", EUR: "€", AUD: "A$", GBP: "£", CHF: "Fr", CNY: "¥", THB: "฿", KRW: "₩", HKD: "HK$" };
  const sym = symbols[currency] || currency + " ";
  const num = Number(amount || 0);
  return sym + num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

export const fmtPct = (n) => {
  const v = Number(n || 0);
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
};

// Foreign currency: native symbol + id-ID locale (dot thousand, comma decimal)
// e.g. fmtCurNative(1000, "SGD") → "S$1.000"
const NATIVE_SYMBOLS = {
  USD: "US$", SGD: "S$", EUR: "€", JPY: "¥", GBP: "£", AUD: "A$",
  HKD: "HK$", CHF: "CHF", MYR: "RM", THB: "฿", KRW: "₩", CNY: "¥",
};
export const fmtCurNative = (amount, currency) => {
  if (!currency || currency === "IDR") return fmtIDR(amount);
  const sym = NATIVE_SYMBOLS[currency] || (currency + " ");
  const v = Number(amount || 0);
  return sym + v.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};
export const fmtCurNativeShort = (amount, currency) => {
  if (!currency || currency === "IDR") return fmtIDR(amount, true);
  const sym = NATIVE_SYMBOLS[currency] || (currency + " ");
  const abs = Math.abs(Number(amount || 0));
  if (abs >= 1e9) return sym + (abs / 1e9).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "B";
  if (abs >= 1e6) return sym + (abs / 1e6).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "M";
  if (abs >= 1e3) return sym + Math.round(abs / 1e3).toLocaleString("id-ID") + "K";
  return sym + abs.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

// ─── FX ──────────────────────────────────────────────────────
export const toIDR = (amount, currency, fxRates = {}, CURRENCIES = []) => {
  if (currency === "IDR") return amount;
  if (fxRates[currency]) return amount * fxRates[currency];
  const cur = CURRENCIES.find(c => c.code === currency);
  return amount * (cur?.rate || 1);
};

// ─── DATE HELPERS ─────────────────────────────────────────────
export const todayStr = () => new Date().toISOString().slice(0, 10);

// "2026-04" from "2026-04-08"
export const ym = (d) => d?.slice(0, 7) || "";

// "April 2026" from "2026-04"
export const mlFull = (s) => {
  try {
    const [y, m] = s.split("-");
    return new Date(y, m - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } catch { return s; }
};

// "Apr '26" from "2026-04"
export const mlShort = (s) => {
  try {
    const [y, m] = s.split("-");
    return new Date(y, m - 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  } catch { return s; }
};

// Days until next occurrence of day-of-month
export const daysUntil = (dayOfMonth) => {
  const now = new Date();
  let target = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
  if (target <= now) target = new Date(now.getFullYear(), now.getMonth() + 1, dayOfMonth);
  return Math.ceil((target - now) / 86400000);
};

// Days until a specific date string
export const daysUntilDate = (dateStr) => {
  const now = new Date();
  const target = new Date(dateStr);
  return Math.ceil((target - now) / 86400000);
};

// Format date for display: "Today", "Yesterday", or "Mon, Apr 8"
export const fmtDateLabel = (dateStr) => {
  const today = todayStr();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

// ─── AGING LABEL ─────────────────────────────────────────────
export const agingLabel = (dateStr) => {
  const days = Math.floor((new Date() - new Date(dateStr)) / 86400000);
  if (days <= 30)  return { label: "< 30d",  color: "#059669" };
  if (days <= 60)  return { label: "31–60d", color: "#d97706" };
  return { label: "60d+", color: "#dc2626" };
};

// ─── NET WORTH CALCULATION ───────────────────────────────────
export const calcNetWorth = (accounts, { employeeLoans = [], loanPayments = [], fxRates = {}, reimburseSettlements = [] } = {}) => {
  let bank = 0, cash = 0, assets = 0, receivables = 0, liabilities = 0, ccBalance = 0;

  const toIDRValue = (amount, currency) => {
    if (!currency || currency === "IDR") return Number(amount || 0);
    if (!fxRates[currency]) console.warn(`[calcNetWorth] No FX rate for ${currency}, defaulting to 1`);
    return Number(amount || 0) * (fxRates[currency] || 1);
  };

  for (const a of accounts) {
    if (!a.is_active) continue;
    if (a.type === "bank") {
      if (a.subtype === "cash") {
        cash += toIDRValue(a.current_balance, a.currency);
      } else {
        bank += toIDRValue(a.current_balance, a.currency);
      }
    } else if (a.type === "credit_card") {
      // outstanding_amount = debt (>= 0); current_balance = CR, not net worth
      ccBalance += toIDRValue(a.outstanding_amount || 0, a.currency);
    } else if (a.type === "asset") {
      assets += toIDRValue(a.current_value || a.current_balance || 0, a.currency);
    } else if (a.type === "receivable") {
      receivables += Number(a.receivable_outstanding || 0);
    } else if (a.type === "liability") {
      liabilities += Number(a.outstanding_amount || 0);
    }
  }

  // ccDebt = total outstanding (positive)
  const ccDebt = ccBalance;

  const employeeLoanTotal = employeeLoans
    .filter(l => l.status !== "settled")
    .reduce((sum, l) => {
      const paid = loanPayments
        .filter(p => p.loan_id === l.id)
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      return sum + Math.max(0, Number(l.total_amount || 0) - paid);
    }, 0);

  const reimburseOutstanding = reimburseSettlements
    .reduce((sum, s) => sum + Math.max(0, Number(s.total_out || 0) - Number(s.total_in || 0)), 0);

  // subtract outstanding from net worth
  const total = bank + cash + assets + receivables + employeeLoanTotal + reimburseOutstanding - ccBalance - liabilities;
  return { total, bank, cash, assets, receivables, ccDebt, liabilities, employeeLoanTotal, reimburseOutstanding };
};

// ─── CATEGORY HELPERS ─────────────────────────────────────────
export const suggestCategory = (description, merchantMaps, EXPENSE_CATEGORIES) => {
  const lower = (description || "").toLowerCase();

  // Check merchant mappings first
  const mapped = merchantMaps?.find(m => lower.includes(m.merchant_name));
  if (mapped) return mapped.category_id;

  // Keyword matching
  for (const cat of EXPENSE_CATEGORIES) {
    if (cat.keywords.some(kw => lower.includes(kw))) return cat.id;
  }
  return "other";
};

// ─── GROUP BY DATE ────────────────────────────────────────────
export const groupByDate = (entries) => {
  const groups = {};
  for (const e of entries) {
    const key = e.tx_date;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  }
  return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
};

// ─── GREETING ─────────────────────────────────────────────────
export const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

// ─── UUID SANITIZER ───────────────────────────────────────────
// Any UUID field must be null if empty — never send "" to Supabase
export const toUUID = (val) =>
  (!val || val === "" || val === "undefined" || val === "null") ? null : val;

// ─── MISC ─────────────────────────────────────────────────────
export const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

export const parseJSON = (text, fallback) => {
  try { return JSON.parse((text || "").replace(/```json|```/g, "").trim()); }
  catch { return fallback; }
};

// ─── DUPLICATE CHECK ──────────────────────────────────────────
// Checks in-memory ledger for a possible duplicate transaction.
// Returns the first matching entry (description, amount_idr, tx_date) or null.
// Match criteria: date ±1 day, amount ±1% or ±500 IDR, currency match.
// Returns { level: 'red'|'orange'|'green', reasons: string[], matchEntry: object } or null.
// RED   — all 5: currency + account + amount exact + date exact + desc ≥80% (or exact merchant)
// ORANGE — all 5: currency + account + amount ±1% + date ±1 day + desc ≥50%
// GREEN  — currency + amount exact + date ±3 days (account NOT required)
export const checkDuplicateTransaction = (ledger, {
  tx_date, amount_idr, currency = "IDR", from_id = "", description = "",
}) => {
  if (!tx_date || !amount_idr) return null;
  const amt = Number(amount_idr);
  if (!amt) return null;
  const tCurrency = (currency || "IDR").toUpperCase();

  const descSim = (a, b) => {
    const wa = new Set((a || "").toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wb = new Set((b || "").toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (!wa.size || !wb.size) return 0;
    let common = 0;
    wa.forEach(w => { if (wb.has(w)) common++; });
    return common / Math.max(wa.size, wb.size);
  };

  let orangeResult = null;
  let greenResult  = null;

  for (const e of (ledger || [])) {
    if (!e.tx_date) continue;
    const eCurrency = (e.currency || "IDR").toUpperCase();
    if (eCurrency !== tCurrency) continue;

    const eAmt     = Number(e.amount_idr || e.amount || 0);
    const amtDiff  = Math.abs(eAmt - amt);
    const dayDiff  = Math.abs(new Date(e.tx_date) - new Date(tx_date)) / 86400000;
    const tolerance = Math.max(500, amt * 0.01);
    const tDesc    = (description || "").toLowerCase().trim();
    const eDesc    = (e.description || e.merchant_name || "").toLowerCase().trim();
    const sim      = descSim(eDesc, tDesc);
    const exactMerchant = tDesc && eDesc && tDesc === eDesc;
    const sameAccount   = !!(from_id && (e.from_id || e.from_account_id) &&
                             from_id === (e.from_id || e.from_account_id));

    // ── RED ───────────────────────────────────────────────────────
    if (amtDiff < 0.01 && dayDiff < 0.5 && sameAccount && (sim >= 0.8 || exactMerchant)) {
      const reasons = ["same date", "exact amount", "same currency", "same account"];
      if (exactMerchant) reasons.push("exact merchant");
      else reasons.push(`${Math.round(sim * 100)}% desc match`);
      return { level: "red", reasons, matchEntry: e };
    }

    // ── ORANGE ────────────────────────────────────────────────────
    if (!orangeResult && amtDiff <= tolerance && dayDiff <= 1 && sameAccount && sim >= 0.5) {
      const reasons = ["same currency", "same account"];
      reasons.push(dayDiff < 0.5 ? "same date" : "±1 day");
      reasons.push(amtDiff < 0.01 ? "exact amount" : `amount ±${(amtDiff / amt * 100).toFixed(1)}%`);
      reasons.push(`${Math.round(sim * 100)}% desc match`);
      orangeResult = { level: "orange", reasons, matchEntry: e };
    }

    // ── GREEN ─────────────────────────────────────────────────────
    if (!greenResult && amtDiff < 0.01 && dayDiff <= 3) {
      const reasons = ["same currency", "exact amount"];
      reasons.push(dayDiff < 0.5 ? "same date" : `±${Math.round(dayDiff)} day${Math.round(dayDiff) > 1 ? "s" : ""}`);
      if (!sameAccount) reasons.push("different account");
      greenResult = { level: "green", reasons, matchEntry: e };
    }
  }

  return orangeResult || greenResult || null;
};

// ─── CATEGORY / INCOME-SOURCE LOOKUP (DB-FIRST) ──────────────
// Source of truth = expense_categories / income_sources tables (per-user UUIDs).
// All import flows resolve AI/scan name strings → DB UUIDs via these helpers.

const SLUG_TO_LABEL_LEGACY = {
  food: "Food & Drinks", home: "Home & Utilities", transport: "Transport",
  health: "Health", shopping: "Shopping", education: "Education",
  entertainment: "Entertainment", business: "Business & Ops", finance: "Finance",
  family: "Family", social: "Social & Gifts", cash_advance_fee: "Cash Advance Fee",
  bank_charges: "Bank Charges", materai: "Stamp Duty", tax: "Tax", other: "Other",
  salary: "Salary", rental_income: "Rental Income", dividend: "Dividend",
  freelance: "Freelance", loan_collection: "Loan Collection",
  bank_interest: "Bank Interest", cashback: "Cashback", other_income: "Other Income",
  personal_shopping: "Personal Shopping",
};

const _norm = (s) => String(s ?? "").trim().toLowerCase();

// Generic name → entity lookup with plural-tolerant + legacy-slug fallback.
function _lookupByName(nameOrSlug, list, fallbackNames = []) {
  if (!nameOrSlug || !list?.length) return null;
  const t = _norm(nameOrSlug);

  // 1. Exact match
  let hit = list.find(c => _norm(c.name) === t);
  if (hit) return { id: hit.id, name: hit.name, source: "exact" };

  // 2. Legacy slug → label, then exact match
  const slugLabel = SLUG_TO_LABEL_LEGACY[t];
  if (slugLabel) {
    hit = list.find(c => _norm(c.name) === _norm(slugLabel));
    if (hit) return { id: hit.id, name: hit.name, source: "fuzzy" };
  }

  // 3. Plural-tolerant ("Food & Drinks" ↔ "Food & Drink")
  const singular = t.endsWith("s") ? t.slice(0, -1) : t;
  const plural   = t.endsWith("s") ? t : t + "s";
  hit = list.find(c => {
    const n = _norm(c.name);
    return n === singular || n === plural;
  });
  if (hit) return { id: hit.id, name: hit.name, source: "fuzzy" };

  // 4. Fallback names (e.g. "Other", "Other Income")
  for (const fb of fallbackNames) {
    hit = list.find(c => _norm(c.name) === _norm(fb));
    if (hit) return { id: hit.id, name: hit.name, source: "fallback" };
  }
  return null;
}

/** Lookup expense category UUID by name (case-insensitive, plural-tolerant, slug-tolerant). */
export const lookupExpenseCategory = (nameOrSlug, userCategories = []) =>
  _lookupByName(nameOrSlug, userCategories, ["Other"]);

/** Lookup income source UUID by name. */
export const lookupIncomeSource = (nameOrSlug, userIncomeSources = []) =>
  _lookupByName(nameOrSlug, userIncomeSources, ["Other Income", "Other"]);

/**
 * 3-Layer auto-categorize for import flows.
 *   Layer 1 — merchant_mappings (per-user learned).
 *   Layer 2 — AI suggested name → DB lookup.
 *   Layer 3 — fallback to "Other" / "Other Income".
 *
 * Returns { id, name, source: 'merchant'|'ai'|'fallback'|null, confidence }.
 */
export const autoCategorize = ({
  merchantName,
  txType = "expense",
  aiSuggestedName,
  merchantMappings = [],
  userCategories = [],
}) => {
  const isIncome = txType === "income";
  const lookup = isIncome ? lookupIncomeSource : lookupExpenseCategory;

  // Layer 1 — merchant_mappings (must match tx_type)
  if (merchantName) {
    const m = _norm(merchantName);
    const mapping = merchantMappings.find(x =>
      x.tx_type === txType && _norm(x.merchant_name) === m
    );
    if (mapping?.category_id) {
      const cat = userCategories.find(c => c.id === mapping.category_id);
      if (cat) {
        return {
          id: cat.id, name: cat.name, source: "merchant",
          confidence: Number(mapping.confidence) || 90,
        };
      }
    }
  }

  // Layer 2 — AI suggested name → DB lookup
  if (aiSuggestedName) {
    const hit = lookup(aiSuggestedName, userCategories);
    if (hit && hit.source !== "fallback") {
      return {
        id: hit.id, name: hit.name, source: "ai",
        confidence: hit.source === "exact" ? 80 : 60,
      };
    }
  }

  // Layer 3 — fallback to "Other" / "Other Income"
  const fb = lookup(isIncome ? "Other Income" : "Other", userCategories);
  if (fb) return { id: fb.id, name: fb.name, source: "fallback", confidence: 0 };

  return { id: null, name: null, source: null, confidence: 0 };
};

/**
 * @deprecated Use lookupExpenseCategory / lookupIncomeSource instead.
 * Kept for backward compat — callers in older flows still rely on this signature.
 */
export const resolveCategoryIds = (slugOrLabel, dbCategories = []) => {
  if (!slugOrLabel) return { category_id: null, category_name: null };
  const hit = _lookupByName(slugOrLabel, dbCategories);
  if (hit) return { category_id: hit.id, category_name: hit.name };
  const label = SLUG_TO_LABEL_LEGACY[_norm(slugOrLabel)] || slugOrLabel;
  return { category_id: null, category_name: label };
};
