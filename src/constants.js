// ─── APP VERSION ──────────────────────────────────────────────
export const APP_VERSION = "2.3.0";
export const APP_BUILD   = "2026-04-09";

// ─── CURRENCIES ───────────────────────────────────────────────
export const CURRENCIES = [
  { code: "IDR", symbol: "Rp",  rate: 1,      flag: "🇮🇩", name: "Indonesian Rupiah"  },
  { code: "USD", symbol: "$",   rate: 16400,  flag: "🇺🇸", name: "US Dollar"          },
  { code: "SGD", symbol: "S$",  rate: 12200,  flag: "🇸🇬", name: "Singapore Dollar"   },
  { code: "MYR", symbol: "RM",  rate: 3700,   flag: "🇲🇾", name: "Malaysian Ringgit"  },
  { code: "JPY", symbol: "¥",   rate: 110,    flag: "🇯🇵", name: "Japanese Yen"       },
  { code: "EUR", symbol: "€",   rate: 17800,  flag: "🇪🇺", name: "Euro"               },
  { code: "AUD", symbol: "A$",  rate: 10500,  flag: "🇦🇺", name: "Australian Dollar"  },
  { code: "GBP", symbol: "£",   rate: 21200,  flag: "🇬🇧", name: "British Pound"      },
  { code: "CHF", symbol: "Fr",  rate: 18500,  flag: "🇨🇭", name: "Swiss Franc"        },
  { code: "CNY", symbol: "¥",   rate: 2250,   flag: "🇨🇳", name: "Chinese Yuan"       },
  { code: "THB", symbol: "฿",   rate: 470,    flag: "🇹🇭", name: "Thai Baht"          },
  { code: "KRW", symbol: "₩",   rate: 12,     flag: "🇰🇷", name: "Korean Won"         },
  { code: "HKD", symbol: "HK$", rate: 2100,   flag: "🇭🇰", name: "Hong Kong Dollar"   },
];

// ─── ENTITIES ─────────────────────────────────────────────────
export const ENTITIES = ["Personal", "Hamasa", "SDC", "Travelio"];
export const REIMBURSE_ENTITIES = ["Hamasa", "SDC", "Travelio"];

// ─── ACCOUNT TYPES ────────────────────────────────────────────
export const ACC_TYPES = {
  BANK:        "bank",
  CREDIT_CARD: "credit_card",
  ASSET:       "asset",
  LIABILITY:   "liability",
  RECEIVABLE:  "receivable",
};

export const ACC_TYPE_LABEL = {
  bank:        "Bank Account",
  credit_card: "Credit Card",
  asset:       "Asset",
  liability:   "Liability",
  receivable:  "Receivable",
};

export const ACC_TYPE_ICON = {
  bank:        "🏦",
  credit_card: "💳",
  asset:       "📈",
  liability:   "📉",
  receivable:  "📋",
};

// ─── ASSET SUBTYPES ───────────────────────────────────────────
export const ASSET_SUBTYPES = [
  "Property", "Vehicle", "Stock", "Mutual Fund",
  "Crypto", "Gold", "Deposito", "Valuables", "FX/Cash", "PT Investment",
];

export const ASSET_ICON = {
  Property: "🏠", Vehicle: "🚗", Stock: "📈", "Mutual Fund": "💼",
  Crypto: "🪙", Gold: "🏅", Deposit: "🏦", Deposito: "🏦", Valuables: "💎", "FX/Cash": "💵",
  "PT Investment": "🏢",
};

export const ASSET_COL = {
  Property: "#3b5bdb", Vehicle: "#0891b2", Stock: "#059669",
  "Mutual Fund": "#7c3aed", Crypto: "#d97706", Gold: "#d4a017",
  Deposit: "#2563eb", Deposito: "#2563eb", Valuables: "#9333ea", "FX/Cash": "#0891b2",
  "PT Investment": "#1d4ed8",
};

// ─── LIABILITY SUBTYPES ───────────────────────────────────────
export const LIAB_SUBTYPES = [
  "Mortgage", "Vehicle Loan", "Personal Loan", "Credit", "Other",
];

