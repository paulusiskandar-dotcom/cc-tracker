// Mobile Wallet (phones only, <768px). Desktop keeps Credit Cards / Bank / Cash pages.
// Layout follows Apple Wallet: a stack of real card images with nothing drawn on top,
// tap a card to lift it and read its figures as plain rows underneath.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, ChevronLeft, ChevronRight, Search, Pencil } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtIDR, fmtCurNative } from "../../utils";
import { CURRENCIES } from "../../constants";
import CurrencyFlag from "../shared/CurrencyFlag";
import Amt from "./Amt";
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

// Cash rows read as the currency itself ("Pound Sterling"), not the account's nickname.
const CUR_NAME = { ...Object.fromEntries(CURRENCIES.map(c => [c.code, c.name])), GBP: "Pound Sterling" };
// Round bank mark beside each bank account, same size as the currency flags on Cash.
// A monogram in the bank's colour until real logo files are added under /public/banks.
const BANK_MARK = {
  BCA: ["BCA", "#0060AF", "#fff"], BLU: ["blu", "#00AEEF", "#fff"], BNI: ["BNI", "#F15A23", "#fff"], Danamon: ["D", "#F7941D", "#fff"],
  Jenius: ["J", "#25A4DD", "#fff"], Mandiri: ["m", "#003D79", "#FFB700"], Maybank: ["M", "#FFC83D", "#111827"], Neobank: ["neo", "#FFD400", "#111827"],
  OCBC: ["OCBC", "#ED1C24", "#fff"], Sinarmas: ["S", "#E30613", "#fff"], Superbank: ["sb", "#111827", "#C8F169"],
};
function BankMark({ bank, name }) {
  const [broken, setBroken] = useState(false);
  const key = bank || String(name || "").split(" ")[0];
  const [txt, bg, fg] = BANK_MARK[key] || [String(key || "?").slice(0, 2), "#e5e7eb", "#374151"];
  if (!broken) return <img className="mw-mark" src={`/banks/${slug(key)}.png`} alt="" onError={() => setBroken(true)} />;
  return <span className="mw-mark" style={{ background: bg, color: fg, fontSize: txt.length > 3 ? 8 : txt.length > 2 ? 9.5 : 12 }}>{txt}</span>;
}

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)"; // close to the iOS sheet spring
const EASE_LIFT = "cubic-bezier(0.3, 1.18, 0.4, 1)"; // the lifted card overshoots a touch, then settles
const FLY_MS = 560;
const SEGMENTS = [["credit", "Credit"], ["bank", "Bank"], ["cash", "Cash"]];

