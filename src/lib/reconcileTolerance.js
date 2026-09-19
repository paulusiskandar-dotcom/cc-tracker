// A closing gap of up to Rp 5 between a statement and the ledger is rounding (CIMB bills in
// ,33 fractions; Mandiri Bonvoy was Rp 1 off) and counts as matched — Paulus, 19 Sep 2026.
// Same number as GAP_TOLERANCE in supabase/functions/_shared/stmtRules.ts.
export const GAP_TOLERANCE = 5;
export const gapOk = g => g != null && Math.abs(Math.round(Number(g))) <= GAP_TOLERANCE;
