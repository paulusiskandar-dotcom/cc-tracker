// duplicateDetection.js — 3-level duplicate detection for Reconcile missing rows
// Uses same word-overlap approach as checkDuplicateTransaction (utils.js)
// but with more lenient thresholds suited for bank statement date drift.
// Level 3 = high-confidence duplicate (auto-uncheck)
// Level 2 = possible duplicate (warn)
// Level 1 = suspicious (same amount, possibly different account)

const normalize = s => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

const wordOverlap = (a, b) => {
  const wa = new Set(normalize(a).split(/\s+/).filter(w => w.length >= 3));
  const wb = new Set(normalize(b).split(/\s+/).filter(w => w.length >= 3));
  if (!wa.size || !wb.size) return 0;
  let hits = 0;
  for (const w of wa) if (wb.has(w)) hits++;
  return hits / Math.max(wa.size, wb.size);
};

/**
 * Detect if a candidate transaction duplicates any ledger entry.
 * @param {{ tx_date, amount_idr, amount, description, merchant_name, merchant }} candidate
 * @param {Array} ledgerRows
 * @param {{ sameAccountId?: string }} options
 * @returns {{ level: number, dupEntry: object, reasons: string[] } | null}
 */
// Build one virtual row per split group (summed amount, earliest date) so a
// statement/import line equal to a whole group is recognized as "already in
// ledger" even though no single row carries that amount.
function withSplitVirtuals(ledgerRows) {
  const groups = {};
  for (const l of ledgerRows || []) {
    if (l.split_group_id) (groups[l.split_group_id] = groups[l.split_group_id] || []).push(l);
  }
  const virtuals = Object.values(groups)
    .filter(g => g.length > 1)
    .map(g => ({
      ...g[0],
      amount_idr: g.reduce((s, l) => s + Math.abs(Number(l.amount_idr || l.amount || 0)), 0),
      description: g[0].description,
      _split_virtual: true,
    }));
  return virtuals.length ? [...ledgerRows, ...virtuals] : ledgerRows;
}

export function detectDuplicate(candidate, ledgerRows, { sameAccountId } = {}) {
  ledgerRows = withSplitVirtuals(ledgerRows);
  const candAmt = Math.abs(Number(candidate.amount_idr || candidate.amount || 0));
  const candDateStr = candidate.tx_date || candidate.date || "";
  const candDate = new Date(candDateStr + "T00:00:00").getTime();
  const candDesc = candidate.description || candidate.merchant_name || candidate.merchant || "";
  if (!candAmt || !candDateStr || isNaN(candDate)) return null;

  let best = null, bestLevel = 0, bestReasons = [];

  for (const l of (ledgerRows || [])) {
    const lAmt = Math.abs(Number(l.amount_idr || l.amount || 0));
    if (!lAmt) continue;
    if (Math.abs(candAmt - lAmt) > 100) continue; // Rp 100 tolerance

    const lDate = new Date((l.tx_date || "") + "T00:00:00").getTime();
    const dayDiff = Math.abs((candDate - lDate) / 86400000);
    const lDesc = l.description || l.merchant_name || "";
    const descSim = wordOverlap(candDesc, lDesc);
    const sameAcc = sameAccountId
      ? (l.from_id === sameAccountId || l.to_id === sameAccountId)
      : false;

    let level = 0;
    const reasons = [];

    const signedDays = Math.round((candDate - lDate) / 86400000);
    const dayLabel = signedDays === 0 ? "0D" : signedDays > 0 ? `+${signedDays}D` : `${signedDays}D`;

    if (sameAcc && dayDiff <= 3 && descSim >= 0.5) {
      level = 3;
      reasons.push("Same IDR", dayLabel, "Desc match");
    } else if (sameAcc && dayDiff <= 7) {
      level = 2;
      reasons.push("Same IDR", dayLabel);
      if (descSim >= 0.3) reasons.push("~ Desc");
    } else if (dayDiff <= 14) {
      level = 1;
      reasons.push("Same IDR", dayLabel);
      if (!sameAcc) reasons.push("Diff acc");
    }

    if (level > bestLevel) {
      bestLevel = level;
      best = l;
      bestReasons = reasons;
    }
  }

  if (!bestLevel) return null;
  return { level: bestLevel, dupEntry: best, reasons: bestReasons };
}
