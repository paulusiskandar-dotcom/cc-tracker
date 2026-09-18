// An instalment is stored under the bank's raw descriptor ("TOKOPEDIA_CYBS_CCL12 (131k)");
// the item bought is in the purchase row's notes. Bills and Home both show that name.
export function nameInstalments(items = [], ledger = [], installments = []) {
  const byId = Object.fromEntries(ledger.map(e => [e.id, e]));
  const names = {};
  installments.forEach(it => { const n = byId[it.purchase_ledger_id]?.notes; if (n && !/^imported from/i.test(n)) names["i" + it.id] = String(n).replace(/\s+\d+\/\d+$/, ""); });
  return items.map(i => (names[i.id] ? { ...i, name: names[i.id] } : i));
}
