// ============================================================
// PAULUS FINANCE - Session 1
// CC Tracker (full) + Bank & Rekening Module
// Supabase integrated, Premium UI, AI Features
// ============================================================

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

// ─── SUPABASE ─────────────────────────────────────────────────
const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

// ─── CONSTANTS ────────────────────────────────────────────────
const CURRENCIES  = [
  {code:"IDR",symbol:"Rp",rate:1,flag:"🇮🇩"},
  {code:"USD",symbol:"$",rate:16400,flag:"🇺🇸"},
  {code:"SGD",symbol:"S$",rate:12200,flag:"🇸🇬"},
  {code:"MYR",symbol:"RM",rate:3700,flag:"🇲🇾"},
  {code:"JPY",symbol:"¥",rate:110,flag:"🇯🇵"},
  {code:"EUR",symbol:"€",rate:17800,flag:"🇪🇺"},
  {code:"AUD",symbol:"A$",rate:10500,flag:"🇦🇺"},
];
const CC_CATEGORIES  = ["Belanja","Makan & Minum","Transport","Tagihan","Hotel/Travel","Elektronik","Kesehatan","Hiburan","Lainnya"];
const BANK_CATEGORIES= ["Gaji","Transfer Masuk","Tarik Tunai","Belanja","Makan & Minum","Transport","Tagihan","Investasi","Lainnya"];
const ENTITIES       = ["Pribadi","Hamasa","SDC","Travelio","Lainnya"];
const CC_ENTITIES    = ["Pribadi","Hamasa","SDC","Travelio"];
const NETWORTH_ENTITIES = ["Pribadi"]; // yang masuk networth
const NETWORKS       = ["Visa","Mastercard","JCB","Amex"];
const BANKS_LIST     = ["BCA","Mandiri","BNI","CIMB","BRI","Permata","Danamon","OCBC","Jenius","SeaBank","Lainnya"];
const ENTITY_COLORS  = {Pribadi:"#6366f1",Hamasa:"#10b981",SDC:"#f59e0b",Travelio:"#06b6d4",Lainnya:"#64748b"};

// ─── HELPERS ──────────────────────────────────────────────────
const getCur   = c => CURRENCIES.find(x=>x.code===c)||CURRENCIES[0];
const toIDR    = (amt,cur,rates={}) => amt*(rates[cur]||getCur(cur).rate);
const fmtIDR   = (n,short=false) => {
  const v=Math.abs(Number(n||0));
  if(short&&v>=1000000000) return "Rp "+(v/1000000000).toFixed(1)+"M";
  if(short&&v>=1000000) return "Rp "+(v/1000000).toFixed(1)+"jt";
  if(short&&v>=1000) return "Rp "+(v/1000).toFixed(0)+"rb";
  return "Rp "+v.toLocaleString("id-ID");
};
const fmtCur   = (amt,cur) => { const c=getCur(cur); return cur==="IDR"?"Rp "+Number(amt||0).toLocaleString("id-ID"):c.symbol+" "+Number(amt||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); };
const today    = () => new Date().toISOString().slice(0,10);
const ym       = d => d?.slice(0,7)||"";
const mlFull   = s => { try{ const [y,m]=s.split("-"); return new Date(y,m-1).toLocaleDateString("id-ID",{month:"long",year:"numeric"}); }catch{ return s; } };
const mlShort  = s => { try{ const [y,m]=s.split("-"); return new Date(y,m-1).toLocaleDateString("id-ID",{month:"short",year:"2-digit"}); }catch{ return s; } };
const daysUntil= d => { const now=new Date(); let t=new Date(now.getFullYear(),now.getMonth(),d); if(t<=now) t=new Date(now.getFullYear(),now.getMonth()+1,d); return Math.ceil((t-now)/86400000); };
const urgColor = d => d<=2?"#ef4444":d<=5?"#f59e0b":d<=10?"#eab308":"#22c55e";
const uuid     = () => crypto.randomUUID();

// ─── THEME ────────────────────────────────────────────────────
const DARK = {
  bg:"#050510",bgNav:"rgba(8,8,22,0.97)",bgCard:"rgba(255,255,255,0.028)",
  bgCardHov:"rgba(255,255,255,0.048)",bgInput:"rgba(255,255,255,0.05)",
  bgModal:"rgba(8,8,22,0.99)",border:"rgba(255,255,255,0.08)",
  borderFoc:"rgba(99,102,241,0.6)",text:"#f1f5f9",textSub:"#94a3b8",
  textMuted:"#475569",textFaint:"#1e293b",shadow:"0 8px 40px rgba(0,0,0,0.5)",
};
const LIGHT = {
  bg:"#f8fafc",bgNav:"rgba(255,255,255,0.97)",bgCard:"#ffffff",
  bgCardHov:"#f1f5f9",bgInput:"#f8fafc",bgModal:"#ffffff",
  border:"rgba(0,0,0,0.08)",borderFoc:"rgba(99,102,241,0.5)",
  text:"#0f172a",textSub:"#475569",textMuted:"#94a3b8",textFaint:"#e2e8f0",
  shadow:"0 4px 24px rgba(0,0,0,0.08)",
};

// ─── AI HELPERS ───────────────────────────────────────────────
async function aiScanReceipt(base64,mime) {
  const res = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"claude-sonnet-4-20250514",
      max_tokens:1000,
      messages:[{role:"user",content:[
        {type:"image",source:{type:"base64",media_type:mime,data:base64}},
        {type:"text",text:`Ekstrak data dari foto struk/nota/mutasi bank ini. Response HANYA JSON:
{
  "amount": <nominal angka tanpa titik/koma>,
  "currency": <"IDR" atau kode lain>,
  "date": <"YYYY-MM-DD" atau null>,
  "merchant": <nama merchant/toko>,
  "last4": <4 digit kartu atau null>,
  "category": <salah satu: "Belanja","Makan & Minum","Transport","Tagihan","Hotel/Travel","Elektronik","Kesehatan","Hiburan","Lainnya">,
  "fee": <fee/admin jika ada, default 0>,
  "type": <"in" atau "out">,
  "notes": <catatan tambahan>
}`}
      ]}]
    })
  });
  const d = await res.json();
  const txt = d.content?.[0]?.text||"{}";
  return JSON.parse(txt.replace(/```json|```/g,"").trim());
}

async function aiCategorize(description) {
  const res = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"claude-sonnet-4-20250514",
      max_tokens:100,
      messages:[{role:"user",content:`Kategorikan transaksi bank ini ke salah satu: Gaji, Transfer Masuk, Tarik Tunai, Belanja, Makan & Minum, Transport, Tagihan, Investasi, Lainnya.
Deskripsi: "${description}"
Response HANYA nama kategori, tidak ada teks lain.`}]
    })
  });
  const d = await res.json();
  return d.content?.[0]?.text?.trim()||"Lainnya";
}

async function aiFinancialAdvisor(question, context) {
  const res = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"claude-sonnet-4-20250514",
      max_tokens:1000,
      messages:[{role:"user",content:`Kamu adalah financial advisor pribadi untuk ${context.name||"user"}.

Data keuangan saat ini:
- Total saldo bank: ${fmtIDR(context.totalBank)}
- Total hutang CC: ${fmtIDR(context.totalCC)}
- Pengeluaran CC bulan ini: ${fmtIDR(context.ccSpent)}
- Jumlah kartu kredit: ${context.cardCount}
- Jumlah rekening bank: ${context.bankCount}

Pertanyaan: ${question}

Jawab dalam Bahasa Indonesia, singkat dan actionable. Max 200 kata.`}]
    })
  });
  const d = await res.json();
  return d.content?.[0]?.text||"Maaf, tidak bisa menjawab saat ini.";
}

// ─── SUPABASE API ─────────────────────────────────────────────
const api = {
  // Cards
  cards: {
    getAll: async(uid) => { const {data}=await supabase.from("cards").select("*").eq("user_id",uid).order("sort_order"); return data||[]; },
    create: async(uid,d) => { const {data}=await supabase.from("cards").insert([{...d,user_id:uid}]).select().single(); return data; },
    update: async(id,d) => { const {data}=await supabase.from("cards").update(d).eq("id",id).select().single(); return data; },
    delete: async(id) => supabase.from("cards").delete().eq("id",id),
  },
  // Transactions
  tx: {
    getAll: async(uid) => { const {data}=await supabase.from("transactions").select("*").eq("user_id",uid).order("tx_date",{ascending:false}); return data||[]; },
    create: async(uid,d) => { const {data}=await supabase.from("transactions").insert([{...d,user_id:uid}]).select().single(); return data; },
    update: async(id,d) => { const {data}=await supabase.from("transactions").update(d).eq("id",id).select().single(); return data; },
    delete: async(id) => supabase.from("transactions").delete().eq("id",id),
    toggleReimb: async(id,v) => supabase.from("transactions").update({reimbursed:v}).eq("id",id),
  },
  // Installments
  inst: {
    getAll: async(uid) => { const {data}=await supabase.from("installments").select("*").eq("user_id",uid); return data||[]; },
    create: async(uid,d) => { const {data}=await supabase.from("installments").insert([{...d,user_id:uid}]).select().single(); return data; },
    update: async(id,d) => { const {data}=await supabase.from("installments").update(d).eq("id",id).select().single(); return data; },
    delete: async(id) => supabase.from("installments").delete().eq("id",id),
    markPaid: async(id,n) => supabase.from("installments").update({paid_months:n}).eq("id",id),
  },
  // Budgets
  budgets: {
    getMonth: async(uid,my) => { const {data}=await supabase.from("budgets").select("*").eq("user_id",uid).eq("month_year",my); const r={Pribadi:0,Hamasa:0,SDC:0,Travelio:0,Lainnya:0}; (data||[]).forEach(b=>{r[b.entity]=Number(b.amount);}); return r; },
    upsertAll: async(uid,my,obj) => { const rows=Object.entries(obj).map(([entity,amount])=>({user_id:uid,entity,amount,month_year:my})); await supabase.from("budgets").upsert(rows,{onConflict:"user_id,entity,month_year"}); },
  },
  // Recurring
  recur: {
    getAll: async(uid) => { const {data}=await supabase.from("recurring_templates").select("*").eq("user_id",uid); return data||[]; },
    create: async(uid,d) => { const {data}=await supabase.from("recurring_templates").insert([{...d,user_id:uid}]).select().single(); return data; },
    update: async(id,d) => { const {data}=await supabase.from("recurring_templates").update(d).eq("id",id).select().single(); return data; },
    delete: async(id) => supabase.from("recurring_templates").delete().eq("id",id),
    toggle: async(id,v) => supabase.from("recurring_templates").update({active:v}).eq("id",id),
  },
  // FX
  fx: {
    getAll: async(uid) => { const {data}=await supabase.from("fx_rates").select("*").eq("user_id",uid); return Object.fromEntries((data||[]).map(r=>[r.currency,r.rate_to_idr])); },
    upsertAll: async(uid,obj) => { const rows=Object.entries(obj).map(([currency,rate_to_idr])=>({user_id:uid,currency,rate_to_idr})); await supabase.from("fx_rates").upsert(rows,{onConflict:"user_id,currency"}); },
  },
  // Bank accounts
  bank: {
    getAll: async(uid) => { const {data}=await supabase.from("bank_accounts").select("*").eq("user_id",uid).order("sort_order"); return data||[]; },
    create: async(uid,d) => { const {data}=await supabase.from("bank_accounts").insert([{...d,user_id:uid}]).select().single(); return data; },
    update: async(id,d) => { const {data}=await supabase.from("bank_accounts").update(d).eq("id",id).select().single(); return data; },
    delete: async(id) => supabase.from("bank_accounts").delete().eq("id",id),
    getBalance: async(uid,accId,initial) => {
      const {data}=await supabase.from("bank_mutations").select("amount,type,transfer_fee,cc_admin_fee,cc_materai").eq("user_id",uid).eq("account_id",accId);
      let bal=initial;
      (data||[]).forEach(m=>{
        if(m.type==="in") bal+=Number(m.amount);
        else if(m.type==="out") bal-=Number(m.amount);
        else if(m.type==="transfer") bal-=Number(m.amount)+(Number(m.transfer_fee)||0);
        bal-=(Number(m.cc_admin_fee)||0)+(Number(m.cc_materai)||0);
      });
      return bal;
    },
  },
  // Bank mutations
  mut: {
    getAll: async(uid) => { const {data}=await supabase.from("bank_mutations").select("*").eq("user_id",uid).order("mut_date",{ascending:false}); return data||[]; },
    getByAccount: async(uid,accId) => { const {data}=await supabase.from("bank_mutations").select("*").eq("user_id",uid).eq("account_id",accId).order("mut_date",{ascending:false}); return data||[]; },
    create: async(uid,d) => { const {data}=await supabase.from("bank_mutations").insert([{...d,user_id:uid}]).select().single(); return data; },
    update: async(id,d) => { const {data}=await supabase.from("bank_mutations").update(d).eq("id",id).select().single(); return data; },
    delete: async(id) => supabase.from("bank_mutations").delete().eq("id",id),
  },
  // Settings
  settings: {
    get: async(uid,key,def) => { const {data}=await supabase.from("app_settings").select("value").eq("user_id",uid).eq("key",key).single(); return data?.value!==undefined?JSON.parse(data.value):def; },
    set: async(uid,key,val) => supabase.from("app_settings").upsert({user_id:uid,key,value:JSON.stringify(val)},{onConflict:"user_id,key"}),
  },
};

