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
        setErr("✅ Check your email to confirm."); setMode("login"); setBusy(false); return;
      }
    } catch (e) { setErr(e.message || "Error"); }
    setBusy(false);
  };

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#f5f6fa", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <Spinner size={36} color="#3b5bdb"/>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight:"100vh", background:"#f5f6fa", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:"#fff", border:"1px solid #e2e4ed", borderRadius:20, padding:"36px 32px", width:"100%", maxWidth:380, textAlign:"center", boxShadow:"0 4px 24px rgba(0,0,0,.08)" }}>
        <div style={{ width:52, height:52, background:"linear-gradient(135deg,#3b5bdb,#7048e8)", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, margin:"0 auto 16px" }}>💎</div>
        <div style={{ fontSize:22, fontWeight:800, color:"#0f1117", marginBottom:4, letterSpacing:"-.3px" }}>Paulus Finance</div>
        <div style={{ fontSize:12, color:"#8a90aa", marginBottom:24 }}>Personal Financial OS</div>
        <div style={{ display:"flex", background:"#f0f1f7", borderRadius:10, padding:3, marginBottom:18 }}>
          {["login","signup"].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex:1, border:"none", padding:"8px", borderRadius:8,
              fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:12, cursor:"pointer",
              background:mode===m?"#fff":"transparent", color:mode===m?"#3b5bdb":"#8a90aa",
              boxShadow:mode===m?"0 1px 4px rgba(0,0,0,.08)":"none", transition:"all .15s",
            }}>{m === "login" ? "Sign In" : "Sign Up"}</button>
          ))}
        </div>
        <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}
          style={{ width:"100%", border:"1.5px solid #e2e4ed", borderRadius:10, padding:"10px 13px", fontFamily:"'Sora',sans-serif", fontSize:13, outline:"none", marginBottom:10, color:"#0f1117", background:"#f5f6fa" }}/>
        <input type="password" placeholder="Password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}
          style={{ width:"100%", border:"1.5px solid #e2e4ed", borderRadius:10, padding:"10px 13px", fontFamily:"'Sora',sans-serif", fontSize:13, outline:"none", marginBottom:err?10:0, color:"#0f1117", background:"#f5f6fa" }}/>
        {err && <div style={{ fontSize:12, color:err.startsWith("✅")?"#0ca678":"#e03131", marginBottom:12, padding:"8px 12px", background:err.startsWith("✅")?"#e6fcf5":"#fff5f5", border:`1px solid ${err.startsWith("✅")?"#b2f2e8":"#ffc9c9"}`, borderRadius:8, textAlign:"left" }}>{err}</div>}
        <button onClick={submit} disabled={busy} style={{ width:"100%", background:"linear-gradient(135deg,#3b5bdb,#7048e8)", color:"white", border:"none", padding:"11px", borderRadius:10, fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:14, cursor:"pointer", marginTop:12, opacity:busy?.7:1, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
          {busy ? <><Spinner size={14} color="#fff"/>Signing in…</> : mode==="login" ? "Sign In" : "Create Account"}
        </button>
        <div style={{ fontSize:11, color:"#8a90aa", marginTop:16 }}>Data secured · Supabase encrypted</div>
      </div>
    </div>
  );
  return children({ user, signOut: () => supabase.auth.signOut() });
}

// ─── MAIN APP ─────────────────────────────────────────────────
export default function App() {
  return <AuthGate>{({ user, signOut }) => <Finance user={user} signOut={signOut}/>}</AuthGate>;
}

