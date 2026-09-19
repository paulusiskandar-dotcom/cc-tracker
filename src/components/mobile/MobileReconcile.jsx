// Phone version of Reconcile. Presentation only: the month's lists (ready / needs review /
// done / waiting), the live re-match, the closing test and Finalize itself all belong to
// Reconcile.jsx and are passed in, so a statement finalized here goes through the same checks.
// Fixing rows and uploading PDFs stay on the desktop page.
import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { fmtIDR } from "../../utils";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const d2 = s => { if (!s) return ""; const d = new Date(`${String(s).slice(0, 10)}T00:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

export default function MobileReconcile({ monthLabel, onPrev, onNext, canNext, data, finalizing, onFinalize, onFinalizeAll, onOpenInbox, usualDay, dark }) {
  const [open, setOpen] = useState(null);
  const { ready = [], needsReview = [], completed = [], waiting = [] } = data;
  const sub = it => `${it.s.total_statement ?? 0} lines${it.s.period_end ? ` · to ${d2(it.s.period_end)}` : ""}`;
  return (
    <div className={`mw${dark ? " dark" : ""}`}>
      <div className="mw-hdr"><h1>Reconcile</h1></div>
      <div className="mw-bar2">
        <div className="mw-month">
          <button onClick={onPrev} aria-label="Previous month"><ChevronLeft size={18} /></button>
          <span>{monthLabel}</span>
          <button onClick={onNext} disabled={!canNext} aria-label="Next month"><ChevronRight size={18} /></button>
        </div>
      </div>

      {ready.length > 0 && (
        <>
          <div className="mw-label mw-label-row"><span>Ready to finalize</span>{ready.length > 1 && <button className="mw-linkbtn" onClick={onFinalizeAll} disabled={!!finalizing}>Finalize all {ready.length}</button>}</div>
          <div className="mw-list">
            {ready.map(it => (
              <button key={it.acc.id} className="mw-row mw-tx" onClick={() => setOpen({ kind: "ready", it })}>
                <span className="mw-row-name">{it.acc.name}<small>{sub(it)}</small></span>
                <span className="mw-row-amt">{fmtIDR(it.s.closing_balance)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {needsReview.length > 0 && (
        <>
          <div className="mw-label">Needs review</div>
          <div className="mw-list">
            {needsReview.map(it => {
              const miss = it.live ? it.live.missing : (it.s.total_missing || 0);
              return (
                <button key={it.acc.id} className="mw-row mw-tx" onClick={() => setOpen({ kind: "review", it })}>
                  <span className="mw-row-name">{it.acc.name}<small className="hot">{miss > 0 ? `${miss} line${miss === 1 ? "" : "s"} not in the book` : it.gap != null ? `closing off by ${fmtIDR(Math.abs(it.live?.tutup?.selisih || it.gap))}` : "closing does not tie"}</small></span>
                  <span className="mw-row-amt">{fmtIDR(it.s.closing_balance)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {completed.length > 0 && (
        <>
          <div className="mw-label">Done</div>
          <div className="mw-list">
            {completed.map(it => <div key={it.acc.id} className="mw-row mw-tx"><span className="mw-row-name">{it.acc.name}<small>{sub(it)}</small></span><span className="mw-row-amt">{fmtIDR(it.s.closing_balance)}</span></div>)}
          </div>
        </>
      )}

      {waiting.length > 0 && (
        <>
          <div className="mw-label">No statement yet</div>
          <div className="mw-list">
            {waiting.map(({ acc }) => { const day = usualDay(acc.id); return <div key={acc.id} className="mw-row"><span className="mw-row-name">{acc.name}</span><span className="mw-row-amt" style={{ fontWeight: 400, color: "var(--muted)" }}>{day ? `usually ~${day}` : ""}</span></div>; })}
          </div>
        </>
      )}
      {!ready.length && !needsReview.length && !completed.length && !waiting.length && <div className="mw-empty">Nothing for {monthLabel}.</div>}

      {open && (
        <div className="mw-modal" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <div className="mw-modal-card" onClick={ev => ev.stopPropagation()}>
            <div className="mw-hdr"><h2>{open.it.acc.name}</h2><button className="mw-round mw-round-sunk" onClick={() => setOpen(null)} aria-label="Close"><X size={20} strokeWidth={1.8} /></button></div>
            <div className="mw-tile-l">Statement closing</div>
            <div className="mw-tile-n">{fmtIDR(open.it.s.closing_balance)}</div>
            <div className="mw-list mw-gap mw-list-sunk">
              <div className="mw-row mw-kv"><span className="mw-row-name">Period</span><span className="mw-row-amt">{d2(open.it.s.period_start)} – {d2(open.it.s.period_end)}</span></div>
              <div className="mw-row mw-kv"><span className="mw-row-name">Statement lines</span><span className="mw-row-amt">{open.it.s.total_statement ?? "—"}</span></div>
              <div className="mw-row mw-kv"><span className="mw-row-name">Not in the book</span><span className={`mw-row-amt${(open.it.live ? open.it.live.missing : open.it.s.total_missing) > 0 ? " hot" : ""}`}>{open.it.live ? open.it.live.missing : (open.it.s.total_missing ?? 0)}</span></div>
              <div className="mw-row mw-kv"><span className="mw-row-name">Closing off by</span><span className={`mw-row-amt${open.kind === "review" ? " hot" : ""}`}>{open.it.live?.tutup ? fmtIDR(Math.abs(open.it.live.tutup.selisih)) : open.it.gap == null ? "—" : fmtIDR(Math.abs(open.it.gap))}</span></div>
              {open.it.live?.tutup && <div className="mw-row mw-kv"><span className="mw-row-name">Book at closing date</span><span className="mw-row-amt">{fmtIDR(open.it.live.tutup.buku ?? open.it.live.tutup.ledger ?? 0)}</span></div>}
            </div>
            {open.kind === "ready"
              ? <button className="mw-btn" disabled={finalizing === open.it.acc.id} onClick={async () => { await onFinalize(open.it); setOpen(null); }}>{finalizing === open.it.acc.id ? "Finalizing" : "Finalize"}</button>
              : <>
{(() => {
                    const miss = open.it.live ? open.it.live.missing : (open.it.s.total_missing || 0);
                    const lebih = open.it.live?.tutup?.lebih || [];
                    if (miss > 0) return <div className="mw-note">Lines still missing are waiting in the Inbox. Approve them there.</div>;
                    if (!lebih.length) return <div className="mw-note">Every statement line is in the book, yet the closing does not tie. Check amounts on the desktop Reconcile page.</div>;
                    return <>
                      <div className="mw-label">In the book, not on this statement</div>
                      <div className="mw-list mw-list-sunk">
                        {lebih.map(r => <div key={r.id} className="mw-row mw-kv"><span className="mw-row-name">{r.name}<small>{d2(r.date)}</small></span><span className="mw-row-amt">{fmtIDR(r.amount)}</span></div>)}
                      </div>
                      <div className="mw-note">Paid with another card, or billed next month? Move the row to the right card or date, then Finalize.</div>
                    </>;
                  })()}
                  {(open.it.live ? open.it.live.missing : (open.it.s.total_missing || 0)) > 0 && <button className="mw-btn" onClick={() => { setOpen(null); onOpenInbox(); }}>Open Inbox</button>}
                </>}
          </div>
        </div>
      )}
    </div>
  );
}