// ─── CHART TOOLTIP ────────────────────────────────────────────
const CTip = ({active,payload,label,th}) => {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:th.bgModal,border:`1px solid ${th.border}`,borderRadius:12,padding:"10px 14px",boxShadow:th.shadow}}>
      <div style={{color:th.textMuted,fontSize:11,fontWeight:700,marginBottom:6}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:p.color||p.fill}}/>
          <span style={{color:th.textSub,fontSize:11}}>{p.name}:</span>
          <span style={{color:th.text,fontFamily:"monospace",fontWeight:700,fontSize:11}}>{fmtIDR(p.value,true)}</span>
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// AUTH GATE
// ═══════════════════════════════════════════════════════════════
function AuthGate({children}) {
  const [user,setUser]     = useState(null);
  const [loading,setLoading] = useState(true);
  const [mode,setMode]     = useState("login");
  const [email,setEmail]   = useState("");
  const [pass,setPass]     = useState("");
  const [err,setErr]       = useState("");
  const [busy,setBusy]     = useState(false);
  const th = DARK;

  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{setUser(data.user);setLoading(false);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,s)=>setUser(s?.user??null));
    return ()=>subscription.unsubscribe();
  },[]);

  const submit = async()=>{
    setErr(""); setBusy(true);
    try {
      if(mode==="login"){
        const {error}=await supabase.auth.signInWithPassword({email,password:pass});
        if(error) throw error;
      } else {
        const {error}=await supabase.auth.signUp({email,password:pass});
        if(error) throw error;
        setErr("✅ Akun dibuat! Cek email untuk konfirmasi.");
        setMode("login"); setBusy(false); return;
      }
    } catch(e){ setErr(e.message||"Error"); }
    setBusy(false);
  };

  if(loading) return (
    <div style={{minHeight:"100vh",background:th.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{width:32,height:32,border:"3px solid rgba(255,255,255,.1)",borderTop:"3px solid #6366f1",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if(!user) return (
    <div style={{minHeight:"100vh",background:th.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Plus Jakarta Sans',system-ui,sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap'); @keyframes spin{to{transform:rotate(360deg)}} *{box-sizing:border-box;margin:0;padding:0}`}</style>
      <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.08)",borderRadius:20,padding:"36px 32px",width:"100%",maxWidth:380,textAlign:"center"}}>
        <div style={{fontSize:52,marginBottom:14}}>💎</div>
        <div style={{fontSize:26,fontWeight:800,color:th.text,marginBottom:4}}>Paulus Finance</div>
        <div style={{fontSize:12,color:th.textMuted,marginBottom:28}}>Your Personal Financial OS</div>
        <div style={{display:"flex",background:"rgba(255,255,255,.04)",borderRadius:10,padding:3,marginBottom:20}}>
          {["login","signup"].map(m=><button key={m} onClick={()=>setMode(m)} style={{flex:1,border:"none",padding:"8px",borderRadius:8,fontFamily:"inherit",fontWeight:700,fontSize:13,cursor:"pointer",background:mode===m?"rgba(99,102,241,.2)":"transparent",color:mode===m?"#a5b4fc":"#475569",transition:"all .15s"}}>{m==="login"?"Masuk":"Daftar"}</button>)}
        </div>
        <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} style={{width:"100%",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",color:th.text,padding:"11px 14px",borderRadius:10,fontFamily:"inherit",fontSize:14,outline:"none",marginBottom:10,boxSizing:"border-box"}}/>
        <input type="password" placeholder="Password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} style={{width:"100%",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",color:th.text,padding:"11px 14px",borderRadius:10,fontFamily:"inherit",fontSize:14,outline:"none",marginBottom:err?10:0,boxSizing:"border-box"}}/>
        {err&&<div style={{fontSize:12,color:err.startsWith("✅")?"#4ade80":"#f87171",marginBottom:12,padding:"8px 12px",background:err.startsWith("✅")?"rgba(16,185,129,.08)":"rgba(239,68,68,.08)",border:`1px solid ${err.startsWith("✅")?"rgba(16,185,129,.2)":"rgba(239,68,68,.2)"}`,borderRadius:8,textAlign:"left"}}>{err}</div>}
        <button onClick={submit} disabled={busy} style={{width:"100%",background:"linear-gradient(135deg,#4f46e5,#7c3aed)",color:"white",border:"none",padding:"12px",borderRadius:10,fontFamily:"inherit",fontWeight:700,fontSize:14,cursor:"pointer",marginTop:12,opacity:busy?.7:1}}>{busy?"...":mode==="login"?"Masuk":"Buat Akun"}</button>
        <div style={{fontSize:11,color:"#1e293b",marginTop:16}}>Data tersimpan aman di Supabase · End-to-end private</div>
      </div>
    </div>
  );

  return children({user, signOut:()=>supabase.auth.signOut()});
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  return <AuthGate>{({user,signOut})=><Finance user={user} signOut={signOut}/>}</AuthGate>;
}

function Finance({user, signOut}) {
  const [isDark,setIsDark]       = useState(true);
  const [tab,setTab]             = useState("dashboard");
  const [loading,setLoading]     = useState(true);
  const [saving,setSaving]       = useState(false);

  // ── CC Data
  const [cards,setCards]         = useState([]);
  const [txList,setTxList]       = useState([]);
  const [instList,setInstList]   = useState([]);
  const [budgets,setBudgets]     = useState({Pribadi:0,Hamasa:0,SDC:0,Travelio:0,Lainnya:0});
  const [recurList,setRecurList] = useState([]);
  const [fxRates,setFxRates]     = useState({USD:16400,SGD:12200,MYR:3700,JPY:110,EUR:17800,AUD:10500});

  // ── Bank Data
  const [bankAccounts,setBankAccounts] = useState([]);
  const [mutations,setMutations]       = useState([]);
  const [bankBalances,setBankBalances] = useState({});

  // ── UI State
  const [showTxForm,setShowTxForm]         = useState(false);
  const [showCardForm,setShowCardForm]     = useState(false);
  const [showInstForm,setShowInstForm]     = useState(false);
  const [showRecurForm,setShowRecurForm]   = useState(false);
  const [showBudgetForm,setShowBudForm]    = useState(false);
  const [showFxPanel,setShowFxPanel]       = useState(false);
  const [showStatement,setShowStatement]   = useState(false);
  const [showScanner,setShowScanner]       = useState(false);
  const [showBankForm,setShowBankForm]     = useState(false);
  const [showMutForm,setShowMutForm]       = useState(false);
  const [showPayCC,setShowPayCC]           = useState(false);
  const [showAIChat,setShowAIChat]         = useState(false);
  const [detailCardId,setDetailCardId]     = useState(null);
  const [detailBankId,setDetailBankId]     = useState(null);

  // ── Edit IDs
  const [editTxId,setEditTxId]     = useState(null);
  const [editCardId,setEditCardId] = useState(null);
  const [editInstId,setEditInstId] = useState(null);
  const [editRecurId,setEditRecurId] = useState(null);
  const [editBankId,setEditBankId] = useState(null);
  const [editMutId,setEditMutId]   = useState(null);

  // ── Filters
  const [filterCard,setFilterCard]   = useState("all");
  const [filterReimb,setFilterReimb] = useState("all");
  const [filterMonth,setFilterMonth] = useState("all");
  const [filterEntity,setFilterEnt]  = useState("all");
  const [filterBank,setFilterBank]   = useState("all");
  const [filterMutType,setFilterMutType] = useState("all");
  const [searchQ,setSearchQ]         = useState("");
  const [searchMut,setSearchMut]     = useState("");
  const [statCard,setStatCard]       = useState("");

  // ── Scanner
  const [scanImg,setScanImg]         = useState(null);
  const [scanMime,setScanMime]       = useState("image/jpeg");
  const [scanLoading,setScanLoading] = useState(false);
  const [scanResult,setScanResult]   = useState(null);
  const [scanError,setScanError]     = useState("");
  const [scanTarget,setScanTarget]   = useState("cc"); // cc | bank
  const fileInputRef = useRef(null);

  // ── AI Chat
  const [aiMessages,setAiMessages] = useState([]);
  const [aiInput,setAiInput]       = useState("");
  const [aiLoading,setAiLoading]   = useState(false);

  // ── Pay CC
  const [payCC,setPayCC] = useState({cardId:"",bankId:"",amount:"",adminFee:"",materai:"",notes:""});

  const th = isDark ? DARK : LIGHT;
  const curMonth = ym(today());

  // Empty forms
  const ET = {tx_date:today(),card_id:"",description:"",amount:"",currency:"IDR",fee:"",category:"Belanja",entity:"Pribadi",reimbursed:false,notes:""};
  const EC = {name:"",bank:"BCA",last4:"",color:"#1d4ed8",accent:"#60a5fa",card_limit:"",statement_day:25,due_day:17,target_pct:30,network:"Visa"};
  const EI = {card_id:"",description:"",total_amount:"",months:12,start_date:today(),currency:"IDR",entity:"Pribadi"};
  const ER = {card_id:"",description:"",amount:"",currency:"IDR",fee:"",category:"Tagihan",entity:"Pribadi",frequency:"Bulanan",day_of_month:1,active:true};
  const EBA = {name:"",bank:"BCA",account_no:"",type:"pribadi",owner_entity:"",currency:"IDR",initial_balance:"",color:"#1d4ed8",accent:"#60a5fa",include_networth:true};
  const EMU = {account_id:"",mut_date:today(),description:"",amount:"",type:"out",category:"Lainnya",entity:"Pribadi",notes:"",transfer_to_account_id:"",transfer_fee:"",is_cc_payment:false,cc_card_id:"",cc_admin_fee:"",cc_materai:"",is_piutang:false,piutang_entity:"",piutang_description:""};

  const [txForm,setTxForm]   = useState(ET);
  const [cardForm,setCardForm] = useState(EC);
  const [instForm,setInstForm] = useState(EI);
  const [recurForm,setRecurForm] = useState(ER);
  const [bankForm,setBankForm] = useState(EBA);
  const [mutForm,setMutForm]   = useState(EMU);
  const [budgetForm,setBudForm] = useState(budgets);

  // ── Load all data
  useEffect(()=>{
    (async()=>{
      setLoading(true);
      const [c,t,i,b,r,fx,ba,mu,dark] = await Promise.all([
        api.cards.getAll(user.id),
        api.tx.getAll(user.id),
        api.inst.getAll(user.id),
        api.budgets.getMonth(user.id,curMonth),
        api.recur.getAll(user.id),
        api.fx.getAll(user.id),
        api.bank.getAll(user.id),
        api.mut.getAll(user.id),
        api.settings.get(user.id,"isDark",true),
      ]);
      setCards(c); setTxList(t); setInstList(i); setBudgets(b);
      setRecurList(r); if(Object.keys(fx).length) setFxRates(fx);
      setBankAccounts(ba); setMutations(mu); setIsDark(dark);
      if(c.length) setStatCard(c[0].id);
      setLoading(false);
    })();
  },[user.id]);

  // ── Save dark mode preference
  useEffect(()=>{ api.settings.set(user.id,"isDark",isDark); },[isDark]);

  // ── Compute bank balances
  useEffect(()=>{
    const bal = {};
    bankAccounts.forEach(acc=>{
      let b = Number(acc.initial_balance||0);
      mutations.filter(m=>m.account_id===acc.id).forEach(m=>{
        if(m.type==="in") b+=Number(m.amount);
        else if(m.type==="out") b-=Number(m.amount);
        else if(m.type==="transfer") b-=Number(m.amount)+(Number(m.transfer_fee)||0);
        b-=(Number(m.cc_admin_fee)||0)+(Number(m.cc_materai)||0);
      });
      // Transfer masuk dari akun lain
      mutations.filter(m=>m.transfer_to_account_id===acc.id).forEach(m=>{
        b+=Number(m.amount);
      });
      bal[acc.id] = b;
    });
    setBankBalances(bal);
  },[bankAccounts,mutations]);

  const cardMap    = useMemo(()=>Object.fromEntries(cards.map(c=>[c.id,c])),[cards]);
  const bankMap    = useMemo(()=>Object.fromEntries(bankAccounts.map(b=>[b.id,b])),[bankAccounts]);
  const txIDR      = useCallback(t=>toIDR(t.amount||0,t.currency||"IDR",fxRates)+(Number(t.fee)||0),[fxRates]);
  const allMonths  = useMemo(()=>[...new Set(txList.map(t=>ym(t.tx_date)))].sort().reverse(),[txList]);

  // ── CC Stats
  const stats = useMemo(()=>{
    const total    = txList.reduce((s,t)=>s+txIDR(t),0);
    const fees     = txList.reduce((s,t)=>s+(Number(t.fee)||0),0);
    const reimb    = txList.filter(t=>t.reimbursed).reduce((s,t)=>s+toIDR(t.amount||0,t.currency||"IDR",fxRates),0);
    const pending  = txList.filter(t=>!t.reimbursed).reduce((s,t)=>s+toIDR(t.amount||0,t.currency||"IDR",fxRates),0);
    const byEntity = Object.fromEntries(ENTITIES.map(e=>[e,txList.filter(t=>t.entity===e).reduce((s,t)=>s+txIDR(t),0)]));
    const thisMonth = txList.filter(t=>ym(t.tx_date)===curMonth);
    const ccDebt   = cards.reduce((s,c)=>{
      const spent = txList.filter(t=>t.card_id===c.id&&ym(t.tx_date)===curMonth).reduce((ss,t)=>ss+txIDR(t),0);
      return s+spent;
    },0);
    return{total,fees,reimb,pending,byEntity,txCount:txList.length,thisMonth,ccDebt};
  },[txList,txIDR,fxRates,curMonth,cards]);

  // ── Card stats
  const cardStats = useMemo(()=>cards.map(c=>{
    const allTx  = txList.filter(t=>t.card_id===c.id);
    const thisM  = allTx.filter(t=>ym(t.tx_date)===curMonth);
    const spent  = thisM.reduce((s,t)=>s+txIDR(t),0);
    const total  = allTx.reduce((s,t)=>s+txIDR(t),0);
    const reimb  = allTx.filter(t=>t.reimbursed).reduce((s,t)=>s+toIDR(t.amount||0,t.currency||"IDR",fxRates),0);
    const avail  = (c.card_limit||0)-spent;
    const pct    = c.card_limit>0?(spent/c.card_limit*100):0;
    return{...c,allTx,thisM,spent,total,reimb,avail,pct,txCount:allTx.length,dueIn:daysUntil(c.due_day),statIn:daysUntil(c.statement_day)};
  }),[cards,txList,curMonth,txIDR,fxRates]);

  // ── Budget stats
  const budgetStats = useMemo(()=>ENTITIES.map(e=>({
    entity:e,
    budget:budgets[e]||0,
    spent:txList.filter(t=>t.entity===e&&ym(t.tx_date)===curMonth).reduce((s,t)=>s+txIDR(t),0),
  })).map(b=>({...b,pct:b.budget>0?(b.spent/b.budget*100):0,remaining:Math.max(0,b.budget-b.spent)})),[budgets,txList,curMonth,txIDR]);

  // ── Bank stats
  const bankStats = useMemo(()=>{
    const totalPrivate  = bankAccounts.filter(a=>a.include_networth).reduce((s,a)=>s+(bankBalances[a.id]||0),0);
    const totalReimburse= bankAccounts.filter(a=>!a.include_networth).reduce((s,a)=>s+(bankBalances[a.id]||0),0);
    return{totalPrivate,totalReimburse,total:totalPrivate+totalReimburse};
  },[bankAccounts,bankBalances]);

  // ── Alerts
  const alerts = useMemo(()=>{
    const a=[];
    cardStats.forEach(c=>{ if(c.dueIn<=5) a.push({id:`due-${c.id}`,type:"danger",icon:"⚠️",title:`JT: ${c.name}`,msg:`Jatuh tempo ${c.dueIn} hari lagi`}); });
    budgetStats.forEach(b=>{ if(b.pct>=100) a.push({id:`bud-${b.entity}`,type:"danger",icon:"🚨",title:`Budget ${b.entity} Habis`,msg:`${b.pct.toFixed(0)}% terpakai`}); else if(b.pct>=80) a.push({id:`bw-${b.entity}`,type:"warning",icon:"💸",title:`Budget ${b.entity} 80%+`,msg:`${b.pct.toFixed(0)}% — sisa ${fmtIDR(b.remaining,true)}`}); });
    return a;
  },[cardStats,budgetStats]);

  // ── Chart data
  const chartData = useMemo(()=>{
    const months=[...new Set(txList.map(t=>ym(t.tx_date)))].sort().slice(-6);
    return months.map(m=>{ const txs=txList.filter(t=>ym(t.tx_date)===m); const r={month:mlShort(m)}; ENTITIES.forEach(e=>{r[e]=txs.filter(t=>t.entity===e).reduce((s,t)=>s+txIDR(t),0);}); r.Total=txs.reduce((s,t)=>s+txIDR(t),0); r.Reimburse=txs.filter(t=>t.reimbursed).reduce((s,t)=>s+toIDR(t.amount||0,t.currency||"IDR",fxRates),0); return r; });
  },[txList,txIDR,fxRates]);

  // ── Filtered transactions
  const filtered = useMemo(()=>txList
    .filter(t=>filterCard==="all"||t.card_id===filterCard)
    .filter(t=>filterReimb==="all"||String(t.reimbursed)===filterReimb)
    .filter(t=>filterMonth==="all"||ym(t.tx_date)===filterMonth)
    .filter(t=>filterEntity==="all"||t.entity===filterEntity)
    .filter(t=>!searchQ||t.description?.toLowerCase().includes(searchQ.toLowerCase()))
    .sort((a,b)=>b.tx_date?.localeCompare(a.tx_date)),[txList,filterCard,filterReimb,filterMonth,filterEntity,searchQ]);

  // ── Filtered mutations
  const filteredMut = useMemo(()=>mutations
    .filter(m=>filterBank==="all"||m.account_id===filterBank)
    .filter(m=>filterMutType==="all"||m.type===filterMutType)
    .filter(m=>!searchMut||m.description?.toLowerCase().includes(searchMut.toLowerCase()))
    .sort((a,b)=>b.mut_date?.localeCompare(a.mut_date)),[mutations,filterBank,filterMutType,searchMut]);

  const instStats = useMemo(()=>instList.map(i=>{
    const m=i.monthly_amount||Math.round((i.total_amount||0)/(i.months||1));
    const rem=i.months-i.paid_months;
    return{...i,monthly:m,remaining:rem,remainingAmt:m*rem,paidAmt:m*i.paid_months,pct:((i.paid_months||0)/(i.months||1))*100};
  }),[instList]);

  const entityPie = ENTITIES.map(e=>({name:e,value:stats.byEntity[e]||0})).filter(d=>d.value>0);

  // ── HANDLERS CC ───────────────────────────────────────────────
  const submitTx = async()=>{
    if(!txForm.description||!txForm.amount||!txForm.card_id) return;
    setSaving(true);
    const d={...txForm,amount:Number(txForm.amount),fee:Number(txForm.fee||0),amount_idr:toIDR(Number(txForm.amount),txForm.currency,fxRates)};
    if(editTxId){ const r=await api.tx.update(editTxId,d); setTxList(p=>p.map(t=>t.id===editTxId?r:t)); setEditTxId(null); }
    else{ const r=await api.tx.create(user.id,d); setTxList(p=>[r,...p]); }
    setTxForm({...ET,card_id:cards[0]?.id||""}); setShowTxForm(false); setSaving(false);
  };
  const submitCard = async()=>{
    if(!cardForm.name||!cardForm.last4||!cardForm.card_limit) return;
    setSaving(true);
    const d={...cardForm,card_limit:Number(cardForm.card_limit),statement_day:Number(cardForm.statement_day),due_day:Number(cardForm.due_day),target_pct:Number(cardForm.target_pct)};
    if(editCardId){ const r=await api.cards.update(editCardId,d); setCards(p=>p.map(c=>c.id===editCardId?r:c)); setEditCardId(null); }
    else{ const r=await api.cards.create(user.id,d); setCards(p=>[...p,r]); }
    setCardForm(EC); setShowCardForm(false); setSaving(false);
  };
  const submitInst = async()=>{
    if(!instForm.description||!instForm.total_amount||!instForm.card_id) return;
    setSaving(true);
    const m=Math.round(Number(instForm.total_amount)/Number(instForm.months));
    const d={...instForm,total_amount:Number(instForm.total_amount),months:Number(instForm.months),monthly_amount:m,paid_months:0};
    if(editInstId){ const r=await api.inst.update(editInstId,d); setInstList(p=>p.map(i=>i.id===editInstId?r:i)); setEditInstId(null); }
    else{ const r=await api.inst.create(user.id,d); setInstList(p=>[...p,r]); }
    setInstForm({...EI,card_id:cards[0]?.id||""}); setShowInstForm(false); setSaving(false);
  };
  const submitRecur = async()=>{
    if(!recurForm.description||!recurForm.amount||!recurForm.card_id) return;
    setSaving(true);
    const d={...recurForm,amount:Number(recurForm.amount),fee:Number(recurForm.fee||0),day_of_month:Number(recurForm.day_of_month)};
    if(editRecurId){ const r=await api.recur.update(editRecurId,d); setRecurList(p=>p.map(r2=>r2.id===editRecurId?r:r2)); setEditRecurId(null); }
    else{ const r=await api.recur.create(user.id,d); setRecurList(p=>[...p,r]); }
    setRecurForm({...ER,card_id:cards[0]?.id||""}); setShowRecurForm(false); setSaving(false);
  };
  const saveBudgets = async()=>{ setSaving(true); await api.budgets.upsertAll(user.id,curMonth,budgetForm); setBudgets(budgetForm); setShowBudForm(false); setSaving(false); };
  const editTxFn  = t=>{ setTxForm({...t,amount:String(t.amount),fee:String(t.fee||""),tx_date:t.tx_date||today()}); setEditTxId(t.id); setShowTxForm(true); };
  const deleteTx  = async id=>{ await api.tx.delete(id); setTxList(p=>p.filter(t=>t.id!==id)); };
  const togReimb  = async(id,v)=>{ await api.tx.toggleReimb(id,!v); setTxList(p=>p.map(t=>t.id===id?{...t,reimbursed:!t.reimbursed}:t)); };
  const editCardFn= c=>{ setCardForm({...c,card_limit:String(c.card_limit)}); setEditCardId(c.id); setShowCardForm(true); };
  const delCard   = async id=>{ if(window.confirm("Hapus kartu?")){ await api.cards.delete(id); setCards(p=>p.filter(c=>c.id!==id)); } };
  const markPaid  = async i=>{ await api.inst.markPaid(i.id,i.paid_months+1); setInstList(p=>p.map(x=>x.id===i.id?{...x,paid_months:x.paid_months+1}:x)); };
  const delInst   = async id=>{ await api.inst.delete(id); setInstList(p=>p.filter(i=>i.id!==id)); };
  const togRecur  = async(id,v)=>{ await api.recur.toggle(id,!v); setRecurList(p=>p.map(r=>r.id===id?{...r,active:!r.active}:r)); };
  const delRecur  = async id=>{ await api.recur.delete(id); setRecurList(p=>p.filter(r=>r.id!==id)); };
  const applyRecur= async r=>{ setSaving(true); const d={tx_date:today(),card_id:r.card_id,description:r.description,amount:r.amount,currency:r.currency,fee:r.fee||0,category:r.category,entity:r.entity,reimbursed:false,notes:`Auto recurring (${r.frequency})`,is_recurring:true,amount_idr:toIDR(r.amount,r.currency,fxRates)}; const res=await api.tx.create(user.id,d); setTxList(p=>[res,...p]); setSaving(false); };

  // ── HANDLERS BANK ─────────────────────────────────────────────
  const submitBank = async()=>{
    if(!bankForm.name||!bankForm.bank) return;
    setSaving(true);
    const d={...bankForm,initial_balance:Number(bankForm.initial_balance||0),include_networth:bankForm.type==="pribadi"};
    if(editBankId){ const r=await api.bank.update(editBankId,d); setBankAccounts(p=>p.map(b=>b.id===editBankId?r:b)); setEditBankId(null); }
    else{ const r=await api.bank.create(user.id,d); setBankAccounts(p=>[...p,r]); }
    setBankForm(EBA); setShowBankForm(false); setSaving(false);
  };
  const submitMut = async()=>{
    if(!mutForm.account_id||!mutForm.description||!mutForm.amount) return;
    setSaving(true);
    const d={...mutForm,amount:Number(mutForm.amount),transfer_fee:Number(mutForm.transfer_fee||0),cc_admin_fee:Number(mutForm.cc_admin_fee||0),cc_materai:Number(mutForm.cc_materai||0)};
    // Auto categorize dengan AI kalau belum ada kategori
    if(!d.category||d.category==="Lainnya"){
      try{ d.category=await aiCategorize(d.description); d.ai_categorized=true; }catch{}
    }
    if(editMutId){ const r=await api.mut.update(editMutId,d); setMutations(p=>p.map(m=>m.id===editMutId?r:m)); setEditMutId(null); }
    else{ const r=await api.mut.create(user.id,d); setMutations(p=>[r,...p]); }
    setMutForm({...EMU,account_id:bankAccounts[0]?.id||""}); setShowMutForm(false); setSaving(false);
  };
  const submitPayCC = async()=>{
    if(!payCC.cardId||!payCC.bankId||!payCC.amount) return;
    setSaving(true);
    const d={account_id:payCC.bankId,mut_date:today(),description:`Bayar CC ${cardMap[payCC.cardId]?.name||""}`,amount:Number(payCC.amount),type:"out",category:"Tagihan",entity:"Pribadi",is_cc_payment:true,cc_card_id:payCC.cardId,cc_payment_amount:Number(payCC.amount),cc_admin_fee:Number(payCC.adminFee||0),cc_materai:Number(payCC.materai||0),notes:payCC.notes||""};
    const r=await api.mut.create(user.id,d); setMutations(p=>[r,...p]);
    setPayCC({cardId:"",bankId:"",amount:"",adminFee:"",materai:"",notes:""}); setShowPayCC(false); setSaving(false);
  };
  const delBank = async id=>{ if(window.confirm("Hapus rekening ini?")){ await api.bank.delete(id); setBankAccounts(p=>p.filter(b=>b.id!==id)); } };
  const delMut  = async id=>{ await api.mut.delete(id); setMutations(p=>p.filter(m=>m.id!==id)); };

  // ── SCANNER ───────────────────────────────────────────────────
  const handleFile = e=>{
    const f=e.target.files?.[0]; if(!f) return;
    setScanMime(f.type||"image/jpeg"); setScanResult(null); setScanError("");
    const reader=new FileReader();
    reader.onload=ev=>setScanImg(ev.target.result.split(",")[1]);
    reader.readAsDataURL(f);
  };
  const runScan = async()=>{
    if(!scanImg) return;
    setScanLoading(true); setScanError("");
    try{
      const r=await aiScanReceipt(scanImg,scanMime);
      setScanResult(r);
      if(scanTarget==="cc"){
        const mc=r.last4?cards.find(c=>c.last4===r.last4):null;
        setTxForm(f=>({...f,description:r.merchant||f.description,amount:r.amount?String(r.amount):f.amount,currency:r.currency||"IDR",tx_date:r.date||today(),category:r.category||"Lainnya",fee:r.fee?String(r.fee):"",notes:r.notes||"",card_id:mc?.id||f.card_id}));
      } else {
        setMutForm(f=>({...f,description:r.merchant||f.description,amount:r.amount?String(r.amount):f.amount,mut_date:r.date||today(),type:r.type||"out",category:r.category||"Lainnya",notes:r.notes||""}));
      }
    }catch(e){ setScanError("Gagal scan. Pastikan foto jelas."); }
    setScanLoading(false);
  };
  const confirmScan=()=>{ setShowScanner(false); setScanImg(null); setScanResult(null); if(scanTarget==="cc") setShowTxForm(true); else setShowMutForm(true); };

  // ── AI CHAT ───────────────────────────────────────────────────
  const sendAI = async()=>{
    if(!aiInput.trim()) return;
    const q=aiInput; setAiInput(""); setAiLoading(true);
    setAiMessages(p=>[...p,{role:"user",text:q}]);
    const ctx={name:user.email,totalBank:bankStats.totalPrivate,totalCC:stats.ccDebt,ccSpent:stats.stats?.thisMonth?.reduce((s,t)=>s+txIDR(t),0)||0,cardCount:cards.length,bankCount:bankAccounts.length};
    const ans=await aiFinancialAdvisor(q,ctx);
    setAiMessages(p=>[...p,{role:"ai",text:ans}]);
    setAiLoading(false);
  };

  const saveFx = async()=>{ await api.fx.upsertAll(user.id,fxRates); setShowFxPanel(false); };

  const detailCard = detailCardId?cardStats.find(c=>c.id===detailCardId):null;
  const detailBank = detailBankId?bankAccounts.find(b=>b.id===detailBankId):null;

  const TABS = [
    {id:"dashboard",icon:"◈",label:"Dashboard"},
    {id:"cc",icon:"💳",label:"CC Tracker"},
    {id:"bank",icon:"🏦",label:"Bank"},
    {id:"piutang",icon:"📋",label:"Piutang"},
    {id:"asset",icon:"📈",label:"Asset"},
    {id:"income",icon:"💰",label:"Income"},
    {id:"calendar",icon:"📅",label:"Calendar"},
    {id:"settings",icon:"⚙️",label:"Settings"},
  ];

  if(loading) return (
    <div style={{minHeight:"100vh",background:th.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,fontFamily:"'Plus Jakarta Sans',system-ui"}}>
      <style>{GLOBAL_CSS}</style>
      <div style={{width:40,height:40,border:"3px solid rgba(99,102,241,.2)",borderTop:"3px solid #6366f1",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      <div style={{color:th.textMuted,fontSize:13}}>Memuat Paulus Finance...</div>
    </div>
  );

  return (
    <div style={{display:"flex",minHeight:"100vh",background:th.bg,color:th.text,fontFamily:"'Plus Jakarta Sans',system-ui,sans-serif",transition:"background .3s,color .3s"}}>
      <style>{GLOBAL_CSS+dynamicCSS(th)}</style>

      {/* ── SIDEBAR */}
      <nav className="sidebar">
        <div>
          <div className="brand">
            <div className="brand-icon">💎</div>
            <div>
              <div className="brand-name">Paulus Finance</div>
              <div className="brand-sub">Personal Financial OS</div>
            </div>
          </div>
          <div style={{padding:"0 10px",marginBottom:8}}>
            {TABS.map(t=>(
              <button key={t.id} className={`side-btn ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>
                <span style={{fontSize:15,width:22,textAlign:"center",flexShrink:0}}>{t.icon}</span>
                <span>{t.label}</span>
                {t.id==="dashboard"&&alerts.length>0&&<span className="badge">{alerts.length}</span>}
                {(t.id==="piutang"||t.id==="asset"||t.id==="income"||t.id==="calendar")&&<span style={{fontSize:9,background:"rgba(99,102,241,.2)",color:"#818cf8",padding:"1px 5px",borderRadius:4,marginLeft:"auto"}}>Soon</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="side-footer">
          <button className="side-act" onClick={()=>setShowAIChat(true)}>🤖 AI Advisor</button>
          <button className="side-act" onClick={()=>setShowFxPanel(true)}>💱 Update Kurs</button>
          <button className="side-act" onClick={()=>setIsDark(d=>!d)}>{isDark?"☀️ Light":"🌙 Dark"} Mode</button>
          <button className="side-act" onClick={signOut} style={{color:"#f87171"}}>🚪 Sign Out</button>
        </div>
      </nav>

      {/* ── BOTTOM NAV (mobile) */}
      <div className="bottom-nav">
        {TABS.slice(0,5).map(t=>(
          <button key={t.id} className={`bot-btn ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>
            <span style={{fontSize:18}}>{t.icon}</span>
            <span style={{fontSize:9,marginTop:1}}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── MAIN */}
      <main className="main">
        {/* TOPBAR */}
        <div className="topbar">
          <div>
            <div className="page-title">{TABS.find(t=>t.id===tab)?.label||"Dashboard"}</div>
            <div className="page-sub">{new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            {saving&&<div style={{fontSize:11,color:th.textMuted,display:"flex",alignItems:"center",gap:4}}><div style={{width:12,height:12,border:"2px solid rgba(99,102,241,.3)",borderTop:"2px solid #6366f1",borderRadius:"50%",animation:"spin .6s linear infinite"}}/>Menyimpan...</div>}
            {alerts.length>0&&<div className="alert-dot">{alerts.length}</div>}
            <button className="btn-theme" onClick={()=>setIsDark(d=>!d)}>{isDark?"☀️":"🌙"}</button>
            <button className="btn-scan" onClick={()=>{setScanImg(null);setScanResult(null);setScanError("");setScanTarget("cc");setShowScanner(true);}}>📷 Scan</button>
            {tab==="cc"&&<button className="btn-add" onClick={()=>{setEditTxId(null);setTxForm({...ET,card_id:cards[0]?.id||""});setShowTxForm(true);}}>+ Transaksi CC</button>}
            {tab==="bank"&&<button className="btn-add" onClick={()=>{setShowBankForm(true);setEditBankId(null);setBankForm(EBA);}}>+ Rekening</button>}
          </div>
        </div>

        <div className="content">

          {/* ALERTS */}
          {alerts.length>0&&tab==="dashboard"&&(
            <div style={{marginBottom:18}}>
              {alerts.slice(0,3).map(a=>(
                <div key={a.id} className={`alert-bar ${a.type}`}>
                  <span style={{fontSize:16}}>{a.icon}</span>
                  <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13}}>{a.title}</div><div style={{fontSize:11,opacity:.8,marginTop:1}}>{a.msg}</div></div>
                </div>
              ))}
            </div>
          )}

          {/* ══ DASHBOARD ══ */}
          {tab==="dashboard"&&(<>
            {/* Net Worth Preview */}
            <div className="glass-card anim-in" style={{padding:"18px 20px",marginBottom:16,borderLeft:"3px solid #6366f1",background:"linear-gradient(135deg,rgba(79,70,229,.08),rgba(99,102,241,.03))"}}>
              <div style={{fontSize:10,color:th.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Saldo Bank Pribadi</div>
              <div style={{fontSize:28,fontWeight:900,fontFamily:"monospace",color:"#a5b4fc",letterSpacing:-.5}}>{fmtIDR(bankStats.totalPrivate)}</div>
              <div style={{display:"flex",gap:16,marginTop:8}}>
                <div style={{fontSize:11,color:th.textMuted}}>Hutang CC: <span style={{color:"#f87171",fontWeight:700}}>{fmtIDR(stats.ccDebt)}</span></div>
                <div style={{fontSize:11,color:th.textMuted}}>Rekening Reimburse: <span style={{color:"#f59e0b",fontWeight:700}}>{fmtIDR(bankStats.totalReimburse)}</span></div>
              </div>
              <div style={{fontSize:11,color:"#6366f1",marginTop:6,fontWeight:700}}>Net: {fmtIDR(bankStats.totalPrivate-stats.ccDebt)} <span style={{color:th.textMuted,fontWeight:400}}>(saldo - hutang CC)</span></div>
            </div>

            {/* Hero Stats */}
            <div className="hero-grid">
              {[
                ["CC Bulan Ini","💳",fmtIDR(stats.thisMonth?.reduce((s,t)=>s+txIDR(t),0)||0),`${stats.txCount} total tx`,"rgba(79,70,229,.2)","#818cf8"],
                ["Hutang CC","⚠️",fmtIDR(stats.ccDebt),"belum dibayar","rgba(239,68,68,.15)","#f87171"],
                ["Bank Pribadi","🏦",fmtIDR(bankStats.totalPrivate,true),`${bankAccounts.filter(b=>b.include_networth).length} rekening`,"rgba(16,185,129,.15)","#4ade80"],
                ["Total Fee CC","💸",fmtIDR(stats.fees,true),"gestun & fee","rgba(245,158,11,.15)","#f59e0b"],
              ].map(([l,ic,v,sub,bg,col])=>(
                <div key={l} className="hero-card anim-in" style={{background:bg,borderColor:col+"44"}}>
                  <div style={{fontSize:22,marginBottom:6}}>{ic}</div>
                  <div style={{fontSize:10,color:th.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
                  <div style={{fontSize:15,fontWeight:900,fontFamily:"monospace",color:col,marginTop:2}}>{v}</div>
                  <div style={{fontSize:10,color:th.textMuted,marginTop:2}}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Budget */}
            <div className="sec-head"><div className="sec-label">Budget Entitas Bulan Ini</div><button className="link-btn" onClick={()=>{setBudForm({...budgets});setShowBudForm(true);}}>Edit</button></div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:22}}>
              {budgetStats.map(b=>{
                const over=b.pct>=100,warn=b.pct>=80;
                const bc=over?"#ef4444":warn?"#f59e0b":ENTITY_COLORS[b.entity];
                return(
                  <div key={b.entity} className="glass-card anim-in" style={{padding:"14px 16px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:7,height:7,borderRadius:"50%",background:ENTITY_COLORS[b.entity]}}/><span style={{fontSize:12,fontWeight:700}}>{b.entity}</span></div>
                      <span style={{fontSize:11,color:bc,fontWeight:700}}>{b.pct.toFixed(0)}%{over?" 🚨":warn?" ⚠️":""}</span>
                    </div>
                    <div style={{height:5,background:th.border,borderRadius:3,overflow:"hidden",marginBottom:5}}>
                      <div style={{height:"100%",width:Math.min(b.pct,100)+"%",background:bc,borderRadius:3,transition:"width .6s"}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}>
                      <span style={{color:th.textSub,fontFamily:"monospace"}}>{fmtIDR(b.spent,true)}</span>
                      <span style={{color:th.textMuted,fontFamily:"monospace"}}>/ {fmtIDR(b.budget,true)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Charts */}
            <div className="sec-label" style={{marginBottom:10}}>Pemakaian CC 6 Bulan</div>
            <div className="glass-card anim-in" style={{padding:16,marginBottom:12}}>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} margin={{top:0,right:0,left:-18,bottom:0}} barSize={22}>
                  <XAxis dataKey="month" tick={{fill:th.textMuted,fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:th.textMuted,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtIDR(v,true)}/>
                  <Tooltip content={<CTip th={th}/>}/>
                  {ENTITIES.map((e,i)=><Bar key={e} dataKey={e} stackId="a" fill={ENTITY_COLORS[e]} radius={i===ENTITIES.length-1?[3,3,0,0]:[0,0,0,0]}/>)}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="glass-card anim-in" style={{padding:16,marginBottom:22}}>
              <div style={{fontSize:10,color:th.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:10}}>Trend Total vs Reimburse</div>
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={chartData} margin={{top:5,right:5,left:-18,bottom:0}}>
                  <defs>
                    <linearGradient id="gT" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={.3}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient>
                    <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={{fill:th.textMuted,fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:th.textMuted,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtIDR(v,true)}/>
                  <Tooltip content={<CTip th={th}/>}/>
                  <Area type="monotone" dataKey="Total" stroke="#6366f1" strokeWidth={2} fill="url(#gT)" dot={{r:3,fill:"#6366f1"}} name="Total CC"/>
                  <Area type="monotone" dataKey="Reimburse" stroke="#10b981" strokeWidth={2} fill="url(#gR)" dot={{r:3,fill:"#10b981"}} name="Reimburse" strokeDasharray="5 3"/>
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Cards quick view */}
            <div className="sec-head"><div className="sec-label">Kartu Kredit</div><button className="link-btn" onClick={()=>setTab("cc")}>Lihat Semua</button></div>
            {cardStats.slice(0,3).map((c,i)=>{
              const over=c.pct>c.target_pct;
              const sc=c.pct>80?"#ef4444":over?"#f59e0b":"#22c55e";
              return(
                <div key={c.id} className="glass-card card-hov anim-in" style={{padding:14,marginBottom:9,cursor:"pointer",animationDelay:`${i*.04}s`}} onClick={()=>{setDetailCardId(c.id);}}>
                  <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:9}}>
                    <div style={{width:38,height:38,borderRadius:10,background:`linear-gradient(135deg,${c.color},${c.accent})`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>💳</div>
                    <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13}}>{c.name}</div><div style={{fontSize:10,color:th.textMuted}}>···· {c.last4} · JT Tgl {c.due_day} · {c.dueIn} hari</div></div>
                    <div style={{textAlign:"right"}}><div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:sc}}>{fmtIDR(c.spent,true)}</div><div style={{fontSize:10,color:th.textMuted}}>/ {fmtIDR(c.card_limit,true)}</div></div>
                  </div>
                  <div style={{position:"relative",height:5,background:th.border,borderRadius:3,marginBottom:4}}>
                    <div style={{height:"100%",width:Math.min(c.pct,100)+"%",background:`linear-gradient(90deg,${c.color},${c.accent})`,borderRadius:3}}/>
                    <div style={{position:"absolute",top:-3,left:c.target_pct+"%",width:2,height:11,background:"#f59e0b",borderRadius:1,opacity:.8}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:th.textMuted}}>
                    <span style={{color:over?"#f59e0b":th.textMuted}}>{c.pct.toFixed(1)}%{over?" ⚠️":""}</span>
                    <span>Target {c.target_pct}% · Sisa {fmtIDR(c.avail,true)}</span>
                  </div>
                </div>
              );
            })}

            {/* Bank quick view */}
            <div className="sec-head" style={{marginTop:8}}><div className="sec-label">Rekening Bank</div><button className="link-btn" onClick={()=>setTab("bank")}>Lihat Semua</button></div>
            {bankAccounts.slice(0,4).map((b,i)=>(
              <div key={b.id} className="glass-card anim-in" style={{padding:"12px 14px",marginBottom:8,animationDelay:`${i*.03}s`,borderLeft:`3px solid ${b.include_networth?"#6366f1":"#f59e0b"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <div style={{width:34,height:34,borderRadius:9,background:`linear-gradient(135deg,${b.color||"#1d4ed8"},${b.accent||"#60a5fa"})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>🏦</div>
                    <div><div style={{fontWeight:700,fontSize:13}}>{b.name}</div><div style={{fontSize:10,color:th.textMuted}}>{b.bank}{b.account_no?` · ${b.account_no}`:""} · <span style={{color:b.include_networth?"#6366f1":"#f59e0b"}}>{b.include_networth?"Pribadi":"Reimburse"}</span></div></div>
                  </div>
                  <div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:b.include_networth?"#a5b4fc":"#fcd34d"}}>{fmtIDR(bankBalances[b.id]||0,true)}</div>
                </div>
              </div>
            ))}
          </>)}

          {/* ══ CC TRACKER ══ */}
          {tab==="cc"&&(<>
            {/* CC Sub-tabs */}
            <div style={{display:"flex",gap:0,marginBottom:18,background:th.bgInput,borderRadius:11,padding:3,border:`1px solid ${th.border}`}}>
              {[["cards","💳 Kartu"],["transactions","≡ Transaksi"],["installments","⟳ Cicilan"],["recurring","↺ Recurring"],["budget","◎ Budget"]].map(([id,label])=>(
                <button key={id} onClick={()=>setFilterCard(id==="cards"?"__cards":filterCard)} className={`subtab-btn`} style={{flex:1,background:filterCard===id?"rgba(99,102,241,.15)":"transparent",color:filterCard===id?"#a5b4fc":th.textMuted,border:"none",padding:"7px 4px",borderRadius:8,fontFamily:"inherit",fontWeight:700,fontSize:11,cursor:"pointer",transition:"all .15s",whiteSpace:"nowrap"}} onClick={()=>{ if(id==="cards"||id==="transactions"||id==="installments"||id==="recurring"||id==="budget")  }}>
                  {label}
                </button>
              ))}
            </div>
            <CCContent
              cards={cards} cardStats={cardStats} txList={txList} filtered={filtered}
              instStats={instStats} instList={instList} recurList={recurList} budgetStats={budgetStats}
              fxRates={fxRates} th={th} filterCard={filterCard} setFilterCard={setFilterCard}
              filterReimb={filterReimb} setFilterReimb={setFilterReimb} filterMonth={filterMonth}
              setFilterMonth={setFilterMonth} filterEntity={filterEntity} setFilterEnt={setFilterEnt}
              searchQ={searchQ} setSearchQ={setSearchQ} allMonths={allMonths} cardMap={cardMap}
              txIDR={txIDR} statCard={statCard} setStatCard={setStatCard}
              showStatement={showStatement} setShowStatement={setShowStatement}
              statData={null} curMonth={curMonth}
              onEditTx={editTxFn} onDeleteTx={deleteTx} onTogReimb={togReimb}
              onEditCard={editCardFn} onDelCard={delCard}
              onMarkPaid={markPaid} onDelInst={delInst}
              onTogRecur={togRecur} onDelRecur={delRecur} onApplyRecur={applyRecur}
              onEditRecur={r=>{ setRecurForm({...r,amount:String(r.amount),fee:String(r.fee||""),day_of_month:String(r.day_of_month)}); setEditRecurId(r.id); setShowRecurForm(true); }}
              onEditInst={i=>{ setInstForm({...i,total_amount:String(i.total_amount),months:String(i.months)}); setEditInstId(i.id); setShowInstForm(true); }}
              onNewCard={()=>{setEditCardId(null);setCardForm(EC);setShowCardForm(true);}}
              onNewTx={()=>{setEditTxId(null);setTxForm({...ET,card_id:cards[0]?.id||""});setShowTxForm(true);}}
              onNewInst={()=>{setEditInstId(null);setInstForm({...EI,card_id:cards[0]?.id||""});setShowInstForm(true);}}
              onNewRecur={()=>{setEditRecurId(null);setRecurForm({...ER,card_id:cards[0]?.id||""});setShowRecurForm(true);}}
              onEditBudget={()=>{setBudForm({...budgets});setShowBudForm(true);}}
              onDetailCard={setDetailCardId}
              onPayCC={()=>setShowPayCC(true)}
            />
          </>)}

          {/* ══ BANK ══ */}
          {tab==="bank"&&(<>
            {/* Summary */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:18}}>
              {[
                ["Total Semua",fmtIDR(bankStats.total,true),`${bankAccounts.length} rekening`,"#94a3b8"],
                ["Rekening Pribadi",fmtIDR(bankStats.totalPrivate,true),`${bankAccounts.filter(b=>b.include_networth).length} rekening`,"#a5b4fc"],
                ["Rekening Reimburse",fmtIDR(bankStats.totalReimburse,true),`${bankAccounts.filter(b=>!b.include_networth).length} rekening`,"#fcd34d"],
              ].map(([l,v,sub,col])=>(
                <div key={l} className="glass-card anim-in" style={{padding:"14px",borderTop:`2px solid ${col}`}}>
                  <div style={{fontSize:10,color:th.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>{l}</div>
                  <div style={{fontSize:15,fontWeight:800,fontFamily:"monospace",color:col}}>{v}</div>
                  <div style={{fontSize:10,color:th.textMuted,marginTop:2}}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Bank Accounts */}
            <div className="sec-head">
              <div className="sec-label">Rekening Bank ({bankAccounts.length})</div>
              <div style={{display:"flex",gap:8}}>
                <button className="btn-outline-sm" onClick={()=>setShowPayCC(true)}>💳 Bayar CC</button>
                <button className="btn-add" onClick={()=>{setEditBankId(null);setBankForm(EBA);setShowBankForm(true);}}>+ Rekening</button>
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12,marginBottom:20}}>
              {bankAccounts.map((b,i)=>{
                const bal=bankBalances[b.id]||0;
                const mutCount=mutations.filter(m=>m.account_id===b.id).length;
                return(
                  <div key={b.id} className="bank-card anim-in" style={{"--bc":b.color||"#1d4ed8","--ba":b.accent||"#60a5fa",animationDelay:`${i*.05}s`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                      <div>
                        <div style={{fontSize:10,opacity:.6,fontWeight:600,textTransform:"uppercase",letterSpacing:1}}>{b.bank} · {b.type==="pribadi"?"Pribadi":"Reimburse"}</div>
                        <div style={{fontSize:16,fontWeight:800,marginTop:2}}>{b.name}</div>
                        {b.account_no&&<div style={{fontSize:11,opacity:.5,marginTop:1,fontFamily:"monospace"}}>···· {b.account_no.slice(-4)}</div>}
                      </div>
                      <div style={{fontSize:10,fontWeight:700,opacity:.6,padding:"3px 8px",background:"rgba(255,255,255,.15)",borderRadius:5}}>{b.include_networth?"✓ Net Worth":"× Reimburse"}</div>
                    </div>
                    <div style={{fontSize:22,fontWeight:900,fontFamily:"monospace",marginBottom:4}}>{fmtIDR(bal)}</div>
                    <div style={{fontSize:11,opacity:.5,marginBottom:14}}>{mutCount} mutasi · {b.currency}</div>
                    <div style={{display:"flex",gap:6}}>
                      <button className="btn-bank-act" onClick={()=>{setDetailBankId(b.id);}}>📊 Detail</button>
                      <button className="btn-bank-act" onClick={()=>{setMutForm({...EMU,account_id:b.id});setEditMutId(null);setShowMutForm(true);}}>+ Mutasi</button>
                      <button className="btn-bank-act" onClick={()=>{setBankForm({...b,initial_balance:String(b.initial_balance)});setEditBankId(b.id);setShowBankForm(true);}}>✏️</button>
                      <button className="btn-bank-del" onClick={()=>delBank(b.id)}>🗑</button>
                    </div>
                  </div>
                );
              })}
              {bankAccounts.length===0&&(
                <div style={{gridColumn:"1/-1",textAlign:"center",padding:"40px 0",color:th.textFaint}}>
                  <div style={{fontSize:36,marginBottom:8}}>🏦</div>
                  <div style={{fontSize:13}}>Belum ada rekening bank</div>
                  <button className="btn-add" style={{marginTop:12}} onClick={()=>{setEditBankId(null);setBankForm(EBA);setShowBankForm(true);}}>+ Tambah Rekening</button>
                </div>
              )}
            </div>

            {/* Mutations */}
            <div className="sec-head">
              <div className="sec-label">Mutasi Terbaru</div>
              <button className="btn-outline-sm" onClick={()=>{setScanTarget("bank");setScanImg(null);setScanResult(null);setScanError("");setShowScanner(true);}}>📷 Scan Struk</button>
            </div>

            {/* Mutation Filters */}
            <div className="glass-card anim-in" style={{padding:14,marginBottom:12}}>
              <input className="search-box" placeholder="🔍 Cari mutasi..." value={searchMut} onChange={e=>setSearchMut(e.target.value)} style={{marginBottom:10}}/>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                <select className="mini-sel" value={filterBank} onChange={e=>setFilterBank(e.target.value)}>
                  <option value="all">Semua Rekening</option>
                  {bankAccounts.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <select className="mini-sel" value={filterMutType} onChange={e=>setFilterMutType(e.target.value)}>
                  <option value="all">Semua Tipe</option>
                  <option value="in">Masuk</option>
                  <option value="out">Keluar</option>
                  <option value="transfer">Transfer</option>
                </select>
              </div>
              <div style={{fontSize:11,color:th.textMuted,marginTop:8}}>
                {filteredMut.length} mutasi · 
                Masuk: <span style={{color:"#4ade80"}}>{fmtIDR(filteredMut.filter(m=>m.type==="in").reduce((s,m)=>s+Number(m.amount),0),true)}</span> · 
                Keluar: <span style={{color:"#f87171"}}>{fmtIDR(filteredMut.filter(m=>m.type!=="in").reduce((s,m)=>s+Number(m.amount),0),true)}</span>
              </div>
            </div>

            {filteredMut.length===0
              ?<div style={{textAlign:"center",color:th.textFaint,padding:"40px 0"}}>
                <div style={{fontSize:32,marginBottom:8}}>📊</div>
                <div>Belum ada mutasi</div>
                <button className="btn-add" style={{marginTop:12}} onClick={()=>{setMutForm({...EMU,account_id:bankAccounts[0]?.id||""});setShowMutForm(true);}}>+ Tambah Mutasi</button>
              </div>
              :filteredMut.map((m,i)=>{
                const acc=bankMap[m.account_id];
                const isIn=m.type==="in";
                const isTransfer=m.type==="transfer";
                const toAcc=m.transfer_to_account_id?bankMap[m.transfer_to_account_id]:null;
                return(
                  <div key={m.id} className="tx-row anim-in" style={{animationDelay:`${Math.min(i,10)*.025}s`}}>
                    <div style={{width:38,height:38,borderRadius:10,background:isIn?"rgba(16,185,129,.15)":isTransfer?"rgba(99,102,241,.15)":"rgba(239,68,68,.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0,border:`1px solid ${isIn?"rgba(16,185,129,.3)":isTransfer?"rgba(99,102,241,.3)":"rgba(239,68,68,.2)"}`}}>
                      {isIn?"↓":isTransfer?"↔":"↑"}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:4}}>{m.description}</div>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                        <Tag th={th}>{m.mut_date}</Tag>
                        <Tag th={th}>{m.category||"Lainnya"}</Tag>
                        {acc&&<Tag th={th} color={acc.accent||"#60a5fa"} bg={(acc.color||"#1d4ed8")+"22"}>{acc.name}</Tag>}
                        {isTransfer&&toAcc&&<Tag th={th} color="#818cf8">→ {toAcc.name}</Tag>}
                        {m.is_cc_payment&&<Tag th={th} color="#f59e0b">Bayar CC</Tag>}
                        {m.is_piutang&&<Tag th={th} color="#06b6d4">Piutang {m.piutang_entity}</Tag>}
                        {m.ai_categorized&&<Tag th={th} color="#a78bfa">🤖 AI</Tag>}
                      </div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                      <div style={{fontFamily:"monospace",fontSize:13,fontWeight:800,color:isIn?"#4ade80":isTransfer?"#818cf8":"#f87171",marginBottom:2}}>
                        {isIn?"+":"-"}{fmtIDR(Number(m.amount))}
                      </div>
                      {(m.cc_admin_fee>0||m.cc_materai>0)&&<div style={{fontSize:10,color:"#f59e0b"}}>+admin {fmtIDR(Number(m.cc_admin_fee||0)+Number(m.cc_materai||0))}</div>}
                      <div style={{display:"flex",gap:4,justifyContent:"flex-end",marginTop:5}}>
                        <button className="icon-btn" onClick={()=>{setMutForm({...m,amount:String(m.amount),transfer_fee:String(m.transfer_fee||""),cc_admin_fee:String(m.cc_admin_fee||""),cc_materai:String(m.cc_materai||"")}); setEditMutId(m.id); setShowMutForm(true);}}>✏️</button>
                        <button className="icon-btn danger" onClick={()=>delMut(m.id)}>🗑</button>
                      </div>
                    </div>
                  </div>
                );
              })
            }
          </>)}

          {/* ══ COMING SOON TABS ══ */}
          {["piutang","asset","income","calendar"].includes(tab)&&(
            <div style={{textAlign:"center",padding:"60px 20px"}}>
              <div style={{fontSize:52,marginBottom:16}}>🚧</div>
              <div style={{fontSize:20,fontWeight:800,marginBottom:8}}>Coming Soon</div>
              <div style={{fontSize:13,color:th.textMuted,marginBottom:24}}>Modul <strong>{TABS.find(t=>t.id===tab)?.label}</strong> sedang dalam pengembangan.<br/>Akan hadir di sesi berikutnya!</div>
              <div style={{display:"inline-flex",flexDirection:"column",gap:8,textAlign:"left"}}>
                {tab==="piutang"&&["Piutang reimburse (Hamasa/SDC/Travelio)","Piutang karyawan + cicilan","Aging report","History per entitas"].map(f=><div key={f} style={{fontSize:12,color:th.textSub,display:"flex",gap:8}}><span style={{color:"#6366f1"}}>→</span>{f}</div>)}
                {tab==="asset"&&["Deposito + rollover + pajak","Saham IDX + US auto-update","Reksa dana","Cash FX real-time","Properti"].map(f=><div key={f} style={{fontSize:12,color:th.textSub,display:"flex",gap:8}}><span style={{color:"#6366f1"}}>→</span>{f}</div>)}
                {tab==="income"&&["Income tracker (gaji, sewa, dividen)","Expense dari CC + bank","Cash flow prediction","Surplus/deficit bulanan"].map(f=><div key={f} style={{fontSize:12,color:th.textSub,display:"flex",gap:8}}><span style={{color:"#6366f1"}}>→</span>{f}</div>)}
                {tab==="calendar"&&["Monthly calendar view","Upcoming transactions","Multi-level reminder (H-7, H-3, H-1)","Browser push notification"].map(f=><div key={f} style={{fontSize:12,color:th.textSub,display:"flex",gap:8}}><span style={{color:"#6366f1"}}>→</span>{f}</div>)}
              </div>
            </div>
          )}

          {/* ══ SETTINGS ══ */}
          {tab==="settings"&&(<>
            <div className="glass-card anim-in" style={{padding:18,marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:14}}>👤 Akun</div>
              <div style={{fontSize:12,color:th.textMuted,marginBottom:4}}>Email: <span style={{color:th.text}}>{user.email}</span></div>
              <div style={{fontSize:12,color:th.textMuted,marginBottom:16}}>User ID: <span style={{fontFamily:"monospace",fontSize:10}}>{user.id.slice(0,16)}...</span></div>
              <button onClick={signOut} style={{background:"rgba(239,68,68,.1)",color:"#f87171",border:"1px solid rgba(239,68,68,.2)",padding:"8px 16px",borderRadius:8,fontFamily:"inherit",fontWeight:700,fontSize:12,cursor:"pointer"}}>🚪 Sign Out</button>
            </div>
            <div className="glass-card anim-in" style={{padding:18,marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:14}}>🎨 Tampilan</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{fontSize:12,color:th.textSub}}>Dark Mode</span>
                <button onClick={()=>setIsDark(d=>!d)} style={{background:isDark?"rgba(99,102,241,.2)":"rgba(255,255,255,.1)",border:`1px solid ${isDark?"rgba(99,102,241,.4)":th.border}`,padding:"6px 14px",borderRadius:7,fontFamily:"inherit",fontWeight:700,fontSize:11,cursor:"pointer",color:isDark?"#a5b4fc":th.textSub}}>{isDark?"🌙 Dark":"☀️ Light"}</button>
              </div>
            </div>
            <div className="glass-card anim-in" style={{padding:18,marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>💱 Kurs Mata Uang</div>
              <div style={{fontSize:11,color:th.textMuted,marginBottom:12}}>Update kurs untuk konversi yang akurat</div>
              {CURRENCIES.filter(c=>c.code!=="IDR").map(cur=>(
                <div key={cur.code} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <span style={{fontSize:16}}>{cur.flag}</span>
                  <span style={{fontSize:12,fontWeight:700,color:th.textSub,width:36}}>{cur.code}</span>
                  <input className="inp" type="number" value={fxRates[cur.code]||cur.rate} onChange={e=>setFxRates(r=>({...r,[cur.code]:Number(e.target.value)}))} style={{flex:1}}/>
                  <span style={{fontSize:11,color:th.textMuted}}>IDR</span>
                </div>
              ))}
              <button className="btn-confirm" style={{marginTop:8}} onClick={saveFx}>Simpan Kurs</button>
            </div>
          </>)}
        </div>
      </main>

      {/* ══ MODALS ══ */}

      {/* AI Chat */}
      {showAIChat&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowAIChat(false);}}>
          <div className="modal" style={{background:th.bgModal,border:`1px solid ${th.border}`,maxWidth:500,display:"flex",flexDirection:"column",height:"80vh"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexShrink:0}}>
              <div><div style={{fontWeight:800,fontSize:16}}>🤖 AI Financial Advisor</div><div style={{fontSize:11,color:th.textMuted}}>Powered by Claude AI</div></div>
              <button className="close-x" style={{background:th.bgInput,border:`1px solid ${th.border}`}} onClick={()=>setShowAIChat(false)}>✕</button>
            </div>
            <div style={{flex:1,overflowY:"auto",marginBottom:12}}>
              {aiMessages.length===0&&(
                <div style={{textAlign:"center",padding:"30px 0",color:th.textMuted}}>
                  <div style={{fontSize:36,marginBottom:8}}>💬</div>
                  <div style={{fontSize:12}}>Tanya apapun tentang keuangan kamu</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:14}}>
                    {["Bagaimana kondisi keuangan saya?","Hutang CC saya berapa?","Tips agar lebih hemat bulan ini?"].map(q=>(
                      <button key={q} onClick={()=>{setAiInput(q);}} style={{background:th.bgCard,border:`1px solid ${th.border}`,borderRadius:8,padding:"8px 12px",fontFamily:"inherit",fontSize:11,color:th.textSub,cursor:"pointer",textAlign:"left"}}>{q}</button>
                    ))}
                  </div>
                </div>
              )}
              {aiMessages.map((m,i)=>(
                <div key={i} style={{display:"flex",gap:8,marginBottom:12,flexDirection:m.role==="user"?"row-reverse":"row"}}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:m.role==="user"?"linear-gradient(135deg,#4f46e5,#7c3aed)":"linear-gradient(135deg,#065f46,#10b981)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>{m.role==="user"?"👤":"🤖"}</div>
                  <div style={{background:m.role==="user"?"rgba(99,102,241,.15)":th.bgCard,border:`1px solid ${m.role==="user"?"rgba(99,102,241,.3)":th.border}`,borderRadius:12,padding:"10px 13px",maxWidth:"80%",fontSize:12,lineHeight:1.6,color:th.text}}>{m.text}</div>
                </div>
              ))}
              {aiLoading&&<div style={{display:"flex",gap:8,marginBottom:12}}><div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#065f46,#10b981)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>🤖</div><div style={{background:th.bgCard,border:`1px solid ${th.border}`,borderRadius:12,padding:"10px 13px",fontSize:12,color:th.textMuted}}>Sedang berpikir...</div></div>}
            </div>
            <div style={{display:"flex",gap:8,flexShrink:0}}>
              <input className="inp" placeholder="Tanya tentang keuangan kamu..." value={aiInput} onChange={e=>setAiInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendAI()} style={{flex:1}}/>
              <button className="btn-confirm" style={{padding:"9px 16px",fontSize:13}} onClick={sendAI} disabled={aiLoading||!aiInput.trim()}>→</button>
            </div>
          </div>
        </div>
      )}

      {/* Scanner */}
      {showScanner&&(
        <Overlay onClose={()=>setShowScanner(false)} th={th} title="📷 Scan Struk / Mutasi">
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",gap:6,marginBottom:12}}>
              {[["cc","CC Transaksi"],["bank","Mutasi Bank"]].map(([v,l])=>(
                <button key={v} onClick={()=>setScanTarget(v)} style={{flex:1,background:scanTarget===v?"rgba(99,102,241,.15)":th.bgInput,border:`1px solid ${scanTarget===v?"rgba(99,102,241,.4)":th.border}`,borderRadius:8,padding:"7px",fontFamily:"inherit",fontWeight:700,fontSize:12,cursor:"pointer",color:scanTarget===v?"#a5b4fc":th.textMuted}}>{l}</button>
              ))}
            </div>
            <div className="scan-drop" onClick={()=>fileInputRef.current?.click()} style={{borderColor:scanImg?"#6366f1":th.border,backgroundImage:scanImg?`url(data:${scanMime};base64,${scanImg})`:"none",backgroundSize:"contain",backgroundRepeat:"no-repeat",backgroundPosition:"center"}}>
              {!scanImg&&(<><div style={{fontSize:36,marginBottom:8}}>📷</div><div style={{fontSize:13,fontWeight:700,color:th.textSub}}>Klik untuk upload foto</div><div style={{fontSize:11,color:th.textMuted,marginTop:4}}>JPG, PNG, HEIC</div></>)}
              {scanImg&&<div style={{position:"absolute",bottom:8,right:8,background:"rgba(0,0,0,.6)",color:"white",fontSize:10,padding:"3px 8px",borderRadius:5}}>✓ Foto dipilih</div>}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleFile} capture="environment"/>
          </div>
          {scanError&&<div style={{padding:"9px 12px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",borderRadius:9,fontSize:12,color:"#f87171",marginBottom:12}}>{scanError}</div>}
          {scanResult&&(
            <div style={{padding:14,background:"rgba(99,102,241,.06)",border:"1px solid rgba(99,102,241,.2)",borderRadius:12,marginBottom:12}}>
              <div style={{fontSize:10,color:"#818cf8",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:10}}>✨ Hasil AI Scan</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                {[["Merchant",scanResult.merchant||"-"],["Nominal",scanResult.amount?fmtIDR(scanResult.amount):"-"],["Tanggal",scanResult.date||"-"],["Kategori",scanResult.category||"-"],["4 Digit",scanResult.last4||"N/A"],["Fee",scanResult.fee>0?fmtIDR(scanResult.fee):"0"]].map(([l,v])=>(
                  <div key={l} style={{background:th.bgInput,borderRadius:8,padding:"7px 9px"}}>
                    <div style={{fontSize:9,color:th.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
                    <div style={{fontSize:12,fontWeight:700,marginTop:1}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{display:"flex",gap:10}}>
            <button className="btn-cancel" style={{background:th.bgInput,border:`1px solid ${th.border}`,color:th.textMuted}} onClick={()=>setShowScanner(false)}>Batal</button>
            {!scanResult
              ?<button className="btn-confirm" onClick={runScan} disabled={!scanImg||scanLoading} style={{opacity:(!scanImg||scanLoading)?.5:1}}>{scanLoading?"🔄 Scanning...":"✨ Scan dengan AI"}</button>
              :<button className="btn-confirm" onClick={confirmScan}>✅ Lanjut Isi Form</button>
            }
          </div>
        </Overlay>
      )}

      {/* Pay CC Modal */}
      {showPayCC&&(
        <Overlay onClose={()=>setShowPayCC(false)} th={th} title="💳 Bayar Tagihan CC">
          <div style={{display:"flex",flexDirection:"column",gap:11}}>
            <div style={{padding:"10px 13px",background:"rgba(99,102,241,.06)",border:"1px solid rgba(99,102,241,.2)",borderRadius:9,fontSize:11,color:"#818cf8"}}>Bayar CC akan mencatat mutasi keluar dari rekening bank yang dipilih.</div>
            <F label="Kartu Kredit" th={th}>
              <select className="inp" value={payCC.cardId} onChange={e=>setPayCC(p=>({...p,cardId:e.target.value}))}>
                <option value="">Pilih kartu...</option>
                {cardStats.map(c=><option key={c.id} value={c.id}>{c.name} ···· {c.last4} — Tagihan: {fmtIDR(c.spent,true)}</option>)}
              </select>
            </F>
            <F label="Bayar dari Rekening" th={th}>
              <select className="inp" value={payCC.bankId} onChange={e=>setPayCC(p=>({...p,bankId:e.target.value}))}>
                <option value="">Pilih rekening...</option>
                {bankAccounts.map(b=><option key={b.id} value={b.id}>{b.name} — Saldo: {fmtIDR(bankBalances[b.id]||0,true)}</option>)}
              </select>
            </F>
            <R2>
              <F label="Jumlah Bayar (Rp)" th={th}>
                <input className="inp" type="number" placeholder="0" value={payCC.amount} onChange={e=>setPayCC(p=>({...p,amount:e.target.value}))}/>
                {payCC.cardId&&<div style={{fontSize:10,color:th.textMuted,marginTop:3}}>Tagihan: {fmtIDR(cardStats.find(c=>c.id===payCC.cardId)?.spent||0)}</div>}
              </F>
            </R2>
            <R2>
              <F label="Biaya Admin (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={payCC.adminFee} onChange={e=>setPayCC(p=>({...p,adminFee:e.target.value}))}/></F>
              <F label="Materai (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={payCC.materai} onChange={e=>setPayCC(p=>({...p,materai:e.target.value}))}/></F>
            </R2>
            <F label="Catatan" th={th}><input className="inp" placeholder="Opsional..." value={payCC.notes} onChange={e=>setPayCC(p=>({...p,notes:e.target.value}))}/></F>
            {payCC.amount&&<div style={{padding:"10px 13px",background:"rgba(245,158,11,.06)",border:"1px solid rgba(245,158,11,.2)",borderRadius:9,fontSize:12}}>
              <div style={{fontWeight:700,color:"#f59e0b",marginBottom:4}}>Ringkasan Pembayaran</div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:th.textSub}}><span>Pokok</span><span style={{fontFamily:"monospace"}}>{fmtIDR(Number(payCC.amount))}</span></div>
              {payCC.adminFee>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:th.textSub}}><span>Biaya Admin</span><span style={{fontFamily:"monospace"}}>{fmtIDR(Number(payCC.adminFee))}</span></div>}
              {payCC.materai>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:th.textSub}}><span>Materai</span><span style={{fontFamily:"monospace"}}>{fmtIDR(Number(payCC.materai))}</span></div>}
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:700,marginTop:6,paddingTop:6,borderTop:`1px solid ${th.border}`}}><span>Total Keluar</span><span style={{fontFamily:"monospace",color:"#f87171"}}>{fmtIDR(Number(payCC.amount)+Number(payCC.adminFee||0)+Number(payCC.materai||0))}</span></div>
            </div>}
            <BtnRow onCancel={()=>setShowPayCC(false)} onOk={submitPayCC} label="Bayar Sekarang" th={th}/>
          </div>
        </Overlay>
      )}

      {/* Bank Account Form */}
      {showBankForm&&(
        <Overlay onClose={()=>setShowBankForm(false)} th={th} title={editBankId?"✏️ Edit Rekening":"🏦 Tambah Rekening"}>
          <div style={{display:"flex",flexDirection:"column",gap:11}}>
            <R2>
              <F label="Nama Rekening" th={th}><input className="inp" placeholder="BCA Tahapan Pribadi" value={bankForm.name} onChange={e=>setBankForm(f=>({...f,name:e.target.value}))}/></F>
              <F label="Bank" th={th}><select className="inp" value={bankForm.bank} onChange={e=>setBankForm(f=>({...f,bank:e.target.value}))}>{BANKS_LIST.map(b=><option key={b}>{b}</option>)}</select></F>
            </R2>
            <R2>
              <F label="No. Rekening (opsional)" th={th}><input className="inp" placeholder="1234567890" value={bankForm.account_no} onChange={e=>setBankForm(f=>({...f,account_no:e.target.value}))}/></F>
              <F label="Mata Uang" th={th}><select className="inp" value={bankForm.currency} onChange={e=>setBankForm(f=>({...f,currency:e.target.value}))}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select></F>
            </R2>
            <F label="Jenis Rekening" th={th}>
              <div style={{display:"flex",gap:8}}>
                {[["pribadi","🏠 Pribadi (masuk net worth)"],["reimburse","🔄 Reimburse (tidak masuk net worth)"]].map(([v,l])=>(
                  <button key={v} onClick={()=>setBankForm(f=>({...f,type:v,include_networth:v==="pribadi"}))} style={{flex:1,background:bankForm.type===v?"rgba(99,102,241,.15)":th.bgInput,border:`1px solid ${bankForm.type===v?"rgba(99,102,241,.4)":th.border}`,borderRadius:8,padding:"9px 8px",fontFamily:"inherit",fontWeight:700,fontSize:11,cursor:"pointer",color:bankForm.type===v?"#a5b4fc":th.textMuted,lineHeight:1.4}}>{l}</button>
                ))}
              </div>
            </F>
            {bankForm.type==="reimburse"&&(
              <F label="Entitas Reimburse" th={th}>
                <select className="inp" value={bankForm.owner_entity} onChange={e=>setBankForm(f=>({...f,owner_entity:e.target.value}))}>
                  <option value="">Pilih entitas...</option>
                  {["Hamasa","SDC","Travelio"].map(e=><option key={e}>{e}</option>)}
                </select>
              </F>
            )}
            <F label="Saldo Awal (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={bankForm.initial_balance} onChange={e=>setBankForm(f=>({...f,initial_balance:e.target.value}))}/></F>
            <R2>
              <F label="Warna Utama" th={th}><div style={{display:"flex",gap:8,alignItems:"center"}}><input type="color" value={bankForm.color} onChange={e=>setBankForm(f=>({...f,color:e.target.value}))} style={{width:44,height:36,border:"none",borderRadius:8,cursor:"pointer"}}/></div></F>
              <F label="Warna Aksen" th={th}><div style={{display:"flex",gap:8,alignItems:"center"}}><input type="color" value={bankForm.accent} onChange={e=>setBankForm(f=>({...f,accent:e.target.value}))} style={{width:44,height:36,border:"none",borderRadius:8,cursor:"pointer"}}/></div></F>
            </R2>
            {/* Preview */}
            <div style={{background:`linear-gradient(135deg,${bankForm.color},${bankForm.accent})`,borderRadius:12,padding:"13px 15px",color:"white"}}>
              <div style={{fontSize:10,opacity:.6,fontWeight:600,textTransform:"uppercase",letterSpacing:1}}>{bankForm.bank} · {bankForm.type==="pribadi"?"Pribadi":"Reimburse"}</div>
              <div style={{fontSize:16,fontWeight:800,marginTop:2}}>{bankForm.name||"Nama Rekening"}</div>
              <div style={{fontFamily:"monospace",fontSize:13,marginTop:6,opacity:.8}}>Saldo: {fmtIDR(Number(bankForm.initial_balance||0))}</div>
            </div>
            <BtnRow onCancel={()=>setShowBankForm(false)} onOk={submitBank} label={editBankId?"Simpan":"Tambah"} th={th}/>
          </div>
        </Overlay>
      )}

      {/* Mutation Form */}
      {showMutForm&&(
        <Overlay onClose={()=>setShowMutForm(false)} th={th} title={editMutId?"✏️ Edit Mutasi":"➕ Tambah Mutasi Bank"}>
          <div style={{display:"flex",flexDirection:"column",gap:11}}>
            {scanResult&&<div style={{padding:"9px 13px",background:"rgba(99,102,241,.06)",border:"1px solid rgba(99,102,241,.2)",borderRadius:9,fontSize:11,color:"#818cf8"}}>✨ Data dari AI scan — cek dan lengkapi</div>}
            <R2>
              <F label="Tanggal" th={th}><input className="inp" type="date" value={mutForm.mut_date} onChange={e=>setMutForm(f=>({...f,mut_date:e.target.value}))}/></F>
              <F label="Rekening" th={th}><select className="inp" value={mutForm.account_id} onChange={e=>setMutForm(f=>({...f,account_id:e.target.value}))}><option value="">Pilih rekening...</option>{bankAccounts.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></F>
            </R2>
            <F label="Keterangan" th={th}><input className="inp" placeholder="Contoh: Gaji bulan April..." value={mutForm.description} onChange={e=>setMutForm(f=>({...f,description:e.target.value}))}/></F>
            <R2>
              <F label="Jumlah (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={mutForm.amount} onChange={e=>setMutForm(f=>({...f,amount:e.target.value}))}/></F>
              <F label="Tipe" th={th}>
                <select className="inp" value={mutForm.type} onChange={e=>setMutForm(f=>({...f,type:e.target.value}))}>
                  <option value="in">↓ Masuk</option>
                  <option value="out">↑ Keluar</option>
                  <option value="transfer">↔ Transfer</option>
                </select>
              </F>
            </R2>
            <R2>
              <F label="Kategori" th={th}><select className="inp" value={mutForm.category} onChange={e=>setMutForm(f=>({...f,category:e.target.value}))}>{BANK_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></F>
              <F label="Entitas" th={th}><select className="inp" value={mutForm.entity} onChange={e=>setMutForm(f=>({...f,entity:e.target.value}))}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</select></F>
            </R2>
            {mutForm.type==="transfer"&&(<>
              <F label="Transfer ke Rekening" th={th}><select className="inp" value={mutForm.transfer_to_account_id} onChange={e=>setMutForm(f=>({...f,transfer_to_account_id:e.target.value}))}><option value="">Pilih rekening tujuan...</option>{bankAccounts.filter(b=>b.id!==mutForm.account_id).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></F>
              <F label="Biaya Transfer (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={mutForm.transfer_fee} onChange={e=>setMutForm(f=>({...f,transfer_fee:e.target.value}))}/></F>
            </>)}
            {/* Piutang toggle */}
            <div className="tog-row" onClick={()=>setMutForm(f=>({...f,is_piutang:!f.is_piutang}))} style={{background:mutForm.is_piutang?"rgba(6,182,212,.06)":"rgba(255,255,255,.02)",borderColor:mutForm.is_piutang?"rgba(6,182,212,.2)":th.border}}>
              <div className={`tog-check ${mutForm.is_piutang?"on":""}`} style={mutForm.is_piutang?{background:"#06b6d4",borderColor:"#06b6d4"}:{}}>{mutForm.is_piutang?"✓":""}</div>
              <div><div style={{fontSize:13,color:mutForm.is_piutang?"#22d3ee":th.textMuted,fontWeight:600}}>Ini adalah piutang reimburse</div><div style={{fontSize:10,color:th.textMuted}}>Tidak masuk expense pribadi</div></div>
            </div>
            {mutForm.is_piutang&&(
              <R2>
                <F label="Entitas Piutang" th={th}><select className="inp" value={mutForm.piutang_entity} onChange={e=>setMutForm(f=>({...f,piutang_entity:e.target.value}))}><option value="">Pilih...</option>{["Hamasa","SDC","Travelio"].map(e=><option key={e}>{e}</option>)}</select></F>
                <F label="Keterangan Piutang" th={th}><input className="inp" placeholder="Billing listrik apartemen..." value={mutForm.piutang_description} onChange={e=>setMutForm(f=>({...f,piutang_description:e.target.value}))}/></F>
              </R2>
            )}
            <F label="Catatan" th={th}><input className="inp" placeholder="Opsional..." value={mutForm.notes} onChange={e=>setMutForm(f=>({...f,notes:e.target.value}))}/></F>
            <BtnRow onCancel={()=>setShowMutForm(false)} onOk={submitMut} label={editMutId?"Simpan":"Tambah"} th={th}/>
          </div>
        </Overlay>
      )}

      {/* CC Modals */}
      {showTxForm&&<TxFormModal th={th} form={txForm} setForm={setTxForm} cards={cards} fxRates={fxRates} scanResult={scanResult} editId={editTxId} onClose={()=>setShowTxForm(false)} onSubmit={submitTx} saving={saving}/>}
      {showCardForm&&<CardFormModal th={th} form={cardForm} setForm={setCardForm} editId={editCardId} onClose={()=>setShowCardForm(false)} onSubmit={submitCard} saving={saving}/>}
      {showInstForm&&<InstFormModal th={th} form={instForm} setForm={setInstForm} cards={cards} editId={editInstId} onClose={()=>setShowInstForm(false)} onSubmit={submitInst} saving={saving}/>}
      {showRecurForm&&<RecurFormModal th={th} form={recurForm} setForm={setRecurForm} cards={cards} editId={editRecurId} onClose={()=>setShowRecurForm(false)} onSubmit={submitRecur} saving={saving}/>}
      {showBudgetForm&&<BudgetFormModal th={th} form={budgetForm} setForm={setBudForm} onClose={()=>setShowBudForm(false)} onSubmit={saveBudgets} saving={saving}/>}
      {showFxPanel&&<FxModal th={th} rates={fxRates} setRates={setFxRates} onClose={()=>setShowFxPanel(false)} onSave={saveFx}/>}

      {/* Card Detail */}
      {detailCard&&<CardDetailModal th={th} card={detailCard} txIDR={txIDR} onClose={()=>setDetailCardId(null)}/>}

      {/* Statement */}
      {showStatement&&<StatementModal th={th} cards={cardStats} statCard={statCard} setStatCard={setStatCard} instList={instList} fxRates={fxRates} curMonth={curMonth} onClose={()=>setShowStatement(false)}/>}
    </div>
  );
}

// ─── CC CONTENT COMPONENT ─────────────────────────────────────
function CCContent({cards,cardStats,txList,filtered,instStats,recurList,budgetStats,th,filterCard,setFilterCard,filterReimb,setFilterReimb,filterMonth,setFilterMonth,filterEntity,setFilterEnt,searchQ,setSearchQ,allMonths,cardMap,txIDR,onEditTx,onDeleteTx,onTogReimb,onEditCard,onDelCard,onMarkPaid,onDelInst,onTogRecur,onDelRecur,onApplyRecur,onEditRecur,onEditInst,onNewCard,onNewTx,onNewInst,onNewRecur,onEditBudget,onDetailCard,onPayCC,fxRates}) {
  const [ccTab,setCCTab] = useState("transactions");

  return (<>
    {/* Sub navigation */}
    <div style={{display:"flex",gap:4,marginBottom:16,overflowX:"auto",paddingBottom:2}}>
      {[["transactions","≡ Transaksi"],["cards","💳 Kartu"],["installments","⟳ Cicilan"],["recurring","↺ Recurring"],["budget","◎ Budget"]].map(([id,label])=>(
        <button key={id} className={`subtab ${ccTab===id?"active":""}`} onClick={()=>setCCTab(id)}>{label}</button>
      ))}
    </div>

    {/* Transactions */}
    {ccTab==="transactions"&&(<>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{fontSize:10,color:"#475569",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>{filtered.length} Transaksi</div>
        <div style={{display:"flex",gap:6}}>
          <button className="btn-outline-sm" onClick={onPayCC}>💳 Bayar CC</button>
          <button className="btn-add" onClick={onNewTx}>+ Transaksi</button>
        </div>
      </div>
      <div className="glass-card" style={{padding:13,marginBottom:12}}>
        <input className="search-box" placeholder="🔍 Cari transaksi..." value={searchQ} onChange={e=>setSearchQ(e.target.value)} style={{marginBottom:9}}/>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          <select className="mini-sel" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)}><option value="all">Semua Bulan</option>{allMonths.map(m=><option key={m} value={m}>{mlFull(m)}</option>)}</select>
          <select className="mini-sel" value={filterCard} onChange={e=>setFilterCard(e.target.value)}><option value="all">Semua Kartu</option>{cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className="mini-sel" value={filterEntity} onChange={e=>setFilterEnt(e.target.value)}><option value="all">Semua Entitas</option>{["Pribadi","Hamasa","SDC","Travelio","Lainnya"].map(e=><option key={e}>{e}</option>)}</select>
          <select className="mini-sel" value={filterReimb} onChange={e=>setFilterReimb(e.target.value)}><option value="all">Semua Status</option><option value="false">Belum Reimburse</option><option value="true">Sudah Reimburse</option></select>
        </div>
      </div>
      {filtered.length===0?<Empty icon="📋" msg="Tidak ada transaksi" onAdd={onNewTx} addLabel="+ Transaksi CC"/>
      :filtered.map((t,i)=>{
        const c=cardMap[t.card_id];
        return(
          <div key={t.id} className="tx-row anim-in" style={{animationDelay:`${Math.min(i,10)*.025}s`}}>
            <div style={{width:38,height:38,borderRadius:10,background:`linear-gradient(135deg,${c?.color||"#334155"},${c?.accent||"#64748b"})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>💳</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:4}}>{t.description}</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                <Tag th={th}>{t.tx_date}</Tag>
                <Tag th={th}>{t.category}</Tag>
                {c&&<Tag th={th} color={c.accent} bg={c.color+"22"}>{c.bank||c.name}</Tag>}
                <Tag th={th} color={ENTITY_COLORS[t.entity]} bg={ENTITY_COLORS[t.entity]+"22"}>{t.entity}</Tag>
                {t.currency!=="IDR"&&<Tag th={th} color="#f59e0b">🌏 {t.currency}</Tag>}
                {t.fee>0&&<Tag th={th} color="#f97316">Fee Gestun</Tag>}
              </div>
            </div>
            <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
              <div style={{fontFamily:"monospace",fontSize:13,fontWeight:800,marginBottom:2}}>{fmtCur(t.amount,t.currency)}</div>
              {t.currency!=="IDR"&&<div style={{fontSize:10,color:th.textMuted,fontFamily:"monospace"}}>≈{fmtIDR(toIDR(t.amount,t.currency,fxRates),true)}</div>}
              {t.fee>0&&<div style={{fontSize:10,color:"#f97316",fontFamily:"monospace"}}>+fee {fmtIDR(t.fee)}</div>}
              <div style={{display:"flex",gap:4,justifyContent:"flex-end",marginTop:5}}>
                <button className={`reimb-btn ${t.reimbursed?"done":""}`} onClick={()=>onTogReimb(t.id,t.reimbursed)}>{t.reimbursed?"✓ Reimb":"Reimb?"}</button>
                <button className="icon-btn" onClick={()=>onEditTx(t)}>✏️</button>
                <button className="icon-btn danger" onClick={()=>onDeleteTx(t.id)}>🗑</button>
              </div>
            </div>
          </div>
        );
      })}
    </>)}

    {/* Cards */}
    {ccTab==="cards"&&(<>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:10,color:"#475569",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Kartu Kredit ({cards.length})</div>
        <button className="btn-add" onClick={onNewCard}>+ Kartu</button>
      </div>
      {cardStats.map((c,i)=>(
        <div key={c.id} className="credit-card anim-in" style={{"--cc":c.color,"--ca":c.accent,animationDelay:`${i*.06}s`}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
            <div><div style={{fontSize:10,opacity:.5,fontWeight:600,textTransform:"uppercase",letterSpacing:1}}>{c.bank} · {c.network}</div><div style={{fontSize:17,fontWeight:800,marginTop:2}}>{c.name}</div></div>
            <div style={{fontSize:12,fontWeight:900,opacity:.7,letterSpacing:1}}>{c.network==="Visa"?"VISA":"MC"}</div>
          </div>
          <div style={{fontFamily:"monospace",letterSpacing:4,fontSize:15,marginBottom:16,opacity:.85}}>•••• •••• •••• {c.last4}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginBottom:12}}>
            {[["Limit",fmtIDR(c.card_limit,true)],["Terpakai",fmtIDR(c.spent,true)],["Tersedia",fmtIDR(c.avail,true)],["Cetak",`Tgl ${c.statement_day}`],["Jatuh Tempo",`Tgl ${c.due_day}`],["Target",`${c.target_pct}%`]].map(([l,v])=>(
              <div key={l} style={{background:"rgba(255,255,255,.1)",borderRadius:8,padding:"6px 9px"}}>
                <div style={{fontSize:9,opacity:.5,fontWeight:700,textTransform:"uppercase"}}>{l}</div>
                <div style={{fontSize:11,fontWeight:700,fontFamily:"monospace",marginTop:1}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{height:4,background:"rgba(255,255,255,.15)",borderRadius:2,overflow:"hidden",marginBottom:10}}>
            <div style={{height:"100%",width:Math.min(c.pct,100)+"%",background:c.pct>80?"rgba(239,68,68,.9)":"rgba(255,255,255,.7)",borderRadius:2}}/>
          </div>
          <div style={{display:"flex",gap:7}}>
            <button className="btn-cc" onClick={()=>onDetailCard(c.id)}>📊 Detail</button>
            <button className="btn-cc" onClick={()=>onEditCard(c)}>✏️ Edit</button>
            <button className="btn-cc" onClick={()=>onDelCard(c.id)}>🗑 Hapus</button>
          </div>
        </div>
      ))}
      {cards.length===0&&<Empty icon="💳" msg="Belum ada kartu kredit" onAdd={onNewCard} addLabel="+ Tambah Kartu"/>}
    </>)}

    {/* Installments */}
    {ccTab==="installments"&&(<>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:10,color:"#475569",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Cicilan ({instStats.length})</div>
        <button className="btn-add" onClick={onNewInst}>+ Cicilan</button>
      </div>
      {instStats.map((i,idx)=>{
        const c=cardMap[i.card_id];
        return(
          <div key={i.id} className="glass-card anim-in" style={{padding:16,marginBottom:9,animationDelay:`${idx*.05}s`}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
              <div><div style={{fontWeight:700,fontSize:13}}>{i.description}</div><div style={{fontSize:11,color:th.textMuted,marginTop:2}}>{c?.name} · {i.entity}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:15,fontWeight:800,fontFamily:"monospace",color:"#818cf8"}}>{fmtIDR(i.monthly,true)}<span style={{fontSize:10,color:th.textMuted}}>/bln</span></div><div style={{fontSize:11,color:th.textMuted}}>Total: {fmtIDR(i.total_amount)}</div></div>
            </div>
            <div style={{height:7,background:th.border,borderRadius:4,overflow:"hidden",marginBottom:6}}>
              <div style={{height:"100%",width:i.pct+"%",background:"linear-gradient(90deg,#6366f1,#10b981)",borderRadius:4}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:th.textMuted,marginBottom:10}}><span>{i.paid_months}/{i.months} bulan ({i.pct.toFixed(0)}%)</span><span>Sisa: {fmtIDR(i.remainingAmt,true)}</span></div>
            <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:10}}>{Array.from({length:i.months}).map((_,j)=><div key={j} style={{width:12,height:12,borderRadius:3,background:j<i.paid_months?"#10b981":th.border}}/>)}</div>
            <div style={{display:"flex",gap:6}}>
              <button className="btn-sm" onClick={()=>onMarkPaid(i)} disabled={i.paid_months>=i.months}>✓ Terbayar</button>
              <button className="btn-sm" onClick={()=>onEditInst(i)}>✏️</button>
              <button className="btn-sm danger" onClick={()=>onDelInst(i.id)}>🗑</button>
            </div>
          </div>
        );
      })}
      {instStats.length===0&&<Empty icon="🔄" msg="Belum ada cicilan" onAdd={onNewInst} addLabel="+ Tambah Cicilan"/>}
    </>)}

    {/* Recurring */}
    {ccTab==="recurring"&&(<>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:10,color:"#475569",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Recurring ({recurList.length})</div>
        <button className="btn-add" onClick={onNewRecur}>+ Recurring</button>
      </div>
      {recurList.map((r,idx)=>{
        const c=cardMap[r.card_id];
        return(
          <div key={r.id} className="glass-card anim-in" style={{padding:"13px 15px",marginBottom:8,opacity:r.active?1:.5,animationDelay:`${idx*.04}s`}}>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <div style={{width:36,height:36,borderRadius:9,background:r.active?`linear-gradient(135deg,${c?.color||"#334155"},${c?.accent||"#64748b"})`:"transparent",border:`1px solid ${th.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>↺</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:13}}>{r.description}</div>
                <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
                  <Tag th={th}>{r.frequency} · Tgl {r.day_of_month}</Tag>
                  <Tag th={th} color={ENTITY_COLORS[r.entity]} bg={ENTITY_COLORS[r.entity]+"22"}>{r.entity}</Tag>
                  {c&&<Tag th={th} color={c.accent} bg={c.color+"22"}>{c.bank||c.name}</Tag>}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontFamily:"monospace",fontSize:13,fontWeight:800}}>{fmtCur(r.amount,r.currency)}</div>
                <div style={{display:"flex",gap:4,marginTop:5,justifyContent:"flex-end"}}>
                  <button className="btn-sm" style={{color:"#10b981",borderColor:"#10b98144"}} onClick={()=>onApplyRecur(r)}>▶ Apply</button>
                  <button className="btn-sm" onClick={()=>onTogRecur(r.id,r.active)}>{r.active?"Pause":"Resume"}</button>
                  <button className="icon-btn" onClick={()=>onEditRecur(r)}>✏️</button>
                  <button className="icon-btn danger" onClick={()=>onDelRecur(r.id)}>🗑</button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
      {recurList.length===0&&<Empty icon="↺" msg="Belum ada recurring" onAdd={onNewRecur} addLabel="+ Tambah Recurring"/>}
    </>)}

    {/* Budget */}
    {ccTab==="budget"&&(<>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:10,color:"#475569",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Budget Bulanan</div>
        <button className="btn-add" onClick={onEditBudget}>Edit Budget</button>
      </div>
      {budgetStats.map((b,idx)=>{
        const over=b.pct>=100,warn=b.pct>=80;
        const bc=over?"#ef4444":warn?"#f59e0b":ENTITY_COLORS[b.entity];
        return(
          <div key={b.entity} className="glass-card anim-in" style={{padding:18,marginBottom:12,animationDelay:`${idx*.06}s`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:40,height:40,borderRadius:11,background:`linear-gradient(135deg,${ENTITY_COLORS[b.entity]}88,${ENTITY_COLORS[b.entity]})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{b.entity==="Pribadi"?"🏠":b.entity==="Hamasa"?"🏭":b.entity==="SDC"?"🔧":b.entity==="Travelio"?"🏢":"📁"}</div>
                <div><div style={{fontWeight:800,fontSize:14}}>{b.entity}</div><div style={{fontSize:11,color:th.textMuted}}>{b.pct.toFixed(0)}% terpakai</div></div>
              </div>
              <div style={{textAlign:"right"}}><div style={{fontSize:11,color:th.textMuted}}>Budget</div><div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:th.textSub}}>{fmtIDR(b.budget,true)}</div></div>
            </div>
            <div style={{height:8,background:th.border,borderRadius:4,overflow:"hidden",marginBottom:8}}>
              <div style={{height:"100%",width:Math.min(b.pct,100)+"%",background:bc,borderRadius:4,transition:"width .7s",boxShadow:`0 0 10px ${bc}66`}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <div><div style={{fontSize:10,color:th.textMuted}}>Terpakai</div><div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:bc}}>{fmtIDR(b.spent,true)}</div></div>
              <div style={{textAlign:"center"}}><div style={{fontSize:10,color:th.textMuted}}>%</div><div style={{fontSize:18,fontWeight:900,color:bc}}>{b.pct.toFixed(0)}%{over?" 🚨":warn?" ⚠️":""}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:10,color:th.textMuted}}>Sisa</div><div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:"#22c55e"}}>{fmtIDR(b.remaining,true)}</div></div>
            </div>
          </div>
        );
      })}
    </>)}
  </>);
}

