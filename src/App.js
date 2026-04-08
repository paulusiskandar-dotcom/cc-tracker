import { useState, useEffect, useMemo, useCallback } from "react";
import PILogo from "./components/PILogo";
import { supabase } from "./lib/supabase";
import { TABS, MOBILE_MAIN_TABS, MOBILE_MORE_TABS, CURRENCIES, APP_VERSION, APP_BUILD } from "./constants";
import {
  accountsApi, ledgerApi, categoriesApi, incomeSrcApi,
  installmentsApi, recurringApi, merchantApi, fxApi,
  settingsApi, gmailApi, employeeLoanApi, loanPaymentsApi,
} from "./api";
import { calcNetWorth, fmtIDR, todayStr, ym } from "./utils";
import { Spinner, ToastContainer, showToast } from "./components/shared/index";

import Dashboard    from "./components/Dashboard";
import Transactions from "./components/Transactions";
import Accounts     from "./components/Accounts";
import CreditCards  from "./components/CreditCards";
import Assets       from "./components/Assets";
import Receivables  from "./components/Receivables";
import Income       from "./components/Income";
import Reports      from "./components/Reports";
import Settings     from "./components/Settings";
import AIImport     from "./components/AIImport";

// ─── AUTH GATE ────────────────────────────────────────────────
function AuthGate({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode]       = useState("login");
  const [email, setEmail]     = useState("");
  const [pass, setPass]       = useState("");
  const [err, setErr]         = useState("");
  const [busy, setBusy]       = useState(false);
  const [focused, setFocused] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const submit = async () => {
    if (!email || !pass) { setErr("Email and password required."); return; }
    setErr(""); setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password: pass });
        if (error) throw error;
        setErr("✓ Check your email to confirm your account.");
        setMode("login");
        setBusy(false);
        return;
      }
    } catch (e) {
      setErr(e.message || "Authentication failed.");
    }
    setBusy(false);
  };

  if (loading) return (
    <div style={S.loadScreen}>
      <Spinner size={32} color="#3b5bdb" />
    </div>
  );

  if (!user) return (
    <div style={S.authScreen}>
      <div style={S.authCard}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <div style={S.logoIcon}><PILogo size={18} white /></div>
          <div>
            <div style={S.logoName}>Paulus Finance</div>
            <div style={S.logoSub}>Personal Financial OS</div>
          </div>
        </div>

        {/* Mode toggle */}
        <div style={S.modeToggle}>
          {["login", "signup"].map(m => (
            <button key={m} onClick={() => { setMode(m); setErr(""); }} style={{
              ...S.modeBtn,
              background: mode === m ? "#fff" : "transparent",
              color:      mode === m ? "#111827" : "#9ca3af",
              fontWeight: mode === m ? 700 : 500,
              boxShadow:  mode === m ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
            }}>
              {m === "login" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        {/* Fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onFocus={() => setFocused("email")}
            onBlur={() => setFocused(null)}
            onKeyDown={e => e.key === "Enter" && submit()}
            style={S.authInput(focused === "email")}
          />
          <input
            type="password"
            placeholder="Password"
            value={pass}
            onChange={e => setPass(e.target.value)}
            onFocus={() => setFocused("pass")}
            onBlur={() => setFocused(null)}
            onKeyDown={e => e.key === "Enter" && submit()}
            style={S.authInput(focused === "pass")}
          />
        </div>

        {/* Error / success */}
        {err && (
          <div style={{
            ...S.authMsg,
            background: err.startsWith("✓") ? "#dcfce7" : "#fee2e2",
            color:      err.startsWith("✓") ? "#059669" : "#dc2626",
            border:     `1px solid ${err.startsWith("✓") ? "#bbf7d0" : "#fecaca"}`,
          }}>
            {err}
          </div>
        )}

        {/* Submit */}
        <button onClick={submit} disabled={busy} style={S.authSubmit(busy)}>
          {busy
            ? <><Spinner size={14} color="#fff" /> Loading…</>
            : mode === "login" ? "Sign In" : "Create Account"
          }
        </button>

        <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginTop: 18 }}>
          Secured by Supabase · v{APP_VERSION}
        </div>
      </div>
    </div>
  );

  return children({ user, signOut: () => supabase.auth.signOut() });
}

// ─── MAIN APP ─────────────────────────────────────────────────
export default function App() {
  return (
    <AuthGate>
      {({ user, signOut }) => <Finance user={user} signOut={signOut} />}
    </AuthGate>
  );
}

// ─── FINANCE SHELL ────────────────────────────────────────────
function Finance({ user, signOut }) {
  const [tab, setTab]           = useState("dashboard");
  const [loading, setLoading]   = useState(true);
  const [isDark, setIsDark]     = useState(false);
  const [showMore, setShowMore] = useState(false);

  // ── Data state ──
  const [accounts,       setAccounts]       = useState([]);
  const [ledger,         setLedger]         = useState([]);
  const [categories,     setCategories]     = useState([]);
  const [incomeSrcs,     setIncomeSrcs]     = useState([]);
  const [installments,   setInstallments]   = useState([]);
  const [recurTemplates, setRecurTemplates] = useState([]);
  const [reminders,      setReminders]      = useState([]);
  const [merchantMaps,   setMerchantMaps]   = useState([]);
  const [fxRates,        setFxRates]        = useState({
    USD: 16400, SGD: 12200, MYR: 3700, JPY: 110, EUR: 17800, AUD: 10500,
  });
  const [pendingSyncs,   setPendingSyncs]   = useState([]);
  const [employeeLoans,  setEmployeeLoans]  = useState([]);
  const [loanPayments,   setLoanPayments]   = useState([]);

  const curMonth = ym(todayStr());

  // ── Load all data ──
  const loadData = useCallback(async () => {
    const safe = (p, fallback) => p.catch(e => { console.warn("[loadData]", e.message); return fallback; });

    const [acc, led, cats, inc, inst, rtempl, rem, merch, fx, dark, pending, loans, payments] = await Promise.all([
      safe(accountsApi.getAll(user.id),                      []),
      safe(ledgerApi.getAll(user.id, { limit: 500 }),        []),
      safe(categoriesApi.getAll(user.id),                    []),
      safe(incomeSrcApi.getAll(user.id),                     []),
      safe(installmentsApi.getAll(user.id),                  []),
      safe(recurringApi.getTemplates(user.id),               []),
      safe(recurringApi.getReminders(user.id),               []),
      safe(merchantApi.getMappings(user.id),                 []),
      safe(fxApi.getAll(user.id),                            {}),
      safe(settingsApi.get(user.id, "isDark", false),        false),
      safe(gmailApi.getPending(user.id),                     []),
      safe(employeeLoanApi.getAll(user.id),                  []),
      safe(loanPaymentsApi.getAll(user.id),                  []),
    ]);

    console.log("[loadData] accounts:", acc.length, "ledger:", led.length);

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
    setEmployeeLoans(loans);
    setLoanPayments(payments);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { if (user?.id) loadData(); }, [user?.id, loadData]);

  // Persist dark mode preference
  useEffect(() => {
    settingsApi.set(user.id, "isDark", isDark);
  }, [isDark, user.id]);

  // Handle Gmail OAuth callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("gmail");
    if (!status) return;
    if (status === "connected") {
      showToast("Gmail connected!", "success");
      loadData();
    } else if (status === "error") {
      showToast(`Gmail error: ${params.get("reason") || "Unknown"}`, "error");
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived data ──
  const bankAccounts  = useMemo(() => accounts.filter(a => a.type === "bank"), [accounts]);
  const creditCards   = useMemo(() => accounts.filter(a => a.type === "credit_card"), [accounts]);
  const assets        = useMemo(() => accounts.filter(a => a.type === "asset"), [accounts]);
  const liabilities   = useMemo(() => accounts.filter(a => a.type === "liability"), [accounts]);
  const receivables   = useMemo(() => accounts.filter(a => a.type === "receivable"), [accounts]);
  const netWorth      = useMemo(() => calcNetWorth(accounts), [accounts]);
  const thisMonthLedger = useMemo(
    () => ledger.filter(e => ym(e.tx_date) === curMonth),
    [ledger, curMonth]
  );

  // Props passed to every page
  const shared = {
    user, accounts, ledger, thisMonthLedger, categories, incomeSrcs,
    installments, recurTemplates, reminders, merchantMaps, fxRates,
    CURRENCIES, netWorth, bankAccounts, creditCards, assets, liabilities,
    receivables, curMonth, pendingSyncs,
    isDark, dark: isDark,         // alias: new components use `dark`, old use `isDark`
    setIsDark, setDark: setIsDark,
    setTab, setPendingSyncs,
    employeeLoans, setEmployeeLoans, loanPayments, setLoanPayments,
    setAccounts, setLedger, setCategories, setIncomeSrcs,
    setInstallments, setRecurTemplates, setReminders,
    setMerchantMaps, setFxRates,
    onRefresh: loadData,
  };

  if (loading) return (
    <div style={S.loadScreen}>
      <div style={{ textAlign: "center" }}>
        <Spinner size={32} color="#3b5bdb" />
        <div style={{ marginTop: 12, fontSize: 12, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
          Loading…
        </div>
      </div>
    </div>
  );

  const pageLabel = TABS.find(t => t.id === tab)?.label || "Dashboard";
  const nwColor   = netWorth.total >= 0 ? "#059669" : "#dc2626";
  const overdueReminders = reminders.filter(r => {
    const daysLeft = Math.ceil((new Date(r.due_date) - new Date()) / 86400000);
    return daysLeft <= 0;
  });

  const renderPage = () => {
    switch (tab) {
      case "dashboard":    return <Dashboard    {...shared} />;
      case "transactions": return <Transactions {...shared} />;
      case "accounts":     return <Accounts     {...shared} />;
      case "cards":        return <CreditCards  {...shared} />;
      case "assets":       return <Assets       {...shared} />;
      case "receivables":  return <Receivables  {...shared} />;
      case "income":       return <Income       {...shared} />;
      case "reports":      return <Reports      {...shared} />;
      case "settings":     return <Settings     {...shared} signOut={signOut} />;
      case "aiimport":     return <AIImport     {...shared} />;
      default:             return <Dashboard    {...shared} />;
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f8f9fb" }}>

      {/* ── SIDEBAR (desktop) ── */}
      <aside className="sidebar" style={S.sidebar}>
        {/* Logo */}
        <div style={S.sidebarLogo}>
          <div style={S.logoIcon}><PILogo size={18} white /></div>
          <div style={S.logoName}>Paulus Finance</div>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: "4px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {TABS.map(t => {
            const active = tab === t.id;
            const isReminders = t.id === "reminders";
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  ...S.navItem,
                  background: active ? "#f3f4f6" : "transparent",
                  color:      active ? "#111827"  : "#6b7280",
                  fontWeight: active ? 700 : 500,
                }}
              >
                <span style={{ fontSize: 15, width: 20, textAlign: "center", flexShrink: 0 }}>
                  {t.icon}
                </span>
                <span style={{ fontSize: 13 }}>{t.label}</span>
                {isReminders && overdueReminders.length > 0 && (
                  <span style={S.badge}>{overdueReminders.length}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom: net worth + sign out + version */}
        <div style={S.sidebarBottom}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>
            Net Worth
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: nwColor, marginBottom: 12, fontFamily: "Figtree, sans-serif" }}>
            {fmtIDR(netWorth.total, true)}
          </div>
          <button onClick={signOut} style={S.signOutBtn}>Sign out</button>
          <div style={{ marginTop: 8, fontSize: 10, color: "#d1d5db" }}>
            v{APP_VERSION} · {APP_BUILD}
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

        {/* Top bar */}
        <header style={S.topBar}>
          {/* Left: logo on mobile, title on desktop */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="mobile-only" style={{ ...S.logoIcon, width: 28, height: 28 }}><PILogo size={16} white /></div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
              {pageLabel}
            </div>
          </div>

          {/* Right: NW (mobile) + dark toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="mobile-only" style={{ alignItems: "baseline", gap: 4 }}>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>NW</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: nwColor, fontFamily: "Figtree, sans-serif" }}>
                {fmtIDR(netWorth.total, true)}
              </span>
            </div>
            <button onClick={() => setIsDark(d => !d)} style={S.darkToggle}>
              {isDark ? "☀" : "◑"}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main
          key={tab}
          className="fade-up"
          style={{ flex: 1, padding: "20px 24px", maxWidth: 840, width: "100%", margin: "0 auto", paddingBottom: 88 }}
        >
          {renderPage()}
        </main>
      </div>

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav className="mobile-nav" style={S.mobileNav}>
        {MOBILE_MAIN_TABS.map(id => {
          const t      = TABS.find(s => s.id === id);
          const active = tab === id;
          return (
            <button key={id} onClick={() => { setTab(id); setShowMore(false); }} style={{
              ...S.mobileNavBtn,
              color: active ? "#3b5bdb" : "#9ca3af",
            }}>
              <NAV_ICON id={id} />
              <span style={{ fontSize: 9, fontWeight: active ? 700 : 500 }}>{t?.label}</span>
            </button>
          );
        })}
        <button onClick={() => setShowMore(s => !s)} style={{
          ...S.mobileNavBtn,
          color: showMore ? "#3b5bdb" : "#9ca3af",
        }}>
          <NAV_ICON id="more" />
          <span style={{ fontSize: 9, fontWeight: showMore ? 700 : 500 }}>More</span>
        </button>
      </nav>

      {/* ── MORE DRAWER (mobile) ── */}
      {showMore && (
        <>
          <div
            onClick={() => setShowMore(false)}
            style={{ position: "fixed", inset: 0, zIndex: 195, background: "rgba(0,0,0,0.3)" }}
          />
          <div style={S.moreDrawer}>
            <div style={{
              display:             "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap:                 8,
            }}>
              {MOBILE_MORE_TABS.map(t => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setTab(t.id); setShowMore(false); }}
                    style={{
                      ...S.moreBtn,
                      border:     `1.5px solid ${active ? "#3b5bdb" : "#e5e7eb"}`,
                      background: active ? "#dbeafe" : "#ffffff",
                      color:      active ? "#3b5bdb" : "#374151",
                      fontWeight: active ? 700 : 500,
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <ToastContainer />
    </div>
  );
}

// ─── NAV ICONS ────────────────────────────────────────────────
// Consistent outlined SVG icons — 22×22, stroke 1.8, no fill
function NAV_ICON({ id }) {
  const props = {
    width: 22, height: 22,
    fill: "none", stroke: "currentColor",
    strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
    viewBox: "0 0 24 24",
  };
  switch (id) {
    case "dashboard":
      // House outline
      return (
        <svg {...props}>
          <path d="M3 12L12 3l9 9" />
          <path d="M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" />
        </svg>
      );
    case "transactions":
      // Arrow up-down (swap / transfer)
      return (
        <svg {...props}>
          <path d="M7 17V4m0 0L4 7m3-3 3 3" />
          <path d="M17 7v13m0 0 3-3m-3 3-3-3" />
        </svg>
      );
    case "accounts":
      // Bank / building columns
      return (
        <svg {...props}>
          <path d="M3 21h18" />
          <path d="M3 10h18" />
          <path d="M5 6l7-3 7 3" />
          <path d="M6 10v11M10 10v11M14 10v11M18 10v11" />
        </svg>
      );
    case "assets":
      // Trending-up line chart
      return (
        <svg {...props}>
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
      );
    case "more":
      // 2×2 grid of rounded squares
      return (
        <svg {...props}>
          <rect x="3"  y="3"  width="7" height="7" rx="1.5" />
          <rect x="14" y="3"  width="7" height="7" rx="1.5" />
          <rect x="3"  y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    default:
      return null;
  }
}

// ─── STYLES ───────────────────────────────────────────────────
const S = {
  loadScreen: {
    minHeight:      "100vh",
    background:     "#f8f9fb",
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
  },

  authScreen: {
    minHeight:      "100vh",
    background:     "#f8f9fb",
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    padding:        16,
  },

  authCard: {
    background:   "#ffffff",
    border:       "1px solid #e5e7eb",
    borderRadius: 20,
    padding:      "32px 28px",
    width:        "100%",
    maxWidth:     380,
    boxShadow:    "0 4px 20px rgba(0,0,0,0.07)",
  },

  logoIcon: {
    width:          30,
    height:         30,
    background:     "#111827",
    borderRadius:   8,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    fontSize:       16,
    flexShrink:     0,
  },

  logoName: {
    fontSize:   14,
    fontWeight: 800,
    color:      "#111827",
    fontFamily: "Figtree, sans-serif",
    lineHeight: 1.3,
  },

  logoSub: {
    fontSize:   10,
    color:      "#9ca3af",
    fontFamily: "Figtree, sans-serif",
  },

  modeToggle: {
    display:      "flex",
    background:   "#f3f4f6",
    borderRadius: 10,
    padding:      3,
    gap:          2,
    marginBottom: 18,
  },

  modeBtn: {
    flex:         1,
    height:       34,
    border:       "none",
    borderRadius: 8,
    fontFamily:   "Figtree, sans-serif",
    fontSize:     13,
    cursor:       "pointer",
    transition:   "all 0.15s",
  },

  authInput: (focused) => ({
    border:       `1.5px solid ${focused ? "#3b5bdb" : "#e5e7eb"}`,
    borderRadius: 10,
    padding:      "0 14px",
    fontFamily:   "Figtree, sans-serif",
    fontSize:     14,
    fontWeight:   500,
    outline:      "none",
    color:        "#111827",
    background:   "#fff",
    height:       44,
    width:        "100%",
    boxSizing:    "border-box",
    boxShadow:    focused ? "0 0 0 3px #dbeafe" : "none",
    transition:   "border-color 0.15s, box-shadow 0.15s",
  }),

  authMsg: {
    fontSize:     12,
    marginBottom: 12,
    padding:      "8px 12px",
    borderRadius: 8,
    fontFamily:   "Figtree, sans-serif",
  },

  authSubmit: (busy) => ({
    width:          "100%",
    background:     "#111827",
    color:          "#fff",
    border:         "none",
    height:         44,
    borderRadius:   10,
    fontFamily:     "Figtree, sans-serif",
    fontWeight:     700,
    fontSize:       14,
    cursor:         "pointer",
    opacity:        busy ? 0.6 : 1,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    gap:            8,
  }),

  sidebar: {
    width:          200,
    flexShrink:     0,
    background:     "#ffffff",
    borderRight:    "1px solid #e5e7eb",
    flexDirection:  "column",
    padding:        "16px 0 12px",
    position:       "sticky",
    top:            0,
    height:         "100vh",
    overflowY:      "auto",
  },

  sidebarLogo: {
    display:       "flex",
    alignItems:    "center",
    gap:           9,
    padding:       "0 16px 14px",
    borderBottom:  "1px solid #f3f4f6",
    marginBottom:  6,
  },

  navItem: {
    display:     "flex",
    alignItems:  "center",
    gap:         8,
    width:       "100%",
    padding:     "8px 10px",
    border:      "none",
    borderRadius: 8,
    cursor:      "pointer",
    fontFamily:  "Figtree, sans-serif",
    textAlign:   "left",
    transition:  "background 0.12s, color 0.12s",
  },

  badge: {
    marginLeft:   "auto",
    background:   "#dc2626",
    color:        "#fff",
    borderRadius: 99,
    fontSize:     9,
    fontWeight:   700,
    padding:      "1px 5px",
    fontFamily:   "Figtree, sans-serif",
  },

  sidebarBottom: {
    padding:    "12px 16px 0",
    borderTop:  "1px solid #f3f4f6",
    marginTop:  8,
  },

  signOutBtn: {
    width:        "100%",
    border:       "1px solid #e5e7eb",
    borderRadius: 7,
    padding:      "6px 0",
    background:   "none",
    color:        "#9ca3af",
    fontFamily:   "Figtree, sans-serif",
    fontSize:     11,
    fontWeight:   600,
    cursor:       "pointer",
  },

  topBar: {
    height:         56,
    flexShrink:     0,
    background:     "#ffffff",
    borderBottom:   "1px solid #e5e7eb",
    display:        "flex",
    alignItems:     "center",
    justifyContent: "space-between",
    padding:        "0 24px",
    position:       "sticky",
    top:            0,
    zIndex:         100,
  },

  darkToggle: {
    background:   "none",
    border:       "1px solid #e5e7eb",
    borderRadius: 6,
    padding:      "5px 9px",
    cursor:       "pointer",
    fontSize:     13,
    color:        "#9ca3af",
    fontFamily:   "Figtree, sans-serif",
  },

  mobileNav: {
    position:       "fixed",
    bottom:         0,
    left:           0,
    right:          0,
    zIndex:         200,
    background:     "#ffffff",
    borderTop:      "1px solid #e5e7eb",
    paddingBottom:  "env(safe-area-inset-bottom)",
    alignItems:     "stretch",
    height:         56,
  },

  mobileNavBtn: {
    flex:           1,
    border:         "none",
    background:     "none",
    cursor:         "pointer",
    display:        "flex",
    flexDirection:  "column",
    alignItems:     "center",
    justifyContent: "center",
    gap:            3,
    padding:        "6px 4px",
    transition:     "color 0.15s",
    fontFamily:     "Figtree, sans-serif",
  },

  moreDrawer: {
    position:     "fixed",
    bottom:       "calc(56px + env(safe-area-inset-bottom))",
    left:         0,
    right:        0,
    zIndex:       196,
    background:   "#ffffff",
    borderTop:    "1px solid #e5e7eb",
    borderRadius: "16px 16px 0 0",
    padding:      "14px 16px 16px",
    animation:    "fadeUp 0.15s ease",
  },

  moreBtn: {
    border:       "1.5px solid #e5e7eb",
    borderRadius: 10,
    padding:      "12px 8px",
    cursor:       "pointer",
    fontFamily:   "Figtree, sans-serif",
    fontSize:     12,
  },
};
