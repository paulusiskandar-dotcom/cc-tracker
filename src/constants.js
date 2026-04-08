// ─── CURRENCIES ───────────────────────────────────────────────
export const CURRENCIES = [
  { code:"IDR", symbol:"Rp",  rate:1,     flag:"🇮🇩" },
  { code:"USD", symbol:"$",   rate:16400, flag:"🇺🇸" },
  { code:"SGD", symbol:"S$",  rate:12200, flag:"🇸🇬" },
  { code:"MYR", symbol:"RM",  rate:3700,  flag:"🇲🇾" },
  { code:"JPY", symbol:"¥",   rate:110,   flag:"🇯🇵" },
  { code:"EUR", symbol:"€",   rate:17800, flag:"🇪🇺" },
  { code:"AUD", symbol:"A$",  rate:10500, flag:"🇦🇺" },
];

// ─── ENTITIES ─────────────────────────────────────────────────
export const ENTITIES     = ["Personal","Hamasa","SDC","Travelio"];
export const ENT_COL      = { Personal:"#3b5bdb", Hamasa:"#0ca678", SDC:"#e67700", Travelio:"#0c8599" };
export const ENT_BG       = { Personal:"#eef2ff", Hamasa:"#e6fcf5", SDC:"#fff9db", Travelio:"#e3fafc" };

// ─── ACCOUNT TYPES ────────────────────────────────────────────
export const ACC_TYPES = {
  BANK:        "bank",
  CREDIT_CARD: "credit_card",
  DEBIT_CARD:  "debit_card",
  ASSET:       "asset",
  LIABILITY:   "liability",
  RECEIVABLE:  "receivable",
};

export const ACC_TYPE_LABEL = {
  bank:        "Bank Account",
  credit_card: "Credit Card",
  debit_card:  "Debit Card",
  asset:       "Asset",
  liability:   "Liability",
  receivable:  "Receivable",
};

export const ACC_TYPE_ICON = {
  bank:        "🏦",
  credit_card: "💳",
  debit_card:  "💳",
  asset:       "📈",
  liability:   "📉",
  receivable:  "📋",
};

// ─── ASSET SUBTYPES ───────────────────────────────────────────
export const ASSET_SUBTYPES = ["Property","Vehicle","Stock","Mutual Fund","Crypto","Gold","Deposit","Valuables","FX/Cash"];
export const ASSET_ICON = {
  Property:"🏠", Vehicle:"🚗", Stock:"📈", "Mutual Fund":"💼",
  Crypto:"🪙", Gold:"🏅", Deposit:"🏦", Valuables:"💎", "FX/Cash":"💵",
};
export const ASSET_COL = {
  Property:"#3b5bdb", Vehicle:"#0c8599", Stock:"#0ca678", "Mutual Fund":"#7048e8",
  Crypto:"#e67700", Gold:"#d4a017", Deposit:"#2563eb", Valuables:"#9333ea", "FX/Cash":"#0891b2",
};

// ─── LIABILITY SUBTYPES ───────────────────────────────────────
export const LIAB_SUBTYPES = ["Mortgage","Vehicle Loan","Personal Loan","Credit","Other"];

// ─── NETWORKS ─────────────────────────────────────────────────
export const NETWORKS = ["Visa","Mastercard","JCB","Amex","UnionPay"];
export const BANKS_L  = ["BCA","Mandiri","BNI","CIMB","BRI","Permata","Danamon","OCBC","Jenius","SeaBank","Other"];

// ─── TRANSACTION TYPES ────────────────────────────────────────
export const TX_TYPES = [
  { id:"expense",       label:"Expense",       icon:"↑", color:"#e03131" },
  { id:"income",        label:"Income",        icon:"↓", color:"#0ca678" },
  { id:"transfer",      label:"Transfer",      icon:"↔", color:"#3b5bdb" },
  { id:"pay_cc",        label:"Pay CC",        icon:"💳",color:"#7048e8" },
  { id:"buy_asset",     label:"Buy Asset",     icon:"📈",color:"#0c8599" },
  { id:"sell_asset",    label:"Sell Asset",    icon:"💰",color:"#0ca678" },
  { id:"pay_liability", label:"Pay Liability", icon:"📉",color:"#e67700" },
  { id:"reimburse_out", label:"Reimburse Out", icon:"↗", color:"#e67700" },
  { id:"reimburse_in",  label:"Reimburse In",  icon:"↙", color:"#0ca678" },
  { id:"give_loan",     label:"Give Loan",     icon:"↗", color:"#e67700" },
  { id:"collect_loan",  label:"Collect Loan",  icon:"↙", color:"#0ca678" },
  { id:"qris_debit",    label:"QRIS/Debit",    icon:"📱",color:"#e03131" },
  { id:"fx_exchange",   label:"FX Exchange",   icon:"💱",color:"#0c8599" },
  { id:"opening_balance",label:"Opening Bal",  icon:"◈", color:"#3b5bdb" },
];