// ─── FORM MODALS ──────────────────────────────────────────────
function TxFormModal({th,form,setForm,cards,fxRates,scanResult,editId,onClose,onSubmit,saving}) {
  return(
    <Overlay onClose={onClose} th={th} title={editId?"✏️ Edit Transaksi CC":"➕ Tambah Transaksi CC"}>
      <div style={{display:"flex",flexDirection:"column",gap:11}}>
        {scanResult&&<div style={{padding:"9px 13px",background:"rgba(99,102,241,.06)",border:"1px solid rgba(99,102,241,.2)",borderRadius:9,fontSize:11,color:"#818cf8"}}>✨ Data dari AI scan — cek dan lengkapi</div>}
        <R2>
          <F label="Tanggal" th={th}><input className="inp" type="date" value={form.tx_date} onChange={e=>setForm(f=>({...f,tx_date:e.target.value}))}/></F>
          <F label="Kartu" th={th}><select className="inp" value={form.card_id} onChange={e=>setForm(f=>({...f,card_id:e.target.value}))}><option value="">Pilih kartu...</option>{cards.map(c=><option key={c.id} value={c.id}>{c.name} ···· {c.last4}</option>)}</select></F>
        </R2>
        <F label="Keterangan" th={th}><input className="inp" placeholder="Makan siang, belanja, dll..." value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></F>
        <R2>
          <F label="Jumlah" th={th}>
            <div style={{display:"flex",gap:5}}><select className="inp" value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))} style={{width:86,flexShrink:0}}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select><input className="inp" type="number" placeholder="0" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/></div>
            {form.currency!=="IDR"&&form.amount&&<div style={{fontSize:10,color:th.textMuted,marginTop:3}}>≈ {fmtIDR(toIDR(Number(form.amount),form.currency,fxRates))}</div>}
          </F>
          <F label="Fee Gestun (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={form.fee} onChange={e=>setForm(f=>({...f,fee:e.target.value}))}/><div style={{fontSize:9,color:th.textMuted,marginTop:3}}>Tidak direimburse</div></F>
        </R2>
        <R2>
          <F label="Kategori" th={th}><select className="inp" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{CC_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></F>
          <F label="Entitas" th={th}><select className="inp" value={form.entity} onChange={e=>setForm(f=>({...f,entity:e.target.value}))}>{CC_ENTITIES.map(e=><option key={e}>{e}</option>)}</select></F>
        </R2>
        <F label="Catatan" th={th}><input className="inp" placeholder="Opsional..." value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></F>
        <div className="tog-row" onClick={()=>setForm(f=>({...f,reimbursed:!f.reimbursed}))} style={{background:form.reimbursed?"rgba(16,185,129,.06)":"rgba(255,255,255,.02)",borderColor:form.reimbursed?"rgba(16,185,129,.2)":th.border}}>
          <div className={`tog-check ${form.reimbursed?"on":""}`}>{form.reimbursed?"✓":""}</div>
          <div><div style={{fontSize:13,color:form.reimbursed?"#4ade80":th.textMuted,fontWeight:600}}>Sudah Direimburse</div><div style={{fontSize:10,color:th.textMuted}}>Fee gestun tidak termasuk</div></div>
        </div>
        <BtnRow onCancel={onClose} onOk={onSubmit} label={editId?"Simpan":"Tambah"} th={th} saving={saving}/>
      </div>
    </Overlay>
  );
}

