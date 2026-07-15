// Shared intake-queue hygiene for the edge functions.
//
// Two flag vocabularies exist on email_sync items (historical accident):
//   web  (api.js markTxStatus)      → { confirmed: true } / { skipped: true }
//   bot  (telegram-webhook import)  → { _imported: true } / { _skipped: true }
// isDoneTx() is THE canonical "this item is handled" predicate — every reader
// (queue counts, digests, importers) must use it so web-handled items never
// resurface in the bot and vice versa.
export function isDoneTx(t: any): boolean {
  return !!(t && (t._imported || t._skipped || t.confirmed || t.skipped || t._waiting_statement));
}

const DAYMS = 86400000;
const ISSUER_CARD: Array<[RegExp, string]> = [[/mayapada|skorcard/i, "2362"]];
const dnum = (s: any) => {
  const str = String(s || "");
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(str) ? str + "T00:00:00Z" : str);
  return isNaN(t) ? NaN : t;
};
const norm = (s: any) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const descMatch = (a: any, b: any) => {
  const x = norm(a), y = norm(b);
  if (x.length < 4 || y.length < 4) return false;
  return x.includes(y.slice(0, 8)) || y.includes(x.slice(0, 8));
};

// Auto-skip "ghost" pending items: transactions that already exist in the ledger
// because the same money arrived through another door (photo → bot import, bank
// email notification, statement reconcile). Runs the SAME strict rule as
// importPending's dedup: exact amount + a resolved account on the item +
// (same-day OR ≤3 days with matching description) — recurring same-amount
// charges (daily Grab etc.) are protected by the desc requirement, and items
// whose account can't be resolved are never touched (never guess).
// Marks matches { _skipped, _auto_dup } — nothing is deleted, fully reversible.
// Returns the number of items swept.
export async function sweepLedgerGhosts(supabase: any, uid: string): Promise<number> {
  const { data: rows } = await supabase.from("email_sync")
    .select("id, ai_raw_result").eq("user_id", uid).eq("status", "pending");
  if (!rows?.length) return 0;

  const { data: accounts } = await supabase.from("accounts")
    .select("id, card_last4").eq("user_id", uid);
  const accIdSet = new Set((accounts || []).map((a: any) => a.id));
  const byL4: Record<string, string> = Object.fromEntries(
    (accounts || []).filter((a: any) => a.card_last4).map((a: any) => [a.card_last4, a.id]));

  // Parse rows, collect live IDR items, find the earliest date to bound the ledger query
  type Cand = { rowId: string; arr: any[]; idx: number; t: any; accIds: string[]; ms: number };
  const parsed = new Map<string, any[]>();
  const cands: Cand[] = [];
  let minMs = Infinity;
  for (const r of rows) {
    let arr: any = r.ai_raw_result;
    try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { arr = null; }
    if (!Array.isArray(arr)) continue;
    parsed.set(r.id, arr);
    arr.forEach((t: any, idx: number) => {
      if (!t || isDoneTx(t)) return;
      if (t.currency && t.currency !== "IDR") return; // valas → waiting_statement flow, not ours
      const amt = Math.round(Number(t.amount_idr ?? t.amount ?? 0));
      const ms = dnum(t.date);
      if (!amt || amt <= 0 || isNaN(ms)) return;
      const accIds = [t.from_account_id, t.to_account_id].filter((id: any) => id && accIdSet.has(id));
      if (!accIds.length) {
        const hay = `${t.to_bank_name || ""} ${t.from_bank_name || ""} ${t.merchant_name || ""} ${t.description || ""}`;
        for (const [re, l4] of ISSUER_CARD) if (re.test(hay) && byL4[l4]) { accIds.push(byL4[l4]); break; }
      }
      if (!accIds.length) return; // unresolved account → leave for ask-back, never guess
      if (ms < minMs) minMs = ms;
      cands.push({ rowId: r.id, arr, idx, t, accIds, ms });
    });
  }
  if (!cands.length) return 0;

  const from = new Date(minMs - 4 * DAYMS).toISOString().slice(0, 10);
  const { data: led } = await supabase.from("ledger")
    .select("tx_date, description, merchant_name, amount_idr, from_id, to_id")
    .eq("user_id", uid).gte("tx_date", from);

  let swept = 0;
  const touched = new Set<string>();
  for (const c of cands) {
    const amt = Math.round(Number(c.t.amount_idr ?? c.t.amount ?? 0));
    const nm = c.t.merchant_name || c.t.description || "";
    const hit = (led || []).find((L: any) => {
      if (Math.round(Number(L.amount_idr || 0)) !== amt) return false;
      if (!(c.accIds.includes(L.from_id) || c.accIds.includes(L.to_id))) return false;
      const dd = Math.abs(dnum(L.tx_date) - c.ms);
      if (dd === 0) return true;
      return dd <= 3 * DAYMS && descMatch(L.merchant_name || L.description, nm);
    });
    if (!hit) continue;
    c.arr[c.idx]._skipped = true;
    c.arr[c.idx]._auto_dup = true;
    swept++; touched.add(c.rowId);
  }

  for (const rowId of touched) {
    const arr = parsed.get(rowId)!;
    const allDone = arr.every((t: any) => !t || isDoneTx(t));
    const anyWaiting = arr.some((t: any) => t && t._waiting_statement && !t._imported && !t._skipped);
    const anyImported = arr.some((t: any) => t && (t._imported || t.confirmed));
    const status = !allDone ? "pending" : anyWaiting ? "waiting_statement" : anyImported ? "imported" : "skipped";
    await supabase.from("email_sync").update({ ai_raw_result: arr, status }).eq("id", rowId);
  }
  return swept;
}
