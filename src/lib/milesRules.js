// Miles earn rules for Paulus's own cards — snapshot from SweetSpot seed
// (~/sweetspot/supabase/seed/cards_catalog.sql; sources: MILES PLAYBOOK 2026 +
// PinterPoin, incl. the 2026 devaluations). rupiah_per_mile = IDR spent per
// 1 mile — LOWER is better. Each rule carries as_of; treat stale data with care.
//
// Card identity = the cc-tracker account NAME (matched exactly).
// Category groups used by the engine: general | online | dining | travel | fx.
// A card may also earn in a specific fx corridor (e.g. UOB SGD/MY/TH/VN).
//
// Value model (Paulus, 2026-08-27): priority programs = KrisFlyer + Accor ALL.
// - KrisFlyer parity for cashback comparison: ~Rp200/mile (SweetSpot MVP proxy).
// - Accor ALL: fixed redemption 2.000 pts = EUR 40 → 1 pt ≈ Rp ~390 (kurs 19.500).

export const MILES_VALUE_IDR = { krisflyer: 200, garudamiles: 180, asiamiles: 180, linkmiles: 150, accor: 390, jalmiles: 180 };

export const CARD_RULES = [
  { card: "Maybank VI", program: "krisflyer", asOf: "2026-01",
    rules: [
      { cat: "general", rpm: 8888 },
      { cat: "dining",  rpm: 7500, capSpend: 26250000, note: "dining & travel, cap spend 26,25jt/bln" },
      { cat: "travel",  rpm: 7500, capSpend: 26250000 },
      { cat: "fx",      rpm: 7500, capSpend: 56250000 },
    ]},
  { card: "Maybank VP", program: "krisflyer", asOf: "2026-01",
    rules: [
      { cat: "general", rpm: 20000 },
      { cat: "online",  rpm: 6667, capBonusPoints: 5000, note: "3x poin online/dining/supermarket; bonus cap 5.000 poin/bln (≈ spend 25jt)" },
      { cat: "dining",  rpm: 6667, capBonusPoints: 5000 },
    ]},
  { card: "Maybank JCB", program: "asiamiles", asOf: "2026-02",
    rules: [{ cat: "general", rpm: 10000, note: "TREATS 1:1 AsiaMiles, Rupiah & FX" }, { cat: "fx", rpm: 10000 }]},
  { card: "Maybank Mini", program: "krisflyer", asOf: "2026-01",
    rules: [{ cat: "general", rpm: 20000 }]},
  { card: "Maybank MU", program: "krisflyer", asOf: "2026-01",
    rules: [{ cat: "general", rpm: 20000 }]},
  { card: "UOB", program: "krisflyer", asOf: "2026-01",
    rules: [
      { cat: "general", rpm: 12000, note: "PRVI Miles; devaluasi domestik Jan 2026" },
      { cat: "fx",      rpm: 4500, corridors: ["SGD","MYR","THB","VND"], note: "HANYA SGD/MYR/THB/VND (termasuk online mata uang itu) — terbaik se-Indonesia" },
    ]},
  { card: "OCBC 90N", program: "krisflyer", asOf: "2026-05",
    rules: [{ cat: "general", rpm: 12000 }, { cat: "fx", rpm: 10000, note: "bebas biaya valas" }]},
  { card: "BCA Krisflyer", program: "krisflyer", asOf: "2026-06",
    rules: [{ cat: "general", rpm: 13500, note: "efektif ~8.060 di spend 20jt/bln (bonus bulanan)" }, { cat: "fx", rpm: 13500 }]},
  { card: "BCA Card", program: "krisflyer", asOf: "2025-05",
    rules: [{ cat: "general", rpm: 20000, note: "Reward BCA → KrisFlyer; lemah" }]},
  { card: "Jenius", program: "krisflyer", asOf: "2026-06",
    rules: [
      { cat: "general", rpm: 13333, note: "Rp10rb = 1 Yay; 1,33 Yay = 1 KrisFlyer (Garuda 12,5rb)" },
      { cat: "dining",  rpm: 6667, note: "Double Yay dining" },
    ]},
  { card: "CIMB ALL", program: "accor", asOf: "2026-08", unverifiedRate: true,
    rules: [{ cat: "general", rpm: null, note: "Kartu Accor — earn ALL points; RATE BELUM TERVERIFIKASI (playbook kosong). Isi setelah cek statement poin." }]},
  { card: "CIMB JCB", program: "krisflyer", asOf: "2026-02",
    rules: [
      { cat: "general", rpm: 37500 },
      { cat: "fx", cashbackPct: 4, corridors: ["JPY","KRW","CNY","TWD"], note: "4% cashback Jepang/Korea/China/Taiwan — andalan trip Jepang" },
    ]},
  { card: "CIMB Platinum", program: "krisflyer", asOf: "2026-02",
    rules: [{ cat: "general", rpm: 37500 }]},
  { card: "Mandiri Signa", program: "garudamiles", asOf: "2026-06",
    rules: [{ cat: "general", rpm: 10000, capBonusPoints: 1000, note: "1.000 Livin'poin pertama/bln 1:1 (≈ spend 10jt), selebihnya 2:1; QRIS/transport/edu/fuel cuma 1 poin/Rp100rb" }]},
  { card: "Mandiri Bonvoy", program: "krisflyer", asOf: "2026-06",
    rules: [{ cat: "general", rpm: 20000, note: "Bonvoy points; konversi variatif — angka konservatif" }]},
  { card: "HSBC", program: "krisflyer", asOf: "2026-05",
    rules: [
      { cat: "general", rpm: 37500 },
      { cat: "travel", rpm: 9375, note: "4x poin airline/hotel/travel agent IN-STORE" },
      { cat: "dining", rpm: 9375, note: "dining in-store (bukan online)" },
      { cat: "fx", rpm: 18750 },
    ]},
  { card: "BRI", program: "garudamiles", asOf: "2026-05",
    rules: [
      { cat: "general", rpm: 3856110, note: "BRIPoin → Garuda ~Rp3,8jt/mile — praktis nol" },
      { cat: "fx", cashbackPct: 10, capCashback: 150000, note: "10% cashback valas cap Rp150rb/bln, tanpa markup FX" },
    ]},
  { card: "BNI JCB", program: "garudamiles", asOf: "2026-02",
    rules: [{ cat: "general", rpm: 25000 }]},
  { card: "DBS", program: "krisflyer", asOf: "2026-05",
    rules: [{ cat: "general", rpm: 13500 }, { cat: "fx", rpm: 10000, note: "FX kecuali Eropa" }]},
  { card: "Skorcard", program: "linkmiles", asOf: "2026-05",
    rules: [
      { cat: "general", cashbackPct: 1, note: "base ~1%" },
      { cat: "online", rpm: 5000, note: "10x merchant boosted terpilih → LinkMiles 5.000 (Garuda 7.000, KrisFlyer 10.000)" },
    ]},
  { card: "Mega Metro", program: null, asOf: "2026-05",
    rules: [{ cat: "general", cashbackPct: 0.5 }]},
  { card: "Danamon JCB", program: "jalmiles", asOf: "2026-05", unverifiedRate: true,
    rules: [{ cat: "general", rpm: null, note: "JAL miles — angka belum diverifikasi" }]},
];