function CardFormModal({th,form,setForm,editId,onClose,onSubmit,saving}) {
  return(
    <Overlay onClose={onClose} th={th} title={editId?"✏️ Edit Kartu":"🏦 Tambah Kartu Kredit"}>
      <div style={{display:"flex",flexDirection:"column",gap:11}}>
        <R2><F label="Nama Kartu" th={th}><input className="inp" placeholder="BCA Platinum" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></F><F label="Bank" th={th}><select className="inp" value={form.bank} onChange={e=>setForm(f=>({...f,bank:e.target.value}))}>{BANKS_LIST.map(b=><option key={b}>{b}</option>)}</select></F></R2>
        <R2><F label="4 Digit Terakhir" th={th}><input className="inp" placeholder="1234" maxLength={4} value={form.last4} onChange={e=>setForm(f=>({...f,last4:e.target.value}))}/></F><F label="Network" th={th}><select className="inp" value={form.network} onChange={e=>setForm(f=>({...f,network:e.target.value}))}>{NETWORKS.map(n=><option key={n}>{n}</option>)}</select></F></R2>
        <F label="Limit (Rp)" th={th}><input className="inp" type="number" value={form.card_limit} onChange={e=>setForm(f=>({...f,card_limit:e.target.value}))}/></F>
        <R2><F label="Tgl Cetak" th={th}><input className="inp" type="number" min={1} max={31} value={form.statement_day} onChange={e=>setForm(f=>({...f,statement_day:e.target.value}))}/></F><F label="Tgl Jatuh Tempo" th={th}><input className="inp" type="number" min={1} max={31} value={form.due_day} onChange={e=>setForm(f=>({...f,due_day:e.target.value}))}/></F></R2>
        <F label={`Target: ${form.target_pct}%`} th={th}><input type="range" min={5} max={100} step={5} value={form.target_pct} onChange={e=>setForm(f=>({...f,target_pct:Number(e.target.value)}))} style={{width:"100%",accentColor:"#6366f1"}}/><div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:th.textMuted,marginTop:2}}><span>5%</span><span style={{color:"#818cf8",fontWeight:700}}>{form.target_pct}% = {fmtIDR(Number(form.card_limit||0)*form.target_pct/100,true)}</span><span>100%</span></div></F>
        <R2><F label="Warna Utama" th={th}><div style={{display:"flex",gap:8,alignItems:"center"}}><input type="color" value={form.color} onChange={e=>setForm(f=>({...f,color:e.target.value}))} style={{width:44,height:36,border:"none",borderRadius:8,cursor:"pointer"}}/><span style={{fontSize:11,color:th.textMuted}}>{form.color}</span></div></F><F label="Warna Aksen" th={th}><div style={{display:"flex",gap:8,alignItems:"center"}}><input type="color" value={form.accent} onChange={e=>setForm(f=>({...f,accent:e.target.value}))} style={{width:44,height:36,border:"none",borderRadius:8,cursor:"pointer"}}/></div></F></R2>
        <div style={{background:`linear-gradient(135deg,${form.color},${form.accent})`,borderRadius:12,padding:"13px 15px",color:"white"}}>
          <div style={{fontWeight:800,fontSize:14}}>{form.name||"Nama Kartu"}</div>
          <div style={{fontFamily:"monospace",letterSpacing:3,margin:"7px 0",opacity:.85}}>•••• •••• •••• {form.last4||"0000"}</div>
          <div style={{fontSize:11,opacity:.5}}>{form.bank} · {form.network} · {fmtIDR(Number(form.card_limit||0),true)}</div>
        </div>
        <BtnRow onCancel={onClose} onOk={onSubmit} label={editId?"Simpan":"Tambah"} th={th} saving={saving}/>
      </div>
    </Overlay>
  );
}

