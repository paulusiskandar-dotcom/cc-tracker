import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { settingsApi } from "../api";
import { Check, X, HelpCircle, AlertTriangle, Minus, ChevronDown } from "lucide-react";
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
const CATS = [["everyday", "Everyday"], ["dining", "Dining"], ["groceries", "Groceries"], ["travel", "Travel"], ["online", "Online"], ["overseas", "Overseas"]];
const CAT_OF = { general: "everyday", dining: "dining", groceries: "groceries", travel: "travel", online: "online", ecommerce: "online", fx: "overseas" };
// Bonus categories the cardholder picks (not in the public catalog). Catalog rows whose
// note names the bonus follow the holder's choice instead of their catalog category.
const BONUS_CHOICES = [{
  match: /jenius/i, nama: "Double Yay", re: /double yay/i, sumber: "https://www.jenius.com/pages/yaypoints",
  options: [["groceries", "Belanja Bulanan"], ["dining", "Makanan & Minuman"], ["travel", "Perjalanan & Hiburan"], ["fashion", "Kecantikan & Fashion"]],
}];
const EXC_ROWS = [
  ["utilitas", "Utilities", "Electricity, water, internet", /utilit|listrik|\bpln\b|\bair\b|internet/i],
  ["cicilan", "Instalments", "Converted to cicilan", /cicilan|instal/i],
  ["asuransi", "Insurance", "Premiums", /asuransi|insuran|premi/i],
  ["qris", "QRIS", "Scan to pay in a bank app", /qris/i],
  ["pajak", "Tax & government", "Tax, PBB, state payments", /pajak|penerimaan negara|\bpbb\b|\btax\b/i],
  ["paper", "Paper.id", "Business invoice payments", /paper\.?id|invoic|tagihan bisnis|pembayaran bisnis/i],
  ["ewallet_topup", "E-wallet top-up", "Adding balance to OVO, GoPay, DANA", /e-?wallet|dompet|ovo|gopay/i],
  ["emoney_topup", "E-money top-up", "Flazz, e-money, Brizzi, TapCash", /flazz|e-?money|uang elektronik|brizzi|tapcash/i],
  ["bayar_ewallet", "Pay via e-wallet", "Card linked to DANA, GoPay, ShopeePay", /e-?wallet|dompet digital|shopee ?pay|gopay|\bdana\b/i],
  ["spbu", "Fuel", "Petrol stations", /spbu|bensin|fuel/i],
];
// Community route reports (jalur_transaksi_kartu) shown under these rows.
const ROUTE_TOPIC = { emoney_topup: "topup_emoney", bayar_ewallet: "qris_dompet" };
const ROUTE_STATUS = [["masih_berlaku", "Still works"], ["tidak_jelas", "Unclear"], ["sudah_ditutup", "Closed"]];
const ROUTE_POINTS = { dapat: ["yes", "Earns"], terbatas: ["limited", "Partly"], tidak_dapat: ["no", "No points"], berubah: ["check", "Keeps changing"] };
const TRICK_CAT = { sweet_spot_penukaran: "Redemption sweet spot", promo_penukaran: "Redemption sale", optimasi_kartu: "Card strategy",
  bayar_tagihan_vendor_pajak: "Bills, vendors & tax", promo_bank: "Bank bonus", hotel: "Hotels", status: "Elite status", trik_booking: "Booking",
  program_bank: "Bank programme", beli_miles: "Buying miles", shopping_portal: "Shopping portal", kompensasi: "Compensation", manufactured_spending: "Manufactured spend" };
const LEVEL = { tinggi: "High", sedang: "Medium", rendah: "Low" };
const asList = v => { if (Array.isArray(v)) return v; if (typeof v === "string") { try { const j = JSON.parse(v); return Array.isArray(j) ? j : [v]; } catch { return [v]; } } return []; };

const LIM_ROWS = [
  ["cap", "Monthly earn cap", r => r.batas_perolehan_bulanan || r.batas_perolehan],
  ["minconv", "Minimum to convert", r => r.min_konversi],
  ["convcap", "Conversion cap", r => r.batas_konversi],
  ["fee", "Annual fee", r => r.iuran_tahunan_utama_rp ?? r.iuran_tahunan],
];
const PROMO_INT = [["kuliner", "Dining"], ["travel", "Travel"], ["belanja", "Shopping"], ["hiburan", "Entertainment"],
  ["kesehatan", "Health"], ["transportasi", "Transport"], ["cicilan", "Instalments"], ["tagihan", "Bills"], ["lainnya", "Other"]];
const BANKING_CAT = ["simpanan", "investasi", "pinjaman"];
const BANKING_PRODUCT = ["tabungan", "deposito", "investasi", "pinjaman"];
const WEALTH_RE = /dana kelolaan|privilege|prioritas|penempatan dana|priority/i;
const KIND = { diskon_penukaran: "Redemption sale", transfer_bonus: "Transfer bonus", bonus_perolehan: "Earning bonus",
  devaluasi: "Devaluation", perubahan_earning_rate: "Earn rate change", welcome_bonus: "Welcome bonus", kartu_baru: "New card" };
