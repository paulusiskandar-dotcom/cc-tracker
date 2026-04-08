import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "./lib/supabase";
import { getTheme } from "./theme";
import { TABS, CURRENCIES, APP_VERSION, APP_BUILD } from "./constants";
import { accountsApi, ledgerApi, categoriesApi, incomeSrcApi, installmentsApi,
         recurringApi, merchantApi, fxApi, settingsApi, gmailApi, fmtIDR, todayStr, ym } from "./api";
import { injectBaseCSS, calcNetWorth, Spinner, showToast } from "./components/shared";
import Dashboard    from "./components/Dashboard";
import Transactions from "./components/Transactions";
import Accounts     from "./components/Accounts";
import CreditCards  from "./components/CreditCards";
import Assets       from "./components/Assets";
import Receivables  from "./components/Receivables";
import Income       from "./components/Income";
import Reports      from "./components/Reports";
import Settings     from "./components/Settings";

injectBaseCSS();

// ─── AUTH GATE ────────────────────────────────────────────────
function AuthGate({ children }) {
  const [user, setUser]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode]   = useState("login");
  const [email, setEmail] = useState("");
  const [pass, setPass]   = useState("");
  const [err, setErr]     = useState("");
  const [busy, setBusy]   = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { setUser(data.user); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setUser(s?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password: pass });
        if (error) throw error;
        setErr("Check your email to confirm."); setMode("login"); setBusy(false); return;
      }
    } catch (e) { setErr(e.message || "Error"); }
    setBusy(false);
  };

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#f8f9fb", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <Spinner size={32} color="#3b5bdb"/>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight:"100vh", background:"#f8f9fb", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:16, padding:"32px 28px", width:"100%", maxWidth:360, boxShadow:"0 4px 12px rgba(0,0,0,.08)" }}>
        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:24 }}>
          <div style={{ width:36, height:36, background:"#3b5bdb", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, color:"#fff", fontWeight:800 }}>P</div>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:"#111827" }}>Paulus Finance</div>
            <div style={{ fontSize:11, color:"#9ca3af" }}>Personal Financial OS</div>
          </div>
        </div>
        {/* Mode toggle */}
        <div style={{ display:"flex", background:"#f3f4f6", borderRadius:8, padding:3, marginBottom:16 }}>
          {["login","signup"].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex:1, border:"none", padding:"7px", borderRadius:6,
              fontFamily:"'Sora',sans-serif", fontWeight:600, fontSize:12, cursor:"pointer",
              background:mode===m?"#fff":"transparent", color:mode===m?"#3b5bdb":"#6b7280",
              boxShadow:mode===m?"0 1px 3px rgba(0,0,0,.08)":"none", transition:"all .15s",
            }}>{m === "login" ? "Sign In" : "Sign Up"}</button>
          ))}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
          <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&submit()}
            style={{ border:"1px solid #e5e7eb", borderRadius:8, padding:"10px 12px", fontFamily:"'Sora',sans-serif", fontSize:14, outline:"none", color:"#111827", background:"#fff", height:40 }}/>
          <input type="password" placeholder="Password" value={pass} onChange={e=>setPass(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&submit()}
            style={{ border:"1px solid #e5e7eb", borderRadius:8, padding:"10px 12px", fontFamily:"'Sora',sans-serif", fontSize:14, outline:"none", color:"#111827", background:"#fff", height:40 }}/>
        </div>
        {err && <div style={{ fontSize:12, color:err.startsWith("Check")?"#059669":"#dc2626", marginBottom:12, padding:"8px 12px", background:err.startsWith("Check")?"#ecfdf5":"#fef2f2", borderRadius:8 }}>{err}</div>}
        <button onClick={submit} disabled={busy} style={{ width:"100%", background:"#3b5bdb", color:"#fff", border:"none", height:40, borderRadius:8, fontFamily:"'Sora',sans-serif", fontWeight:600, fontSize:14, cursor:"pointer", opacity:busy?.6:1, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
          {busy ? <><Spinner size={13} color="#fff"/>Loading…</> : mode==="login" ? "Sign In" : "Create Account"}
        </button>
        <div style={{ fontSize:11, color:"#9ca3af", marginTop:16, textAlign:"center" }}>Secured by Supabase</div>
      </div>
    </div>
  );
  return children({ user, signOut: () => supabase.auth.signOut() });
}

// ─── MAIN APP ─────────────────────────────────────────────────
export default function App() {
  return <AuthGate>{({ user, signOut }) => <Finance user={user} signOut={signOut}/>}</AuthGate>;
}

// ─── TABS CONFIG ──────────────────────────────────────────────
const SIDEBAR_TABS = [
  { id:"dashboard",    icon:"⌂",  label:"Dashboard" },
  { id:"transactions", icon:"↕",  label:"Transactions" },
  { id:"accounts",     icon:"◫",  label:"Accounts" },
  { id:"cards",        icon:"▭",  label:"Credit Cards" },
  { id:"assets",       icon:"◈",  label:"Assets" },
  { id:"receivables",  icon:"◎",  label:"Receivables" },
  { id:"income",       icon:"↓",  label:"Income" },
  { id:"reports",      icon:"◻",  label:"Reports" },
  { id:"settings",     icon:"◑",  label:"Settings" },
];

const MOBILE_MAIN = ["dashboard","transactions","accounts","assets"];
const MOBILE_MORE = [
  { id:"cards",       label:"Credit Cards" },
  { id:"receivables", label:"Receivables" },
  { id:"income",      label:"Income" },
  { id:"reports",     label:"Reports" },
  { id:"settings",    label:"Settings" },
];

function Finance({ user, signOut }) {
  const [isDark, setIsDark]   = useState(false);
  const [tab, setTab]         = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [showMore, setShowMore] = useState(false);

  const [accounts, setAccounts]   = useState([]);
  const [ledger, setLedger]       = useState([]);
  const [categories, setCategories] = useState([]);
  const [incomeSrcs, setIncomeSrcs] = useState([]);
  const [installments, setInstallments] = useState([]);
  const [recurTemplates, setRecurTemplates] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [merchantMaps, setMerchantMaps] = useState([]);
  const [fxRates, setFxRates]     = useState({ USD:16400, SGD:12200, MYR:3700, JPY:110, EUR:17800, AUD:10500 });
  const [pendingSyncs, setPendingSyncs] = useState([]);

  const th = getTheme(isDark);
  const curMonth = ym(todayStr());

  const loadData = useCallback(async () => {
    try {
      const [acc, led, cats, inc, inst, rtempl, rem, merch, fx, dark, pending] = await Promise.all([
        accountsApi.getAll(user.id),
        ledgerApi.getAll(user.id, { limit: 500 }),
        categoriesApi.getAll(user.id),
        incomeSrcApi.getAll(user.id),
        installmentsApi.getAll(user.id),
        recurringApi.getTemplates(user.id),
        recurringApi.getReminders(user.id),
        merchantApi.getMappings(user.id),
        fxApi.getAll(user.id),
        settingsApi.get(user.id, "isDark", false),
        gmailApi.getPending(user.id).catch(() => []),
      ]);
      setAccounts(acc); setLedger(led); setCategories(cats);
      setIncomeSrcs(inc); setInstallments(inst); setRecurTemplates(rtempl);
      setReminders(rem); setMerchantMaps(merch);
      if (Object.keys(fx).length) setFxRates(fx);
      setIsDark(dark); setPendingSyncs(pending);
    } catch (e) { console.error("[loadData]", e); }
    setLoading(false);
  }, [user.id]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { settingsApi.set(user.id, "isDark", isDark); }, [isDark, user.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailStatus = params.get("gmail");
    if (!gmailStatus) return;
    if (gmailStatus === "connected") { showToast("Gmail connected!", "success"); loadData(); }
    else if (gmailStatus === "error") { showToast(`Gmail error: ${params.get("reason")||"Unknown"}`, "error"); }
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const bankAccounts  = useMemo(() => accounts.filter(a => a.type === "bank"), [accounts]);
  const creditCards   = useMemo(() => accounts.filter(a => a.type === "credit_card"), [accounts]);
  const assets        = useMemo(() => accounts.filter(a => a.type === "asset"), [accounts]);
  const liabilities   = useMemo(() => accounts.filter(a => a.type === "liability"), [accounts]);
  const receivables   = useMemo(() => accounts.filter(a => a.type === "receivable"), [accounts]);
  const netWorth      = useMemo(() => calcNetWorth(accounts), [accounts]);
  const thisMonthLedger = useMemo(() => ledger.filter(e => ym(e.date) === curMonth), [ledger, curMonth]);

  const shared = {
    th, user, accounts, ledger, thisMonthLedger, categories, incomeSrcs, installments,
    recurTemplates, reminders, merchantMaps, fxRates, CURRENCIES, netWorth,
    bankAccounts, creditCards, assets, liabilities, receivables, curMonth,
    pendingSyncs, setPendingSyncs, setTab,
    onRefresh: loadData,
    setAccounts, setLedger, setCategories, setIncomeSrcs, setInstallments,
    setRecurTemplates, setReminders, setMerchantMaps, setFxRates,
  };

  if (loading) return (
    <div style={{ minHeight:"100vh", background:th.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <Spinner size={32} color={th.ac}/>
    </div>
  );

  const renderModule = () => {
    switch (tab) {
      case "dashboard":    return <Dashboard    {...shared}/>;
      case "transactions": return <Transactions {...shared}/>;
      case "accounts":     return <Accounts     {...shared}/>;
      case "cards":        return <CreditCards  {...shared}/>;
      case "assets":       return <Assets       {...shared}/>;
      case "receivables":  return <Receivables  {...shared}/>;
      case "income":       return <Income       {...shared}/>;
      case "reports":      return <Reports      {...shared}/>;
      case "settings":     return <Settings     {...shared} isDark={isDark} setIsDark={setIsDark} signOut={signOut}/>;
      default:             return <Dashboard    {...shared}/>;
    }
  };

  const pageTitle = SIDEBAR_TABS.find(t => t.id === tab)?.label || "Dashboard";
  const nwColor   = netWorth.total >= 0 ? th.gr : th.rd;

  return (
    <div style={{ display:"flex", minHeight:"100vh", background:th.bg }}>

      {/* ── SIDEBAR (desktop only) ── */}
      <aside className="desktop-sidebar" style={{
        width:200, flexShrink:0, background:th.sur,
        borderRight:`1px solid ${th.bor}`,
        flexDirection:"column", padding:"16px 0",
        position:"sticky", top:0, height:"100vh", overflowY:"auto",
      }}>
        {/* Logo */}
        <div style={{ padding:"0 16px 16px", borderBottom:`1px solid ${th.bor}`, marginBottom:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:9 }}>
            <div style={{ width:30, height:30, background:th.ac, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:800, fontSize:14 }}>P</div>
            <div style={{ fontSize:13, fontWeight:700, color:th.tx }}>Paulus Finance</div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex:1, padding:"0 8px", display:"flex", flexDirection:"column", gap:1 }}>
          {SIDEBAR_TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`nav-item${tab===t.id?" active":""}`}
              style={{ color: tab===t.id ? th.ac : th.tx2, background: tab===t.id ? th.acBg : "transparent" }}>
              <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0 }}>{t.icon}</span>
              <span>{t.label}</span>
              {t.id==="reminders"&&reminders.length>0 && (
                <span style={{ marginLeft:"auto", background:th.rd, color:"#fff", borderRadius:999, fontSize:9, fontWeight:700, padding:"1px 5px" }}>{reminders.length}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Bottom: net worth + sign out */}
        <div style={{ padding:"12px 16px 0", borderTop:`1px solid ${th.bor}`, marginTop:8 }}>
          <div style={{ fontSize:10, fontWeight:600, color:th.tx3, textTransform:"uppercase", letterSpacing:.5, marginBottom:2 }}>Net Worth</div>
          <div className="num" style={{ fontSize:16, fontWeight:800, color:nwColor, marginBottom:10 }}>{fmtIDR(netWorth.total,true)}</div>
          <button onClick={signOut} style={{ width:"100%", border:`1px solid ${th.bor}`, borderRadius:7, padding:"6px", background:"none", color:th.tx3, fontFamily:"'Sora',sans-serif", fontSize:11, fontWeight:600, cursor:"pointer" }}>Sign out</button>
          <div style={{ marginTop:8, fontSize:10, color:th.tx3, opacity:.6 }}>v{APP_VERSION} · {APP_BUILD}</div>
        </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column" }}>

        {/* Top header */}
        <header style={{
          height:56, flexShrink:0, background:th.sur, borderBottom:`1px solid ${th.bor}`,
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"0 24px", position:"sticky", top:0, zIndex:100,
        }}>
          {/* Mobile: logo; Desktop: page title */}
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div className="mobile-header-logo" style={{ width:28, height:28, background:th.ac, borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:800, fontSize:13 }}>P</div>
            <div style={{ fontSize:16, fontWeight:700, color:th.tx }}>{pageTitle}</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            {/* Net worth on mobile header */}
            <div className="mobile-header-logo" style={{ display:"flex", alignItems:"baseline", gap:4 }}>
              <span style={{ fontSize:10, color:th.tx3 }}>NW</span>
              <span className="num" style={{ fontSize:13, fontWeight:700, color:nwColor }}>{fmtIDR(netWorth.total,true)}</span>
            </div>
            <button onClick={() => setIsDark(d => !d)} style={{ background:"none", border:`1px solid ${th.bor}`, borderRadius:6, padding:"5px 8px", cursor:"pointer", fontSize:13, color:th.tx3 }}>
              {isDark ? "☀" : "◑"}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex:1, padding:"24px", maxWidth:840, width:"100%", margin:"0 auto", paddingBottom:80 }} className="fade-up">
          {renderModule()}
        </main>
      </div>

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav className="mobile-nav" style={{
        position:"fixed", bottom:0, left:0, right:0, zIndex:200,
        background:th.sur, borderTop:`1px solid ${th.bor}`,
        paddingBottom:"env(safe-area-inset-bottom)",
        alignItems:"stretch",
      }}>
        {MOBILE_MAIN.map(id => {
          const t = SIDEBAR_TABS.find(s => s.id === id);
          const active = tab === id;
          return (
            <button key={id} onClick={() => { setTab(id); setShowMore(false); }} style={{
              flex:1, border:"none", background:"none", cursor:"pointer",
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              gap:3, padding:"8px 4px", color:active?th.ac:th.tx3, transition:"color .15s",
            }}>
              <span style={{ fontSize:18 }}>{t?.icon}</span>
              <span style={{ fontSize:9, fontWeight:600 }}>{t?.label}</span>
            </button>
          );
        })}
        {/* More button */}
        <button onClick={() => setShowMore(s => !s)} style={{
          flex:1, border:"none", background:"none", cursor:"pointer",
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          gap:3, padding:"8px 4px", color:showMore?th.ac:th.tx3, transition:"color .15s",
        }}>
          <span style={{ fontSize:18 }}>···</span>
          <span style={{ fontSize:9, fontWeight:600 }}>More</span>
        </button>
      </nav>

      {/* ── MORE DRAWER (mobile) ── */}
      {showMore && <>
        <div onClick={() => setShowMore(false)} style={{ position:"fixed", inset:0, zIndex:195, background:"rgba(0,0,0,.3)" }}/>
        <div style={{
          position:"fixed", bottom:"calc(56px + env(safe-area-inset-bottom))", left:0, right:0, zIndex:196,
          background:th.sur, borderTop:`1px solid ${th.bor}`, borderRadius:"12px 12px 0 0",
          padding:"12px 16px 16px", animation:"fadeUp .15s ease",
        }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8 }}>
            {MOBILE_MORE.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setShowMore(false); }} style={{
                border:`1px solid ${tab===t.id?th.ac:th.bor}`, borderRadius:10, padding:"12px 8px",
                background:tab===t.id?th.acBg:th.sur, color:tab===t.id?th.ac:th.tx2,
                cursor:"pointer", fontFamily:"'Sora',sans-serif", fontWeight:600, fontSize:12,
              }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </>}
    </div>
  );
}
