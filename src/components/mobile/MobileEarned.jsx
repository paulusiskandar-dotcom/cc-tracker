// SweetSpot › My spending on the phone: what each card REALLY earned, from the statements
// (points_history), against what was spent on it. No estimates, no rule snapshot.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { fmtIDR } from "../../utils";
import { classify, POOLS, POINT_RULES, poolOf, poolCheck } from "../../lib/pointsRules";
import "./mobile.css";

const num = n => Math.round(Number(n || 0)).toLocaleString("id-ID");

// Spend that could earn on one statement: purchases and instalments, without fees, and without a
// purchase the same statement credits back in full (converted to instalments, or refunded).
function stmtSpend(rows = []) {
  const back = rows.filter(r => r.direction === "in").map(r => Math.round(Math.abs(Number(r.amount || 0))));
  let s = 0;
  for (const r of rows) {
    const k = classify(r); if (k === "credit" || k === "fee") continue;
    const a = Math.abs(Number(r.amount || 0)); const i = back.indexOf(Math.round(a));
    if (i >= 0) { back.splice(i, 1); continue; }
    s += a;
  }
  return s;
}

export default function MobileEarned({ accounts = [], dark = false }) {
  const [hist, setHist] = useState(null);
  useEffect(() => {
    let on = true;
    supabase.from("points_history").select("account_id,statement_date,balance,earned,bonus,unit,stmt_rows").order("statement_date")
      .then(({ data }) => { if (on) setHist(data || []); });
    return () => { on = false; };
  }, []);

  const rows = useMemo(() => {
    if (!hist) return [];
    const name = Object.fromEntries(accounts.map(a => [a.id, a.name]));
    const byCard = {};
    for (const h of hist) { const n = name[h.account_id]; if (n) (byCard[n] = byCard[n] || []).push({ ...h, card: n }); }
    const out = []; const pooled = new Set();
    for (const [card, list] of Object.entries(byCard)) {
      // Statement figure is not this card's own earning (Mandiri: Livin'poin is the bank-wide pot).
      if (POINT_RULES[card]?.notesOnly) continue;
      const pool = poolOf(card);
      if (pool) {
        if (pooled.has(pool)) continue; pooled.add(pool);
        const all = Object.keys(POOLS[pool].cards).flatMap(c => byCard[c] || []);
        // the card with the longest run of statements is the pot's yardstick
        const best = Object.keys(POOLS[pool].cards).map(c => poolCheck(pool, all, c)).filter(Boolean).sort((a, b) => b.spend - a.spend)[0];
        if (best && best.printed > 0) out.push({ key: pool, name: `${pool.split(" ")[0]}, all cards`, unit: best.unit, points: best.printed, spend: best.spend, from: best.from, to: best.to });
        continue;
      }
      // months that have both the statement's lines and a figure for what was earned
      let pts = 0, spend = 0, from = null, to = null, prevBal = null;
      for (const h of list) {
        const earned = h.earned != null ? Number(h.earned) + Number(h.bonus || 0)
          : (h.balance != null && prevBal != null && Number(h.balance) >= prevBal ? Number(h.balance) - prevBal : null);
        if (h.balance != null) prevBal = Number(h.balance);
        if (earned == null || !Array.isArray(h.stmt_rows) || !h.stmt_rows.length) continue;
        pts += earned; spend += stmtSpend(h.stmt_rows); from = from || h.statement_date; to = h.statement_date;
      }
      if (pts > 0 && spend > 0) out.push({ key: card, name: card, unit: list[list.length - 1].unit || "points", points: pts, spend, from, to });
    }
    return out.sort((a, b) => a.spend / a.points - b.spend / b.points);
  }, [hist, accounts]);

  return (
    <div className={`mw${dark ? " dark" : ""}`} style={{ padding: 0, background: "none", minHeight: 0 }}>
      <div className="mw-label">Earned, per statements</div>
      {hist == null ? <div className="mw-note">Loading</div> : !rows.length ? <div className="mw-note">No statement has printed points yet.</div> : (
        <div className="mw-list">
          {rows.map(r => (
            <div key={r.key} className="mw-row mw-tx">
              <span className="mw-row-name">{r.name}<small>{num(r.points)} {r.unit} · Rp {(r.spend / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt</small></span>
              <span className="mw-row-amt">{fmtIDR(Math.round(r.spend / r.points))}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mw-note">Rupiah spent for one point or mile, from every 2026 statement that printed them. Lower is better. Units differ by programme, so compare cards inside the same programme. Cards whose statements print no points are not listed.</div>
    </div>
  );
}
