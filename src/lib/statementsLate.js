// Cards whose statement should have arrived by now but has not (22 Sep 2026).
// "Usual day" = the median statement day seen in this card's sessions; a card is late once today is
// more than GRACE days past it (statement emails normally land the same or next day) and no session exists for this month. Cards without a statement in the
// last 3 months are dormant and never counted — DBS, Mega Metro, Maybank MU, CIMB JCB, Mandiri Prioritas.
const GRACE = 2;
const DORMANT_DAYS = 95;

export function lateStatements(accounts = [], sessions = [], today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth() + 1;
  const ymd = today.toISOString().slice(0, 10);
  const cutoff = new Date(today.getTime() - DORMANT_DAYS * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const a of accounts) {
    if (a.type !== "credit_card" || a.is_active === false) continue;
    const mine = sessions.filter(s => s.account_id === a.id && s.status !== "void");
    if (mine.some(s => s.period_year === y && s.period_month === m)) continue;
    const dates = mine.map(s => String(s.statement_date || s.period_end || "").slice(0, 10)).filter(Boolean);
    if (a.last_statement_date) dates.push(String(a.last_statement_date).slice(0, 10));
    const newest = dates.sort().pop();
    if (!newest || newest < cutoff) continue;                      // dormant
    if (newest.slice(0, 7) === ymd.slice(0, 7)) continue;          // this month's already came (no session row)
    const days = dates.map(d => Number(d.slice(8, 10))).sort((p, q) => p - q);
    const usual = a.statement_day || days[Math.floor(days.length / 2)];
    if (!usual || today.getDate() <= usual + GRACE) continue;
    out.push({ acc: a, usual, daysLate: today.getDate() - usual });
  }
  return out.sort((p, q) => q.daysLate - p.daysLate);
}