function InstFormModal({th,form,setForm,cards,editId,onClose,onSubmit,saving}) {
  return(
    <Overlay onClose={onClose} th={th} title={editId?"✏️ Edit Cicilan":"🔄 Tambah Cicilan"}>
      <div style={{display:"flex",flexDirection:"column",gap:11}}>
        <F label="Nama Item" th={th}><input className="inp" placeholder="iPhone, Laptop..." value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></F>
        <R2><F label="Kartu" th={th}><select className="inp" value={form.card_id} onChange={e=>setForm(f=>({...f,card_id:e.target.value}))}><option value="">Pilih kartu...</option>{cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></F><F label="Entitas" th={th}><select className="inp" value={form.entity} onChange={e=>setForm(f=>({...f,entity:e.target.value}))}>{CC_ENTITIES.map(e=><option key={e}>{e}</option>)}</select></F></R2>
        <R2><F label="Mata Uang" th={th}><select className="inp" value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select></F><F label="Total Harga" th={th}><input className="inp" type="number" value={form.total_amount} onChange={e=>setForm(f=>({...f,total_amount:e.target.value}))}/></F></R2>
        <R2><F label="Jumlah Bulan" th={th}><select className="inp" value={form.months} onChange={e=>setForm(f=>({...f,months:Number(e.target.value)}))}>{[3,6,9,12,18,24,36].map(m=><option key={m} value={m}>{m} bulan</option>)}</select></F><F label="Mulai" th={th}><input className="inp" type="date" value={form.start_date} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))}/></F></R2>
        {form.total_amount&&form.months&&<div style={{padding:"9px 13px",background:"rgba(99,102,241,.07)",border:"1px solid rgba(99,102,241,.2)",borderRadius:9,fontFamily:"monospace",fontSize:13,color:"#818cf8",fontWeight:700}}>Cicilan/bulan: {fmtIDR(Math.round(Number(form.total_amount)/Number(form.months)))}</div>}
        <BtnRow onCancel={onClose} onOk={onSubmit} label={editId?"Simpan":"Tambah"} th={th} saving={saving}/>
      </div>
    </Overlay>
  );
}

