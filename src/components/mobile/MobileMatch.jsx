// Phone version of Receivables › Match. Presentation only: the selection state, the
// Rp 10.000 rule, the mandatory "record short/over as" choice and the Match action all
// belong to Receivables.jsx and are passed in — a match made here is booked by the same code.
import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { fmtIDR } from "../../utils";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = s => { const d = new Date(`${String(s).slice(0, 10)}T00:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const label = e => (e.notes && !/^imported from/i.test(e.notes) ? e.notes : (e.description || e.merchant_name || "Reimburse"));
const val = e => Number(e.amount || 0);

export default function MobileMatch({ entities = [], threshold, categories = [], settling, onMatch, dark }) {
  const [openId, setOpenId] = useState(null);
  const ent = entities.find(x => x.id === openId);
  if (ent) return <EntityMatch ent={ent} threshold={threshold} categories={categories} settling={settling} onMatch={onMatch} onBack={() => setOpenId(null)} dark={dark} />;
  return (
    <div className={`mw${dark ? " dark" : ""}`} style={{ margin: 0 }}>
      <div className="mw-list">
        {entities.map(x => (
          <button key={x.id} className="mw-row mw-tx" onClick={() => setOpenId(x.id)}>
            <span className="mw-row-name">{x.entity}<small>{x.outRows.length} paid out · {x.inRows.length} received, not matched</small></span>
            <span className={`mw-row-amt${x.outstanding < 0 ? " in" : ""}`}>{x.outstanding < 0 ? "−" : ""}{fmtIDR(Math.abs(x.outstanding))}</span>
          </button>
        ))}
        {!entities.length && <div className="mw-row"><span className="mw-row-name" style={{ color: "var(--muted)" }}>No reimburse accounts yet</span></div>}
      </div>
    </div>
  );
}

function EntityMatch({ ent, threshold, categories, settling, onMatch, onBack, dark }) {
  const out = ent.outRows.filter(e => ent.selOut.has(e.id)).reduce((s, e) => s + val(e), 0);
  const inn = ent.inRows.filter(e => ent.selIn.has(e.id)).reduce((s, e) => s + val(e), 0);
  const short = out - inn, over = inn - out;
  const any = ent.selOut.size > 0 || ent.selIn.size > 0;
  const can = ent.selOut.size > 0 && ent.selIn.size > 0;
  const needShort = short > threshold && !ent.shortAs;
  const needOver = over > threshold && !ent.overAs;
  return (
    <div className={`mw${dark ? " dark" : ""}`} style={{ margin: 0, paddingBottom: any ? 210 : 0 }}>
      <div className="mw-hdr">
        <button className="mw-round" onClick={onBack} aria-label="Back"><ChevronLeft size={22} strokeWidth={1.8} /></button>
        <h2>{ent.entity}</h2>
      </div>

      <Side title="Paid out" rows={ent.outRows} sel={ent.selOut} onToggle={ent.toggleOut} pair={ent.pairIndex} />
      <Side title="Received" rows={ent.inRows} sel={ent.selIn} onToggle={ent.toggleIn} pair={ent.pairIndex} incoming />

      {any && (
        <div className="mw-dock">
          <div className="mw-dock-row"><span>Paid out</span><b>{fmtIDR(out)}</b></div>
          <div className="mw-dock-row"><span>Received</span><b className="in">{fmtIDR(inn)}</b></div>
          <div className="mw-dock-row mw-dock-sum"><span>{over > 0 ? "Over" : "Short"}</span><b className={short > 0 ? "hot" : over > 0 ? "in" : ""}>{fmtIDR(Math.abs(short))}</b></div>
          {short > threshold && (
            <label htmlFor="mm-short" className="mw-dock-pick">Record short as
              <select id="mm-short" value={ent.shortAs || ""} onChange={e => ent.setShortAs(e.target.value)}>
                <option value="">Choose a category</option>
                {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {over > threshold && (
            <label htmlFor="mm-over" className="mw-dock-pick">Record over as
              <select id="mm-over" value={ent.overAs || ""} onChange={e => ent.setOverAs(e.target.value)}>
                <option value="">Choose</option>
                <option value="utility">Utility Income (electricity, Biznet margin)</option>
                <option value="other">Other Income</option>
              </select>
            </label>
          )}
          <div className="mw-dock-act">
            <label htmlFor="mm-date">Settled on<input id="mm-date" type="date" value={ent.settleDate} onChange={e => ent.setSettleDate(e.target.value)} /></label>
            <button className="mw-btn" onClick={() => onMatch(ent)} disabled={!can || settling || needShort || needOver}>{settling ? "Matching" : "Match"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Side({ title, rows, sel, onToggle, pair = {}, incoming }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <>
      <div className="mw-label mw-label-row"><span>{title}</span><b>{rows.length}</b></div>
      <div className="mw-list">
        {shown.map(e => {
          const on = sel.has(e.id);
          return (
            <button key={e.id} className={`mw-row mw-tx mw-check${on ? " on" : ""}`} onClick={() => onToggle(e.id)} aria-pressed={on}>
              <i className="mw-box" aria-hidden="true" />
              <span className="mw-row-name">{label(e)}<small>{day(e.tx_date)}{pair[e.id] != null ? ` · likely pair ${pair[e.id] + 1}` : ""}</small></span>
              <span className={`mw-row-amt${incoming ? " in" : ""}`}>{fmtIDR(val(e))}</span>
            </button>
          );
        })}
        {!rows.length && <div className="mw-row"><span className="mw-row-name" style={{ color: "var(--muted)" }}>Nothing open</span></div>}
        {rows.length > 12 && <button className="mw-row mw-showall" onClick={() => setAll(v => !v)}>{all ? "Show less" : `Show all ${rows.length}`}</button>}
      </div>
    </>
  );
}
