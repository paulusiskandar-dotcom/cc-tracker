const normalize = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Detect cross-account transfer pairs in a list of candidate rows.
 * Also cross-checks against existing ledger rows.
 * Returns array of matches: [{ rowId, partnerRowId?, partnerLedgerId?, fromId, toId, confidence }]
 */
export function detectTransferPairs(rows, accounts, existingLedger = []) {
  const results = [];
  const accLast4 = new Map();
  const accName  = new Map();

  accounts.forEach(a => {
    const l4 = a.card_last4;
    if (l4) accLast4.set(l4, a);
    const name = normalize(a.name);
    if (name.length >= 4) accName.set(name, a);
  });

  const findReferencedAccount = (desc) => {
    const d = normalize(desc || "");
    for (const [l4, acc] of accLast4) if (d.includes(l4)) return acc;
    for (const [name, acc] of accName) if (name.length >= 4 && d.includes(name)) return acc;
    return null;
  };

  const used = new Set();

  for (let i = 0; i < rows.length; i++) {
    if (used.has(rows[i]._id)) continue;
    const a = rows[i];
    const amtA = Math.abs(Number(a.amount_idr || a.amount || 0));
    if (!amtA) continue;
    const dateA = new Date((a.tx_date || a.date || "") + "T00:00:00").getTime();
    if (isNaN(dateA)) continue;
    const aIsOut = a.tx_type === "expense" || (a.from_id && !a.to_id);
    const aIsIn  = a.tx_type === "income"  || (!a.from_id && a.to_id);
    const refAcc = findReferencedAccount(a.description || a.merchant_name || a.merchant);
    if (!refAcc) continue;

    // Look in other rows for a matching opposite-direction row
    let matchedPartner = null;
    for (let j = i + 1; j < rows.length; j++) {
      if (used.has(rows[j]._id)) continue;
      const b = rows[j];
      const amtB = Math.abs(Number(b.amount_idr || b.amount || 0));
      if (Math.abs(amtA - amtB) > 100) continue;
      const dateB = new Date((b.tx_date || b.date || "") + "T00:00:00").getTime();
      if (Math.abs((dateA - dateB) / 86400000) > 2) continue;
      const bIsOut = b.tx_type === "expense" || (b.from_id && !b.to_id);
      const bIsIn  = b.tx_type === "income"  || (!b.from_id && b.to_id);
      if (!((aIsOut && bIsIn) || (aIsIn && bIsOut))) continue;
      matchedPartner = b;
      break;
    }

    if (matchedPartner) {
      used.add(a._id); used.add(matchedPartner._id);
      const outRow = aIsOut ? a : matchedPartner;
      const inRow  = aIsOut ? matchedPartner : a;
      results.push({
        rowId: a._id,
        partnerRowId: matchedPartner._id,
        fromId: outRow.from_id,
        toId: inRow.to_id,
        confidence: 2,
      });
      continue;
    }

    // No pair in rows — check existing ledger for a recent opposite-direction entry
    for (const l of existingLedger) {
      const amtL = Math.abs(Number(l.amount_idr || l.amount || 0));
      if (Math.abs(amtA - amtL) > 100) continue;
      const dateL = new Date((l.tx_date || "") + "T00:00:00").getTime();
      if (Math.abs((dateA - dateL) / 86400000) > 2) continue;
      const lIsOut = l.from_type === "account" && !l.to_id;
      const lIsIn  = l.to_type  === "account"  && !l.from_id;
      if (!((aIsOut && lIsIn) || (aIsIn && lIsOut))) continue;
      results.push({
        rowId: a._id,
        partnerLedgerId: l.id,
        fromId: aIsOut ? a.from_id : l.from_id,
        toId:   aIsOut ? l.to_id   : a.to_id,
        confidence: 1,
      });
      used.add(a._id);
      break;
    }
  }

  return results;
}