function RecurFormModal({th,form,setForm,cards,editId,onClose,onSubmit,saving}) {
  return(
    <Overlay onClose={onClose} th={th} title={editId?"✏️ Edit Recurring":"↺ Tambah Recurring"}>
      <div style={{display:"flex",flexDirection:"column",gap:11}}>
        <F label="Nama" th={th}><input className="inp" placeholder="Netflix, Spotify..." value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></F>
        <R2><F label="Kartu" th={th}><select className="inp" value={form.card_id} onChange={e=>setForm(f=>({...f,card_id:e.target.value}))}><option value="">Pilih kartu...</option>{cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></F><F label="Entitas" th={th}><select className="inp" value={form.entity} onChange={e=>setForm(f=>({...f,entity:e.target.value}))}>{CC_ENTITIES.map(e=><option key={e}>{e}</option>)}</select></F></R2>
        <R2><F label="Jumlah" th={th}><div style={{display:"flex",gap:5}}><select className="inp" value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))} style={{width:80,flexShrink:0}}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select><input className="inp" type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/></div></F><F label="Fee Gestun" th={th}><input className="inp" type="number" placeholder="0" value={form.fee} onChange={e=>setForm(f=>({...f,fee:e.target.value}))}/></F></R2>
        <R2><F label="Kategori" th={th}><select className="inp" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{CC_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></F><F label="Frekuensi" th={th}><select className="inp" value={form.frequency} onChange={e=>setForm(f=>({...f,frequency:e.target.value}))}>{["Bulanan","Mingguan","Tahunan"].map(f=><option key={f}>{f}</option>)}</select></F></R2>
        <F label="Tanggal" th={th}><input className="inp" type="number" min={1} max={31} value={form.day_of_month} onChange={e=>setForm(f=>({...f,day_of_month:e.target.value}))}/></F>
        <BtnRow onCancel={onClose} onOk={onSubmit} label={editId?"Simpan":"Tambah"} th={th} saving={saving}/>
      </div>
    </Overlay>
  );
}