// ─── NETWORKS / BANKS ─────────────────────────────────────────
export const NETWORKS = ["Visa", "Mastercard", "JCB", "Amex", "UnionPay"];
export const BANKS_L  = [
  "BCA", "BRI", "CIMB", "Danamon", "Jenius", "Mandiri",
  "Maybank", "Mega", "UOB", "HSBC", "BNI", "OCBC",
  "Superbank", "BLU", "Neobank", "Other",
];

// ─── TRANSACTION TYPES ────────────────────────────────────────
export const TX_TYPES = [
  { id: "expense",         label: "Expense",       icon: "↑",  color: "#dc2626" },
  { id: "income",          label: "Income",        icon: "↓",  color: "#059669" },
  { id: "transfer",        label: "Transfer",      icon: "↔",  color: "#3b5bdb" },
  { id: "pay_cc",          label: "Pay CC",        icon: "💳", color: "#7c3aed" },
  { id: "buy_asset",       label: "Buy Asset",     icon: "📈", color: "#0891b2" },
  { id: "sell_asset",      label: "Sell Asset",    icon: "💰", color: "#059669" },
  { id: "pay_liability",   label: "Pay Liability", icon: "📉", color: "#d97706" },
  { id: "reimburse_out",   label: "Reimburse Out", icon: "↗",  color: "#d97706" },
  { id: "reimburse_in",    label: "Reimburse In",  icon: "↙",  color: "#059669" },
  { id: "give_loan",       label: "Give Loan",     icon: "↗",  color: "#d97706" },
  { id: "collect_loan",    label: "Collect Loan",  icon: "↙",  color: "#059669" },
  { id: "fx_exchange",     label: "FX Exchange",   icon: "💱", color: "#0891b2" },
  { id: "opening_balance", label: "Opening Bal",   icon: "◈",  color: "#3b5bdb" },
];

export const TX_TYPE_MAP = Object.fromEntries(TX_TYPES.map(t => [t.id, t]));

// ─── EXPENSE CATEGORIES ───────────────────────────────────────
/**
 * @deprecated as primary UI source — DB tables (expense_categories, income_sources)
 * are now the source of truth. These constants are kept for:
 *   1. Legacy slug → label fallback in lookupExpenseCategory / lookupIncomeSource
 *   2. Initial keyword matching in suggestCategory()
 *   3. Bootstrap defaults for first-time users (Phase 3 will seed DB from these)
 * Do NOT use these as dropdown sources in new code — fetch from DB via
 * categoriesApi.getAll() / incomeSrcApi.getAll() instead.
 * Migration plan: Phase 3 cleanup (TODO) will remove these once all flows are DB-only.
 */
