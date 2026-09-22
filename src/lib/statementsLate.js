// Cards whose statement should have arrived by now but has not (22 Sep 2026).
// "Usual day" = the median statement day seen in this card's sessions; a card is late once today is
// more than GRACE days past it (statement emails normally land the same or next day) and no session exists for this month. Cards without a statement in the
// last 3 months are dormant and never counted — DBS, Mega Metro, Maybank MU, CIMB JCB, Mandiri Prioritas.
const GRACE = 2;

// What we know about a card's statement rhythm. dormant = it skipped last month already
// (Danamon JCB: last statement Jul, none in Aug — nothing to wait for in Sep).
export function statementCadence(acc, sessions = [], today = new Date()) {
  const mine = sessions.filter(s => s.account_id === acc.id && s.status !== "void");
  const dates = mine.map(s => String(s.statement_date || s.period_end || "").slice(0, 10)).filter(Boolean);
  if (acc.last_statement_date) dates.push(String(acc.last_statement_date).slice(0, 10));
  const newest = dates.slice().sort().pop() || null;
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevYm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  const thisYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const days = dates.map(d => Number(d.slice(8, 10))).sort((p, q) => p - q);
  const usual = acc.statement_day || (days.length ? days[Math.floor(days.length / 2)] : null);
  const dormant = !newest || (newest.slice(0, 7) !== prevYm && newest.slice(0, 7) !== thisYm);
  return { usual, newest, dormant, arrivedThisMonth: !!newest && newest.slice(0, 7) === thisYm };
}

export function lateStatements(accounts = [], sessions = [], today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth() + 1;
  const out = [];
  for (const a of accounts) {
    if (a.type !== "credit_card" || a.is_active === false) continue;
    if (sessions.some(s => s.account_id === a.id && s.status !== "void" && s.period_year === y && s.period_month === m)) continue;
    const c = statementCadence(a, sessions, today);
    if (c.dormant || c.arrivedThisMonth || !c.usual) continue;
    if (today.getDate() <= c.usual + GRACE) continue;
    out.push({ acc: a, usual: c.usual, daysLate: today.getDate() - c.usual });
  }
  return out.sort((p, q) => q.daysLate - p.daysLate);
}