// FX corridor detection from a transaction description (currency the merchant billed in).
const CORRIDOR_RE = {
  SGD: /SGD|SINGAPORE|\bSGP\b/i, MYR: /MYR|MALAYSIA|\bMYS\b/i, THB: /THB|THAILAND|BANGKOK/i, VND: /VND|VIETNAM/i,
  JPY: /JPY|\bJPN?\b|TOKYO|OSAKA|SAPPORO|KYOTO/i, KRW: /KRW|KOREA|SEOUL/i, CNY: /CNY|CHINA|SHANGHAI|BEIJING/i, TWD: /TWD|TAIWAN|TAIPEI/i,
  EUR: /EUR|BERLIN|\bDEU?\b|GERMANY|FRANCE|SPAIN|ITALY/i, USD: /USD|\bUSA?\b/i, GBP: /GBP|LONDON|\bGB\b/i,
};
export function detectCorridor(desc) {
  for (const [cur, re] of Object.entries(CORRIDOR_RE)) if (re.test(desc || "")) return cur;
  return null;
}
export const FX_RE = /BILLED AS|JPY|EUR|USD|SGD|GBP|KRW|TWD|\bJPN?\b|\bDEU?\b|\bSGP\b|OSAKA|TOKYO|SAPPORO|BERLIN|SINGAPORE|STOCKHOLM/i;

// Map a ledger row to a rule-category group.
export function txGroup(row) {
  if (FX_RE.test(row.description || "")) return "fx";
  const c = row.category_name || "";
  if (c === "Food & Dining") return "dining";
  if (c === "Online Shopping" || /TOKOPEDIA|SHOPEE|LAZADA|BLIBLI/i.test(row.description || "")) return "online";
  if (c === "Travel") return "travel";
  return "general";
}

// Pick the applicable rule on a card for a group (+ fx corridor restriction).
export function pickRule(cardName, group, desc) {
  const card = CARD_RULES.find(c => c.card === cardName);
  if (!card) return null;
  let rule = card.rules.find(r => r.cat === group);
  if (rule?.corridors) {
    const cor = detectCorridor(desc);
    if (!cor || !rule.corridors.includes(cor)) rule = null;
  }
  if (!rule) rule = card.rules.find(r => r.cat === "general");
  return rule ? { ...rule, program: card.program, cardName, unverified: card.unverifiedRate } : null;
}

// Value of a spend on a rule, in miles + IDR-equivalent (for cross-program compare).
export function ruleValue(rule, amount) {
  if (!rule) return { miles: 0, cashback: 0, valueIdr: 0 };
  if (rule.cashbackPct) {
    let cash = (amount * rule.cashbackPct) / 100;
    if (rule.capCashback) cash = Math.min(cash, rule.capCashback);
    return { miles: 0, cashback: cash, valueIdr: cash };
  }
  if (rule.rpm) {
    const miles = amount / rule.rpm;
    const per = MILES_VALUE_IDR[rule.program] || 200;
    return { miles, cashback: 0, valueIdr: miles * per };
  }
  return { miles: 0, cashback: 0, valueIdr: 0 };
}

// Best owned card for a group (ignores caps for the headline; caps shown as notes).
export function bestCardFor(group, desc = "") {
  let best = null;
  for (const card of CARD_RULES) {
    const rule = pickRule(card.card, group, desc);
    if (!rule || rule.unverified) continue;
    const v = ruleValue(rule, 1000000);
    if (!best || v.valueIdr > best.v.valueIdr) best = { card: card.card, rule, v };
  }
  return best;
}
