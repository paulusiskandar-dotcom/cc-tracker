// Mobile Wallet (phones only, <768px). Desktop keeps Credit Cards / Bank / Cash pages.
// Layout follows Apple Wallet: a stack of real card images with nothing drawn on top,
// tap a card to lift it and read its figures as plain rows underneath.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtIDR, fmtCurNative } from "../../utils";
import CurrencyFlag from "../shared/CurrencyFlag";
import "./mobile.css";

const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const fmtDate = s => { if (!s) return ""; const d = new Date(`${String(s).slice(0, 10)}T00:00:00`); return `${fmtDay(d)} ${d.getFullYear()}`; };
const num = n => Number(n || 0).toLocaleString("id-ID");
const nextDue = day => {
  if (!day) return null;
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (y, m) => new Date(y, m, Math.min(Number(day), new Date(y, m + 1, 0).getDate()));
  let t = at(today.getFullYear(), today.getMonth());
  if (t < today) t = at(today.getFullYear(), today.getMonth() + 1);
  return { date: t, days: Math.round((t - today) / 86400000) };
};
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const SEGMENTS = [["credit", "Credit"], ["bank", "Bank"], ["cash", "Cash"]];

export default function Wallet({ user, accounts = [], ledger = [], fxRates = {}, initialSegment = "credit", setTab, onSearch }) {
  const navigate = useNavigate();
  const [seg, setSeg] = useState(() => lsGet("m.wallet.seg") || initialSegment);
  const [openCard, setOpenCard] = useState(null); // { id, from: rect of the tapped card }
  const [leaving, setLeaving] = useState(false);   // sheet is closing: bring the stack back in step with it
  const stackRef = useRef(null);
  const [catalog, setCatalog] = useState({ byAccount: {}, ratio: {} });
  const [dismissed, setDismissed] = useState(() => lsGet("m.wallet.notice") || "");

  useEffect(() => { lsSet("m.wallet.seg", seg); }, [seg]);

  // Catalogue link per card (for the picture) and the bank's points-per-KrisFlyer-mile
  // ratio. Both come from n8n's tables; nothing is filled in here.
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    (async () => {
      const [{ data: maps }, { data: kartu }] = await Promise.all([
        supabase.from("pemetaan_kartu").select("account_id,kartu_katalog,status"),
        supabase.from("kartu_miles").select("kartu,poin_per_mile_kf"),
      ]);
      if (!alive) return;
      const byAccount = {}; (maps || []).forEach(m => { if (m.status === "matched" && m.kartu_katalog) byAccount[m.account_id] = m.kartu_katalog; });
      const ratio = {}; (kartu || []).forEach(k => { if (Number(k.poin_per_mile_kf) > 0) ratio[k.kartu] = Number(k.poin_per_mile_kf); });
      setCatalog({ byAccount, ratio });
    })();
    return () => { alive = false; };
  }, [user?.id]);

  const active = useMemo(() => accounts.filter(a => a.is_active !== false), [accounts]);

  const cards = useMemo(() => {
    const cc = active.filter(a => a.type === "credit_card");
    const groups = {};
    cc.forEach(c => {
      const g = c.shared_limit_group_id; if (!g) return;
      groups[g] = groups[g] || { debt: 0, cr: 0, limit: 0 };
      groups[g].debt += Number(c.outstanding_amount || 0); groups[g].cr += Number(c.current_balance || 0);
      if (c.is_limit_group_master || !groups[g].limit) groups[g].limit = Number(c.shared_limit || 0) || groups[g].limit;
    });
    const rows = cc.map(c => {
      const rate = fxRates[c.currency] || 1;
      const debt = Number(c.outstanding_amount || 0) * rate;
      const g = c.shared_limit_group_id && groups[c.shared_limit_group_id];
      const limit = g ? g.limit * rate : Number(c.card_limit || 0) * rate;
      const avail = limit > 0 ? Math.max(0, g ? (g.limit - g.debt + g.cr) * rate : limit - debt + Number(c.current_balance || 0) * rate) : null;
      const kat = catalog.byAccount[c.id];
      return { ...c, debt, limit, avail, due: nextDue(c.due_day), kat, img: c.card_image_url || (kat ? `/cards/${slug(kat)}.jpg` : null), ratio: kat ? catalog.ratio[kat] : null };
    });
    return rows.sort((a, b) => b.debt - a.debt); // largest balance on top
  }, [active, fxRates, catalog]);

  const banks = useMemo(() => active.filter(a => a.type === "bank" && a.subtype !== "cash" && a.subtype !== "reimburse")
    .sort((a, b) => Number(b.current_balance || 0) * (fxRates[b.currency] || 1) - Number(a.current_balance || 0) * (fxRates[a.currency] || 1)), [active, fxRates]);
  const cash = useMemo(() => active.filter(a => a.type === "bank" && a.subtype === "cash")
    .sort((a, b) => Number(b.current_balance || 0) * (fxRates[b.currency] || 1) - Number(a.current_balance || 0) * (fxRates[a.currency] || 1)), [active, fxRates]);

  // One dismissible notice: the nearest points expiry within 45 days.
  const notice = useMemo(() => {
    const soon = cards.filter(c => Number(c.points_expiring) > 0 && c.points_expiry_date)
      .map(c => ({ c, days: Math.round((new Date(`${c.points_expiry_date}T00:00:00`) - new Date()) / 86400000) }))
      .filter(x => x.days >= 0 && x.days <= 45).sort((a, b) => a.days - b.days)[0];
    if (!soon) return null;
    const key = `${soon.c.id}:${soon.c.points_expiry_date}`;
    return key === dismissed ? null : { key, text: `${num(soon.c.points_expiring)} ${soon.c.points_unit || "points"} expire ${fmtDate(soon.c.points_expiry_date)}`, name: soon.c.name, id: soon.c.id };
  }, [cards, dismissed]);

  const open = openCard && cards.find(c => c.id === openCard.id);
  const openById = id => {
    const el = stackRef.current?.querySelector(`[data-card="${id}"]`);
    const r = el?.getBoundingClientRect();
    setOpenCard({ id, from: r ? { top: r.top } : null });
  };

  return (
    <div className={`mw${open && !leaving ? " mw-behind" : ""}`}>
      {open && <CardSheet card={open} from={openCard.from} ledger={ledger} onLeave={() => setLeaving(true)} onClose={() => { setOpenCard(null); setLeaving(false); }} navigate={navigate} setTab={setTab} />}
      <div className="mw-hdr">
        <h1>Wallet</h1>
        {onSearch && <button className="mw-round" onClick={onSearch} aria-label="Search"><Search size={20} strokeWidth={1.8} /></button>}
      </div>

      {notice && seg === "credit" && (
        <div className="mw-notice">
          <button className="mw-notice-body" onClick={() => openById(notice.id)}>
            <b>{notice.name}</b><span>{notice.text}</span>
          </button>
          <button className="mw-x" onClick={() => { setDismissed(notice.key); lsSet("m.wallet.notice", notice.key); }} aria-label="Dismiss"><X size={18} /></button>
        </div>
      )}

      <div className="mw-seg" role="tablist">
        {SEGMENTS.map(([id, label]) => <button key={id} role="tab" aria-selected={seg === id} className={seg === id ? "on" : ""} onClick={() => setSeg(id)}>{label}</button>)}
      </div>

      {seg === "credit" && (
        <>
          <div className="mw-stack" ref={stackRef}>
            {cards.map(c => (
              <button key={c.id} data-card={c.id} className={`mw-card${open && c.id === open.id ? " mw-gone" : ""}`} onClick={() => openById(c.id)} aria-label={c.name}>
                <CardArt card={c} />
              </button>
            ))}
          </div>
        </>
      )}

      {seg === "bank" && <AccountList rows={banks} fxRates={fxRates} navigate={navigate} />}
      {seg === "cash" && <AccountList rows={cash} fxRates={fxRates} navigate={navigate} showTotal flags />}
    </div>
  );
}

