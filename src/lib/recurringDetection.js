import { supabase } from "./supabase";

const normalize = s => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

/**
 * Generate recurring_reminders rows for any due date that has passed without
 * a confirmed or skipped reminder. Called on app load so the sidebar overdue
 * badge and Upcoming list stay accurate.
 * Returns the count of newly inserted reminders.
 */
export async function generateMissingReminders(userId, templates, existingReminders) {
  const today   = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);

  // Index existing reminders by "templateId|due_date" for O(1) lookup
  const existing = new Set(
    existingReminders.map(r => `${r.template_id}|${r.due_date}`)
  );

  const toInsert = [];

  for (const tpl of templates) {
    if (tpl.is_active === false) continue;
    if (!tpl.day_of_month)       continue;

    const freq = (tpl.frequency || "Monthly").toLowerCase();
    if (!["monthly", "weekly", "yearly", "annual"].includes(freq)) continue;

    // Start from the month when the template was created
    const origin = new Date(tpl.created_at || tpl.start_date || todayIso);
    let cursor   = new Date(origin.getFullYear(), origin.getMonth(), tpl.day_of_month);

    // If the first cursor is before the origin date, step forward one period
    if (cursor < origin) {
      if (freq === "monthly")           cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, tpl.day_of_month);
      else if (freq === "yearly" || freq === "annual") cursor = new Date(cursor.getFullYear() + 1, cursor.getMonth(), tpl.day_of_month);
      else if (freq === "weekly")       cursor = new Date(cursor.getTime() + 7 * 86400000);
    }

    let safety = 0;
    while (cursor <= today && safety++ < 200) {
      const dueIso = cursor.toISOString().slice(0, 10);
      if (!existing.has(`${tpl.id}|${dueIso}`)) {
        toInsert.push({ user_id: userId, template_id: tpl.id, due_date: dueIso, status: "pending" });
      }
      if (freq === "monthly")           cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, tpl.day_of_month);
      else if (freq === "yearly" || freq === "annual") cursor = new Date(cursor.getFullYear() + 1, cursor.getMonth(), tpl.day_of_month);
      else if (freq === "weekly")       cursor = new Date(cursor.getTime() + 7 * 86400000);
      else break;
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("recurring_reminders").insert(toInsert);
    if (error) console.warn("[generateMissingReminders]", error.message);
  }
  return toInsert.length;
}

/**
 * Detect recurring transaction patterns in a ledger array.
 * Returns array of { key, txSample, occurrences, avgAmount, avgDay, frequency, confidence }
 */
export function detectRecurringPatterns(ledger, { minOccurrences = 3, dayTolerance = 7 } = {}) {
  const groups = new Map();
  for (const tx of ledger) {
    if (!tx.tx_date || !tx.amount_idr) continue;
    const desc = tx.description || tx.merchant_name || "";
    const fingerprint = normalize(desc).slice(0, 20);
    if (fingerprint.length < 4) continue;
    const key = `${tx.tx_type}|${fingerprint}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }

  const patterns = [];
  for (const [key, txs] of groups) {
    if (txs.length < minOccurrences) continue;

    txs.sort((a, b) => a.tx_date.localeCompare(b.tx_date));

    // Amounts must be similar (±10%)
    const amounts  = txs.map(t => Math.abs(Number(t.amount_idr || 0)));
    const avgAmount = amounts.reduce((s, n) => s + n, 0) / amounts.length;
    const maxDiff  = Math.max(...amounts.map(a => Math.abs(a - avgAmount) / (avgAmount || 1)));
    if (maxDiff > 0.1) continue;

    // Spacing between consecutive dates
    const dates = txs.map(t => new Date(t.tx_date + "T00:00:00").getTime());
    const gaps  = [];
    for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / 86400000);
    const avgGap = gaps.reduce((s, n) => s + n, 0) / gaps.length;

    let frequency = null;
    if      (avgGap >= 25 && avgGap <= 35) frequency = "monthly";
    else if (avgGap >= 13 && avgGap <= 16) frequency = "biweekly";
    else if (avgGap >= 6  && avgGap <= 8)  frequency = "weekly";
    else continue;

    const expectedGap = frequency === "monthly" ? 30 : frequency === "weekly" ? 7 : 14;
    const tolerance   = frequency === "monthly" ? dayTolerance : frequency === "weekly" ? 2 : 3;
    if (!gaps.every(g => Math.abs(g - expectedGap) <= tolerance)) continue;

    // Not active if last occurrence is too old (>2× expected gap)
    const daysSinceLast = (Date.now() - dates[dates.length - 1]) / 86400000;
    if (daysSinceLast > expectedGap * 2) continue;

    const avgDay = Math.round(txs.reduce((s, t) => s + new Date(t.tx_date + "T00:00:00").getDate(), 0) / txs.length);

    patterns.push({
      key,
      txSample:    txs[txs.length - 1],
      occurrences: txs.length,
      avgAmount:   Math.round(avgAmount),
      avgDay,
      frequency,
      confidence:  txs.length >= 4 ? 2 : 1,
    });
  }

  return patterns.sort((a, b) => b.occurrences - a.occurrences);
}