function BudgetFormModal({th,form,setForm,onClose,onSubmit,saving}) {
  return(
    <Overlay onClose={onClose} th={th} title="◎ Edit Budget Bulanan">
      <div style={{fontSize:11,color:th.textMuted,marginBottom:16}}>Set budget pengeluaran CC per entitas untuk bulan ini.</div>
      {["Pribadi","Hamasa","SDC","Travelio","Lainnya"].map(e=>(
        <div key={e} style={{marginBottom:13}}>
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}><div style={{width:7,height:7,borderRadius:"50%",background:ENTITY_COLORS[e]}}/><span style={{fontSize:13,fontWeight:700}}>{e}</span></div>
          <input className="inp" type="number" placeholder="0 = tidak ada limit" value={form[e]||""} onChange={e2=>setForm(f=>({...f,[e]:Number(e2.target.value)}))}/>
          {form[e]>0&&<div style={{fontSize:10,color:ENTITY_COLORS[e],marginTop:3}}>{fmtIDR(form[e])} / bulan</div>}
        </div>
      ))}
      <BtnRow onCancel={onClose} onOk={onSubmit} label="Simpan Budget" th={th} saving={saving}/>
    </Overlay>
  );
}

function FxModal({th,rates,setRates,onClose,onSave}) {
  return(
    <Overlay onClose={onClose} th={th} title="💱 Kurs Mata Uang">
      <div style={{fontSize:11,color:th.textMuted,marginBottom:16}}>Kurs konversi ke IDR. Tersimpan otomatis.</div>
      {CURRENCIES.filter(c=>c.code!=="IDR").map(cur=>(
        <div key={cur.code} style={{display:"flex",alignItems:"center",gap:10,marginBottom:11}}>
          <span style={{fontSize:18}}>{cur.flag}</span>
          <span style={{fontSize:13,fontWeight:700,color:th.textSub,width:34}}>{cur.code}</span>
          <input className="inp" type="number" value={rates[cur.code]||cur.rate} onChange={e=>setRates(r=>({...r,[cur.code]:Number(e.target.value)}))} style={{flex:1}}/>
          <span style={{fontSize:11,color:th.textMuted}}>IDR</span>
        </div>
      ))}
      <BtnRow onCancel={onClose} onOk={onSave} label="Simpan Kurs" th={th}/>
    </Overlay>
  );
}