function CardArt({ card }) {
  const [broken, setBroken] = useState(false);
  if (card.img && !broken) return <img className="mw-art" src={card.img} alt="" decoding="sync" draggable={false} onError={() => setBroken(true)} />;
  return <div className="mw-art mw-art-ph"><b>{card.bank_name || card.name}</b>{card.bank_name && card.bank_name !== card.name ? <span>{card.name}</span> : null}</div>;
}

// Rows are ordered by rupiah value; a foreign balance shows that value underneath so the
// order reads at a glance.
function AccountList({ rows, fxRates, navigate, showTotal, flags }) {
  const total = rows.reduce((s, a) => s + Number(a.current_balance || 0) * (fxRates[a.currency] || 1), 0);
  if (!rows.length) return <div className="mw-empty">Nothing here yet.</div>;
  return (
    <div className="mw-list">
      {rows.map(a => (
        <button key={a.id} className="mw-row" onClick={() => navigate(`/accounts/${a.id}/statement`)}>
          {flags && <CurrencyFlag code={a.currency || "IDR"} size={28} />}
          <span className="mw-row-name">{a.name}</span>
          <span className="mw-row-amt">{fmtCurNative(a.current_balance, a.currency)}
            {a.currency && a.currency !== "IDR" && fxRates[a.currency] ? <small>{fmtIDR(Number(a.current_balance || 0) * fxRates[a.currency])}</small> : null}
          </span>
          <ChevronRight size={16} className="mw-chev" />
        </button>
      ))}
      {showTotal && <div className="mw-row mw-total">{flags && <span style={{ width: 28, flex: "none" }} />}<span className="mw-row-name">Total</span><span className="mw-row-amt">{fmtIDR(total)}</span><span className="mw-chev" /></div>}
    </div>
  );
}

