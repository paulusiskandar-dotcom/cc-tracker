import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { settingsApi } from "../api";
import SweetSpotSpending from "./SweetSpotSpending";

// SweetSpot — earn rates, exclusions, promos and miles news for the cards Paulus
// holds. Data comes from public sources collected by n8n and pushed through the
// `ingest-miles-promo` Edge Function (docs/INGEST_MILES_PROMO.md). Never reads
// or sends transaction data; "My spending" is the separate ledger analysis.
//
// Honesty rules carried into the UI:
// - an empty source value shows as "Not stated", never as "earns";
// - bank/hotel points are kept apart from airline miles;
// - figures flagged for checking are shown with a badge and never win a row;
// - free-text exclusions only produce "See terms", not a yes/no verdict.

const FF = "Figtree, system-ui, -apple-system, sans-serif";
const PROGRAMS = [["krisflyer", "KrisFlyer"], ["asiamiles", "Asia Miles"], ["garudamiles", "GarudaMiles"]];
const CATS = [["everyday", "Everyday"], ["dining", "Dining"], ["travel", "Travel"], ["online", "Online"], ["overseas", "Overseas"]];
const CAT_OF = { general: "everyday", dining: "dining", travel: "travel", online: "online", ecommerce: "online", fx: "overseas" };
const EXC_ROWS = [
  ["utilitas", "Utilities", "Electricity, water, internet", /utilit|listrik|\bpln\b|\bair\b|internet/i],
  ["cicilan", "Instalments", "Converted to cicilan", /cicilan|instal/i],
  ["asuransi", "Insurance", "Premiums", /asuransi|insuran|premi/i],
  ["qris", "QRIS", "Scan to pay in a bank app", /qris/i],
  ["pajak", "Tax & government", "Tax, PBB, state payments", /pajak|penerimaan negara|\bpbb\b|\btax\b/i],
  ["ewallet_topup", "E-wallet top-up", "OVO, GoPay, DANA", /e-?wallet|top ?up|dompet/i],
  ["spbu", "Fuel", "Petrol stations", /spbu|bensin|fuel/i],
];
const LIM_ROWS = [
  ["cap", "Monthly earn cap", r => r.batas_perolehan_bulanan || r.batas_perolehan],
  ["minconv", "Minimum to convert", r => r.min_konversi],
  ["convcap", "Conversion cap", r => r.batas_konversi],
  ["fee", "Annual fee", r => r.iuran_tahunan_utama_rp ?? r.iuran_tahunan],
];
const PROMO_INT = [["kuliner", "Dining"], ["travel", "Travel"], ["belanja", "Shopping"], ["hiburan", "Entertainment"],
  ["kesehatan", "Health"], ["transportasi", "Transport"], ["cicilan", "Instalments"], ["lainnya", "Other"]];
const BANKING_CAT = ["simpanan", "investasi", "pinjaman"];
const BANKING_PRODUCT = ["tabungan", "deposito", "investasi", "pinjaman"];
const WEALTH_RE = /dana kelolaan|privilege|prioritas|penempatan dana|priority/i;
const KIND = { diskon_penukaran: "Redemption sale", transfer_bonus: "Transfer bonus", bonus_perolehan: "Earning bonus",
  devaluasi: "Devaluation", perubahan_earning_rate: "Earn rate change", welcome_bonus: "Welcome bonus", kartu_baru: "New card" };
const BANK_ALIAS = { jenius: ["jenius", "smbc", "btpn"], cimb: ["cimb"], skorcard: ["mayapada", "skorcard"], mayapada: ["mayapada", "skorcard"] };
const DEFAULT_PREFS = { interests: ["kuliner", "travel", "belanja", "hiburan"], hidden: [], hideWealth: true };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const progKey = p => String(p || "").toLowerCase().replace(/[^a-z]/g, "");
const rpn = n => Math.round(Number(n)).toLocaleString("id-ID");
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; } };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); if (!m) return iso || ""; const y = +m[1]; return `${+m[3]} ${MONTHS[+m[2] - 1]}${y !== new Date().getFullYear() ? " " + y : ""}`; };
const daysLeft = iso => Math.ceil((new Date(iso + "T23:59:59") - new Date()) / 86400000);
const isBankPoints = r => r.satuan ? r.satuan !== "miles_maskapai" : String(r.catatan || "").startsWith("[POIN BANK");
const needsCheck = r => r.perlu_cek ?? String(r.catatan || "").includes("[PERLU CEK");
const cleanNote = s => String(s || "").replace(/^\[PERLU CEK:[^\]]*\]\s*/, "");
const feeText = v => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) ? `Rp ${rpn(n)}` : v; };

async function fetchAll(table, build) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build(supabase.from(table).select("*")).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) return out;
  }
}