function CardDetailModal({th,card,txIDR,onClose}) {
  return(
    <Overlay onClose={onClose} th={th} title={card.name} wide>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        {[["Limit",fmtIDR(card.card_limit)],["Terpakai Bulan Ini",fmtIDR(card.spent)],["Sisa Limit",fmtIDR(card.avail)],["Target",`${card.target_pct}% = ${fmtIDR(card.card_limit*card.target_pct/100,true)}`],["Tgl Cetak",`Tgl ${card.statement_day} (${card.statIn} hari)`],["Jatuh Tempo",`Tgl ${card.due_day} (${card.dueIn} hari)`],["Total Semua",fmtIDR(card.total)],["Total Reimburse",fmtIDR(card.reimb)]].map(([l,v])=>(
          <div key={l} style={{background:th.bgInput,border:`1px solid ${th.border}`,borderRadius:9,padding:"9px 11px"}}>
            <div style={{fontSize:9,color:th.textMuted,fontWeight:700,textTransform:"uppercase",marginBottom:2}}>{l}</div>
            <div style={{fontSize:12,fontWeight:700,fontFamily:"monospace"}}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{fontSize:10,color:th.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Transaksi Terakhir</div>
      {card.allTx.slice(0,6).map(t=>(
        <div key={t.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${th.border}`,fontSize:12}}>
          <span style={{color:th.textMuted}}>{t.tx_date?.slice(5)} · {t.description} <span style={{color:ENTITY_COLORS[t.entity],fontSize:10}}>[{t.entity}]</span></span>
          <span style={{fontFamily:"monospace",color:t.reimbursed?"#4ade80":"#f87171"}}>{fmtIDR(txIDR(t),true)}</span>
        </div>
      ))}
      {card.allTx.length===0&&<div style={{textAlign:"center",color:th.textFaint,padding:"20px 0"}}>Belum ada transaksi</div>}
    </Overlay>
  );
}

function StatementModal({th,cards,statCard,setStatCard,instList,fxRates,curMonth,onClose}) {
  const cs = cards.find(c=>c.id===statCard);
  const inst = instList.filter(i=>i.card_id===statCard&&i.paid_months<i.months).reduce((s,i)=>s+toIDR(i.monthly_amount||(i.total_amount/i.months),i.currency,fxRates),0);
  const fees = cs?.thisM?.reduce((s,t)=>s+(Number(t.fee)||0),0)||0;
  const pokok = cs?.thisM?.reduce((s,t)=>s+toIDR(t.amount||0,t.currency||"IDR",fxRates),0)||0;
  const total = pokok+inst+fees;
  return(
    <Overlay onClose={onClose} th={th} title="🧾 Statement Simulator" wide>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
        {cards.map(c=><button key={c.id} onClick={()=>setStatCard(c.id)} style={{background:statCard===c.id?`linear-gradient(135deg,${c.color},${c.accent})`:"transparent",border:`1px solid ${statCard===c.id?"transparent":th.border}`,borderRadius:9,padding:"7px 12px",fontFamily:"inherit",fontWeight:700,fontSize:11,cursor:"pointer",color:statCard===c.id?"white":th.textMuted}}>{c.name?.split(" ").slice(0,2).join(" ")} ···· {c.last4}</button>)}
      </div>
      {cs&&(<>
        <div style={{background:"rgba(99,102,241,.06)",border:"1px solid rgba(99,102,241,.2)",borderRadius:12,padding:16,marginBottom:14}}>
          <div style={{fontSize:10,color:"#6366f1",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:10}}>Estimasi Tagihan {mlFull(curMonth)}</div>
          {[["Transaksi Biasa",pokok,`${cs.thisM?.length||0} tx`],["Cicilan Aktif",inst,"bulanan"],["Fee Gestun",fees,"tidak direimburse"]].map(([l,v,s])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${th.border}`}}>
              <div><div style={{fontSize:12,color:th.textSub}}>{l}</div><div style={{fontSize:10,color:th.textMuted}}>{s}</div></div>
              <div style={{fontFamily:"monospace",fontSize:13,fontWeight:700}}>{fmtIDR(v)}</div>
            </div>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",paddingTop:12,marginTop:4}}>
            <div style={{fontWeight:800,fontSize:14}}>TOTAL</div>
            <div style={{fontFamily:"monospace",fontSize:20,fontWeight:900,color:"#f59e0b"}}>{fmtIDR(total)}</div>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div style={{background:"rgba(239,68,68,.06)",border:"1px solid rgba(239,68,68,.15)",borderRadius:10,padding:12}}>
            <div style={{fontSize:10,color:"#ef4444",fontWeight:700,textTransform:"uppercase"}}>Pembayaran Minimum</div>
            <div style={{fontFamily:"monospace",fontSize:15,fontWeight:800,color:"#f87171",marginTop:4}}>{fmtIDR(Math.max(total*.1,100000))}</div>
          </div>
          <div style={{background:"rgba(16,185,129,.06)",border:"1px solid rgba(16,185,129,.15)",borderRadius:10,padding:12}}>
            <div style={{fontSize:10,color:"#10b981",fontWeight:700,textTransform:"uppercase"}}>Jatuh Tempo</div>
            <div style={{fontFamily:"monospace",fontSize:15,fontWeight:800,color:"#4ade80",marginTop:4}}>{cs.dueIn} hari lagi</div>
          </div>
        </div>
      </>)}
    </Overlay>
  );
}

// ─── SHARED MINI COMPONENTS ───────────────────────────────────
const Overlay = ({children,onClose,title,wide,th}) => (
  <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" style={{maxWidth:wide?520:460,background:th.bgModal,border:`1px solid ${th.border}`}}>
      {title&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}><div style={{fontWeight:800,fontSize:16}}>{title}</div><button className="close-x" style={{background:th.bgInput,border:`1px solid ${th.border}`}} onClick={onClose}>✕</button></div>}
      {children}
    </div>
  </div>
);
const Tag = ({children,color,bg,th}) => <span style={{display:"inline-block",padding:"2px 7px",borderRadius:20,fontSize:10,fontWeight:600,background:bg||th.bgInput,color:color||th.textMuted,border:`1px solid ${color?color+"33":th.border}`,whiteSpace:"nowrap"}}>{children}</span>;
const F   = ({label,children,th}) => <div style={{flex:1}}><div style={{fontSize:10,color:th.textMuted,fontWeight:700,letterSpacing:.5,textTransform:"uppercase",marginBottom:5}}>{label}</div>{children}</div>;
const R2  = ({children}) => <div style={{display:"flex",gap:10}}>{children}</div>;
const BtnRow = ({onCancel,onOk,label,th,saving}) => (
  <div style={{display:"flex",gap:10,marginTop:6}}>
    <button className="btn-cancel" style={{background:th.bgInput,color:th.textMuted,border:`1px solid ${th.border}`}} onClick={onCancel}>Batal</button>
    <button className="btn-confirm" onClick={onOk} disabled={saving} style={{opacity:saving?.7:1}}>{saving?"Menyimpan...":label}</button>
  </div>
);
const Empty = ({icon,msg,onAdd,addLabel}) => (
  <div style={{textAlign:"center",padding:"40px 20px"}}>
    <div style={{fontSize:36,marginBottom:8}}>{icon}</div>
    <div style={{fontSize:13,color:"#475569",marginBottom:14}}>{msg}</div>
    {onAdd&&<button className="btn-add" onClick={onAdd}>{addLabel}</button>}
  </div>
);

// ─── CSS ──────────────────────────────────────────────────────
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}
.anim-in{animation:fu .28s cubic-bezier(.22,1,.36,1) both}
@keyframes fu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes spin{to{transform:rotate(360deg)}}
.btn-confirm{flex:2;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;padding:10px;border-radius:9px;font-family:inherit;font-weight:700;font-size:13px;cursor:pointer;transition:filter .15s}
.btn-confirm:hover{filter:brightness(1.1)}
.btn-confirm:disabled{opacity:.5;cursor:not-allowed}
.btn-cancel{flex:1;padding:10px;border-radius:9px;font-family:inherit;font-weight:600;font-size:12px;cursor:pointer;transition:all .15s}
.btn-add{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;padding:8px 16px;border-radius:9px;font-family:inherit;font-weight:700;font-size:12px;cursor:pointer;transition:filter .15s;white-space:nowrap}
.btn-add:hover{filter:brightness(1.12)}
.btn-theme{width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .15s;border:none}
.btn-scan{background:rgba(99,102,241,.12);color:#a5b4fc;border:1px solid rgba(99,102,241,.25);padding:7px 13px;border-radius:9px;font-family:inherit;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap}
.btn-outline-sm{background:transparent;border:1px solid;padding:7px 12px;border-radius:8px;font-family:inherit;font-weight:600;font-size:11px;cursor:pointer;transition:all .15s;white-space:nowrap}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:200;padding:14px;overflow-y:auto;backdrop-filter:blur(6px)}
.modal{border-radius:18px;padding:22px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.5)}
.close-x{width:29px;height:29px;border-radius:8px;cursor:pointer;font-size:12px;font-family:inherit;display:flex;align-items:center;justify-content:center;transition:all .15s}
.inp{border:1px solid;color:inherit;padding:8px 11px;border-radius:9px;font-family:inherit;font-size:12px;width:100%;outline:none;transition:border-color .15s}
.tog-row{display:flex;align-items:center;gap:11px;padding:10px 13px;border:1px solid;border-radius:10px;cursor:pointer;transition:all .15s}
.tog-check{width:19px;height:19px;border-radius:6px;border:2px solid rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;flex-shrink:0;transition:all .2s}
.tog-check.on{background:#10b981;border-color:#10b981;color:#fff}
.scan-drop{position:relative;border:2px dashed;border-radius:14px;padding:40px 20px;text-align:center;cursor:pointer;transition:all .2s;min-height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.subtab{background:transparent;border:1px solid transparent;color:#475569;padding:7px 12px;border-radius:8px;font-family:inherit;font-weight:700;font-size:11px;cursor:pointer;transition:all .15s;white-space:nowrap}
.subtab.active{background:rgba(99,102,241,.15);color:#a5b4fc;border-color:rgba(99,102,241,.3)}
.reimb-btn{padding:3px 8px;border-radius:5px;font-family:inherit;font-weight:700;font-size:10px;cursor:pointer;white-space:nowrap;transition:all .15s;border:1px solid}
.reimb-btn.done{background:rgba(16,185,129,.1);color:#4ade80;border-color:rgba(16,185,129,.25)}
.icon-btn{border:1px solid;padding:3px 7px;border-radius:5px;font-size:10px;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap;background:transparent}
.icon-btn.danger{color:#f87171}
.btn-sm{border:1px solid;padding:5px 11px;border-radius:7px;font-family:inherit;font-weight:600;font-size:11px;cursor:pointer;transition:all .15s;background:transparent}
.btn-sm:disabled{opacity:.35;cursor:not-allowed}
.btn-sm.danger{color:#f87171}
.btn-cc{background:rgba(255,255,255,.12);color:rgba(255,255,255,.85);border:1px solid rgba(255,255,255,.2);padding:6px 13px;border-radius:8px;font-family:inherit;font-weight:600;font-size:11px;cursor:pointer}
.credit-card{background:linear-gradient(135deg,var(--cc),var(--ca));border-radius:17px;padding:20px;color:white;box-shadow:0 10px 40px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.15);margin-bottom:13px;position:relative;overflow:hidden}
.credit-card::before{content:"";position:absolute;top:-40px;right:-40px;width:130px;height:130px;border-radius:50%;background:rgba(255,255,255,.06)}
.bank-card{background:linear-gradient(135deg,var(--bc),var(--ba));border-radius:16px;padding:18px;color:white;box-shadow:0 8px 32px rgba(0,0,0,.25)}
.btn-bank-act{background:rgba(255,255,255,.12);color:rgba(255,255,255,.85);border:1px solid rgba(255,255,255,.2);padding:5px 11px;border-radius:7px;font-family:inherit;font-weight:600;font-size:11px;cursor:pointer}
.btn-bank-del{background:rgba(239,68,68,.2);color:#f87171;border:1px solid rgba(239,68,68,.3);padding:5px 10px;border-radius:7px;font-family:inherit;font-weight:600;font-size:11px;cursor:pointer}
.badge{background:#ef4444;color:white;border-radius:20px;padding:1px 6px;font-size:10px;font-weight:700;margin-left:auto}
.alert-dot{background:#ef4444;color:white;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:700}
.link-btn{background:transparent;border:none;color:#6366f1;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;padding:4px 8px;border-radius:6px}
.hero-card{border-radius:13px;padding:15px;border:1px solid;position:relative;overflow:hidden;transition:transform .2s}
.card-hov{transition:transform .2s,background .15s,border-color .15s;cursor:pointer}
.card-hov:hover{transform:translateY(-2px)}
.sec-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.sec-label{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase}
.alert-bar{display:flex;align-items:center;gap:11px;padding:10px 13px;border-radius:11px;margin-bottom:7px}
.alert-bar.danger{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2)}
.alert-bar.warning{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2)}
.bottom-nav{display:none;position:fixed;bottom:0;left:0;right:0;z-index:50;backdrop-filter:blur(20px)}
.bot-btn{display:flex;flex-direction:column;align-items:center;background:transparent;border:none;font-family:inherit;cursor:pointer;padding:8px 10px 12px;border-radius:10px;transition:color .15s;min-width:52px}
@media(max-width:768px){
  .sidebar{display:none!important}
  .bottom-nav{display:flex!important;justify-content:space-around}
  .main{padding-bottom:70px!important}
  .content{padding:14px!important}
  .hero-grid{grid-template-columns:repeat(2,1fr)!important}
  .topbar{padding:12px 14px!important}
}
`;

const dynamicCSS = th => `
.sidebar{width:212px;background:${th.bgNav};border-right:1px solid ${th.border};display:flex;flex-direction:column;justify-content:space-between;position:sticky;top:0;height:100vh;flex-shrink:0;backdrop-filter:blur(20px);transition:background .3s}
.brand{padding:16px 14px 13px;display:flex;align-items:center;gap:10px;border-bottom:1px solid ${th.border};margin-bottom:8px}
.brand-icon{width:34px;height:34px;background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.brand-name{font-weight:800;font-size:13px;color:${th.text}}
.brand-sub{font-size:9px;color:${th.textMuted};letter-spacing:.3px}
.side-btn{display:flex;align-items:center;gap:9px;width:100%;padding:8px 11px;border:none;background:transparent;color:${th.textMuted};font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;border-radius:9px;margin-bottom:2px;transition:all .15s;text-align:left}
.side-btn:hover{background:${th.bgCard};color:${th.textSub}}
.side-btn.active{background:rgba(99,102,241,.12);color:#a5b4fc}
.side-footer{padding:10px 12px;border-top:1px solid ${th.border}}
.side-act{display:block;width:100%;padding:6px 9px;border:none;background:transparent;color:${th.textMuted};font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;border-radius:7px;margin-bottom:3px;text-align:left;transition:all .15s}
.side-act:hover{background:${th.bgCard};color:${th.textSub}}
.main{flex:1;display:flex;flex-direction:column;min-width:0;overflow-x:hidden;transition:background .3s}
.topbar{padding:14px 22px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${th.border};background:${th.bgNav};backdrop-filter:blur(20px);position:sticky;top:0;z-index:40;transition:background .3s;gap:10px;flex-wrap:wrap}
.page-title{font-weight:800;font-size:18px;color:${th.text};letter-spacing:-.3px}
.page-sub{font-size:11px;color:${th.textMuted};margin-top:2px}
.content{max-width:760px;width:100%;padding:18px 20px;transition:background .3s}
.hero-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:20px}
.glass-card{background:${th.bgCard};border:1px solid ${th.border};border-radius:13px;backdrop-filter:blur(10px);transition:background .3s,border-color .15s}
.tx-row{display:flex;align-items:flex-start;gap:11px;background:${th.bgCard};border:1px solid ${th.border};border-radius:11px;padding:11px 13px;margin-bottom:6px;transition:background .15s}
.tx-row:hover{background:${th.bgCardHov}}
.search-box{width:100%;background:${th.bgInput};border:1px solid ${th.border};color:${th.text};padding:9px 13px;border-radius:10px;font-family:inherit;font-size:13px;outline:none;transition:border-color .15s}
.search-box:focus{border-color:rgba(99,102,241,.4)}
.mini-sel{background:${th.bgInput};border:1px solid ${th.border};color:${th.textSub};padding:6px 9px;border-radius:8px;font-family:inherit;font-size:11px;outline:none;cursor:pointer}
.mini-sel option{background:${th.bgModal}}
.inp{background:${th.bgInput}!important;border-color:${th.border}!important;color:${th.text}!important}
.inp:focus{border-color:rgba(99,102,241,.5)!important}
.inp option{background:${th.bgModal}}
.icon-btn{background:${th.bgInput};border-color:${th.border};color:${th.textMuted}}
.btn-sm{background:${th.bgInput};border-color:${th.border};color:${th.textSub}}
.btn-outline-sm{border-color:${th.border};color:${th.textSub}}
.btn-outline-sm:hover{background:${th.bgCard}}
.btn-theme{background:${th.bgCard};border:1px solid ${th.border};color:${th.text}}
.reimb-btn{background:${th.bgInput};color:${th.textMuted};border-color:${th.border}}
.sec-label{color:${th.textMuted}}
.subtab{color:${th.textMuted}}
.bottom-nav{background:${th.bgNav};border-top:1px solid ${th.border}}
.bot-btn{color:${th.textMuted}}
.bot-btn.active{color:#a5b4fc}
.scan-drop{border-color:${th.border}}
.tog-row{border-color:${th.border}}
`;