// Mobile Wallet (phones only, <768px). Desktop keeps Credit Cards / Bank / Cash pages.
// Layout follows Apple Wallet: a stack of real card images with nothing drawn on top,
// tap a card to lift it and read its figures as plain rows underneath.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtIDR, fmtCurNative } from "../../utils";
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
  const [openId, setOpenId] = useState(null);
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

  const open = openId && cards.find(c => c.id === openId);
  if (open) return <CardDetail card={open} ledger={ledger} onBack={() => setOpenId(null)} navigate={navigate} setTab={setTab} />;

  return (
    <div className="mw">
      <div className="mw-hdr">
        <h1>Wallet</h1>
        {onSearch && <button className="mw-round" onClick={onSearch} aria-label="Search"><Search size={20} strokeWidth={1.8} /></button>}
      </div>

      {notice && seg === "credit" && (
        <div className="mw-notice">
          <button className="mw-notice-body" onClick={() => setOpenId(notice.id)}>
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
          <div className="mw-stack">
            {cards.map(c => (
              <button key={c.id} className="mw-card" onClick={() => { setOpenId(c.id); window.scrollTo(0, 0); }} aria-label={c.name}>
                <CardArt card={c} />
              </button>
            ))}
          </div>
        </>
      )}

      {seg === "bank" && <AccountList rows={banks} fxRates={fxRates} navigate={navigate} />}
      {seg === "cash" && <AccountList rows={cash} fxRates={fxRates} navigate={navigate} showTotal />}
    </div>
  );
}

function CardArt({ card }) {
  const [broken, setBroken] = useState(false);
  if (card.img && !broken) return <img className="mw-art" src={card.img} alt="" onError={() => setBroken(true)} />;
  return <div className="mw-art mw-art-ph"><b>{card.bank_name || card.name}</b>{card.bank_name && card.bank_name !== card.name ? <span>{card.name}</span> : null}</div>;
}

function AccountList({ rows, fxRates, navigate, showTotal }) {
  const total = rows.reduce((s, a) => s + Number(a.current_balance || 0) * (fxRates[a.currency] || 1), 0);
  if (!rows.length) return <div className="mw-empty">Nothing here yet.</div>;
  return (
    <div className="mw-list">
      {rows.map(a => (
        <button key={a.id} className="mw-row" onClick={() => navigate(`/accounts/${a.id}/statement`)}>
          <span className="mw-row-name">{a.name}</span>
          <span className="mw-row-amt">{fmtCurNative(a.current_balance, a.currency)}</span>
          <ChevronRight size={16} className="mw-chev" />
        </button>
      ))}
      {showTotal && <div className="mw-row mw-total"><span className="mw-row-name">Total</span><span className="mw-row-amt">{fmtIDR(total)}</span><span className="mw-chev" /></div>}
    </div>
  );
}

function CardDetail({ card, ledger, onBack, navigate, setTab }) {
  const recent = useMemo(() => ledger.filter(e => e.from_id === card.id || e.to_id === card.id)
    .sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date))).slice(0, 8), [ledger, card.id]);
  const hasPoints = card.points_balance != null;
  const kf = hasPoints && card.ratio ? Math.floor(Number(card.points_balance) / card.ratio) : null;
  const expDays = card.points_expiry_date ? Math.round((new Date(`${card.points_expiry_date}T00:00:00`) - new Date()) / 86400000) : null;

  return (
    <div className="mw">
      <div className="mw-hdr">
        <button className="mw-round" onClick={onBack} aria-label="Back"><ChevronLeft size={22} strokeWidth={1.8} /></button>
        <h2>{card.name}</h2>
      </div>
      <CardArt card={card} />

      <div className="mw-list mw-gap">
        {card.avail != null && <Row label="Available" value={fmtIDR(card.avail)} />}
        <Row label="Balance" value={fmtIDR(card.debt)} />
        {card.due && card.debt > 0 && <Row label="Due" value={`${fmtDay(card.due.date)} · ${card.due.days === 0 ? "today" : `${card.due.days} day${card.due.days === 1 ? "" : "s"}`}`} hot={card.due.days <= 5} />}
        {hasPoints && <Row label="Points" value={`${num(card.points_balance)}${card.points_unit ? ` ${card.points_unit}` : ""}`} sub={[kf != null ? `≈ ${num(kf)} KrisFlyer miles` : null, card.points_as_of ? `Statement ${fmtDate(card.points_as_of)}` : null].filter(Boolean).join(" · ")} />}
        {hasPoints && Number(card.points_expiring) > 0 && card.points_expiry_date && <Row label="Expiring" value={num(card.points_expiring)} sub={fmtDate(card.points_expiry_date)} hot={expDays != null && expDays <= 45} />}
      </div>

      <div className="mw-list mw-gap">
        <button className="mw-row" onClick={() => navigate(`/accounts/${card.id}/statement`)}><span className="mw-row-name">Statement</span><ChevronRight size={16} className="mw-chev" /></button>
        <button className="mw-row" onClick={() => setTab && setTab("reconcile")}><span className="mw-row-name">Reconcile</span><ChevronRight size={16} className="mw-chev" /></button>
      </div>

      {recent.length > 0 && (
        <>
          <div className="mw-label">Recent</div>
          <div className="mw-list">
            {recent.map(e => {
              const out = e.from_id === card.id;
              return (
                <div key={e.id} className="mw-row mw-tx">
                  <span className="mw-row-name">{e.description || e.merchant_name || e.tx_type}<small>{fmtDate(e.tx_date)}</small></span>
                  <span className={`mw-row-amt${out ? "" : " in"}`}>{out ? "" : "+"}{fmtIDR(e.amount_idr || e.amount)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
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