export const TX_TYPE_MAP = Object.fromEntries(TX_TYPES.map(t=>[t.id,t]));

// ─── EXPENSE CATEGORIES ───────────────────────────────────────
export const EXPENSE_CATEGORIES = [
  { id:"food",          label:"Food & Drinks",       icon:"🍽️", color:"#e67700",
    keywords:["restaurant","cafe","coffee","food","warung","grab food","gofood","mcdonalds","kfc","indomaret","alfamart","supermarket","bakery","pizza","sushi"] },
  { id:"home",          label:"Home & Utilities",    icon:"🏠", color:"#0c8599",
    keywords:["pln","electricity","water","pdam","internet","indihome","firstmedia","telkom","gas","pertamina","rent","kost","iuran","mortgage"] },
  { id:"transport",     label:"Transport",           icon:"🚗", color:"#3b5bdb",
    keywords:["grab","gojek","uber","parking","toll","gas station","spbu","shell","pertamax","taxi","bus","train","mrt","ojek","bengkel","service"] },
  { id:"health",        label:"Health",              icon:"💊", color:"#0ca678",
    keywords:["pharmacy","apotek","clinic","hospital","doctor","gym","fitness","halodoc","insurance","bpjs","medicine"] },
  { id:"shopping",      label:"Shopping",            icon:"👕", color:"#7048e8",
    keywords:["shopee","tokopedia","lazada","blibli","zara","uniqlo","samsung","apple","laptop","gadget","fashion","clothes"] },
  { id:"education",     label:"Education",           icon:"🎓", color:"#e03131",
    keywords:["school","course","udemy","book","gramedia","ruangguru","tutor","university","spp"] },
  { id:"entertainment", label:"Entertainment",       icon:"✈️", color:"#c2255c",
    keywords:["hotel","airbnb","traveloka","netflix","spotify","cinema","disney","booking","travel","vacation"] },
  { id:"business",      label:"Business & Ops",      icon:"💼", color:"#495057",
    keywords:["hamasa","sdc","travelio","vendor","supplier","invoice","operational","office","atk","printing"] },
  { id:"finance",       label:"Finance",             icon:"💰", color:"#d4a017",
    keywords:["insurance","premium","installment","investment","reksa dana","bibit","admin fee","interest","bank fee"] },
  { id:"family",        label:"Family",              icon:"👨‍👩‍👧", color:"#0ca678",
    keywords:["housekeeper","allowance","school fee","diapers","toys","family","child","baby"] },
  { id:"social",        label:"Social & Gifts",      icon:"🎁", color:"#c2255c",
    keywords:["gift","donation","wedding","birthday","charity","flowers","social"] },
  { id:"other",         label:"Other",               icon:"❓", color:"#8a90aa", keywords:[] },
];

export const INCOME_CATEGORIES = ["Salary","Rent","Dividend","Deposit Interest","Freelance","Bonus","Transfer In","Other"];

// ─── RECURRING FREQUENCIES ────────────────────────────────────
export const FREQUENCIES = ["Daily","Weekly","Monthly","Quarterly","Yearly"];

// ─── TABS / NAVIGATION ────────────────────────────────────────
export const TABS = [
  { id:"dashboard",    icon:"◈",  label:"Dashboard" },
  { id:"transactions", icon:"🔄", label:"Transactions" },
  { id:"accounts",     icon:"🏦", label:"Accounts" },
  { id:"cards",        icon:"💳", label:"Credit Cards" },
  { id:"assets",       icon:"📈", label:"Assets" },
  { id:"receivables",  icon:"📋", label:"Receivables" },
  { id:"income",       icon:"💰", label:"Income" },
  { id:"reports",      icon:"📊", label:"Reports" },
  { id:"settings",     icon:"⚙️", label:"Settings" },
];

export const MOBILE_TABS = ["dashboard","transactions","accounts","assets","more"];

// ─── AI PROXY ─────────────────────────────────────────────────
export const AI_PROXY    = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/ai-proxy`;
export const AI_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || "";

// ─── APP VERSION ──────────────────────────────────────────────
export const APP_VERSION = "2.1.0";
export const APP_BUILD   = "2026-04-08";
