// ─── NUMBER FORMATTING ────────────────────────────────────────
// Always use dot as thousand separator (Indonesian locale)
// e.g. Rp 1.250.750.000

export const fmt = (n) =>
  "Rp " + Math.abs(Number(n || 0)).toLocaleString("id-ID");

export const fmtIDR = (n, short = false) => {
  const v = Math.abs(Number(n || 0));
  if (short && v >= 1e9) return "Rp " + (v / 1e9).toFixed(1) + "B";
  if (short && v >= 1e6) return "Rp " + (v / 1e6).toFixed(1) + "M";
  if (short && v >= 1e3) return "Rp " + (v / 1e3).toFixed(0) + "K";
  return "Rp " + v.toLocaleString("id-ID");
};

export const fmtCur = (amount, currency) => {
  if (currency === "IDR") return fmtIDR(amount);
  const symbols = { USD: "$", SGD: "S$", MYR: "RM", JPY: "¥", EUR: "€", AUD: "A$" };
  return (symbols[currency] || currency) + " " + Number(amount || 0).toFixed(2);
};

export const fmtPct = (n) => {
  const v = Number(n || 0);
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
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
  return new Date(dateStr).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

// ─── AGING LABEL ─────────────────────────────────────────────
export const agingLabel = (dateStr) => {
  const days = Math.floor((new Date() - new Date(dateStr)) / 86400000);
  if (days <= 30)  return { label: "< 30d",  color: "#059669" };
  if (days <= 60)  return { label: "31–60d", color: "#d97706" };
  return { label: "60d+", color: "#dc2626" };
};

// ─── NET WORTH CALCULATION ───────────────────────────────────
export const calcNetWorth = (accounts) => {
  let bank = 0, assets = 0, receivables = 0, ccDebt = 0, liabilities = 0;

  for (const a of accounts) {
    if (!a.is_active) continue;
    if (a.type === "bank" || a.type === "debit_card") {
      bank += Number(a.current_balance || 0);
    } else if (a.type === "credit_card") {
      ccDebt += Number(a.current_balance || 0);
    } else if (a.type === "asset") {
      assets += Number(a.current_value || 0);
    } else if (a.type === "receivable") {
      receivables += Number(a.outstanding_amount || 0);
    } else if (a.type === "liability") {
      liabilities += Number(a.outstanding_amount || 0);
    }
  }

  const total = bank + assets + receivables - ccDebt - liabilities;
  return { total, bank, assets, receivables, ccDebt, liabilities };
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
    const key = e.date;
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

// ─── MISC ─────────────────────────────────────────────────────
export const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

export const parseJSON = (text, fallback) => {
  try { return JSON.parse((text || "").replace(/```json|```/g, "").trim()); }
  catch { return fallback; }
};