export default function Wallet({ user, accounts = [], ledger = [], fxRates = {}, initialSegment = "credit", setTab, onSearch, onRefresh, installments = [], reconSessions = [], dark = false }) {
  const navigate = useNavigate();
  const [seg, setSeg] = useState(() => lsGet("m.wallet.seg") || initialSegment);
  // Opening a card moves the REAL cards in the stack, the way Apple Wallet does: the tapped
  // card rises to the top, the ones after it (which lie on top of it) slide down and away,
  // the ones before it slide up. Closing plays it back, so the card is lowered into its slot
  // and its neighbours close over it. Once the card is up, an identical copy inside the
  // scrollable sheet takes over so it can scroll with the content.
  const [openCard, setOpenCard] = useState(null);   // { id }
  const [phase, setPhase] = useState(null);         // "opening" | "open" | "closing"
  const flight = useRef({ anims: [], timers: [] });
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
    // Instalment months not billed yet still hold the limit at the bank. The card's balance
    // only carries what has been billed, so the rest is taken off Available here (same
    // split calcNetWorth uses, so nothing is counted twice).
    const held = {};
    installments.filter(i => i.status === "active").forEach(i => {
      const cid = i.account_id || i.cc_account_id; if (!cid) return;
      held[cid] = (held[cid] || 0) + Math.max(0, Number(i.total_months || 0) - Number(i.paid_months || 0)) * Number(i.monthly_amount || 0);
    });
    cc.forEach(c => { const g = c.shared_limit_group_id; if (g && groups[g]) groups[g].held = (groups[g].held || 0) + (held[c.id] || 0); });
    const rows = cc.map(c => {
      const rate = fxRates[c.currency] || 1;
      const debt = Number(c.outstanding_amount || 0) * rate;
      const g = c.shared_limit_group_id && groups[c.shared_limit_group_id];
      const limit = g ? g.limit * rate : Number(c.card_limit || 0) * rate;
      const heldHere = (g ? g.held || 0 : held[c.id] || 0) * rate;
      const avail = limit > 0 ? Math.max(0, (g ? (g.limit - g.debt + g.cr) * rate : limit - debt + Number(c.current_balance || 0) * rate) - heldHere) : null;
      const kat = catalog.byAccount[c.id];
      // Due date: the one printed on the newest statement while it is still ahead; else the usual day.
      const today0 = new Date(); today0.setHours(0, 0, 0, 0);
      const sess = reconSessions.filter(r => r.account_id === c.id && r.due_date).sort((a, b) => String(b.statement_date || "").localeCompare(String(a.statement_date || "")))[0];
      const printed = sess ? new Date(`${String(sess.due_date).slice(0, 10)}T00:00:00`) : null;
      const due = printed && printed >= today0 ? { date: printed, days: Math.round((printed - today0) / 86400000) } : nextDue(c.due_day);
      return { ...c, debt, limit, avail, held: heldHere, due, kat, img: c.card_image_url || (kat ? `/cards/${slug(kat)}.jpg` : null), ratio: kat ? catalog.ratio[kat] : null };
    });
    return rows.sort((a, b) => b.debt - a.debt); // largest balance on top
  }, [active, fxRates, catalog, installments, reconSessions]);

  // Rupiah accounts first, then foreign ones; each group by rupiah value, largest on top.
  const banks = useMemo(() => active.filter(a => a.type === "bank" && a.subtype !== "cash" && a.subtype !== "reimburse")
    .sort((a, b) => Number((a.currency || "IDR") !== "IDR") - Number((b.currency || "IDR") !== "IDR")
      || Number(b.current_balance || 0) * (fxRates[b.currency] || 1) - Number(a.current_balance || 0) * (fxRates[a.currency] || 1)), [active, fxRates]);
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

  const txByCard = useMemo(() => {
    const ids = new Set(cards.map(c => c.id)); const m = {};
    ledger.forEach(e => { [e.from_id, e.to_id].forEach(id => { if (id && ids.has(id)) (m[id] = m[id] || []).push(e); }); });
    Object.values(m).forEach(l => l.sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date))));
    return m;
  }, [ledger, cards]);

  // Active instalment plans per card, named after the item bought (purchase row's notes).
  const plansByCard = useMemo(() => {
    const byId = Object.fromEntries(ledger.map(e => [e.id, e])); const m = {};
    installments.filter(i => i.status === "active").forEach(i => {
      const cid = i.account_id || i.cc_account_id; if (!cid) return;
      const note = byId[i.purchase_ledger_id]?.notes;
      const left = Math.max(0, Number(i.total_months || 0) - Number(i.paid_months || 0));
      (m[cid] = m[cid] || []).push({ id: i.id, name: note && !/^imported from/i.test(note) ? String(note).replace(/\s+\d+\/\d+$/, "") : i.description,
        paid: Number(i.paid_months || 0), total: Number(i.total_months || 0), monthly: Number(i.monthly_amount || 0), left: left * Number(i.monthly_amount || 0) });
    });
    Object.values(m).forEach(l => l.sort((a, b) => b.left - a.left));
    return m;
  }, [installments, ledger]);

  const open = openCard && cards.find(c => c.id === openCard.id);
  const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clearFlight = () => { flight.current.anims.forEach(a => a.cancel()); flight.current.timers.forEach(clearTimeout); flight.current = { anims: [], timers: [] }; };
  const later = (fn, ms) => flight.current.timers.push(setTimeout(fn, ms));
  useEffect(() => () => clearFlight(), []);

  const openById = id => { if (!openCard) { setOpenCard({ id }); setPhase("opening"); } };

  // Called by the sheet as soon as it knows where its copy of the card sits.
  const flyUp = copyTop => {
    const els = [...(stackRef.current?.querySelectorAll("[data-card]") || [])];
    const i = els.findIndex(el => el.dataset.card === openCard.id);
    if (i < 0 || !els[i].animate) { setPhase("open"); return; }
    const vh = window.innerHeight; const ms = calm() ? 1 : FLY_MS;
    const rects = els.map(el => el.getBoundingClientRect());
    clearFlight();
    flight.current.offsets = els.map((el, j) => (j === i ? copyTop - rects[j].top : j < i ? -(rects[j].bottom + 40) : vh - rects[j].top + 40));
    els.forEach((el, j) => {
      if (j !== i && (rects[j].bottom < -60 || rects[j].top > vh + 60)) return; // never on screen: leave it be
      flight.current.anims.push(el.animate(
        [{ transform: "translate3d(0,0,0)" }, { transform: `translate3d(0,${flight.current.offsets[j]}px,0)` }],
        { duration: ms, easing: j === i ? EASE_LIFT : EASE, fill: "forwards" }));
    });
    later(() => setPhase("open"), ms + 30);
  };

  // copyTop: where the sheet's copy is right now (the sheet may have been scrolled).
  const flyDown = copyTop => {
    const els = [...(stackRef.current?.querySelectorAll("[data-card]") || [])];
    const i = els.findIndex(el => el.dataset.card === openCard?.id);
    const ms = calm() ? 1 : FLY_MS; const offs = flight.current.offsets || [];
    const vh = window.innerHeight;
    clearFlight();
    setPhase("closing");
    els.forEach((el, j) => {
      const r = el.getBoundingClientRect(); // back at rest now that the old animations are cancelled
      if (j !== i && (r.bottom < -60 || r.top > vh + 60)) return;
      const from = j === i ? copyTop - r.top : offs[j] ?? 0;
      if (el.animate) flight.current.anims.push(el.animate(
        [{ transform: `translate3d(0,${from}px,0)` }, { transform: "translate3d(0,0,0)" }],
        { duration: ms, easing: EASE, fill: "backwards" }));
    });
    later(() => { clearFlight(); setOpenCard(null); setPhase(null); }, ms + 30);
  };

  return (
    <div className={`mw${dark ? " dark" : ""}${open && phase !== "closing" ? " mw-behind" : ""}`}>
      {open && <CardSheet card={open} phase={phase} txs={txByCard[open.id] || []} plans={plansByCard[open.id] || []} onPlaced={flyUp} onClose={flyDown} navigate={navigate} setTab={setTab} onRefresh={onRefresh} />}
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
              <button key={c.id} data-card={c.id} className={`mw-card${open && c.id === open.id && phase === "open" ? " mw-gone" : ""}`} onClick={() => openById(c.id)} aria-label={c.name}>
                <CardArt card={c} />
              </button>
            ))}
          </div>
        </>
      )}

      {seg === "bank" && <AccountList rows={banks} fxRates={fxRates} navigate={navigate} marks />}
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
function AccountList({ rows, fxRates, navigate, showTotal, flags, marks }) {
  const total = rows.reduce((s, a) => s + Number(a.current_balance || 0) * (fxRates[a.currency] || 1), 0);
  if (!rows.length) return <div className="mw-empty">Nothing here yet.</div>;
  return (
    <div className="mw-list">
      {rows.map(a => (
        <button key={a.id} className="mw-row" onClick={() => navigate(`/accounts/${a.id}/statement`)}>
          {flags && <CurrencyFlag code={a.currency || "IDR"} size={28} />}
          {marks && <BankMark bank={a.bank_name} name={a.name} />}
          <span className="mw-row-name">{flags ? (CUR_NAME[a.currency || "IDR"] || a.name) : a.name}</span>
          <span className={`mw-row-amt${Number(a.current_balance) < 0 ? " hot" : ""}`}>{Number(a.current_balance) < 0 ? "−" : ""}{fmtCurNative(Math.abs(Number(a.current_balance || 0)), a.currency)}
            {!flags && a.currency && a.currency !== "IDR" && fxRates[a.currency] ? <small>{fmtIDR(Number(a.current_balance || 0) * fxRates[a.currency])}</small> : null}
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
function CardSheet({ card, phase, txs, plans = [], onPlaced, onClose, navigate, setTab, onRefresh }) {
  const [level, setLevel] = useState("peek");
  const artRef = useRef(null);
  const swapped = useRef(false); // the swap animation is for peek ↔ detail only, not for opening
  const closing = phase === "closing";

  useLayoutEffect(() => {
    onPlaced(artRef.current ? artRef.current.getBoundingClientRect().top : 0);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { if (phase === "open") onClose(artRef.current ? artRef.current.getBoundingClientRect().top : 0); };
  const back = () => { if (level === "detail") { swapped.current = true; setLevel("peek"); } else close(); };

  const mine = txs;
  const hasPoints = card.points_balance != null;
  const kf = hasPoints && card.ratio ? Math.floor(Number(card.points_balance) / card.ratio) : null;
  const expDays = card.points_expiry_date ? Math.round((new Date(`${card.points_expiry_date}T00:00:00`) - new Date()) / 86400000) : null;
  const used = card.limit > 0 && card.avail != null ? Math.max(0, card.limit - card.avail) : null;
  const showDue = card.due && card.debt > 0;
  const dueText = showDue ? (card.due.days === 0 ? "TODAY" : `${card.due.days}D LEFT`) : null;

  return (
    <div className={`mw-sheet${closing ? " out" : ""}`}>
      <div className="mw-hdr">
        <button className="mw-round" onClick={back} aria-label={level === "detail" ? "Back" : "Close"}>
          {level === "detail" ? <ChevronLeft size={22} strokeWidth={1.8} /> : <X size={20} strokeWidth={1.8} />}
        </button>
        <h2>{level === "detail" ? card.name : ""}</h2>
      </div>

      {/* The copy only shows while the sheet is at rest; during the flight the real card is what moves. */}
      <button ref={artRef} className="mw-card" style={{ visibility: phase === "open" ? "visible" : "hidden" }}
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
                <div className="mw-tile-s">Used {fmtIDR(used)} of {fmtIDR(card.limit)}{card.held > 0 ? ` · ${fmtIDR(card.held)} held by installments` : ""}</div>
              </div>
            )}
            {card.avail == null && <div className="mw-tile"><div className="mw-tile-l">Balance</div><div className="mw-tile-n">{fmtIDR(card.debt)}</div></div>}
            {(showDue || hasPoints) && (
              <div className="mw-tiles">
                {showDue && <div className="mw-tile"><div className="mw-tile-l">Due</div><div className="mw-tile-m">{fmtDay(card.due.date)}<span className={`mw-chip${card.due.days <= 5 ? " hot" : ""}`}>{dueText}</span></div></div>}
                {hasPoints && <div className="mw-tile"><div className="mw-tile-l">Points</div><div className="mw-tile-m">{num(card.points_balance)}</div>{kf != null && <div className="mw-tile-s">≈ {num(kf)} KrisFlyer miles</div>}</div>}
              </div>
            )}
            {plans.length > 0 && (
              <div className="mw-tile">
                <div className="mw-tile-l">Installments · {fmtIDR(plans.reduce((t, p) => t + p.left, 0))} left</div>
                {plans.slice(0, 4).map(p => <div key={p.id} className="mw-inst"><span>{p.name}</span><span>{p.total - p.paid} more · {fmtIDR(p.monthly)}</span></div>)}
                {plans.length > 4 && <div className="mw-tile-s">and {plans.length - 4} more — tap the card for all</div>}
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
            {/* Points typed by hand, for cards whose statement prints none. A statement that
                does print them always wins (it is newer and final). */}
            {card.points_source !== "statement" && <PointsEditor card={card} onSaved={onRefresh} />}
            <div className="mw-list mw-gap">
              <button className="mw-row" onClick={() => navigate(`/accounts/${card.id}/statement`)}><span className="mw-row-name">Statement</span><ChevronRight size={16} className="mw-chev" /></button>
              <button className="mw-row" onClick={() => setTab && setTab("reconcile")}><span className="mw-row-name">Reconcile</span><ChevronRight size={16} className="mw-chev" /></button>
            </div>
            {plans.length > 0 && (
              <>
                <div className="mw-label">Installments</div>
                <div className="mw-list">
                  {plans.map(p => <div key={p.id} className="mw-row mw-tx"><span className="mw-row-name">{p.name}<small>{p.paid}/{p.total} paid · {p.total - p.paid} more · {fmtIDR(p.left)} left</small></span><span className="mw-row-amt">{fmtIDR(p.monthly)}</span></div>)}
                </div>
              </>
            )}
            <MonthByCategory txs={mine} cardId={card.id} />
          </>
        )}
      </div>
    </div>
  );
}

const MONTHS_S = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const stepMonth = (m, by) => { const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

// One month of this card's charges grouped by category; payments to the card sit in their own group.
function MonthByCategory({ txs, cardId }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [openCat, setOpenCat] = useState(null);
  const groups = useMemo(() => {
    const m = {};
    txs.filter(e => String(e.tx_date || "").slice(0, 7) === month).forEach(e => {
      const pay = e.to_id === cardId;
      const k = pay ? "Payments" : (e.category_name || (e.is_reimburse || /^reimburse/.test(e.tx_type) ? "Reimburse" : "Uncategorized"));
      (m[k] = m[k] || { name: k, total: 0, pay, items: [] }); m[k].total += Number(e.amount_idr || e.amount || 0); m[k].items.push(e);
    });
    return Object.values(m).sort((a, b) => Number(a.pay) - Number(b.pay) || b.total - a.total);
  }, [txs, month, cardId]);
  return (
    <>
      <div className="mw-label mw-label-row"><span>Transactions</span>
        <div className="mw-month">
          <button onClick={() => setMonth(m => stepMonth(m, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
          <span>{MONTHS_S[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}</span>
          <button onClick={() => setMonth(m => stepMonth(m, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
      </div>
      {groups.length === 0 ? <div className="mw-empty">No transactions this month.</div> : (
        <div className="mw-list">
          {groups.map(g => (
            <div key={g.name}>
              <button className="mw-row" onClick={() => setOpenCat(openCat === g.name ? null : g.name)} aria-expanded={openCat === g.name}>
                <span className="mw-row-name">{g.name}<small>{g.items.length} transaction{g.items.length === 1 ? "" : "s"}</small></span>
                <span className={`mw-row-amt${g.pay ? " in" : ""}`}>{g.pay ? "+" : ""}{fmtIDR(g.total)}</span>
              </button>
              {openCat === g.name && (
                <div className="mw-sub">
                  {g.items.map(e => <div key={e.id} className="mw-row mw-tx"><span className="mw-row-name">{e.notes && !/^imported from/i.test(e.notes) ? e.notes : (e.description || e.merchant_name || e.tx_type)}<small>{fmtDate(e.tx_date)}</small></span><Amt e={e} /></div>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function PointsEditor({ card, onSaved }) {
  const [open, setOpen] = useState(false);
  const [bal, setBal] = useState(card.points_balance != null ? String(Math.round(card.points_balance)) : "");
  const [unit, setUnit] = useState(card.points_unit || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    const n = Number(String(bal).replace(/[^\d]/g, ""));
    if (!String(bal).trim() || !Number.isFinite(n)) { setErr("Enter the points balance as a number."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.from("accounts").update({ points_balance: n, points_unit: unit.trim() || null, points_expiring: null, points_expiry_date: null,
      points_as_of: new Date().toISOString().slice(0, 10), points_source: "manual" }).eq("id", card.id);
    setBusy(false);
    if (error) { setErr(`Could not save: ${error.message}`); return; }
    setOpen(false); onSaved && onSaved();
  };
  if (!open) return (
    <div className="mw-list mw-gap">
      <button className="mw-row" onClick={() => setOpen(true)}><span className="mw-row-name">{card.points_balance != null ? "Update points" : "Add points"}</span><Pencil size={16} className="mw-chev" /></button>
    </div>
  );
  return (
    <div className="mw-tile mw-gap">
      <div className="mw-form">
        <label htmlFor="pts-bal">Points<input id="pts-bal" inputMode="numeric" value={bal} onChange={e => setBal(e.target.value)} placeholder="0" /></label>
        <label htmlFor="pts-unit">Name<input id="pts-unit" value={unit} onChange={e => setUnit(e.target.value)} placeholder="BCA Reward" /></label>
      </div>
      {err && <div className="mw-err">{err}</div>}
      <div className="mw-form-act">
        <button className="mw-btn mw-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        <button className="mw-btn" onClick={save} disabled={busy}>{busy ? "Saving" : "Save"}</button>
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
          return (
            <div key={e.id} className="mw-row mw-tx">
              <span className="mw-row-name">{e.description || e.merchant_name || e.tx_type}<small>{fmtDate(e.tx_date)}</small></span>
              <Amt e={e} />
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