export default function SweetSpot({ user, ledger = [], accounts = [] }) {
  const [tab, setTab] = useState("compare");
  const [prog, setProg] = useState("krisflyer");
  const [cat, setCat] = useState("everyday");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [cell, setCell] = useState(null);
  const [matching, setMatching] = useState(false);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [scope, setScope] = useState("mine");
  const [soon, setSoon] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [kartu, earn, promo, news, pemetaan] = await Promise.all([
        fetchAll("kartu_miles", q => q.order("kartu")),
        fetchAll("earn_rate_kartu", q => q.order("kartu")),
        fetchAll("promo_bank", q => q.order("periode_akhir", { ascending: true, nullsFirst: false })),
        fetchAll("miles_update", q => q.order("terbit", { ascending: false })),
        fetchAll("pemetaan_kartu", q => q),
      ]);
      setData({ kartu, earn, promo, news, pemetaan });
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!user?.id) return;
    settingsApi.get(user.id, "sweetspot_promo_prefs", DEFAULT_PREFS).then(p => setPrefs({ ...DEFAULT_PREFS, ...p })).catch(() => {});
  }, [user?.id]);
  const savePrefs = p => { setPrefs(p); if (user?.id) settingsApi.set(user.id, "sweetspot_promo_prefs", p).catch(() => {}); };

  const creditCards = useMemo(() => accounts.filter(a => a.type === "credit_card" && a.is_active !== false), [accounts]);
  const kartuByName = useMemo(() => Object.fromEntries((data?.kartu || []).map(k => [k.kartu, k])), [data]);
  const mapByAccount = useMemo(() => Object.fromEntries((data?.pemetaan || []).map(m => [m.account_id, m])), [data]);
  const cols = useMemo(() => creditCards
    .map(a => ({ account: a, map: mapByAccount[a.id] }))
    .filter(x => x.map?.status === "matched" && kartuByName[x.map.kartu_katalog])
    .map(x => ({ name: x.account.name, catalog: x.map.kartu_katalog, bank: x.account.bank_name || kartuByName[x.map.kartu_katalog]?.bank || "" })),
  [creditCards, mapByAccount, kartuByName]);
  const unmatched = creditCards.filter(a => !mapByAccount[a.id]);

  // lowest clean airline-miles figure per card × category × program
  const earnFor = useCallback((catalog, c) => {
    const rs = (data?.earn || []).filter(r => r.kartu === catalog && CAT_OF[r.kategori] === c && progKey(r.program) === prog && !isBankPoints(r) && r.rupiah_per_mile != null)
      .sort((a, b) => a.rupiah_per_mile - b.rupiah_per_mile);
    if (!rs.length) return null;
    const clean = rs.filter(r => !needsCheck(r)); const pick = clean[0] || rs[0];
    return { ...pick, flagged: !clean.length, alt: [...new Set(rs.filter(r => r !== pick && Number(r.rupiah_per_mile) !== Number(pick.rupiah_per_mile)).map(r => Number(r.rupiah_per_mile)))] };
  }, [data, prog]);

  if (error) return <Frame><div className="ss-empty"><b>Could not load SweetSpot data.</b> {error} <button className="ss-btn" onClick={load}>Try again</button></div></Frame>;
  if (!data) return <Frame><div className="ss-empty">Loading earn rates, promos and news…</div></Frame>;

  const progName = PROGRAMS.find(p => p[0] === prog)[1];
  const latestSync = [...data.kartu, ...data.earn, ...data.promo, ...data.news].map(r => r.updated_at).sort().pop();
  const withExclusions = cols.filter(c => EXC_ROWS.some(([k]) => { const v = kartuByName[c.catalog]?.[`pengecualian_${k}`]; return v && v !== "tidak_disebut"; })).length;

  /* ── promos ── */
  const myBankTokens = [...new Set(creditCards.flatMap(a => {
    const t = String(a.bank_name || a.name.split(" ")[0]).toLowerCase(); return BANK_ALIAS[t] || [t];
  }))];
  const promoBankMine = p => { const b = String(p.bank_penerbit_kartu || p.bank || "").toLowerCase(); return myBankTokens.some(t => b.startsWith(t)); };
  const today = todayISO();
  const active = data.promo.filter(p => (p.status || "ok") === "ok" && (!p.periode_akhir || p.periode_akhir >= today));
  const why = { banking: 0, notcard: 0, interest: 0, wealth: 0, later: 0, hidden: 0 };
  const shownPromos = [], hiddenPromos = [];
  active.forEach(p => {
    if (prefs.hidden.includes(p.url)) { why.hidden++; hiddenPromos.push(p); return; }
    const isCredit = p.jenis_produk ? p.jenis_produk === "kartu_kredit" : /kartu kredit|credit card/i.test(p.kartu_atau_produk || "");
    const isBanking = p.jenis_produk ? BANKING_PRODUCT.includes(p.jenis_produk) : BANKING_CAT.includes(p.kategori);
    if (scope === "mine") {
      if (isBanking) { why.banking++; return; }
      if (!isCredit || !promoBankMine(p)) { why.notcard++; return; }
      if (!prefs.interests.includes(p.kategori || "lainnya")) { why.interest++; return; }
    }
    const wealth = p.butuh_status_prioritas ?? WEALTH_RE.test(`${p.minimal_transaksi || ""} ${p.kartu_atau_produk || ""} ${p.judul || ""}`);
    if (prefs.hideWealth && wealth) { why.wealth++; return; }
    if (soon && !(p.periode_akhir && daysLeft(p.periode_akhir) <= 30)) { why.later++; return; }
    shownPromos.push(p);
  });
  const coveredBanks = new Set(data.promo.map(p => String(p.bank_penerbit_kartu || p.bank || "").toLowerCase()));
  const uncovered = [...new Set(creditCards.map(a => a.bank_name || a.name.split(" ")[0]))]
    .filter(b => !(BANK_ALIAS[b.toLowerCase()] || [b.toLowerCase()]).some(t => [...coveredBanks].some(c => c.startsWith(t))));
  const newsRelevant = data.news.filter(n => n.relevan_miles && (n.status || "ok") === "ok");

  const tabs = [["compare", "Compare cards"], ["pick", "Which card"], ["promo", "Promos", shownPromos.length], ["news", "Miles news", newsRelevant.length], ["spending", "My spending"]];

  return (
    <Frame>
      <header className="ss-top">
        <div>
          <h1>SweetSpot</h1>
          <p>What each card earns, where it earns nothing, and which promos are worth your time. Public sources only.</p>
        </div>
        {tab !== "promo" && tab !== "news" && tab !== "spending" && (
          <div>
            <div className="ss-label" id="ss-prog-l">Collecting</div>
            <Seg labelledBy="ss-prog-l" items={PROGRAMS} value={prog} onChange={v => { setProg(v); setCell(null); }} />
          </div>
        )}
      </header>
      <div className="ss-note">
        <span>Data updated <b>{latestSync ? new Date(latestSync).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never"}</b></span>
        <span>{cols.length} of {creditCards.length} cards matched{unmatched.length ? `, ${unmatched.length} waiting` : ""}</span>
        <button className="ss-linkbtn" onClick={() => setMatching(m => !m)} aria-expanded={matching}>{matching ? "Close matching" : "Match cards"}</button>
      </div>
      {matching && <MatchPanel user={user} cards={creditCards} kartu={data.kartu} mapByAccount={mapByAccount} onSaved={load} />}

      <nav className="ss-tabs" role="tablist" aria-label="SweetSpot views">
        {tabs.map(([v, l, n]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}>
            {l}{n != null && <span className="ss-count">{n}</span>}
          </button>
        ))}
      </nav>

      {tab === "compare" && (
        <section className="ss-view">
          <div className="ss-head"><div><h2>Compare cards</h2><div className="ss-sub">Rp per mile where a card earns, a plain answer where it does not. Tap a cell for the source text.</div></div></div>
          {withExclusions < cols.length && (
            <div className="ss-callout"><b>Exclusion data is still thin.</b> {cols.length - withExclusions} of {cols.length} matched cards have no structured exclusions yet, so those cells read <i>Not stated</i> or <i>See terms</i> instead of a guess.</div>
          )}
          {cols.length === 0 ? <div className="ss-empty"><b>No cards matched yet.</b> Use Match cards above to link your cards to the catalog.</div> : (
            <div className="ss-tablebox">
              <table className="ss-cmp">
                <thead><tr><th className="ss-rowh" scope="col">Spending</th>{cols.map(c => <th key={c.name} scope="col">{c.name}<span className="ss-bank">{c.bank}</span></th>)}</tr></thead>
                <tbody>
                  <tr className="ss-group"><th colSpan={cols.length + 1} scope="colgroup">Earns {progName} miles</th></tr>
                  {CATS.map(([k, l]) => {
                    const vals = cols.map(c => earnFor(c.catalog, k));
                    const clean = vals.filter(v => v && !v.flagged).map(v => Number(v.rupiah_per_mile));
                    const best = clean.length ? Math.min(...clean) : null;
                    return (
                      <tr key={k}><th className="ss-rowh" scope="row">{l}</th>
                        {cols.map((c, i) => {
                          const v = vals[i]; const id = `e|${c.name}|${k}`;
                          return <Cell key={id} id={id} cell={cell} setCell={setCell} best={v && !v.flagged && Number(v.rupiah_per_mile) === best}>
                            {v ? <><span className="ss-rate"><b>{rpn(v.rupiah_per_mile)}</b> <small>per mile</small></span>{v.flagged && <span className="ss-chip warn">Needs check</span>}</> : <span className="ss-na">Not stated</span>}
                          </Cell>;
                        })}
                      </tr>
                    );
                  })}
                  <tr className="ss-group"><th colSpan={cols.length + 1} scope="colgroup">Often excluded</th></tr>
                  {EXC_ROWS.map(([k, l, s, re]) => (
                    <tr key={k}><th className="ss-rowh" scope="row">{l}<small>{s}</small></th>
                      {cols.map(c => {
                        const kr = kartuByName[c.catalog] || {}; const v = kr[`pengecualian_${k}`]; const id = `x|${c.name}|${k}`;
                        const mentioned = (!v || v === "tidak_disebut") && re.test(kr.kategori_dikecualikan || "");
                        return <Cell key={id} id={id} cell={cell} setCell={setCell}>
                          {v === "tidak_dapat" ? <span className="ss-no">No points</span>
                            : v === "terbatas" ? <span className="ss-lim">Limited</span>
                            : v === "dapat" ? <span className="ss-yes">Earns</span>
                            : mentioned ? <span className="ss-lim">See terms</span>
                            : <span className="ss-na">Not stated</span>}
                        </Cell>;
                      })}
                    </tr>
                  ))}
                  <tr className="ss-group"><th colSpan={cols.length + 1} scope="colgroup">Minimum and maximum</th></tr>
                  {LIM_ROWS.map(([k, l, get]) => (
                    <tr key={k}><th className="ss-rowh" scope="row">{l}</th>
                      {cols.map(c => {
                        const v = get(kartuByName[c.catalog] || {}); const id = `l|${c.name}|${k}`;
                        return <Cell key={id} id={id} cell={cell} setCell={setCell}>
                          {v != null && v !== "" ? <span className="ss-text">{k === "fee" ? feeText(v) : v}</span> : <span className="ss-na">Not stated</span>}
                        </Cell>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cell && <Detail cell={cell} cols={cols} kartuByName={kartuByName} earnFor={earnFor} progName={progName} onClose={() => setCell(null)} />}
          <div className="ss-legend">
            <span><i className="ss-sw" />Best in the row</span>
            <span><b className="ss-no">No points</b> excluded in the card's terms</span>
            <span><b className="ss-lim">Limited</b> restricted by the terms</span>
            <span><b className="ss-lim">See terms</b> mentioned in free-text terms, not yet classified</span>
            <span><b className="ss-na">Not stated</b> source says nothing</span>
            <span><span className="ss-chip warn">Needs check</span> figure outside the normal range</span>
          </div>
        </section>
      )}

      {tab === "pick" && (
        <section className="ss-view">
          <div className="ss-head">
            <div><h2>Which card should I use?</h2><div className="ss-sub">One answer for one kind of spending. Airline miles only.</div></div>
            <Seg label="Spending type" items={CATS} value={cat} onChange={setCat} />
          </div>
          <Picker cols={cols} cat={cat} earnFor={earnFor} progName={progName} />
        </section>
      )}

      {tab === "promo" && (
        <section className="ss-view">
          <div className="ss-head"><div><h2>Promos</h2><div className="ss-sub">Start narrow: credit card promos from banks you hold, in the kinds of spending you care about. Hide anything you will never use.</div></div></div>
          <div className="ss-filterbar">
            <div className="ss-frow"><span className="ss-label" id="ss-scope-l">Show</span>
              <Seg labelledBy="ss-scope-l" items={[["mine", "My cards"], ["all", "Everything"]]} value={scope} onChange={setScope} /></div>
            <div className="ss-frow"><span className="ss-label" id="ss-int-l">Interested in</span>
              <div className="ss-frow" role="group" aria-labelledby="ss-int-l" style={{ gap: 6 }}>
                {PROMO_INT.map(([v, l]) => (
                  <button key={v} className="ss-toggle" aria-pressed={prefs.interests.includes(v)} disabled={scope !== "mine"}
                    onClick={() => savePrefs({ ...prefs, interests: prefs.interests.includes(v) ? prefs.interests.filter(x => x !== v) : [...prefs.interests, v] })}>{l}</button>
                ))}
              </div></div>
            <div className="ss-frow"><span className="ss-label">Also</span>
              <label className="ss-check"><input id="ss-wealth" type="checkbox" checked={prefs.hideWealth} onChange={e => savePrefs({ ...prefs, hideWealth: e.target.checked })} /> Hide offers that need priority or wealth status</label>
              <label className="ss-check"><input id="ss-soon" type="checkbox" checked={soon} onChange={e => setSoon(e.target.checked)} /> Ending in 30 days</label></div>
            <div className="ss-tally">
              <span>Showing <b>{shownPromos.length}</b> of {active.length} active promos.</span>
              {Object.values(why).some(Boolean) && <span>Filtered out: {[
                why.banking && `${why.banking} savings, loans or investment`, why.notcard && `${why.notcard} not for a credit card you hold`,
                why.interest && `${why.interest} outside your interests`, why.wealth && `${why.wealth} need priority status`, why.later && `${why.later} end later`,
              ].filter(Boolean).join(" · ")}.</span>}
              {why.hidden > 0 && <span>{why.hidden} hidden by you. <button className="ss-linkbtn" onClick={() => setShowHidden(s => !s)}>{showHidden ? "Hide them again" : "Show"}</button></span>}
            </div>
          </div>
          {uncovered.length > 0 && <div className="ss-callout"><b>Not covered yet:</b> {uncovered.join(", ")}. No promos stored for these banks, which does not mean they have none.</div>}
          <div className="ss-list">
            {(showHidden ? [...shownPromos, ...hiddenPromos] : shownPromos).map(p => {
              const dl = p.periode_akhir ? daysLeft(p.periode_akhir) : null; const hidden = prefs.hidden.includes(p.url);
              return (
                <article key={p.url} className={`ss-promo${hidden ? " is-hidden" : ""}`}>
                  <div className="ss-when">{p.periode_akhir
                    ? <><span className="ss-d">{fmtDate(p.periode_akhir)}</span><span className={`ss-left${dl <= 7 ? " soon" : ""}`}>{dl <= 0 ? "Last day" : `${dl} days left`}</span></>
                    : <><span className="ss-d">No end date</span><span className="ss-left">in source</span></>}</div>
                  <div>
                    <div className="ss-pbank">{p.bank}</div>
                    <h3>{p.judul || "Untitled in source"}</h3>
                    {p.benefit ? <p>{p.benefit}</p> : <p className="ss-muted">No benefit text in the source.</p>}
                    {p.minimal_transaksi && <div className="ss-fine">Minimum: {p.minimal_transaksi}</div>}
                    {p.kartu_atau_produk && <div className="ss-fine">For: {p.kartu_atau_produk}</div>}
                    <div className="ss-tags">
                      {p.kategori && <span className="ss-chip soft">{(PROMO_INT.find(x => x[0] === p.kategori) || [0, p.kategori])[1]}</span>}
                      {(p.jenis_reward ? p.jenis_reward === "miles_maskapai" : p.miles_poin) && <span className="ss-chip acc">{p.jenis_reward ? `Miles${p.program ? " · " + p.program : ""}` : "Miles/points"}</span>}
                      {p.kode_promo && <span className="ss-chip soft">Code {p.kode_promo}</span>}
                      <a href={p.url} target="_blank" rel="noopener noreferrer">{host(p.url)}</a>
                      {p.ditemukan && <span className="ss-found">found {String(p.ditemukan).slice(0, 10)}</span>}
                    </div>
                  </div>
                  <div><button className="ss-btn small" onClick={() => savePrefs({ ...prefs, hidden: hidden ? prefs.hidden.filter(u => u !== p.url) : [...prefs.hidden, p.url] })}>{hidden ? "Unhide" : "Hide"}</button></div>
                </article>
              );
            })}
            {shownPromos.length === 0 && !showHidden && <div className="ss-promo" style={{ gridTemplateColumns: "1fr" }}><div className="ss-muted">Nothing left after these filters. Turn on another interest, or switch Show to Everything.</div></div>}
          </div>
        </section>
      )}

      {tab === "news" && (
        <section className="ss-view">
          <div className="ss-head"><div><h2>Miles news</h2><div className="ss-sub">Changes and limited-time offers that touch miles, with what to do.</div></div></div>
          {newsRelevant.length === 0 ? <div className="ss-empty">No miles news stored yet.</div> : (
            <div className="ss-news">
              {newsRelevant.map(n => {
                const mine = myBankTokens.filter(t => new RegExp(`\\b${t}`, "i").test(n.bank || ""));
                return (
                  <article key={n.url} className="ss-item">
                    <div className="ss-kind"><span className={`ss-chip ${n.jenis === "devaluasi" ? "hot" : "acc"}`}>{KIND[n.jenis] || "Update"}</span>{n.program && <span>{n.program}</span>}{n.terbit && <span>{fmtDate(n.terbit)}</span>}</div>
                    <h3>{String(n.judul || "").replace(/&#8220;|&#8221;/g, '"')}</h3>
                    {n.rate_baru && <div className="ss-rates">{n.rate_lama && <>Before: {n.rate_lama}<br /></>}Now: {n.rate_baru}</div>}
                    {n.aksi && <div className="ss-act"><span>What to do</span>{n.aksi}</div>}
                    <div className="ss-mine">{mine.length ? <>Your banks: {mine.map(b => <span key={b} className="ss-chip soft">{b}</span>)}</> : "Not tied to a bank you hold"}</div>
                    <a href={String(n.url).split("?")[0]} target="_blank" rel="noopener noreferrer">{host(n.url)}</a>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {tab === "spending" && <SweetSpotSpending ledger={ledger} accounts={accounts} />}
    </Frame>
  );
}

function Frame({ children }) {
  return <div className="ss" style={{ fontFamily: FF }}><style>{CSS}</style>{children}</div>;
}

function Seg({ items, value, onChange, label, labelledBy }) {
  return (
    <div className="ss-seg" role="group" aria-label={label} aria-labelledby={labelledBy}>
      {items.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

function Cell({ id, cell, setCell, best, children }) {
  return (
    <td className={best ? "ss-best" : ""}>
      <button type="button" aria-pressed={cell === id} onClick={() => setCell(cell === id ? null : id)}>{children}</button>
    </td>
  );
}

function Detail({ cell, cols, kartuByName, earnFor, progName, onClose }) {
  const [t, name, k] = cell.split("|");
  const col = cols.find(c => c.name === name); if (!col) return null;
  const kr = kartuByName[col.catalog] || {};
  let title, body, src = null, asof = null, extra = null;
  if (t === "e") {
    const v = earnFor(col.catalog, k); const l = CATS.find(x => x[0] === k)[1];
    title = `${name} · ${l}`;
    if (!v) body = `No ${l.toLowerCase()} figure for this card in ${progName}. That does not mean it earns nothing; the source does not say.`;
    else {
      body = cleanNote(v.catatan) || "No conditions stated in the source."; src = v.sumber_url; asof = v.per_tanggal;
      extra = <>
        <span>Rp {rpn(v.rupiah_per_mile)} per mile · Rp 1.000.000 earns about {Math.floor(1000000 / v.rupiah_per_mile).toLocaleString("id-ID")} miles</span>
        {v.batas_bulanan && <span>Monthly cap: {v.batas_bulanan}</span>}
        {v.min_transaksi && <span>Minimum: {v.min_transaksi}</span>}
        {v.alt.length > 0 && <span>Another source says Rp {v.alt.map(rpn).join(", Rp ")}</span>}
      </>;
    }
  } else if (t === "x") {
    const row = EXC_ROWS.find(r => r[0] === k); title = `${name} · ${row[1]}`;
    const q = kr.pengecualian_kutipan?.[k];
    if (q) { body = q.kutipan; src = q.sumber_url; asof = q.per_tanggal; }
    else if (kr.kategori_dikecualikan) { body = `Catalog note on exclusions: "${kr.kategori_dikecualikan}"`; src = kr.sumber_url; asof = kr.per_tanggal; }
    else body = "The catalog has nothing on this for this card. It needs checking against the official terms before it can read Yes or No.";
  } else {
    const row = LIM_ROWS.find(r => r[0] === k); title = `${name} · ${row[1]}`;
    const v = row[2](kr); body = v != null && v !== "" ? String(k === "fee" ? feeText(v) : v) : "Not stated in the catalog.";
    src = kr.sumber_url; asof = kr.per_tanggal;
  }
  return (
    <div className="ss-detail" role="region" aria-live="polite">
      <h3>{title}</h3><button className="ss-btn small" onClick={onClose}>Close</button>
      <p>{body}</p>
      <div className="ss-src">{extra}{asof && <span>As of {asof}</span>}{src && <a href={src} target="_blank" rel="noopener noreferrer">{host(src)}</a>}</div>
    </div>
  );
}

function Picker({ cols, cat, earnFor, progName }) {
  const list = cols.map(c => ({ c, v: earnFor(c.catalog, cat) })).filter(x => x.v)
    .map(x => ({ ...x.v, card: x.c.name })).sort((a, b) => (a.flagged - b.flagged) || (a.rupiah_per_mile - b.rupiah_per_mile));
  const catName = CATS.find(c => c[0] === cat)[1];
  if (!list.length) return <div className="ss-empty"><b>No {catName.toLowerCase()} figure for your matched cards in {progName}.</b> Try Everyday, or another program.</div>;
  const best = list[0]; const maxMiles = Math.max(...list.map(r => 1000000 / r.rupiah_per_mile));
  return (
    <div className="ss-picker">
      <article className="ss-winner">
        <div><div className="ss-label">Use this card</div><div className="ss-card">{best.card}</div><div className="ss-muted small">{best.kartu}</div></div>
        <div className="ss-ratebig"><span className="big">Rp {rpn(best.rupiah_per_mile)}</span><span className="unit">per {progName} mile</span>{best.flagged && <span className="ss-chip warn">Needs check</span>}</div>
        <div className="ss-plain">Spending <b>Rp 1.000.000</b> earns about <b>{Math.floor(1000000 / best.rupiah_per_mile).toLocaleString("id-ID")} miles</b>.</div>
        <dl className="ss-facts">
          <dt>Conditions</dt><dd>{cleanNote(best.catatan) || "None stated in the source"}</dd>
          {best.batas_bulanan && <><dt>Monthly cap</dt><dd>{best.batas_bulanan}</dd></>}
          {best.alt.length > 0 && <><dt>Other figure</dt><dd>Rp {best.alt.map(rpn).join(", Rp ")} per mile in another source</dd></>}
        </dl>
        <div className="ss-src">{best.per_tanggal && <span>As of {best.per_tanggal}</span>}{best.sumber_url && <a href={best.sumber_url} target="_blank" rel="noopener noreferrer">{host(best.sumber_url)}</a>}</div>
      </article>
      <div className="ss-others">
        <div className="ss-label">All your cards, {catName.toLowerCase()}</div>
        <ol>{list.map((r, i) => (
          <li key={r.kunci_baris} className={`ss-row${i === 0 ? " is-best" : ""}${r.flagged ? " is-flag" : ""}`}>
            <span className="name">{r.card}{r.flagged && <span className="ss-chip warn">Needs check</span>}</span>
            <span className="rpm">Rp {rpn(r.rupiah_per_mile)}</span>
            <span className="track" aria-hidden="true"><i style={{ width: `${Math.max(4, (1000000 / r.rupiah_per_mile) / maxMiles * 100)}%` }} /></span>
            <span className="meta">{cleanNote(r.catatan) || "No conditions stated"}</span>
          </li>
        ))}</ol>
        <div className="ss-muted small" style={{ paddingTop: 8 }}>Longer bar = more miles for the same spend.</div>
      </div>
    </div>
  );
}

function MatchPanel({ user, cards, kartu, mapByAccount, onSaved }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(cards.map(a => {
    const m = mapByAccount[a.id]; return [a.id, m ? (m.status === "not_in_catalog" ? "__none" : m.kartu_katalog) : ""];
  })));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const names = kartu.map(k => k.kartu).sort();
  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const upserts = [], deletes = [];
      cards.forEach(a => {
        const v = draft[a.id];
        if (!v) { if (mapByAccount[a.id]) deletes.push(a.id); return; }
        upserts.push({ user_id: user.id, account_id: a.id, status: v === "__none" ? "not_in_catalog" : "matched",
          kartu_katalog: v === "__none" ? null : v, updated_at: new Date().toISOString() });
      });
      if (upserts.length) { const { error } = await supabase.from("pemetaan_kartu").upsert(upserts, { onConflict: "user_id,account_id" }); if (error) throw error; }
      if (deletes.length) { const { error } = await supabase.from("pemetaan_kartu").delete().in("account_id", deletes); if (error) throw error; }
      setMsg("Saved."); await onSaved();
    } catch (e) { setMsg(`Not saved: ${e.message}`); }
    setSaving(false);
  };
  return (
    <div className="ss-match">
      <div className="ss-head"><div><h2 style={{ fontSize: 16 }}>Match your cards</h2>
        <div className="ss-sub">Pick the exact product for each card. Names that only look alike are never matched automatically.</div></div></div>
      <div className="ss-scroll"><table>
        <thead><tr><th scope="col">Your card</th><th scope="col">Catalog product</th></tr></thead>
        <tbody>{cards.map(a => (
          <tr key={a.id}><td><b>{a.name}</b></td><td>
            <select id={`ss-match-${a.id}`} aria-label={`Catalog product for ${a.name}`} value={draft[a.id]} onChange={e => setDraft(d => ({ ...d, [a.id]: e.target.value }))}>
              <option value="">Not matched yet</option>
              <option value="__none">Not in catalog</option>
              {names.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </td></tr>
        ))}</tbody>
      </table></div>
      <div className="ss-frow"><button className="ss-btn primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save matching"}</button>{msg && <span className="ss-muted">{msg}</span>}</div>
    </div>
  );
}

const CSS = `
.ss{--ink:#111827;--muted:#667085;--faint:#98a2b3;--line:#e4e7ec;--sunk:#f0f2f6;--surface:#fff;--accent:#3b5bdb;--accent-soft:#eef1fd;--accent-ink:#2f47b3;--warn:#b45309;--warn-soft:#fdf3e4;--hot:#b42318;--hot-soft:#fdecea;--good:#047857;--bar:#c9d3f6;
  display:flex;flex-direction:column;gap:18px;color:var(--ink);font-size:14px;line-height:1.5}
.ss h1,.ss h2,.ss h3{margin:0;text-wrap:balance}
.ss a{color:var(--accent-ink);text-underline-offset:2px;font-size:12.5px}
.ss button:focus-visible,.ss select:focus-visible,.ss input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ss-top{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px}
.ss-top h1{font-size:24px;font-weight:800;letter-spacing:-.01em}
.ss-top p{margin:4px 0 0;color:var(--muted);max-width:62ch;font-size:13px}
.ss-note{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12.5px;color:var(--muted);align-items:center}
.ss-note b{color:var(--ink);font-weight:600}
.ss-label{font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.ss-muted{color:var(--muted)} .ss-muted.small{font-size:12.5px}
.ss-seg{display:inline-flex;flex-wrap:wrap;gap:2px;background:var(--sunk);border:1px solid var(--line);border-radius:10px;padding:3px}
.ss-seg button{height:34px;padding:0 14px;border:0;border-radius:8px;background:transparent;color:var(--muted);font:600 13px/1 ${FF};cursor:pointer}
.ss-seg button[aria-pressed="true"]{background:var(--surface);color:var(--ink);box-shadow:0 1px 2px rgba(16,24,40,.08)}
.ss-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);overflow-x:auto}
.ss-tabs button{height:42px;padding:0 16px;border:0;background:transparent;color:var(--muted);font:600 14px/1 ${FF};cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.ss-tabs button[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--accent)}
.ss-count{font-weight:600;color:var(--faint);margin-left:6px}
.ss-view{display:flex;flex-direction:column;gap:14px}
.ss-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px}
.ss-head h2{font-size:18px;font-weight:700}
.ss-sub{color:var(--muted);font-size:13px;margin-top:2px;max-width:70ch}
.ss-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:6px;font-size:11.5px;font-weight:600;white-space:nowrap}
.ss-chip.warn{background:var(--warn-soft);color:var(--warn)} .ss-chip.hot{background:var(--hot-soft);color:var(--hot)}
.ss-chip.soft{background:var(--sunk);color:var(--muted)} .ss-chip.acc{background:var(--accent-soft);color:var(--accent-ink)}
.ss-btn{height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:600 13px/1 ${FF};cursor:pointer;white-space:nowrap}
.ss-btn:hover{border-color:var(--accent);color:var(--accent-ink)} .ss-btn.small{height:28px;padding:0 10px;font-size:12px}
.ss-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff} .ss-btn:disabled{opacity:.6;cursor:default}
.ss-linkbtn{all:unset;cursor:pointer;color:var(--accent-ink);font-weight:600;text-decoration:underline;text-underline-offset:2px}
.ss-callout{font-size:13px;color:var(--muted);background:var(--sunk);border-radius:10px;padding:10px 14px} .ss-callout b{color:var(--ink)}
.ss-empty{border:1px dashed var(--line);border-radius:14px;padding:20px;color:var(--muted);background:var(--surface)} .ss-empty b{color:var(--ink)}
.ss-tablebox{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow-x:auto}
.ss-cmp{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:13px}
.ss-cmp th,.ss-cmp td{border-bottom:1px solid var(--line);padding:0}
.ss-cmp thead th{background:var(--surface);font-weight:700;text-align:left;padding:12px 10px;vertical-align:bottom;min-width:120px;max-width:180px}
.ss-bank{display:block;font-size:11px;font-weight:600;color:var(--faint)}
.ss-rowh{position:sticky;left:0;z-index:2;background:var(--surface);text-align:left;font-weight:600;padding:10px 14px!important;min-width:168px;border-right:1px solid var(--line)}
.ss-rowh small{display:block;font-weight:400;color:var(--muted);font-size:12px}
.ss-group th{background:var(--sunk);text-align:left;padding:7px 14px!important;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.ss-cmp td button{all:unset;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:2px;width:100%;min-height:52px;padding:8px 10px;cursor:pointer;max-width:180px}
.ss-cmp td button:hover{background:var(--sunk)}
.ss-cmp td button[aria-pressed="true"]{box-shadow:inset 0 0 0 2px var(--accent)}
.ss-best{background:var(--accent-soft)} .ss-best b{color:var(--accent-ink)}
.ss-rate b{font-weight:700;font-size:14px;font-variant-numeric:tabular-nums} .ss-rate small{font-size:11px;color:var(--muted)}
.ss-no{color:var(--hot);font-weight:700} .ss-lim{color:var(--warn);font-weight:700} .ss-yes{color:var(--good);font-weight:700} .ss-na{color:var(--faint)}
.ss-text{font-size:12.5px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.ss-detail{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px}
.ss-detail h3{font-size:15px} .ss-detail p{margin:0;grid-column:1/-1;max-width:80ch;white-space:pre-wrap}
.ss-src{grid-column:1/-1;font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 14px}
.ss-legend{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:12.5px;color:var(--muted)} .ss-legend span{display:inline-flex;gap:8px;align-items:center}
.ss-sw{display:inline-block;width:14px;height:14px;border-radius:4px;background:var(--accent-soft);border:1px solid var(--accent)}
.ss-picker{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:16px}
.ss-winner{background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px -12px rgba(59,91,219,.18);padding:22px;display:flex;flex-direction:column;gap:14px}
.ss-card{font-size:26px;font-weight:800;letter-spacing:-.01em;margin-top:6px}
.ss-ratebig{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.ss-ratebig .big{font-size:38px;font-weight:800;letter-spacing:-.02em;color:var(--accent-ink);font-variant-numeric:tabular-nums}
.ss-ratebig .unit{font-size:15px;color:var(--muted);font-weight:600}
.ss-plain{background:var(--accent-soft);color:var(--accent-ink);border-radius:10px;padding:10px 12px;font-size:13.5px}
.ss-facts{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px;margin:0} .ss-facts dt{color:var(--muted)} .ss-facts dd{margin:0}
.ss-others{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px 18px 12px}
.ss-others ol{list-style:none;margin:6px 0 0;padding:0}
.ss-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;padding:10px 0;border-top:1px solid var(--line);align-items:center}
.ss-row:first-child{border-top:0}
.ss-row .name{font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap} .ss-row .rpm{font-weight:700;font-variant-numeric:tabular-nums}
.ss-row .meta{grid-column:1/-1;color:var(--muted);font-size:12.5px}
.ss-row .track{grid-column:1/-1;height:6px;border-radius:4px;background:var(--sunk);overflow:hidden} .ss-row .track i{display:block;height:100%;background:var(--bar);border-radius:4px}
.ss-row.is-best .track i{background:var(--accent)} .ss-row.is-flag .track i{background:repeating-linear-gradient(90deg,var(--warn) 0 4px,transparent 4px 7px)}
.ss-filterbar,.ss-match{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.ss-frow{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center} .ss-frow>.ss-label{min-width:92px}
.ss-toggle{height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--muted);font:600 12.5px/1 ${FF};cursor:pointer}
.ss-toggle[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-ink)} .ss-toggle:disabled{opacity:.5;cursor:default}
.ss-check{display:inline-flex;align-items:center;gap:8px;font-size:13px;cursor:pointer} .ss-check input{width:16px;height:16px;accent-color:var(--accent)}
.ss-tally{font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center} .ss-tally b{color:var(--ink)}
.ss-list{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.ss-promo{display:grid;grid-template-columns:92px minmax(0,1fr) auto;gap:14px;padding:14px 16px;border-top:1px solid var(--line)}
.ss-promo:first-child{border-top:0} .ss-promo.is-hidden{opacity:.55}
.ss-when{display:flex;flex-direction:column;gap:2px} .ss-d{font-weight:700;font-size:13.5px}
.ss-left{font-size:12px;color:var(--muted)} .ss-left.soon{color:var(--hot);font-weight:600}
.ss-promo h3{font-size:14.5px;font-weight:600;line-height:1.35} .ss-pbank{font-size:12px;font-weight:700;color:var(--muted)}
.ss-promo p{margin:4px 0 0;font-size:13px} .ss-fine{color:var(--muted);font-size:12.5px;margin-top:4px}
.ss-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center} .ss-found{font-size:12px;color:var(--faint)}
.ss-news{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.ss-item{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.ss-kind{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:12px;color:var(--muted)}
.ss-item h3{font-size:14.5px;font-weight:600;line-height:1.35} .ss-rates{font-size:12.5px;color:var(--muted)}
.ss-act{font-size:13px;border-left:2px solid var(--accent);padding-left:10px}
.ss-act span{display:block;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:2px}
.ss-mine{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;color:var(--muted)}
.ss-scroll{overflow-x:auto} .ss-match table{width:100%;border-collapse:collapse;font-size:13px}
.ss-match th{text-align:left;font-weight:600;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--line)}
.ss-match td{padding:6px 8px;border-bottom:1px solid var(--line)}
.ss-match select{height:34px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:500 13px ${FF};padding:0 8px;width:100%;max-width:360px}
@media (max-width:880px){.ss-picker{grid-template-columns:1fr}}
@media (max-width:560px){.ss-promo{grid-template-columns:1fr;gap:6px}.ss-when{flex-direction:row;gap:8px;align-items:baseline}.ss-ratebig .big{font-size:32px}}
`;