function Finance({ user, signOut }) {
  const [isDark, setIsDark]   = useState(false);
  const [tab, setTab]         = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [showMore, setShowMore] = useState(false); // mobile "More" menu

  // ── Core data
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

  // ── Load all data
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
      setAccounts(acc);
      setLedger(led);
      setCategories(cats);
      setIncomeSrcs(inc);
      setInstallments(inst);
      setRecurTemplates(rtempl);
      setReminders(rem);
      setMerchantMaps(merch);
      if (Object.keys(fx).length) setFxRates(fx);
      setIsDark(dark);
      setPendingSyncs(pending);
    } catch (e) {
      console.error("[loadData]", e);
    }
    setLoading(false);
  }, [user.id]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { settingsApi.set(user.id, "isDark", isDark); }, [isDark, user.id]);

  // Handle Gmail OAuth redirect (?gmail=connected | ?gmail=error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailStatus = params.get("gmail");
    if (!gmailStatus) return;
    if (gmailStatus === "connected") {
      showToast("Gmail connected successfully!", "success");
      loadData(); // reload to pick up new gmail_tokens row
    } else if (gmailStatus === "error") {
      const reason = params.get("reason") || params.get("message") || "Unknown error";
      showToast(`Gmail connection failed: ${reason}`, "error");
    }
    // Clear URL params without reloading
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // ── Derived data (shared across modules)
  const bankAccounts  = useMemo(() => accounts.filter(a => a.type === "bank"), [accounts]);
  const creditCards   = useMemo(() => accounts.filter(a => a.type === "credit_card"), [accounts]);
  const assets        = useMemo(() => accounts.filter(a => a.type === "asset"), [accounts]);
  const liabilities   = useMemo(() => accounts.filter(a => a.type === "liability"), [accounts]);
  const receivables   = useMemo(() => accounts.filter(a => a.type === "receivable"), [accounts]);
  const netWorth      = useMemo(() => calcNetWorth(accounts), [accounts]);

  const thisMonthLedger = useMemo(() =>
    ledger.filter(e => ym(e.date) === curMonth), [ledger, curMonth]);

  // Props bundle shared across all modules
  const shared = {
    th, user, accounts, ledger, thisMonthLedger, categories, incomeSrcs, installments,
    recurTemplates, reminders, merchantMaps, fxRates, CURRENCIES, netWorth,
    bankAccounts, creditCards, assets, liabilities, receivables, curMonth,
    pendingSyncs, setPendingSyncs, setTab,
    onRefresh: loadData,
    setAccounts, setLedger, setCategories, setIncomeSrcs, setInstallments,
    setRecurTemplates, setReminders, setMerchantMaps, setFxRates,
  };

  const NAV_TABS = TABS;
  const MOBILE_NAV = [
    { id:"dashboard",    icon:"◈",  label:"Home" },
    { id:"transactions", icon:"🔄", label:"Txns" },
    { id:"accounts",     icon:"🏦", label:"Accounts" },
    { id:"assets",       icon:"📈", label:"Assets" },
    { id:"more",         icon:"⋯",  label:"More" },
  ];

  if (loading) return (
    <div style={{ minHeight:"100vh", background:th.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ textAlign:"center" }}>
        <Spinner size={40} color={th.ac}/>
        <div style={{ marginTop:12, fontSize:13, color:th.tx3 }}>Loading your finances…</div>
      </div>
    </div>
  );

  const renderModule = () => {
    const props = shared;
    switch (tab) {
      case "dashboard":    return <Dashboard    {...props}/>;
      case "transactions": return <Transactions {...props}/>;
      case "accounts":     return <Accounts     {...props}/>;
      case "cards":        return <CreditCards  {...props}/>;
      case "assets":       return <Assets       {...props}/>;
      case "receivables":  return <Receivables  {...props}/>;
      case "income":       return <Income       {...props}/>;
      case "reports":      return <Reports      {...props}/>;
      case "settings":     return <Settings     {...props} isDark={isDark} setIsDark={setIsDark} signOut={signOut}/>;
      default:             return <Dashboard    {...props}/>;
    }
  };

  return (
    <div style={{ display:"flex", minHeight:"100vh", background:th.bg, fontFamily:"'Sora',system-ui,sans-serif" }}>

      {/* ── DESKTOP SIDEBAR ── */}
      <aside style={{
        width:220, flexShrink:0, background:th.nav, borderRight:`1px solid ${th.bor}`,
        display:"flex", flexDirection:"column", padding:"20px 0",
        position:"sticky", top:0, height:"100vh",
        // Hide on mobile
        "@media(max-width:768px)":{display:"none"},
      }} className="desktop-sidebar">
        {/* Logo */}
        <div style={{ padding:"0 20px 20px", borderBottom:`1px solid ${th.bor}`, marginBottom:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:34, height:34, background:"linear-gradient(135deg,#3b5bdb,#7048e8)", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>💎</div>
            <div>
              <div style={{ fontSize:13, fontWeight:800, color:th.tx, letterSpacing:"-.3px" }}>Paulus Finance</div>
              <div style={{ fontSize:10, color:th.tx3 }}>Financial OS</div>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav style={{ flex:1, padding:"0 8px", display:"flex", flexDirection:"column", gap:2 }}>
          {NAV_TABS.map(t => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                display:"flex", alignItems:"center", gap:10, padding:"9px 12px",
                border:"none", borderRadius:9, cursor:"pointer",
                background:active ? th.acBg : "transparent",
                color:active ? th.ac : th.tx2,
                fontFamily:"'Sora',sans-serif", fontWeight:active?700:500, fontSize:13,
                transition:"all .15s", width:"100%", textAlign:"left",
              }}>
                <span style={{ fontSize:16, width:20, textAlign:"center" }}>{t.icon}</span>
                {t.label}
                {t.id==="reminders"&&reminders.length>0&&<span style={{ marginLeft:"auto", background:th.rd, color:"#fff", borderRadius:999, fontSize:9, fontWeight:800, padding:"1px 6px" }}>{reminders.length}</span>}
              </button>
            );
          })}
        </nav>

        {/* User + net worth */}
        <div style={{ padding:"12px 12px 0", borderTop:`1px solid ${th.bor}`, marginTop:8 }}>
          <div style={{ fontSize:10, color:th.tx3, fontWeight:600, marginBottom:4 }}>NET WORTH</div>
          <div className="num" style={{ fontSize:16, fontWeight:800, color:netWorth.total>=0?th.gr:th.rd }}>{fmtIDR(netWorth.total,true)}</div>
          <button onClick={signOut} style={{ marginTop:10, width:"100%", border:`1px solid ${th.bor}`, borderRadius:8, padding:"7px", background:"none", color:th.tx3, fontFamily:"'Sora',sans-serif", fontSize:11, fontWeight:600, cursor:"pointer" }}>Sign Out</button>
          <div style={{ marginTop:10, paddingTop:8, borderTop:`1px solid ${th.bor}2` }}>
            <div style={{ fontSize:10, fontWeight:700, color:th.tx3 }}>Paulus Finance v{APP_VERSION}</div>
            <div style={{ fontSize:9, color:th.tx3, opacity:.6, marginTop:1 }}>Build {APP_BUILD}</div>
          </div>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main style={{ flex:1, minWidth:0, paddingBottom:72, overflowX:"hidden" }}>
        {/* Mobile header */}
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"12px 16px", background:th.nav, borderBottom:`1px solid ${th.bor}`,
          position:"sticky", top:0, zIndex:100,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:28, height:28, background:"linear-gradient(135deg,#3b5bdb,#7048e8)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>💎</div>
            <div style={{ fontSize:14, fontWeight:800, color:th.tx }}>
              {NAV_TABS.find(t=>t.id===tab)?.label || "Dashboard"}
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div className="num" style={{ fontSize:12, fontWeight:800, color:netWorth.total>=0?th.gr:th.rd }}>{fmtIDR(netWorth.total,true)}</div>
            <button onClick={()=>setIsDark(d=>!d)} style={{ background:th.sur2, border:`1px solid ${th.bor}`, borderRadius:8, padding:"5px 8px", cursor:"pointer", fontSize:14 }}>
              {isDark ? "☀️" : "🌙"}
            </button>
          </div>
        </div>

        {/* Module content */}
        <div style={{ padding:"16px", maxWidth:900, margin:"0 auto" }} className="fade-up">
          {renderModule()}
        </div>
      </main>

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav style={{
        position:"fixed", bottom:0, left:0, right:0,
        background:th.nav, borderTop:`1px solid ${th.bor}`,
        display:"flex", padding:"8px 0 env(safe-area-inset-bottom)",
        zIndex:200,
      }}>
        {MOBILE_NAV.map(t => {
          const isMore = t.id === "more";
          const active = isMore ? showMore : tab === t.id;
          return (
            <button key={t.id} onClick={() => {
              if (isMore) setShowMore(s => !s);
              else { setTab(t.id); setShowMore(false); }
            }} style={{
              flex:1, border:"none", background:"none", cursor:"pointer",
              display:"flex", flexDirection:"column", alignItems:"center", gap:2,
              padding:"4px 0", color:active?th.ac:th.tx3, transition:"color .15s",
            }}>
              <span style={{ fontSize:20 }}>{t.icon}</span>
              <span style={{ fontSize:9, fontWeight:700 }}>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── MOBILE "MORE" DRAWER ── */}
      {showMore && (
        <div style={{ position:"fixed", bottom:65, left:0, right:0, background:th.sur, borderTop:`1px solid ${th.bor}`, borderRadius:"16px 16px 0 0", padding:"12px 16px", zIndex:190, boxShadow:th.sh2, animation:"fadeUp .15s ease" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
            {[
              { id:"cards",       icon:"💳", label:"Credit Cards" },
              { id:"receivables", icon:"📋", label:"Receivables" },
              { id:"income",      icon:"💰", label:"Income" },
              { id:"reports",     icon:"📊", label:"Reports" },
              { id:"settings",    icon:"⚙️", label:"Settings" },
            ].map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setShowMore(false); }} style={{
                border:`1px solid ${th.bor}`, borderRadius:10, padding:"12px 8px",
                background:tab===t.id?th.acBg:th.sur2, color:tab===t.id?th.ac:th.tx2,
                cursor:"pointer", fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:11,
                display:"flex", flexDirection:"column", alignItems:"center", gap:5,
              }}>
                <span style={{ fontSize:22 }}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
          {/* Sidebar nav for desktop - CSS classes won't work inline, use data- approach */}
          <style>{`
            @media(min-width:769px){
              .desktop-sidebar{display:flex!important}
              nav[style*="position:fixed"][style*="bottom:0"]{display:none!important}
            }
            @media(max-width:768px){
              .desktop-sidebar{display:none!important}
            }
          `}</style>
        </div>
      )}
      <style>{`
        @media(min-width:769px){
          .desktop-sidebar{display:flex!important}
          nav[data-mobile-nav]{display:none!important}
        }
        @media(max-width:768px){
          .desktop-sidebar{display:none!important}
        }
      `}</style>
    </div>
  );
}
