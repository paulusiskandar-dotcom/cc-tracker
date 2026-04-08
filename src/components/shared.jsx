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
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Sora',system-ui,sans-serif}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    .inp{width:100%;border:1.5px solid;border-radius:9px;padding:9px 12px;font-family:'Sora',sans-serif;font-size:13px;outline:none;transition:border-color .15s}
    .inp:focus{border-color:#3b5bdb!important}
    .btn{display:inline-flex;align-items:center;gap:6px;border:none;border-radius:9px;padding:9px 16px;font-family:'Sora',sans-serif;font-weight:700;font-size:13px;cursor:pointer;transition:all .15s;white-space:nowrap}
    .btn:disabled{opacity:.5;cursor:not-allowed}
    .btn-primary{background:linear-gradient(135deg,#3b5bdb,#7048e8);color:#fff}
    .btn-ghost{background:transparent;color:#8a90aa;border:1.5px solid #e2e4ed}
    .btn-danger{background:#fff5f5;color:#e03131;border:1.5px solid #ffc9c9}
    .btn-ai{background:linear-gradient(135deg,#7048e8,#0c8599);color:#fff}
    .num{font-family:'JetBrains Mono',monospace}
    .card{border-radius:14px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.05),0 4px 16px rgba(0,0,0,.04)}
    .fade-up{animation:fadeUp .25s ease both}
    ::-webkit-scrollbar{width:4px;height:4px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:#d0d3e0;border-radius:4px}
    .overlay-backdrop{align-items:stretch}
    .overlay-modal{border-radius:0;min-height:100%;max-height:none}
    @media(min-width:769px){
      .overlay-backdrop{align-items:center;padding:24px 16px}
      .overlay-modal{border-radius:20px!important;min-height:unset!important;max-height:85vh!important;height:auto}
      .overlay-handle{display:none}
    }
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
export function Overlay({ children, onClose, th, title, sub, maxWidth = 500, noPad = false }) {
  const contentRef = useRef(null);
  const handleBackdrop = useCallback(e => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  useEffect(() => {
    // requestAnimationFrame ensures children have rendered before we scroll,
    // so the scroll-to-top is never a no-op on first open.
    const raf = requestAnimationFrame(() => {
      contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
    });
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div onClick={handleBackdrop}
      className="overlay-backdrop"
      style={{
        position:"fixed", inset:0, background:"rgba(0,0,0,.48)", zIndex:1000,
        display:"flex", justifyContent:"center",
      }}>
      {/* ONE scroll container — sticky header/footer work relative to this div.
          Mobile: fullscreen (min-height:100%, no maxHeight) via CSS class.
          Desktop: centered 85vh via CSS media query. */}
      <div ref={contentRef} className="overlay-modal" style={{
        background:th.sur, width:"100%", maxWidth,
        overflowY:"auto",
        WebkitOverflowScrolling:"touch", overscrollBehavior:"contain",
        animation:"fadeUp .2s ease both", boxShadow:th.sh2,
        paddingBottom:"env(safe-area-inset-bottom)",
      }}>
        {/* Drag handle — hidden on desktop via CSS */}
        <div className="overlay-handle" style={{ padding:"12px 0 0", textAlign:"center" }}>
          <div style={{ width:40, height:4, borderRadius:2, background:th.bor2, display:"inline-block" }}/>
        </div>
        {/* Sticky header — sticky because its parent IS the scroll container */}
        <div style={{
          position:"sticky", top:0, zIndex:10, background:th.sur,
          padding:"0 20px 12px", borderBottom:`1px solid ${th.bor}`,
          display:"flex", justifyContent:"space-between", alignItems:"flex-start",
        }}>
          <div>
            <div style={{ fontSize:16, fontWeight:800, color:th.tx, letterSpacing:"-.3px" }}>{title||""}</div>
            {sub && <div style={{ fontSize:11, color:th.tx3, marginTop:2 }}>{sub}</div>}
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer",
            color:th.tx3, fontSize:22, padding:"0 0 0 12px", lineHeight:1, flexShrink:0 }}>×</button>
        </div>
        {/* Content */}
        <div style={{ padding: noPad ? 0 : "16px 20px 4px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── FORM FIELD WRAPPER ───────────────────────────────────────
export function F({ label, children, th, required }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
      <label style={{ fontSize:11, fontWeight:700, color:th.tx3, textTransform:"uppercase", letterSpacing:.5 }}>
        {label}{required && <span style={{ color:th.rd }}> *</span>}
      </label>
      {children}
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
      position:"sticky", bottom:0,
      background:th.sur,
      paddingTop:12, marginTop:16,
      borderTop:`1px solid ${th.bor}`,
      display:"flex", gap:8,
    }}>
      <button className="btn btn-ghost" onClick={onCancel} disabled={saving}
        style={{ flex:1, color:th.tx2, borderColor:th.bor }}>Cancel</button>
      <button className="btn btn-primary" onClick={onOk} disabled={saving||disabled} style={{ flex:2 }}>
        {saving ? <><Spinner size={14} color="#fff"/>&nbsp;Saving…</> : label}
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
    collect_loan:"#e6fcf5",qris_debit:"#fff5f5",fx_exchange:"#e3fafc",
    opening_balance:"#eef2ff",cc_installment:"#f3f0ff",
  };
  return <Tag bg={colors[type]||"#f0f1f7"} color={t.color} small={small}>{t.icon} {t.label}</Tag>;
}

// ─── AMOUNT DISPLAY ───────────────────────────────────────────
export function Amount({ amount, currency = "IDR", type, small }) {
  const isOut = ["expense","pay_cc","buy_asset","pay_liability","reimburse_out","give_loan","qris_debit"].includes(type);
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
export function SubTabs({ tabs, active, onChange, th }) {
  return (
    <div style={{ display:"flex", gap:4, background:th.sur2, borderRadius:11, padding:3, flexWrap:"wrap" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={()=>onChange(t.id)} style={{
          flex:"1 1 auto", border:"none", padding:"7px 12px", borderRadius:8,
          fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:11, cursor:"pointer",
          background:active===t.id ? th.sur : "transparent",
          color:active===t.id ? th.ac : th.tx3,
          boxShadow:active===t.id ? th.sh : "none",
          transition:"all .15s", whiteSpace:"nowrap",
        }}>
          {t.icon && <span style={{ marginRight:4 }}>{t.icon}</span>}{t.label}
        </button>
      ))}
    </div>
  );
}

// ─── INPUT WITH STYLE ─────────────────────────────────────────
export function Input({ value, onChange, type="text", placeholder, th, style={}, ...props }) {
  return (
    <input
      className="inp"
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={{ background:th.sur, color:th.tx, borderColor:th.bor2, ...style }}
      {...props}
    />
  );
}

export function Select({ value, onChange, children, th, style={} }) {
  return (
    <select
      className="inp"
      value={value}
      onChange={onChange}
      style={{ background:th.sur, color:th.tx, borderColor:th.bor2, cursor:"pointer", ...style }}
    >
      {children}
    </select>
  );
}

export function Textarea({ value, onChange, placeholder, th, rows=3, style={} }) {
  return (
    <textarea
      className="inp"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      style={{ background:th.sur, color:th.tx, borderColor:th.bor2, resize:"vertical", ...style }}
    />
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
      receivables += Number(a.outstanding_amount || 0);  // money owed TO user
    else if (a.type === "credit_card")
      ccDebt += Math.max(0, Number(a.current_balance || 0));  // only count positive debt
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