const BANK_ALIAS = { jenius: ["jenius", "smbc", "btpn"], cimb: ["cimb"], skorcard: ["mayapada", "skorcard"], mayapada: ["mayapada", "skorcard"] };
const DEFAULT_PREFS = { interests: ["kuliner", "travel", "belanja", "hiburan"], hidden: [], hideWealth: true };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Bank Mega" / "PT Bank ..." → "mega", so issuer names match the account's bank.
const bankNorm = b => String(b || "").toLowerCase().replace(/^(pt\.?\s+)?bank\s+/, "").trim();
const PROG_ALIAS = { united: "unitedmileageplus" };
const progKey = p => { const k = String(p || "").toLowerCase().replace(/[^a-z]/g, ""); return PROG_ALIAS[k] || k; };
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
  const [spend, setSpend] = useState("e:everyday");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [matching, setMatching] = useState(false);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [scope, setScope] = useState("mine");
  const [soon, setSoon] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(40);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [kartu, earn, promo, news, pemetaan, mcc, routes, tricks] = await Promise.all([
        fetchAll("kartu_miles", q => q.order("kartu")),
        fetchAll("earn_rate_kartu", q => q.order("kartu")),
        fetchAll("promo_bank", q => q.order("periode_akhir", { ascending: true, nullsFirst: false })),
        fetchAll("miles_update", q => q.order("terbit", { ascending: false })),
        fetchAll("pemetaan_kartu", q => q),
        fetchAll("mcc_merchant", q => q.order("merchant")),
        fetchAll("jalur_transaksi_kartu", q => q.order("terakhir_dilaporkan", { ascending: false, nullsFirst: false })),
        fetchAll("trik_miles", q => q.order("skor_manfaat", { ascending: false })),
      ]);
      setData({ kartu, earn, promo, news, pemetaan, mcc, routes, tricks });
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
    .map(x => {
      const b = x.map.pengaturan?.bonus_pilihan; const def = b && BONUS_CHOICES.find(d => d.nama === b.nama);
      return { name: x.account.name, catalog: x.map.kartu_katalog, bank: x.account.bank_name || kartuByName[x.map.kartu_katalog]?.bank || "",
        bonus: b && def ? { ...b, re: def.re } : null };
    }),
  [creditCards, mapByAccount, kartuByName]);
  const unmatched = creditCards.filter(a => !mapByAccount[a.id]);

  // lowest clean airline-miles figure per card × category × program.
  // A card with no separate rate for a category earns its everyday rate there
  // (bank terms give the base rate "for every transaction"); that fallback is
  // labelled, and categories the bank excludes are handled by the exclusion rows.
  const earnFor = useCallback((col, c) => {
    const catOf = r => (col.bonus && col.bonus.re.test(r.catatan || "")) ? col.bonus.kategori : CAT_OF[r.kategori];
    const pickFor = cat => {
      const rs = (data?.earn || []).filter(r => r.kartu === col.catalog && catOf(r) === cat && progKey(r.program) === prog && !isBankPoints(r) && r.rupiah_per_mile != null)
        .sort((a, b) => a.rupiah_per_mile - b.rupiah_per_mile);
      if (!rs.length) return null;
      const clean = rs.filter(r => !needsCheck(r)); const pick = clean[0] || rs[0];
      return { ...pick, flagged: !clean.length, alt: [...new Set(rs.filter(r => r !== pick && Number(r.rupiah_per_mile) !== Number(pick.rupiah_per_mile)).map(r => Number(r.rupiah_per_mile)))] };
    };
    const own = pickFor(c);
    if (own || c === "everyday") return own;
    const base = pickFor("everyday");
    return base ? { ...base, fallback: true } : null;
  }, [data, prog]);

  if (error) return <Frame><div className="ss-empty"><b>Could not load SweetSpot data.</b> {error} <button className="ss-btn" onClick={load}>Try again</button></div></Frame>;
  if (!data) return <Frame><div className="ss-empty">Loading earn rates, promos and news…</div></Frame>;

  // other airline programmes your matched cards can reach (Flying Blue via ALL Accor, JAL via D-Point, ...)
  const PROG_LABEL = { flyingblue: "Flying Blue", qatarprivilegeclub: "Qatar Privilege Club", britishairwaysexecutiveclub: "British Airways Club",
    emiratesskywards: "Emirates Skywards", etihadguest: "Etihad Guest", turkishmilessmiles: "Turkish Miles&Smiles", thairoyalorchidplus: "Thai Royal Orchid Plus",
    koreanskypass: "Korean SKYPASS", unitedmileageplus: "United MileagePlus", qantasfrequentflyer: "Qantas Frequent Flyer",
    vietnamlotusmiles: "Vietnam Lotusmiles", iberiaplus: "Iberia Plus", finnairplus: "Finnair Plus", virginaustraliavelocity: "Virgin Australia Velocity",
    airasia: "AirAsia rewards", linkmiles: "LinkMiles", jal: "JAL Mileage Bank", ana: "ANA Mileage Club", lifemiles: "LifeMiles" };
  const mainKeys = new Set(PROGRAMS.map(p => p[0]));
  const otherProgs = [...new Set((data.earn || []).filter(r => cols.some(c => c.catalog === r.kartu) && !isBankPoints(r) && r.rupiah_per_mile != null)
    .map(r => progKey(r.program)).filter(k => k && !mainKeys.has(k) && PROG_LABEL[k]))]
    .map(k => [k, PROG_LABEL[k]]).sort((a, b) => a[1].localeCompare(b[1]));
  const progName = (PROGRAMS.find(p => p[0] === prog) || otherProgs.find(p => p[0] === prog) || [prog, prog])[1];
  const latestSync = [...data.kartu, ...data.earn, ...data.promo, ...data.news].map(r => r.updated_at).sort().pop();

  /* ── promos ── */
  const myBankTokens = [...new Set(creditCards.flatMap(a => {
    const t = String(a.bank_name || a.name.split(" ")[0]).toLowerCase(); return BANK_ALIAS[t] || [t];
  }))];
  const promoBankMine = p => { const b = bankNorm(p.bank_penerbit_kartu || p.bank); return myBankTokens.some(t => b.startsWith(t)); };
  const today = todayISO();
  const active = data.promo.filter(p => (p.status || "ok") === "ok" && (!p.periode_akhir || p.periode_akhir >= today));
  const why = { banking: 0, notcard: 0, interest: 0, wealth: 0, later: 0, hidden: 0, search: 0 };
  const qs = q.trim().toLowerCase();
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
    if (qs && !`${p.judul || ""} ${p.merchant || ""} ${p.benefit || ""} ${p.bank || ""} ${p.kartu_atau_produk || ""}`.toLowerCase().includes(qs)) { why.search++; return; }
    shownPromos.push(p);
  });
  const coveredBanks = new Set(data.promo.map(p => bankNorm(p.bank_penerbit_kartu || p.bank)));
  const uncovered = [...new Set(creditCards.map(a => a.bank_name || a.name.split(" ")[0]))]
    .filter(b => !(BANK_ALIAS[b.toLowerCase()] || [b.toLowerCase()]).some(t => [...coveredBanks].some(c => c.startsWith(t))));
  const newsRelevant = data.news.filter(n => n.relevan_miles && (n.status || "ok") === "ok");

  const tricksWorking = data.tricks.filter(t => t.status_dugaan === "masih_berlaku").length;
  const tabs = [["compare", "Compare cards"], ["promo", "Promos", shownPromos.length], ["news", "Miles news", newsRelevant.length], ["tricks", "Tricks", tricksWorking], ["spending", "My spending"]];

  return (
    <Frame>
      <header className="ss-top">
        <div>
          <h1>SweetSpot</h1>
          <p>What each card earns, where it earns nothing, and which promos are worth your time. Public sources only.</p>
        </div>
        {tab === "compare" && (
          <div>
            <div className="ss-label" id="ss-prog-l">Collecting</div>
            <div className="ss-frow" style={{ gap: 8 }}>
              <Seg labelledBy="ss-prog-l" items={PROGRAMS} value={prog} onChange={setProg} />
              {otherProgs.length > 0 && (
                <select id="ss-prog-other" className="ss-select" aria-label="Other airline programme" value={mainKeys.has(prog) ? "" : prog} onChange={e => e.target.value && setProg(e.target.value)}>
                  <option value="">Other programmes…</option>
                  {otherProgs.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              )}
            </div>
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
        <CompareView cols={cols} kartuByName={kartuByName} earnFor={earnFor} progName={progName} spend={spend} setSpend={setSpend} mcc={data.mcc} routes={data.routes} />
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
            <div className="ss-frow"><span className="ss-label"><label htmlFor="ss-q">Search</label></span>
              <input id="ss-q" className="ss-input" type="search" placeholder="Merchant, benefit or card" value={q}
                onChange={e => { setQ(e.target.value); setLimit(40); }} /></div>
            <div className="ss-frow"><span className="ss-label">Also</span>
              <label className="ss-check"><input id="ss-wealth" type="checkbox" checked={prefs.hideWealth} onChange={e => savePrefs({ ...prefs, hideWealth: e.target.checked })} /> Hide offers that need priority or wealth status</label>
              <label className="ss-check"><input id="ss-soon" type="checkbox" checked={soon} onChange={e => setSoon(e.target.checked)} /> Ending in 30 days</label></div>
            <div className="ss-tally">
              <span>Showing <b>{shownPromos.length}</b> of {active.length} active promos.</span>
              {Object.values(why).some(Boolean) && <span>Filtered out: {[
                why.banking && `${why.banking} savings, loans or investment`, why.notcard && `${why.notcard} not for a credit card you hold`,
                why.interest && `${why.interest} outside your interests`, why.wealth && `${why.wealth} need priority status`, why.later && `${why.later} end later`,
              ].filter(Boolean).join(" · ")}.</span>}
              {why.search > 0 && <span>{why.search} do not match your search.</span>}
              {why.hidden > 0 && <span>{why.hidden} hidden by you. <button className="ss-linkbtn" onClick={() => setShowHidden(s => !s)}>{showHidden ? "Hide them again" : "Show"}</button></span>}
            </div>
          </div>
          {uncovered.length > 0 && <div className="ss-callout"><b>Not covered yet:</b> {uncovered.join(", ")}. No promos stored for these banks, which does not mean they have none.</div>}
          <div className="ss-list">
            {(showHidden ? [...shownPromos, ...hiddenPromos] : shownPromos).slice(0, limit).map(p => {
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
            {shownPromos.length > limit && !showHidden && (
              <div className="ss-promo" style={{ gridTemplateColumns: "1fr" }}>
                <button className="ss-btn" onClick={() => setLimit(l => l + 60)}>Show 60 more of {shownPromos.length - limit} left</button>
              </div>
            )}
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

      {tab === "tricks" && <TricksView tricks={data.tricks} />}

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

// Left: what you are about to pay for. Right: your cards, best first, as a checklist.
function CompareView({ cols, kartuByName, earnFor, progName, spend, setSpend, mcc = [], routes = [] }) {
  const [open, setOpen] = useState(null);
  const [type, key] = spend.split(":");
  const isEarn = type === "e";
  const label = isEarn ? CATS.find(c => c[0] === key)[1] : EXC_ROWS.find(r => r[0] === key)[1];

  const ORDER = { best: 0, yes: 1, check: 2, limited: 3, see: 4, unknown: 5, no: 6 };
  const rows = cols.map(c => {
    const kr = kartuByName[c.catalog] || {};
    if (isEarn) {
      const v = earnFor(c, key);
      return { c, kr, v, status: !v ? "unknown" : v.flagged ? "check" : "yes", rpm: v ? Number(v.rupiah_per_mile) : Infinity };
    }
    const val = kr[`pengecualian_${key}`];
    const re = EXC_ROWS.find(r => r[0] === key)[3];
    const status = val === "dapat" ? "yes" : val === "terbatas" ? "limited" : val === "tidak_dapat" ? "no"
      : re.test(kr.kategori_dikecualikan || "") ? "see" : "unknown";
    return { c, kr, status, rpm: Infinity };
  }).sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (a.rpm - b.rpm) || a.c.name.localeCompare(b.c.name));
  if (isEarn && rows[0]?.status === "yes") rows[0] = { ...rows[0], status: "best" };

  const count = s => rows.filter(r => r.status === s).length;
  const best = rows[0]?.status === "best" ? rows[0] : null;
  let summary;
  if (isEarn) summary = best
    ? <>Best for {label.toLowerCase()}: <b>{best.c.name}</b> at <b>Rp {rpn(best.rpm)}</b> per {progName} mile{best.v?.fallback ? " (its everyday rate)" : ""}. Rp 1.000.000 earns about <b>{Math.floor(1000000 / best.rpm).toLocaleString("id-ID")} miles</b>.</>
    : <>None of your matched cards has a {label.toLowerCase()} figure in {progName}.</>;
  else summary = <>{count("no") ? <><b>{count("no")}</b> {count("no") === 1 ? "card earns" : "cards earn"} nothing here. </> : null}
    {count("yes") ? <><b>{count("yes")}</b> confirmed to earn. </> : null}
    {count("unknown") + count("see") ? <><b>{count("unknown") + count("see")}</b> not classified yet, so they are not marked either way.</> : null}</>;

  const Pick = ({ items, group }) => (
    <div className="ss-spendgroup">
      <div className="ss-label">{group}</div>
      {items.map(([k, l, sub]) => {
        const id = `${group === "Earn miles" ? "e" : "x"}:${k}`;
        return <button key={id} type="button" className="ss-spend" aria-pressed={spend === id} onClick={() => { setSpend(id); setOpen(null); }}>
          {l}{sub && <small>{sub}</small>}
        </button>;
      })}
    </div>
  );

  if (!cols.length) return <section className="ss-view"><div className="ss-empty"><b>No cards matched yet.</b> Use Match cards above to link your cards to the catalog.</div></section>;

  return (
    <section className="ss-view">
      <div className="ss-head"><div><h2>Compare cards</h2><div className="ss-sub">Pick what you are paying for. Your cards line up best first.</div></div></div>
      <div className="ss-cmpgrid">
        <nav className="ss-spendnav" aria-label="Spending type">
          <Pick group="Earn miles" items={CATS.map(([k, l]) => [k, l])} />
          <Pick group="Often excluded" items={EXC_ROWS.map(([k, l, sub]) => [k, l, sub])} />
        </nav>
        <div className="ss-ranked">
          <div className="ss-summary">{summary}</div>
          <MerchantTips tips={mcc.filter(t => {
            const mine = cols.some(c => c.catalog === t.kartu) || cols.some(c => t.bank && c.bank && c.bank.toLowerCase().startsWith(String(t.bank).toLowerCase()));
            const here = t.kategori_spending === key || (key === "utilitas" && /listrik|\bpln\b|tagihan/i.test(t.dampak || ""));
            return mine && here;
          })} />
          <ol className="ss-cards">
            {rows.map(r => {
              const id = r.c.name; const isOpen = open === id;
              return (
                <li key={id} className={`ss-cardrow st-${r.status}`}>
                  <button type="button" className="ss-cardbtn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
                    <Mark status={r.status} />
                    <span className="ss-cname">{r.c.name}<small>{r.c.bank}</small>
                      {r.c.bonus && <small className="ss-bonus">{r.c.bonus.nama}: {r.c.bonus.label_bank}</small>}
                      {cautions(r, isEarn, key).length > 0 && <span className="ss-caution"><AlertTriangle size={12} aria-hidden="true" /><span>{cautions(r, isEarn, key).join(" · ")}</span></span>}
                    </span>
                    <span className="ss-verdict">{verdict(r, isEarn)}</span>
                    <ChevronDown size={16} className="ss-chev" aria-hidden="true" />
                  </button>
                  {isOpen && <CardDetail r={r} isEarn={isEarn} spendKey={key} />}
                </li>
              );
            })}
          </ol>
          <div className="ss-legend">
            <span><Mark status="yes" /> earns</span><span><Mark status="no" /> no points</span>
            <span><Mark status="limited" /> limited or see terms</span><span><Mark status="check" /> figure needs checking</span>
            <span><Mark status="unknown" /> not stated, not assumed</span>
          </div>
          {ROUTE_TOPIC[key] && <RouteReports key={key} topic={ROUTE_TOPIC[key]} routes={routes} cols={cols} />}
        </div>
      </div>
    </section>
  );
}

// Short caps shown right under the card name, straight from the source fields.
function cautions(r, isEarn, spendKey) {
  if (!isEarn) {
    if (spendKey === "paper" && r.status === "no" && r.kr?.paper_via_blibli_tokopedia === "dapat") return ["May earn if paid through a Blibli or Tokopedia e-invoice"];
    return [];
  }
  if (r.status === "unknown") return [];
  const out = []; const v = r.v || {}; const kr = r.kr || {};
  // conditional variants ("efektif spend Rp20 juta/statement", "s.d. 200.000 per maskapai") can be the lowest figure; say so up front
  if (v.varian && !/^(dasar|resmi)$/i.test(String(v.varian).trim())) out.push(`Only when: ${v.varian}`);
  if (v.batas_bulanan) {
    const n = Number(v.batas_bulanan);
    out.push(`Cap on this rate: ${Number.isFinite(n) ? (/spend/i.test(v.catatan || "") ? `spend Rp ${rpn(n)} a month` : rpn(n)) : v.batas_bulanan}`);
  }
  const cap = kr.batas_perolehan_bulanan || kr.batas_perolehan; if (cap) out.push(`Earn cap: ${cap}`);
  if (kr.batas_konversi) out.push(`Conversion cap: ${kr.batas_konversi}`);
  return out;
}

function MerchantTips({ tips }) {
  const [open, setOpen] = useState(null);
  if (!tips.length) return null;
  const STATUS = { terverifikasi: ["acc", "Verified"], belum_diverifikasi: ["warn", "Not verified"], bertentangan: ["hot", "Conflicts with official terms"], kedaluwarsa: ["soft", "Outdated"] };
  const SRC = { resmi: "Official", komunitas: "Community tip", pribadi: "Your note" };
  return (
    <div className="ss-tips">
      <div className="ss-label">Merchant tips (MCC)</div>
      {tips.map(t => {
        const st = STATUS[t.status_verifikasi] || ["soft", t.status_verifikasi || "Unknown status"]; const isOpen = open === t.kunci;
        return (
          <div key={t.kunci} className="ss-tip">
            <button type="button" className="ss-tipbtn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.kunci)}>
              <span><b>{t.merchant}</b>{t.kartu ? ` · ${t.kartu}` : t.bank ? ` · ${t.bank}` : ""}<br /><span className="ss-muted">{t.dampak}</span></span>
              <span className="ss-tipchips"><span className="ss-chip soft">{SRC[t.sumber_jenis] || t.sumber_jenis}</span><span className={`ss-chip ${st[0]}`}>{st[1]}</span></span>
            </button>
            {isOpen && (
              <dl className="ss-facts ss-tipdetail">
                {t.mcc_kode && <><dt>MCC</dt><dd>{t.mcc_kode}{t.kategori_mcc ? ` · ${t.kategori_mcc}` : ""}</dd></>}
                {!t.mcc_kode && t.kategori_mcc && <><dt>MCC category</dt><dd>{t.kategori_mcc} (code not recorded)</dd></>}
                {t.bukti && <><dt>Evidence</dt><dd>{t.bukti}</dd></>}
                {t.bertentangan_dengan && <><dt>Official terms say</dt><dd>{t.bertentangan_dengan}</dd></>}
                {t.catatan && <><dt>Note</dt><dd>{t.catatan}</dd></>}
                <dt>Source</dt><dd>{t.per_tanggal && `As of ${t.per_tanggal} · `}{t.sumber_url ? <a href={t.sumber_url} target="_blank" rel="noopener noreferrer">{host(t.sumber_url)}</a> : "No link"}</dd>
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Mark({ status }) {
  const m = { best: [Check, "yes"], yes: [Check, "yes"], no: [X, "no"], limited: [Minus, "lim"], see: [Minus, "lim"], check: [AlertTriangle, "lim"], unknown: [HelpCircle, "na"] }[status];
  const Icon = m[0];
  return <span className={`ss-mark ${m[1]}`} aria-hidden="true"><Icon size={14} strokeWidth={2.6} /></span>;
}

function verdict(r, isEarn) {
  if (r.status === "unknown") return <span className="ss-na">Not stated</span>;
  if (!isEarn) return { yes: <span className="ss-yes">Earns</span>, no: <span className="ss-no">No points</span>, limited: <span className="ss-lim">Limited</span>, see: <span className="ss-lim">See terms</span> }[r.status];
  return <span className="ss-rate">
    {r.status === "best" && <span className="ss-chip acc">Best</span>}
    <b>Rp {rpn(r.rpm)}</b><small> per mile</small>
    {r.v?.fallback && <span className="ss-chip soft">Everyday rate</span>}
    {r.status === "check" && <span className="ss-chip warn">Needs check</span>}
  </span>;
}

function CardDetail({ r, isEarn, spendKey }) {
  const kr = r.kr; const v = r.v;
  const facts = [];
  if (r.c.bonus) facts.push([`Your ${r.c.bonus.nama}`, `${r.c.bonus.label_bank} (set ${r.c.bonus.diatur_pada || "by you"}). ${r.c.bonus.nama} rates follow this choice, not the catalog category.`]);
  if (isEarn && v) {
    if (v.fallback) facts.push(["Rate used", "No separate rate for this kind of spending in the source, so the everyday rate is shown."]);
    facts.push(["Conditions", cleanNote(v.catatan) || "None stated in the source"]);
    facts.push(["Rp 1.000.000 earns", `about ${Math.floor(1000000 / r.rpm).toLocaleString("id-ID")} miles`]);
    if (v.batas_bulanan) facts.push(["Monthly cap on this rate", v.batas_bulanan]);
    if (v.min_transaksi) facts.push(["Minimum", v.min_transaksi]);
    if (v.alt.length) facts.push(["Other source says", `Rp ${v.alt.map(rpn).join(", Rp ")} per mile`]);
  }
  if (!isEarn) {
    const q = kr.pengecualian_kutipan?.[spendKey];
    facts.push(["From the terms", q?.kutipan || (kr.kategori_dikecualikan ? `Catalog note: "${kr.kategori_dikecualikan}"` : "The catalog has nothing on this for this card yet.")]);
  }
  LIM_ROWS.forEach(([k, l, get]) => { const val = get(kr); if (val != null && val !== "") facts.push([l, k === "fee" ? feeText(val) : String(val)]); });
  const src = isEarn && v ? v.sumber_url : (kr.pengecualian_kutipan?.[spendKey]?.sumber_url || kr.sumber_url);
  const asof = isEarn && v ? v.per_tanggal : (kr.pengecualian_kutipan?.[spendKey]?.per_tanggal || kr.per_tanggal);
  return (
    <div className="ss-carddetail">
      <div className="ss-muted small">{kr.kartu}</div>
      <dl className="ss-facts">{facts.map(([k, val]) => <Fragment key={k}><dt>{k}</dt><dd>{val}</dd></Fragment>)}</dl>
      <div className="ss-src">{asof && <span>As of {asof}</span>}{src && <a href={src} target="_blank" rel="noopener noreferrer">{host(src)}</a>}</div>
    </div>
  );
}

function MatchPanel({ user, cards, kartu, mapByAccount, onSaved }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(cards.map(a => {
    const m = mapByAccount[a.id]; return [a.id, m ? (m.status === "not_in_catalog" ? "__none" : m.kartu_katalog) : ""];
  })));
  const [bonusDraft, setBonusDraft] = useState(() => Object.fromEntries(cards.map(a => [a.id, mapByAccount[a.id]?.pengaturan?.bonus_pilihan?.kategori || ""])));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const names = kartu.map(k => k.kartu).sort();
  const choiceFor = id => { const v = draft[id]; return v && v !== "__none" ? BONUS_CHOICES.find(d => d.match.test(v)) : null; };
  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const upserts = [], deletes = [];
      cards.forEach(a => {
        const v = draft[a.id];
        if (!v) { if (mapByAccount[a.id]) deletes.push(a.id); return; }
        // every object carries `pengaturan`: supabase-js upserts the union of keys,
        // so leaving it out on one row would wipe that card's saved settings.
        const def = choiceFor(a.id); const pick = bonusDraft[a.id];
        const prev = mapByAccount[a.id]?.pengaturan || {};
        let pengaturan = prev;
        if (def) {
          const opt = def.options.find(o => o[0] === pick);
          pengaturan = { ...prev, bonus_pilihan: opt ? { nama: def.nama, kategori: opt[0], label_bank: opt[1], diatur_pada: todayISO(), sumber: "Paulus" } : undefined };
          if (!opt) delete pengaturan.bonus_pilihan;
        }
        upserts.push({ user_id: user.id, account_id: a.id, status: v === "__none" ? "not_in_catalog" : "matched",
          kartu_katalog: v === "__none" ? null : v, pengaturan, updated_at: new Date().toISOString() });
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
        <thead><tr><th scope="col">Your card</th><th scope="col">Catalog product</th><th scope="col">Your bonus category</th></tr></thead>
        <tbody>{cards.map(a => (
          <tr key={a.id}><td><b>{a.name}</b></td><td>
            <select id={`ss-match-${a.id}`} aria-label={`Catalog product for ${a.name}`} value={draft[a.id]} onChange={e => setDraft(d => ({ ...d, [a.id]: e.target.value }))}>
              <option value="">Not matched yet</option>
              <option value="__none">Not in catalog</option>
              {names.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </td><td>{choiceFor(a.id) ? (
            <select id={`ss-bonus-${a.id}`} aria-label={`${choiceFor(a.id).nama} category for ${a.name}`} value={bonusDraft[a.id]} onChange={e => setBonusDraft(d => ({ ...d, [a.id]: e.target.value }))}>
              <option value="">Not set</option>
              {choiceFor(a.id).options.map(([k, l]) => <option key={k} value={k}>{choiceFor(a.id).nama}: {l}</option>)}
            </select>) : <span className="ss-muted small">None</span>}
          </td></tr>
        ))}</tbody>
      </table></div>
      <div className="ss-frow"><button className="ss-btn primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save matching"}</button>{msg && <span className="ss-muted">{msg}</span>}</div>
    </div>
  );
}

// What Telegram members report for e-money top-ups and paying through e-wallets.
// These are field reports, not bank terms: kept visually apart from the checklist.
function RouteReports({ topic, routes, cols }) {
  const [open, setOpen] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const catalogs = new Set(cols.map(c => c.catalog));
  const own = r => {
    const k = asList(r.kartu_katalog);
    if (k.length) return k.some(n => catalogs.has(n)) ? "yours" : "other";
    return /milik paulus/i.test(r.kartu_atau_bank || "") ? "yours" : /kandidat/i.test(r.kartu_atau_bank || "") ? "other" : "route";
  };
  const label = r => String(r.kartu_atau_bank || "").replace(/\s*-\s*(milik paulus|kandidat).*$/i, "").replace(/\s*\(kandidat\)/i, "");
  const rank = { yours: 0, route: 1, other: 2 };
  const all = routes.filter(r => r.topik === topic)
    .sort((a, b) => (rank[own(a)] - rank[own(b)]) || String(b.terakhir_dilaporkan || "").localeCompare(String(a.terakhir_dilaporkan || "")));
  if (!all.length) return null;
  const closed = all.filter(r => r.status_dugaan === "sudah_ditutup");
  return (
    <section className="ss-routes" aria-labelledby={`ss-routes-${topic}`}>
      <div>
        <h3 id={`ss-routes-${topic}`}>What members report</h3>
        <p className="ss-muted small">From Telegram miles groups, analysed by n8n. Not bank terms: points can be clawed back and routes close without notice. Test a small amount and check the statement first.</p>
      </div>
      {ROUTE_STATUS.map(([st, stLabel]) => {
        const rs = all.filter(r => r.status_dugaan === st);
        if (!rs.length || (st === "sudah_ditutup" && !showClosed)) return null;
        return (
          <div key={st} className="ss-routegroup">
            <div className="ss-label">{stLabel} · {rs.length}</div>
            <ul className="ss-cards">
              {rs.map(r => {
                const pts = ROUTE_POINTS[r.dapat_poin] || ["unknown", "No answer yet"]; const isOpen = open === r.kunci; const o = own(r);
                const evidence = asList(r.bukti).filter(b => b && typeof b === "object");
                return (
                  <li key={r.kunci} className="ss-cardrow">
                    <button type="button" className="ss-cardbtn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.kunci)}>
                      <Mark status={pts[0]} />
                      <span className="ss-cname">{label(r)}<small>{r.kanal}</small>
                        <span className="ss-routemeta">
                          {o === "yours" && <span className="ss-chip acc">Your card</span>}
                          {o === "other" && <span className="ss-chip soft">Not a card you hold</span>}
                          {r.bertentangan_dengan_resmi && <span className="ss-chip hot">Against bank terms</span>}
                          {r.keyakinan && <span className="ss-chip soft">{LEVEL[r.keyakinan] || r.keyakinan} confidence</span>}
                          {r.terakhir_dilaporkan && <span>Last report {fmtDate(r.terakhir_dilaporkan)}</span>}
                          {r.biaya_admin && <span>Fee: {r.biaya_admin}</span>}
                        </span>
                      </span>
                      <span className="ss-verdict"><span className={`ss-${{ yes: "yes", no: "no", limited: "lim", check: "lim", unknown: "na" }[pts[0]]}`}>{pts[1]}</span></span>
                      <ChevronDown size={16} className="ss-chev" aria-hidden="true" />
                    </button>
                    {isOpen && (
                      <div className="ss-carddetail">
                        {r.detail && <p className="ss-routep">{r.detail}</p>}
                        <dl className="ss-facts">
                          {r.catatan && <><dt>Bank terms</dt><dd>{r.catatan}</dd></>}
                          {r.jenis_transaksi && <><dt>Transaction</dt><dd>{r.jenis_transaksi.replace(/_/g, " ")}</dd></>}
                          {r.mcc_dilaporkan && <><dt>Shows up as</dt><dd>{r.mcc_dilaporkan}</dd></>}
                          <dt>Reports</dt><dd>{r.jumlah_laporan != null ? `${rpn(r.jumlah_laporan)} messages` : "Not counted"}{r.pertama_dilaporkan && `, first ${fmtDate(r.pertama_dilaporkan)}`}{r.terakhir_dilaporkan && `, last ${fmtDate(r.terakhir_dilaporkan)}`}</dd>
                        </dl>
                        {evidence.length > 0 && <Evidence items={evidence} />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {closed.length > 0 && <button type="button" className="ss-linkbtn" onClick={() => setShowClosed(s => !s)}>{showClosed ? "Hide closed routes" : `Show ${closed.length} closed ${closed.length === 1 ? "route" : "routes"}`}</button>}
    </section>
  );
}

function Evidence({ items }) {
  return (
    <div className="ss-evidence">
      <div className="ss-label">Messages quoted ({items.length})</div>
      <ul>
        {items.slice(0, 6).map((b, i) => (
          <li key={i}><span className="ss-muted">{b.tanggal ? fmtDate(String(b.tanggal).slice(0, 10)) : "Undated"}{b.grup ? ` · ${String(b.grup).split("(")[0].trim()}` : ""}</span>{b.kutipan && <q>{b.kutipan}</q>}</li>
        ))}
      </ul>
      {items.length > 6 && <div className="ss-muted small">{items.length - 6} more in n8n.</div>}
    </div>
  );
}

function TricksView({ tricks }) {
  const [status, setStatus] = useState("masih_berlaku");
  const [mineOnly, setMineOnly] = useState(true);
  const [open, setOpen] = useState(null);
  // closed tricks are listed as "already dead" whatever the relevance filter says
  const keep = t => !mineOnly || t.status_dugaan === "sudah_ditutup" || t.relevan_paulus !== "tidak";
  const count = st => tricks.filter(t => t.status_dugaan === st && keep(t)).length;
  const shown = tricks.filter(t => t.status_dugaan === status && keep(t))
    .sort((a, b) => (Number(b.skor_manfaat) || 0) - (Number(a.skor_manfaat) || 0));
  return (
    <section className="ss-view">
      <div className="ss-head"><div><h2>Tricks</h2><div className="ss-sub">Sweet spots and routes shared in Telegram miles groups over the last 12 months, ranked by how much they could save you. Member claims, not verified with the programmes.</div></div></div>
      <div className="ss-filterbar">
        <div className="ss-frow"><span className="ss-label" id="ss-trk-l">Status</span>
          <Seg labelledBy="ss-trk-l" items={ROUTE_STATUS.map(([v, l]) => [v, `${l} (${count(v)})`])} value={status} onChange={v => { setStatus(v); setOpen(null); }} /></div>
        <div className="ss-frow"><span className="ss-label">Also</span>
          <label className="ss-check"><input id="ss-trk-mine" type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} /> Only tricks that use cards or programmes you have</label></div>
      </div>
      {shown.length === 0 ? <div className="ss-empty">Nothing here with these filters.</div> : (
        <ol className="ss-cards">
          {shown.map(t => {
            const isOpen = open === t.kode; const steps = asList(t.langkah); const evidence = asList(t.bukti).filter(b => b && typeof b === "object");
            return (
              <li key={t.kode} className="ss-cardrow">
                <button type="button" className="ss-cardbtn ss-trickbtn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.kode)}>
                  <span className="ss-cname">{t.judul}
                    {t.manfaat_perkiraan && <span className="ss-gain">{t.manfaat_perkiraan}</span>}
                    <span className="ss-routemeta">
                      {t.kategori && <span className="ss-chip soft">{TRICK_CAT[t.kategori] || t.kategori.replace(/_/g, " ")}</span>}
                      {t.relevan_paulus === "ya" && <span className="ss-chip acc">Uses your cards</span>}
                      {t.relevan_paulus === "sebagian" && <span className="ss-chip soft">Partly relevant</span>}
                      {LEVEL[t.keyakinan] && <span className="ss-chip soft">{LEVEL[t.keyakinan]} confidence</span>}
                      {t.terakhir_dibahas && <span>Last discussed {fmtDate(String(t.terakhir_dibahas).slice(0, 10))}</span>}
                    </span>
                  </span>
                  <ChevronDown size={16} className="ss-chev" aria-hidden="true" />
                </button>
                {isOpen && (
                  <div className="ss-carddetail ss-trickdetail">
                    {t.ringkasan && <p className="ss-routep">{t.ringkasan}</p>}
                    {steps.length > 0 && <div><div className="ss-label">How</div><ol className="ss-steps">{steps.map((x, i) => <li key={i}>{typeof x === "string" ? x : JSON.stringify(x)}</li>)}</ol></div>}
                    <dl className="ss-facts">
                      {t.syarat && <><dt>You need</dt><dd>{t.syarat}</dd></>}
                      {t.risiko && <><dt>Risk</dt><dd>{t.risiko}</dd></>}
                      {t.alasan_relevansi && <><dt>Why it fits you</dt><dd>{t.alasan_relevansi}</dd></>}
                    </dl>
                    {evidence.length > 0 && <Evidence items={evidence} />}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
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
.ss-input{height:34px;min-width:min(280px,100%);border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:500 13px ${FF};padding:0 10px}
.ss-select{height:42px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:600 13px/1 ${FF};padding:0 10px}
.ss-linkbtn{all:unset;cursor:pointer;color:var(--accent-ink);font-weight:600;text-decoration:underline;text-underline-offset:2px}
.ss-callout{font-size:13px;color:var(--muted);background:var(--sunk);border-radius:10px;padding:10px 14px} .ss-callout b{color:var(--ink)}
.ss-empty{border:1px dashed var(--line);border-radius:14px;padding:20px;color:var(--muted);background:var(--surface)} .ss-empty b{color:var(--ink)}
.ss-rate{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap} .ss-rate b{font-weight:700;font-size:14.5px;font-variant-numeric:tabular-nums} .ss-rate small{font-size:12px;color:var(--muted)}
.ss-no{color:var(--hot);font-weight:700} .ss-lim{color:var(--warn);font-weight:700} .ss-yes{color:var(--good);font-weight:700} .ss-na{color:var(--faint)}
.ss-src{font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 14px}
.ss-facts{display:grid;grid-template-columns:minmax(120px,auto) 1fr;gap:6px 14px;font-size:13px;margin:0} .ss-facts dt{color:var(--muted)} .ss-facts dd{margin:0;overflow-wrap:anywhere}
.ss-cmpgrid{display:grid;grid-template-columns:220px minmax(0,1fr);gap:18px;align-items:start}
.ss-spendnav{display:flex;flex-direction:column;gap:14px;position:sticky;top:12px}
.ss-spendgroup{display:flex;flex-direction:column;gap:2px}
.ss-spendgroup .ss-label{padding:0 10px 4px}
.ss-spend{all:unset;box-sizing:border-box;display:flex;flex-direction:column;padding:8px 10px;border-radius:8px;cursor:pointer;font-weight:600;font-size:13.5px;color:var(--ink)}
.ss-spend small{font-weight:400;font-size:12px;color:var(--muted)}
.ss-spend:hover{background:var(--sunk)}
.ss-spend[aria-pressed="true"]{background:var(--accent-soft);color:var(--accent-ink);box-shadow:inset 3px 0 0 var(--accent)}
.ss-spend:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.ss-ranked{display:flex;flex-direction:column;gap:12px;min-width:0}
.ss-summary{font-size:14px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.ss-cards{list-style:none;margin:0;padding:0;background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.ss-cardrow{border-top:1px solid var(--line)} .ss-cardrow:first-child{border-top:0}
.ss-cardrow.st-best{background:var(--accent-soft)}
.ss-cardbtn{all:unset;box-sizing:border-box;width:100%;display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:12px 14px;cursor:pointer}
.ss-cardbtn:hover{background:rgba(59,91,219,.04)} .ss-cardbtn:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ss-cname{font-weight:600;display:flex;flex-direction:column;min-width:0} .ss-cname small{font-weight:500;font-size:12px;color:var(--faint)}
.ss-verdict{text-align:right}
.ss-bonus{color:var(--accent-ink)!important;font-weight:600!important}
.ss-caution{display:flex;gap:5px;align-items:flex-start;margin-top:3px;font-size:12px;font-weight:500;color:var(--warn);line-height:1.35}
.ss-caution svg{flex-shrink:0;margin-top:2px}
.ss-caution>span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ss-tips{display:flex;flex-direction:column;gap:6px}
.ss-tip{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.ss-tipbtn{all:unset;box-sizing:border-box;width:100%;display:flex;justify-content:space-between;gap:12px;padding:10px 14px;cursor:pointer;font-size:13px;flex-wrap:wrap}
.ss-tipbtn:hover{background:var(--sunk)} .ss-tipbtn:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ss-tipchips{display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap}
.ss-tipdetail{padding:0 14px 12px}
.ss-chev{color:var(--faint);transition:transform .15s} .ss-cardbtn[aria-expanded="true"] .ss-chev{transform:rotate(180deg)}
.ss-mark{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;flex-shrink:0}
.ss-mark.yes{background:#dcf5ea;color:var(--good)} .ss-mark.no{background:var(--hot-soft);color:var(--hot)}
.ss-mark.lim{background:var(--warn-soft);color:var(--warn)} .ss-mark.na{background:var(--sunk);color:var(--faint)}
.ss-carddetail{padding:0 14px 14px 50px;display:flex;flex-direction:column;gap:8px}
@media (max-width:760px){
  .ss-cmpgrid{grid-template-columns:1fr}
  .ss-spendnav{position:static;flex-direction:row;flex-wrap:wrap;gap:10px}
  .ss-spendgroup{flex-direction:row;flex-wrap:wrap;gap:6px;align-items:center}
  .ss-spendgroup .ss-label{width:100%;padding:0}
  .ss-spend{flex-direction:row;padding:6px 10px;border:1px solid var(--line);font-size:13px}
  .ss-spend small{display:none}
  .ss-spend[aria-pressed="true"]{box-shadow:none;border-color:var(--accent)}
  .ss-carddetail{padding-left:14px}
  .ss-facts{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){.ss-chev{transition:none}}
.ss-routes{display:flex;flex-direction:column;gap:10px;margin-top:6px;padding-top:14px;border-top:1px dashed var(--line)}
.ss-routes h3{font-size:15px;font-weight:700} .ss-routes p{margin:2px 0 0;max-width:70ch}
.ss-routegroup{display:flex;flex-direction:column;gap:6px}
.ss-routemeta{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;margin-top:5px;font-size:12px;font-weight:500;color:var(--muted)}
.ss-routep{margin:0;font-size:13px;max-width:75ch}
.ss-evidence{display:flex;flex-direction:column;gap:4px} .ss-evidence ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px;font-size:12.5px}
.ss-evidence q{display:block;color:var(--ink)}
.ss-trickbtn{grid-template-columns:minmax(0,1fr) auto}
.ss-gain{font-weight:500;font-size:13px;color:var(--good);margin-top:3px}
.ss-trickdetail{padding-left:14px}
.ss-steps{margin:4px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:3px;font-size:13px}
.ss-legend{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:12.5px;color:var(--muted)} .ss-legend span{display:inline-flex;gap:8px;align-items:center}
.ss-sw{display:inline-block;width:14px;height:14px;border-radius:4px;background:var(--accent-soft);border:1px solid var(--accent)}
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

@media (max-width:560px){.ss-promo{grid-template-columns:1fr;gap:6px}.ss-when{flex-direction:row;gap:8px;align-items:baseline}.ss-ratebig .big{font-size:32px}}
`;