export const EXPENSE_CATEGORIES = [
  { id: "food",          label: "Food & Drinks",    icon: "🍽️",  color: "#d97706",
    keywords: ["restaurant","cafe","coffee","food","warung","grab food","gofood","mcdonalds","kfc","indomaret","alfamart","supermarket","bakery","pizza","sushi"] },
  { id: "home",          label: "Home & Utilities", icon: "🏠",  color: "#0891b2",
    keywords: ["pln","electricity","water","pdam","internet","indihome","firstmedia","telkom","gas","pertamina","rent","kost","iuran","mortgage"] },
  { id: "transport",     label: "Transport",        icon: "🚗",  color: "#3b5bdb",
    keywords: ["grab","gojek","uber","parking","toll","gas station","spbu","shell","pertamax","taxi","bus","train","mrt","ojek","bengkel","service"] },
  { id: "health",        label: "Health",           icon: "💊",  color: "#059669",
    keywords: ["pharmacy","apotek","clinic","hospital","doctor","gym","fitness","halodoc","insurance","bpjs","medicine"] },
  { id: "shopping",      label: "Shopping",         icon: "👕",  color: "#7c3aed",
    keywords: ["shopee","tokopedia","lazada","blibli","zara","uniqlo","samsung","apple","laptop","gadget","fashion","clothes"] },
  { id: "education",     label: "Education",        icon: "🎓",  color: "#dc2626",
    keywords: ["school","course","udemy","book","gramedia","ruangguru","tutor","university","spp"] },
  { id: "entertainment", label: "Entertainment",    icon: "✈️",  color: "#c2255c",
    keywords: ["hotel","airbnb","traveloka","netflix","spotify","cinema","disney","booking","travel","vacation"] },
  { id: "business",      label: "Business & Ops",   icon: "💼",  color: "#495057",
    keywords: ["hamasa","sdc","travelio","vendor","supplier","invoice","operational","office","atk","printing"] },
  { id: "finance",       label: "Finance",          icon: "💰",  color: "#d4a017",
    keywords: ["insurance","premium","installment","investment","reksa dana","bibit","admin fee","interest","bank fee"] },
  { id: "family",        label: "Family",           icon: "👨‍👩‍👧", color: "#059669",
    keywords: ["housekeeper","allowance","school fee","diapers","toys","family","child","baby"] },
  { id: "social",        label: "Social & Gifts",   icon: "🎁",  color: "#c2255c",
    keywords: ["gift","donation","wedding","birthday","charity","flowers","social"] },
  { id: "cash_advance_fee", label: "Cash Advance Fee", icon: "💸", color: "#dc2626", keywords: ["cash advance", "advance fee", "ca fee"] },
  { id: "bank_charges",  label: "Bank Charges",     icon: "🏦",  color: "#6b7280", keywords: ["bank charge", "biaya admin", "admin fee", "service charge"] },
  { id: "materai",       label: "Stamp Duty",       icon: "📋",  color: "#6b7280", keywords: ["materai", "bea materai", "stamp duty"] },
  { id: "tax",           label: "Tax",              icon: "🧾",  color: "#6b7280", keywords: ["pajak", "pph", "ppn", "tax"] },
  { id: "other",         label: "Other",            icon: "❓",  color: "#9ca3af", keywords: [] },
];

// ─── INCOME CATEGORIES ────────────────────────────────────────
export const INCOME_CATEGORIES = [
  "Salary", "Rent", "Dividend", "Deposit Interest",
  "Freelance", "Bonus", "Transfer In", "Other",
];

export const INCOME_CATEGORIES_LIST = [
  { id: "salary",          label: "Salary",          icon: "💼", color: "#059669" },
  { id: "rental_income",   label: "Rental Income",   icon: "🏠", color: "#0891b2" },
  { id: "dividend",        label: "Dividend",        icon: "📈", color: "#7c3aed" },
  { id: "freelance",       label: "Freelance",       icon: "💻", color: "#d97706" },
  { id: "loan_collection", label: "Loan Collection", icon: "🔄", color: "#3b5bdb" },
  { id: "bank_interest",   label: "Bank Interest",   icon: "🏦", color: "#059669" },
  { id: "cashback",        label: "Cashback",        icon: "💰", color: "#059669" },
  { id: "other_income",    label: "Other Income",    icon: "💰", color: "#6b7280" },
];

// ─── RECURRING FREQUENCIES ────────────────────────────────────
export const FREQUENCIES = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"];

// ─── NAVIGATION TABS ──────────────────────────────────────────
export const TABS = [
  { id: "dashboard",    label: "Dashboard"    },
  { id: "transactions", label: "Transactions" },
  { id: "bank",         label: "Bank"         },
  { id: "cash",         label: "Cash"         },
  { id: "cards",        label: "Credit Cards" },
  { id: "assets",       label: "Assets"       },
  { id: "receivables",  label: "Receivables"  },
  { id: "income",       label: "Income"       },
  { id: "reports",      label: "Reports"      },
  { id: "calendar",     label: "Calendar"     },
  { id: "reconcile",    label: "Reconcile"    },
  { id: "settings",     label: "Settings"     },
];

export const MOBILE_MAIN_TABS = ["dashboard", "transactions", "bank", "assets"];
export const MOBILE_MORE_TABS = [
  { id: "cash",        label: "Cash"         },
  { id: "cards",       label: "Credit Cards" },
  { id: "receivables", label: "Receivables"  },
  { id: "income",      label: "Income"       },
  { id: "reports",     label: "Reports"      },
  { id: "calendar",    label: "Calendar"     },
  { id: "reconcile",   label: "Reconcile"    },
  { id: "settings",    label: "Settings"     },
];

// ─── AI PROXY ─────────────────────────────────────────────────
export const AI_PROXY    = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/ai-proxy`;
export const AI_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