// Apple Wallet flow. First tap: the card flies to the top, the rest of the stack drops
// away, and a quick preview sits under it. Tap the card again for the full detail;
// the close button steps back one level at a time.
function CardSheet({ card, from, ledger, onLeave, onClose, navigate, setTab }) {
  const [level, setLevel] = useState("peek");
  const [shown, setShown] = useState(false);
  const artRef = useRef(null);
  const swapped = useRef(false); // the swap animation is for peek ↔ detail only, not for opening
  const [delta, setDelta] = useState(0);

  useLayoutEffect(() => {
    const top = artRef.current?.getBoundingClientRect().top ?? 0;
    setDelta(from ? from.top - top : 0);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { cancelAnimationFrame(id); document.body.style.overflow = prev; };
  }, [from]);

  const close = () => { setShown(false); onLeave && onLeave(); setTimeout(onClose, 560); };
  const back = () => { if (level === "detail") { swapped.current = true; setLevel("peek"); } else close(); };

  const mine = useMemo(() => ledger.filter(e => e.from_id === card.id || e.to_id === card.id)
    .sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date))), [ledger, card.id]);
  const hasPoints = card.points_balance != null;
  const kf = hasPoints && card.ratio ? Math.floor(Number(card.points_balance) / card.ratio) : null;
  const expDays = card.points_expiry_date ? Math.round((new Date(`${card.points_expiry_date}T00:00:00`) - new Date()) / 86400000) : null;
  const used = card.limit > 0 && card.avail != null ? Math.max(0, card.limit - card.avail) : null;
  const showDue = card.due && card.debt > 0;
  const dueText = showDue ? (card.due.days === 0 ? "TODAY" : `${card.due.days}D LEFT`) : null;

  return (
    <div className={`mw-sheet${shown ? " in" : ""}`}>
      <div className="mw-hdr">
        <button className="mw-round" onClick={back} aria-label={level === "detail" ? "Back" : "Close"}>
          {level === "detail" ? <ChevronLeft size={22} strokeWidth={1.8} /> : <X size={20} strokeWidth={1.8} />}
        </button>
        <h2>{level === "detail" ? card.name : ""}</h2>
      </div>

      <button ref={artRef} className="mw-card mw-fly" style={{ transform: shown ? "translate3d(0,0,0)" : `translate3d(0,${delta}px,0)` }}
        onClick={() => { swapped.current = true; setLevel(l => (l === "peek" ? "detail" : "peek")); }} aria-label={`${card.name}: ${level === "peek" ? "show details" : "show preview"}`}>
        <CardArt card={card} />
      </button>

      <div className={`mw-under${swapped.current ? " swap" : ""}`} key={level}>
        {level === "peek" ? (
          <>
            {card.avail != null && (
              <div className="mw-tile">
                <div className="mw-tile-l">Available</div>
                <div className="mw-tile-n">{fmtIDR(card.avail)}</div>
                <div className="mw-bar"><i style={{ width: `${Math.min(100, (used / card.limit) * 100)}%` }} /></div>
                <div className="mw-tile-s">Used {fmtIDR(used)} of {fmtIDR(card.limit)}</div>
              </div>
            )}
            {card.avail == null && <div className="mw-tile"><div className="mw-tile-l">Balance</div><div className="mw-tile-n">{fmtIDR(card.debt)}</div></div>}
            {(showDue || hasPoints) && (
              <div className="mw-tiles">
                {showDue && <div className="mw-tile"><div className="mw-tile-l">Due</div><div className="mw-tile-m">{fmtDay(card.due.date)}<span className={`mw-chip${card.due.days <= 5 ? " hot" : ""}`}>{dueText}</span></div></div>}
                {hasPoints && <div className="mw-tile"><div className="mw-tile-l">Points</div><div className="mw-tile-m">{num(card.points_balance)}</div>{kf != null && <div className="mw-tile-s">≈ {num(kf)} KrisFlyer miles</div>}</div>}
              </div>
            )}
            <TxList title="Latest" rows={mine.slice(0, 5)} cardId={card.id} />
          </>
        ) : (
          <>
            <div className="mw-list">
              {card.avail != null && <Row label="Available" value={fmtIDR(card.avail)} />}
              <Row label="Balance" value={fmtIDR(card.debt)} />
              {card.limit > 0 && <Row label="Limit" value={fmtIDR(card.limit)} sub={card.shared_limit_group_id ? "Shared" : null} />}
              {showDue && <Row label="Due" value={`${fmtDay(card.due.date)} · ${card.due.days === 0 ? "today" : `${card.due.days} day${card.due.days === 1 ? "" : "s"}`}`} hot={card.due.days <= 5} />}
              {card.statement_day && <Row label="Statement day" value={String(card.statement_day)} />}
              {hasPoints && <Row label="Points" value={`${num(card.points_balance)}${card.points_unit ? ` ${card.points_unit}` : ""}`} sub={[kf != null ? `≈ ${num(kf)} KrisFlyer miles` : null, card.points_as_of ? `Statement ${fmtDate(card.points_as_of)}` : null].filter(Boolean).join(" · ")} />}
              {hasPoints && Number(card.points_expiring) > 0 && card.points_expiry_date && <Row label="Expiring" value={num(card.points_expiring)} sub={fmtDate(card.points_expiry_date)} hot={expDays != null && expDays <= 45} />}
            </div>
            <div className="mw-list mw-gap">
              <button className="mw-row" onClick={() => navigate(`/accounts/${card.id}/statement`)}><span className="mw-row-name">Statement</span><ChevronRight size={16} className="mw-chev" /></button>
              <button className="mw-row" onClick={() => setTab && setTab("reconcile")}><span className="mw-row-name">Reconcile</span><ChevronRight size={16} className="mw-chev" /></button>
            </div>
            <TxList title="Transactions" rows={mine.slice(0, 30)} cardId={card.id} />
          </>
        )}
      </div>
    </div>
  );
}

function TxList({ title, rows, cardId }) {
  if (!rows.length) return null;
  return (
    <>
      <div className="mw-label">{title}</div>
      <div className="mw-list">
        {rows.map(e => {
          const out = e.from_id === cardId;
          return (
            <div key={e.id} className="mw-row mw-tx">
              <span className="mw-row-name">{e.description || e.merchant_name || e.tx_type}<small>{fmtDate(e.tx_date)}</small></span>
              <span className={`mw-row-amt${out ? "" : " in"}`}>{out ? "" : "+"}{fmtIDR(e.amount_idr || e.amount)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Row({ label, value, sub, hot }) {
  return (
    <div className="mw-row mw-kv">
      <span className="mw-row-name">{label}</span>
      <span className={`mw-row-amt${hot ? " hot" : ""}`}>{value}{sub ? <small>{sub}</small> : null}</span>
    </div>
  );
}
