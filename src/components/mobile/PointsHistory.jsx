// Points per statement for one card, and whether the earn rule reproduces what the bank printed.
// Reads points_history (written by the statement parser). Never edits anything.
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtIDR } from "../../utils";
import { applyRule, shortfall, likelyNotEarning, POINT_RULES } from "../../lib/pointsRules";

const num = n => Number(n || 0).toLocaleString("id-ID");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = d => { const [y, m] = String(d).split("-"); return `${MON[Number(m) - 1]} ${y}`; };

export default function PointsHistory({ card }) {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    let on = true;
    supabase.from("points_history").select("*").eq("account_id", card.id).order("statement_date", { ascending: false }).limit(12)
      .then(({ data }) => { if (on) setRows(data || []); });
    return () => { on = false; };
  }, [card.id]);

  const list = useMemo(() => rows.map((r, i) => {
    const prev = rows[i + 1];
    // Printed by the bank when available; otherwise the change in balance (redemptions included, so it can be negative).
    const earned = r.earned != null ? Number(r.earned) : (r.balance != null && prev?.balance != null ? Number(r.balance) - Number(prev.balance) : null);
    // Cards that print only a balance are checked against the change in balance (OCBC 90N: Jul 6.097 = 6.097,
    // Sep 8.852 = 8.852). A redemption in that month makes the change smaller than the rule — shown, not hidden.
    const check = earned != null && Array.isArray(r.stmt_rows) && r.stmt_rows.length ? applyRule(card.name, r.stmt_rows) : null;
    const sf = check ? shortfall(check, earned) : null;
    return { ...r, shown: earned, printed: r.earned != null, check, sf };
  }), [rows, card.name]);

  // Per purchase: what it earned. "none" only where the evidence is unambiguous, "unclear" where two
  // explanations differ on that line; instalments and fees never earn under the card's rule.
  const linesOf = (m) => {
    if (!m?.check) return [];
    const { sure, maybe } = likelyNotEarning(list, m);
    const per = l => (l.kind === "fx" ? m.check.rule.perFx : m.check.rule.per);
    const earning = m.check.earning.map(l => ({ ...l, pts: l.amount / per(l), state: sure.includes(l) ? "none" : maybe.includes(l) ? "unclear" : (m.sf.ok || sure.length || maybe.length ? "earned" : "rule") }));
    const skipped = m.check.skipped.map(l => ({ ...l, pts: 0, state: l.kind }));
    return [...earning, ...skipped].sort((a, b) => b.amount - a.amount);
  };
  const lessons = POINT_RULES[card.name]?.lessons || [];

  if (!list.length) return null;
  return (
    <>
      <div className="mw-label">Points history</div>
      <div className="mw-list">
        {list.map(r => (
          <button key={r.id} className="mw-row mw-tx" onClick={() => setOpen(r)}>
            <span className="mw-row-name">{label(r.statement_date)}{r.sf && !r.sf.ok && <small className="hot">rule says {num(r.check.points)}</small>}</span>
            <span className="mw-row-amt">{r.shown == null ? num(r.balance) : `${r.shown > 0 && !r.printed ? "+" : ""}${num(r.shown)}`}</span>
          </button>
        ))}
      </div>
      {lessons.length > 0 && (
        <>
          <div className="mw-label">What the statements taught</div>
          <div className="mw-list">
            {lessons.map((t, i) => <div key={i} className="mw-row mw-lesson"><span className="mw-row-name mw-wrap">{t}</span></div>)}
          </div>
        </>
      )}
      {open && (
        <div className="mw-modal" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <div className="mw-modal-card" onClick={ev => ev.stopPropagation()}>
            <div className="mw-hdr"><h2>{label(open.statement_date)}</h2><button className="mw-round mw-round-sunk" onClick={() => setOpen(null)} aria-label="Close"><X size={20} strokeWidth={1.8} /></button></div>
            <div className="mw-list mw-list-sunk">
              {open.balance != null && <div className="mw-row mw-kv"><span className="mw-row-name">Balance</span><span className="mw-row-amt">{num(open.balance)}</span></div>}
              {open.shown != null && <div className="mw-row mw-kv"><span className="mw-row-name">{open.printed ? "Earned, per statement" : "Change in balance"}</span><span className="mw-row-amt">{num(open.shown)}</span></div>}
              {Number(open.bonus) > 0 && <div className="mw-row mw-kv"><span className="mw-row-name">Bonus</span><span className="mw-row-amt">{num(open.bonus)}</span></div>}
              {Number(open.redeemed) > 0 && <div className="mw-row mw-kv"><span className="mw-row-name">Redeemed</span><span className="mw-row-amt">{num(open.redeemed)}</span></div>}
              {Number(open.expiring) > 0 && <div className="mw-row mw-kv"><span className="mw-row-name">Expiring{open.expiry_date ? ` ${label(open.expiry_date)}` : ""}</span><span className="mw-row-amt hot">{num(open.expiring)}</span></div>}
            </div>
            {open.check && (
              <>
                <div className="mw-label">Rule check</div>
                <div className="mw-list mw-list-sunk">
                  <div className="mw-row mw-kv"><span className="mw-row-name">Spend that earns</span><span className="mw-row-amt">{fmtIDR(open.check.spend)}</span></div>
                  <div className="mw-row mw-kv"><span className="mw-row-name">Rule says<small>{fmtIDR(open.check.rule.per)} per {open.unit || "point"}</small></span><span className="mw-row-amt">{num(open.check.points)}</span></div>
                  <div className="mw-row mw-kv"><span className="mw-row-name">Difference</span><span className={`mw-row-amt${open.sf.ok ? " good" : " hot"}`}>{open.sf.ok ? "matches" : num(open.sf.diff)}</span></div>
                  {open.check.bonus > 0 && <div className="mw-row mw-kv"><span className="mw-row-name">Bonus expected</span><span className={`mw-row-amt${Number(open.bonus) === open.check.bonus ? " good" : " hot"}`}>{num(open.check.bonus)}</span></div>}
                  {open.check.spend > 0 && open.shown > 0 && <div className="mw-row mw-kv"><span className="mw-row-name">Effective</span><span className="mw-row-amt">{fmtIDR(Math.round(open.check.spend / (open.shown + Number(open.bonus || 0))))} per {open.unit || "point"}</span></div>}
                </div>
                {!open.sf.ok && open.sf.rupiah > 0 && <div className="mw-note">About {fmtIDR(open.sf.rupiah)} of this statement's spend earned nothing. The bank decides that per merchant category, which the statement does not print.</div>}
                <div className="mw-label">Purchases</div>
                <div className="mw-list mw-list-sunk">
                  {linesOf(open).map((l, i) => (
                    <div key={i} className="mw-row mw-kv">
                      <span className="mw-row-name">{String(l.description).replace(/\s+(JAKARTA|SINGAPORE|AMSTERDAM)\b.*$/i, "").replace(/\(.*$/, "").trim()}<small>{fmtIDR(l.amount)}{l.state === "instalment" ? " · instalment" : l.state === "fee" ? " · fee" : l.state === "unclear" ? " · unclear" : l.state === "rule" ? " · by the rule" : ""}</small></span>
                      <span className={`mw-row-amt${l.state === "none" ? " hot" : l.state === "earned" ? " good" : ""}`}>{l.state === "none" || l.state === "instalment" || l.state === "fee" ? "0" : l.state === "unclear" ? "?" : num(Math.round(l.pts))}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
