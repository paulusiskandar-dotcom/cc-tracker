import { useEffect, useRef, useCallback } from "react";
import { fmtIDR, fmtCur } from "../api";
import { ENT_COL, ENT_BG, TX_TYPE_MAP, EXPENSE_CATEGORIES } from "../constants";

// ─── FONTS + BASE CSS (injected once) ─────────────────────────
let _cssInjected = false;
export function injectBaseCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Sora',system-ui,sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}

    /* ── Inputs ── */
    .inp{width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:0 12px;height:40px;
      font-family:'Sora',sans-serif;font-size:14px;outline:none;
      transition:border-color .15s,box-shadow .15s;background:#fff;color:#111827}
    .inp:focus{border-color:#3b5bdb!important;box-shadow:0 0 0 3px #eef2ff!important}
    textarea.inp{height:auto;padding:10px 12px}

    /* ── Buttons ── */
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:none;
      border-radius:8px;padding:0 16px;height:36px;
      font-family:'Sora',sans-serif;font-weight:600;font-size:13px;cursor:pointer;
      transition:all .15s;white-space:nowrap;line-height:1}
    .btn:disabled{opacity:.45;cursor:not-allowed}
    .btn-primary{background:#3b5bdb;color:#fff}
    .btn-primary:hover:not(:disabled){background:#3451c7}
    .btn-ghost{background:transparent;color:#6b7280;border:1px solid #e5e7eb}
    .btn-ghost:hover:not(:disabled){background:#f3f4f6}
    .btn-danger{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
    .btn-danger:hover:not(:disabled){background:#fee2e2}
    .btn-ai{background:#3b5bdb;color:#fff}
    .btn-ai:hover:not(:disabled){background:#3451c7}
    .btn-sm{height:30px;padding:0 12px;font-size:12px;border-radius:6px}
    .btn-icon{width:32px;height:32px;padding:0;border-radius:6px;border:1px solid #e5e7eb;background:transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;color:#6b7280;transition:all .15s}
    .btn-icon:hover{background:#f3f4f6}

    /* ── Typography ── */
    .num{font-family:'JetBrains Mono',monospace}
    .label-sm{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}

    /* ── Cards ── */
    .card{border-radius:12px;padding:16px;border:1px solid #e5e7eb;background:#fff}

    /* ── Utils ── */
    .fade-up{animation:fadeUp .2s ease both}
    ::-webkit-scrollbar{width:4px;height:4px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}

    /* ── Layout ── */
    .desktop-sidebar{display:none}
    .mobile-nav{display:flex}
    @media(min-width:769px){
      .desktop-sidebar{display:flex!important}
      .mobile-nav{display:none!important}
      .mobile-header-logo{display:none}
    }
    @media(max-width:768px){
      .desktop-sidebar{display:none!important}
    }

    /* ── Overlay / Modal ── */
    .overlay-backdrop{align-items:flex-end;overflow:hidden}
    .overlay-modal{height:100dvh;border-radius:0}
    .overlay-drag{display:block}
    @media(min-width:769px){
      .overlay-backdrop{align-items:center;padding:24px 16px}
      .overlay-modal{height:auto!important;max-height:85vh;border-radius:16px!important}
      .overlay-drag{display:none}
    }

    /* ── Nav items ── */
    .nav-item{display:flex;align-items:center;gap:10px;padding:8px 12px;border:none;
      border-radius:8px;cursor:pointer;font-family:'Sora',sans-serif;font-weight:500;
      font-size:13px;transition:all .12s;width:100%;text-align:left;
      background:transparent;color:#6b7280}
    .nav-item:hover{background:#f3f4f6}
    .nav-item.active{background:#eef2ff;color:#3b5bdb;font-weight:600}

    /* ── Transaction list ── */
    .tx-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;
      cursor:pointer;transition:background .1s}
    .tx-row:hover{background:#f9fafb}
    .tx-date-header{font-size:11px;font-weight:700;text-transform:uppercase;
      letter-spacing:.5px;color:#9ca3af;padding:12px 12px 4px}

    /* ── SubTabs ── */
    .subtab-bar{display:flex;gap:0;border-bottom:1px solid #e5e7eb;margin-bottom:0}
    .subtab{border:none;background:none;padding:8px 14px;font-family:'Sora',sans-serif;
      font-size:13px;font-weight:500;cursor:pointer;color:#6b7280;
      border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s}
    .subtab.active{color:#3b5bdb;font-weight:600;border-bottom-color:#3b5bdb}
    .subtab:hover:not(.active){color:#374151}
  `;
  document.head.appendChild(s);
}

// ─── SPINNER ──────────────────────────────────────────────────
export function Spinner({ size = 24, color = "#3b5bdb" }) {
  return (
    <div style={{
      width:size, height:size, borderRadius:"50%",
      border:`2px solid ${color}22`, borderTop:`2px solid ${color}`,
      animation:"spin .7s linear infinite", flexShrink:0,
    }}/>
  );
}

// ─── OVERLAY / MODAL ──────────────────────────────────────────
export function Overlay({ children, onClose, th, title, sub, maxWidth = 480, noPad = false }) {
  const bodyRef = useRef(null);
  const handleBackdrop = useCallback(e => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      bodyRef.current?.scrollTo({ top: 0, behavior: "instant" });
    });
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { cancelAnimationFrame(raf); document.body.style.overflow = prev; };
  }, []);

  return (
    <div onClick={handleBackdrop} className="overlay-backdrop"
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.4)", zIndex:1000,
        display:"flex", justifyContent:"center" }}>
      <div className="overlay-modal" style={{
        background:th.sur, width:"100%", maxWidth,
        display:"flex", flexDirection:"column",
        animation:"fadeUp .18s ease both", boxShadow:"0 20px 60px rgba(0,0,0,.15)",
      }}>
        {/* Mobile drag handle */}
        <div className="overlay-drag" style={{ padding:"10px 0 6px", textAlign:"center", flexShrink:0 }}>
          <div style={{ width:36, height:4, borderRadius:2, background:th.bor2, display:"inline-block" }}/>
        </div>
        {/* Sticky header */}
        <div style={{
          flexShrink:0, padding:"16px 20px", borderBottom:`1px solid ${th.bor}`,
          display:"flex", justifyContent:"space-between", alignItems:"center",
        }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:th.tx }}>{title||""}</div>
            {sub && <div style={{ fontSize:12, color:th.tx3, marginTop:2 }}>{sub}</div>}
          </div>
          <button onClick={onClose} className="btn-icon" style={{ border:"none", background:"none", color:th.tx3, fontSize:20, width:32, height:32 }}>×</button>
        </div>
        {/* Scrollable body */}
        <div ref={bodyRef} style={{
          flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain",
          padding: noPad ? 0 : "20px 20px 0",
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── FORM FIELD WRAPPER ───────────────────────────────────────
export function F({ label, children, th, required }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      <label style={{ fontSize:11, fontWeight:700, color:th.tx3, textTransform:"uppercase", letterSpacing:.6, lineHeight:1 }}>
        {label}{required && <span style={{ color:th.rd }}> *</span>}
      </label>
      {children}
    </div>
  );
}

// ─── FORM SECTION DIVIDER ─────────────────────────────────────
export function FormSection({ label, th }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, margin:"6px 0 2px" }}>
      <div style={{ fontSize:10, fontWeight:800, color:th.tx3, textTransform:"uppercase", letterSpacing:1, whiteSpace:"nowrap" }}>{label}</div>
      <div style={{ flex:1, height:1, background:th.bor }}/>
    </div>
  );
}

// ─── 2-COLUMN ROW ─────────────────────────────────────────────
export function R2({ children }) {
  return <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>{children}</div>;
}

// ─── BUTTON ROW ───────────────────────────────────────────────
export function BtnRow({ onCancel, onOk, label = "Save", th, saving, disabled }) {
  return (
    <div style={{
      position:"sticky", bottom:0, zIndex:5, background:th.sur,
      padding:"16px 0 max(16px, env(safe-area-inset-bottom))",
      marginTop:20, borderTop:`1px solid ${th.bor}`,
      display:"flex", gap:8,
    }}>
      <button className="btn btn-ghost" onClick={onCancel} disabled={saving}
        style={{ flex:1, height:40 }}>Cancel</button>
      <button className="btn btn-primary" onClick={onOk} disabled={saving||disabled}
        style={{ flex:2, height:40 }}>
        {saving ? <><Spinner size={13} color="#fff"/>Saving…</> : label}
      </button>
    </div>
  );
}

// ─── TAG / BADGE ──────────────────────────────────────────────
export function Tag({ children, bg, color, small }) {
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", gap:3,
      background:bg, color,
      padding:small?"2px 6px":"3px 9px",
      borderRadius:6, fontSize:small?9:11, fontWeight:700, whiteSpace:"nowrap",
    }}>
      {children}
    </span>
  );
}

// ─── ENTITY TAG ───────────────────────────────────────────────
export function EntityTag({ entity, small }) {
  return <Tag bg={ENT_BG[entity]||"#f0f1f7"} color={ENT_COL[entity]||"#8a90aa"} small={small}>{entity}</Tag>;
}

// ─── TX TYPE TAG ──────────────────────────────────────────────
export function TxTypeTag({ type, small }) {
  const t = TX_TYPE_MAP[type];
  if (!t) return null;
  const colors = {
    expense:"#fff5f5",income:"#e6fcf5",transfer:"#eef2ff",pay_cc:"#f3f0ff",
    buy_asset:"#e3fafc",sell_asset:"#e6fcf5",pay_liability:"#fff9db",
    reimburse_out:"#fff9db",reimburse_in:"#e6fcf5",give_loan:"#fff9db",
    collect_loan:"#e6fcf5",expense:"#fff5f5",fx_exchange:"#e3fafc",
    opening_balance:"#eef2ff",cc_installment:"#f3f0ff",
  };
  return <Tag bg={colors[type]||"#f0f1f7"} color={t.color} small={small}>{t.icon} {t.label}</Tag>;
}

// ─── AMOUNT DISPLAY ───────────────────────────────────────────
export function Amount({ amount, currency = "IDR", type, small }) {
  const isOut = ["expense","pay_cc","buy_asset","pay_liability","reimburse_out","give_loan"].includes(type);
  const isIn  = ["income","sell_asset","reimburse_in","collect_loan"].includes(type);
  const color = isOut ? "#e03131" : isIn ? "#0ca678" : "#3b5bdb";
  const prefix = isOut ? "−" : isIn ? "+" : "";
  return (
    <span className="num" style={{ color, fontWeight:700, fontSize:small?11:13 }}>
      {prefix}{fmtCur(amount, currency)}
    </span>
  );
}

// ─── PROGRESS BAR ─────────────────────────────────────────────
export function ProgressBar({ value, max, color = "#3b5bdb", height = 6, showPct = false, th }) {
  const pct = max > 0 ? Math.min(100, (value/max)*100) : 0;
  return (
    <div>
      <div style={{ background:th.sur3, borderRadius:999, height, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", background:color, borderRadius:999, transition:"width .4s ease" }}/>
      </div>
      {showPct && <div style={{ fontSize:10, color:th.tx3, textAlign:"right", marginTop:2 }}>{pct.toFixed(0)}%</div>}
    </div>
  );
}

// ─── EMPTY STATE ──────────────────────────────────────────────
export function Empty({ icon = "📭", message = "Nothing here yet", th }) {
  return (
    <div style={{ textAlign:"center", padding:"40px 20px", color:th.tx3 }}>
      <div style={{ fontSize:36, marginBottom:8 }}>{icon}</div>
      <div style={{ fontSize:13 }}>{message}</div>
    </div>
  );
}

// ─── SECTION HEADER ───────────────────────────────────────────
export function SectionHeader({ title, action, th }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
      <div style={{ fontSize:13, fontWeight:800, color:th.tx, textTransform:"uppercase", letterSpacing:.5 }}>{title}</div>
      {action}
    </div>
  );
}

// ─── STAT CARD ────────────────────────────────────────────────
export function StatCard({ label, value, sub, color, th, icon, onClick }) {
  return (
    <div onClick={onClick} style={{
      background:th.sur, border:`1px solid ${th.bor}`, borderRadius:12, padding:"14px 16px",
      cursor:onClick?"pointer":"default", transition:"box-shadow .15s",
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
        <div style={{ fontSize:11, color:th.tx3, fontWeight:600 }}>{label}</div>
        {icon && <span style={{ fontSize:16 }}>{icon}</span>}
      </div>
      <div className="num" style={{ fontSize:18, fontWeight:800, color:color||th.tx }}>{value}</div>
      {sub && <div style={{ fontSize:10, color:th.tx3, marginTop:3 }}>{sub}</div>}
    </div>
  );
}

// ─── ACCOUNT COLOR DOT ────────────────────────────────────────
export function ColorDot({ color, size = 10 }) {
  return <span style={{ display:"inline-block", width:size, height:size, borderRadius:"50%", background:color, flexShrink:0 }}/>;
}

// ─── CATEGORY PILL ────────────────────────────────────────────
export function CatPill({ category, small, th }) {
  const cat = EXPENSE_CATEGORIES.find(c=>c.label===category||c.id===category);
  if (!cat) return <Tag bg={th?.sur3||"#f0f1f7"} color={th?.tx3||"#8a90aa"} small={small}>{category||"—"}</Tag>;
  return <Tag bg={cat.color+"22"} color={cat.color} small={small}>{cat.icon} {cat.label}</Tag>;
}

// ─── SUB-TAB BAR ──────────────────────────────────────────────
export function SubTabs({ tabs, active, onChange }) {
  return (
    <div className="subtab-bar">
      {tabs.map(t => (
        <button key={t.id} onClick={()=>onChange(t.id)}
          className={`subtab${active===t.id?" active":""}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── INPUT WITH STYLE ─────────────────────────────────────────
export function Input({ value, onChange, type="text", placeholder, th, style={}, ...props }) {
  return (
    <input className="inp" type={type} value={value} onChange={onChange} placeholder={placeholder}
      style={{ background:th.sur, color:th.tx, borderColor:th.bor, ...style }} {...props}/>
  );
}

export function Select({ value, onChange, children, th, style={} }) {
  return (
    <select className="inp" value={value} onChange={onChange}
      style={{ background:th.sur, color:th.tx, borderColor:th.bor, cursor:"pointer", ...style }}>
      {children}
    </select>
  );
}

export function Textarea({ value, onChange, placeholder, th, rows=3, style={} }) {
  return (
    <textarea className="inp" value={value} onChange={onChange} placeholder={placeholder} rows={rows}
      style={{ background:th.sur, color:th.tx, borderColor:th.bor, resize:"vertical", ...style }}/>
  );
}

// ─── TOAST ────────────────────────────────────────────────────
let _toastTimer;
export function showToast(message, type = "success") {
  let el = document.getElementById("pf-toast");
  if (!el) { el = document.createElement("div"); el.id = "pf-toast"; document.body.appendChild(el); }
  const colors = { success:"#0ca678", error:"#e03131", info:"#3b5bdb", warning:"#e67700" };
  el.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:${colors[type]||colors.success};color:#fff;padding:10px 20px;
    border-radius:12px;font-family:'Sora',sans-serif;font-weight:700;font-size:13px;
    z-index:9999;box-shadow:0 4px 24px rgba(0,0,0,.2);
    animation:fadeUp .2s ease;white-space:nowrap;pointer-events:none;
  `;
  el.textContent = message;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { if (el) el.textContent = ""; }, 3000);
}

// ─── CONFIRM DIALOG ───────────────────────────────────────────
export function confirmDelete(name) {
  return window.confirm(`Delete "${name}"? This cannot be undone.`);
}

// ─── CURRENCY AMOUNT INPUT ────────────────────────────────────
export function AmountInput({ value, onChange, currency, onCurrencyChange, currencies, th }) {
  return (
    <div style={{ display:"flex", gap:6 }}>
      <select className="inp" value={currency} onChange={e=>onCurrencyChange(e.target.value)}
        style={{ width:80, background:th.sur, color:th.tx, borderColor:th.bor2, cursor:"pointer", flexShrink:0 }}>
        {currencies.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
      </select>
      <input className="inp" type="number" value={value} onChange={onChange} placeholder="0"
        style={{ background:th.sur, color:th.tx, borderColor:th.bor2, fontFamily:"'JetBrains Mono',monospace" }}/>
    </div>
  );
}

// ─── NET WORTH CALCULATOR ─────────────────────────────────────
export function calcNetWorth(accounts) {
  let bank = 0, assets = 0, receivables = 0, ccDebt = 0, liabilities = 0;
  (accounts||[]).forEach(a => {
    // All bank accounts always included (reimburse/tracking accounts included)
    if (a.type === "bank")
      bank += Number(a.current_balance || 0);
    else if (a.type === "asset")
      assets += Number(a.current_value || 0);
    else if (a.type === "receivable")
      receivables += Number(a.receivable_outstanding || 0);  // money owed TO user
    else if (a.type === "credit_card")
      ccDebt += Number(a.outstanding_amount || 0);  // outstanding debt
    else if (a.type === "liability")
      liabilities += Number(a.outstanding_amount || 0);
  });
  return { bank, assets, receivables, ccDebt, liabilities, total: bank + assets + receivables - ccDebt - liabilities };
}

// ─── MONTH SELECTOR ───────────────────────────────────────────
export function MonthSelect({ value, onChange, th }) {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = d.toISOString().slice(0,7);
    months.push({ value: ym, label: d.toLocaleDateString("en-US",{month:"long",year:"numeric"}) });
  }
  return (
    <select className="inp" value={value} onChange={e=>onChange(e.target.value)}
      style={{ background:th.sur, color:th.tx, borderColor:th.bor2, cursor:"pointer" }}>
      <option value="all">All Months</option>
      {months.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
    </select>
  );
}
