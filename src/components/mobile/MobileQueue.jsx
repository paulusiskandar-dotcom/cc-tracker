// Phone version of the Email Sync queue. Presentation only: approving, skipping, validation
// and the account lists all come from the desktop queue (Email.jsx + TxHorizontal.jsx), so
// a row approved here is booked by exactly the same code.
import { useState } from "react";
import { X } from "lucide-react";
import { fmtIDR, fmtCurNative } from "../../utils";
import { TX_TYPE_MAP, ENTITIES } from "../../constants";
import { validateRow, getAcctCfg } from "../shared/TxHorizontal";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = s => { if (!s) return ""; const d = new Date(`${String(s).slice(0, 10)}T00:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const NO_CAT = new Set(["transfer", "pay_cc", "give_loan", "collect_loan", "fx_exchange", "reimburse_in", "reimburse_out", "buy_asset", "sell_asset", "pay_liability"]);
const SIMPLE_TYPES = ["expense", "income", "transfer", "pay_cc", "reimburse_out", "reimburse_in"];
// Fields this sheet does not offer; rows that need them go to the full editor.
const NEEDS_FULL = r => ["collect_loan", "give_loan", "buy_asset", "sell_asset", "fx_exchange", "pay_liability"].includes(r.tx_type);
const amountText = r => (r.currency && r.currency !== "IDR" ? fmtCurNative(r.amount, r.currency) : fmtIDR(r.amount_idr || r.amount));
const ERR_EN = { "Pilih akun sumber": "Choose the account it came from", "Pilih akun tujuan": "Choose the account it went to", "Pilih kategori": "Choose a category", "Pilih entity reimburse": "Choose who reimburses", "Isi FX rate": "Needs an FX rate", "Pilih borrower": "Choose the borrower", "Pilih asset": "Choose the asset" };

export default function MobileQueue({ rows = [], onUpdateRow, onConfirmRow, onSkipRow, accounts = [], categories = [], incomeSrcs = [], busy = false, waiting = false, dark = false, onFullEditor }) {
  const [openId, setOpenId] = useState(null);
  const row = rows.find(r => r._id === openId);
  return (
    <div className={`mw${dark ? " dark" : ""}`} style={{ margin: 0 }}>
      <div className="mw-list">
        {rows.map(r => {
          const err = waiting ? null : validateRow(r, accounts);
          return (
            <button key={r._id} className="mw-row mw-tx" onClick={() => setOpenId(r._id)}>
              <span className="mw-row-name">{r.notes || r.description || r.subject || "Transaction"}<small className={err ? "hot" : ""}>{fmtDate(r.tx_date)}{err ? ` · ${ERR_EN[err] || err}` : ""}</small></span>
              <span className="mw-row-amt">{amountText(r)}</span>
            </button>
          );
        })}
        {onFullEditor && <button className="mw-row mw-showall" onClick={onFullEditor}>Open full editor</button>}
      </div>
      {row && <QueueSheet r={row} accounts={accounts} categories={categories} incomeSrcs={incomeSrcs} busy={busy} waiting={waiting}
        onUpdate={patch => onUpdateRow(row._id, patch)} onClose={() => setOpenId(null)} onFullEditor={onFullEditor}
        onApprove={() => { setOpenId(null); onConfirmRow(row); }} onSkip={() => { setOpenId(null); onSkipRow(row._id); }} />}
    </div>
  );
}

function QueueSheet({ r, accounts, categories, incomeSrcs, busy, waiting, onUpdate, onClose, onApprove, onSkip, onFullEditor }) {
  const cfg = getAcctCfg(r.tx_type, accounts);
  const needFrom = cfg.mode === "from" || cfg.mode === "from_to";
  const needTo = cfg.mode === "to" || cfg.mode === "from_to";
  const cats = r.tx_type === "income" ? incomeSrcs : categories;
  const err = waiting ? null : validateRow(r, accounts);
  const types = SIMPLE_TYPES.includes(r.tx_type) ? SIMPLE_TYPES : [r.tx_type, ...SIMPLE_TYPES];
  const complex = NEEDS_FULL(r) || r._cicilan || r._paper_split;
  const opt = list => (list || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>);
  const sid = `q-${r._id}`;
  return (
    <div className="mw-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mw-modal-card" onClick={ev => ev.stopPropagation()}>
        <div className="mw-hdr">
          <h2>{r.notes || r.description || "Transaction"}</h2>
          <button className="mw-round mw-round-sunk" onClick={onClose} aria-label="Close"><X size={20} strokeWidth={1.8} /></button>
        </div>
        <div className="mw-tile-n">{amountText(r)}</div>
        <div className="mw-tile-s">{fmtDate(r.tx_date)}{r.description && r.notes ? ` · ${r.description}` : ""}</div>

        {waiting ? (
          <div className="mw-note">Foreign-currency charge. It waits for the statement, which carries the real rupiah amount, and clears from here once that statement is reconciled.</div>
        ) : (
          <div className="mw-fields">
            <label htmlFor={`${sid}-type`}>Type
              <select id={`${sid}-type`} value={r.tx_type} onChange={e => onUpdate({ tx_type: e.target.value, category_id: null })}>
                {types.map(t => <option key={t} value={t}>{TX_TYPE_MAP[t]?.label || t}</option>)}
              </select>
            </label>
            {needFrom && <label htmlFor={`${sid}-from`}>From
              <select id={`${sid}-from`} value={r.from_id || ""} onChange={e => onUpdate({ from_id: e.target.value })}><option value="">Choose account</option>{opt(cfg.from)}</select>
            </label>}
            {needTo && <label htmlFor={`${sid}-to`}>To
              <select id={`${sid}-to`} value={r.to_id || ""} onChange={e => onUpdate({ to_id: e.target.value })}><option value="">Choose account</option>{opt(cfg.to)}</select>
            </label>}
            {!NO_CAT.has(r.tx_type) && <label htmlFor={`${sid}-cat`}>{r.tx_type === "income" ? "Source" : "Category"}
              <select id={`${sid}-cat`} value={r.category_id || ""} onChange={e => onUpdate({ category_id: e.target.value || null })}>
                <option value="">{r.suggested_category_label ? `Suggested: ${r.suggested_category_label}` : "Choose"}</option>{opt(cats)}
              </select>
            </label>}
            {/^reimburse_/.test(r.tx_type) && <label htmlFor={`${sid}-ent`}>Entity
              <select id={`${sid}-ent`} value={r.entity || ""} onChange={e => onUpdate({ entity: e.target.value })}><option value="">Choose</option>{ENTITIES.map(x => <option key={x} value={x}>{x}</option>)}</select>
            </label>}
            <label htmlFor={`${sid}-notes`}>Notes
              <input id={`${sid}-notes`} value={r.notes || ""} onChange={e => onUpdate({ notes: e.target.value })} placeholder="What was it" />
            </label>
          </div>
        )}

        {r._dup && !waiting && <div className="mw-note mw-note-warn">Looks like a transaction already in the ledger (same amount and date). Approving asks you to confirm.</div>}
        {complex && !waiting && <div className="mw-note">This one has parts this sheet does not edit{r._cicilan ? " (it starts an installment plan)" : r._paper_split ? " (Paper.id split)" : ""}. {err ? "Finish it in the full editor." : "Approving books it the same way as on desktop."}</div>}
        {err && <div className="mw-err">{ERR_EN[err] || err}</div>}

        <div className="mw-form-act">
          <button className="mw-btn mw-btn-ghost" onClick={onSkip} disabled={busy}>{waiting ? "Dismiss" : "Skip"}</button>
          {waiting ? <button className="mw-btn" onClick={onClose}>Keep waiting</button>
            : err && complex && onFullEditor ? <button className="mw-btn" onClick={() => { onClose(); onFullEditor(); }}>Full editor</button>
            : <button className="mw-btn" onClick={onApprove} disabled={busy || !!err}>Approve</button>}
        </div>
      </div>
    </div>
  );
}
