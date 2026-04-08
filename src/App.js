// ============================================================
// PAULUS FINANCE - Session 2
// NEW PREMIUM UI (Light default, Mobile-first, Sora font)
// CC Tracker + Bank + Piutang Manager
// Supabase integrated
// ============================================================

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

// ─── CONSTANTS ────────────────────────────────────────────────
const CURRENCIES = [
  {code:"IDR",symbol:"Rp",rate:1,flag:"🇮🇩"},
  {code:"USD",symbol:"$",rate:16400,flag:"🇺🇸"},
  {code:"SGD",symbol:"S$",rate:12200,flag:"🇸🇬"},
  {code:"MYR",symbol:"RM",rate:3700,flag:"🇲🇾"},
  {code:"JPY",symbol:"¥",rate:110,flag:"🇯🇵"},
  {code:"EUR",symbol:"€",rate:17800,flag:"🇪🇺"},
  {code:"AUD",symbol:"A$",rate:10500,flag:"🇦🇺"},
];
const CC_CATS   = ["Belanja","Makan & Minum","Transport","Tagihan","Hotel/Travel","Elektronik","Kesehatan","Hiburan","Lainnya"];
const BNK_CATS  = ["Gaji","Transfer Masuk","Tarik Tunai","Belanja","Makan & Minum","Transport","Tagihan","Investasi","Lainnya"];
const ENTITIES  = ["Pribadi","Hamasa","SDC","Travelio","Lainnya"];
const CC_ENTS   = ["Pribadi","Hamasa","SDC","Travelio"];
const BANKS_L   = ["BCA","Mandiri","BNI","CIMB","BRI","Permata","Danamon","OCBC","Jenius","SeaBank","Lainnya"];
const NETWORKS  = ["Visa","Mastercard","JCB","Amex"];
const ENT_COL   = {Pribadi:"#3b5bdb",Hamasa:"#0ca678",SDC:"#e67700",Travelio:"#0c8599",Lainnya:"#8a90aa"};
const ENT_BG    = {Pribadi:"#eef2ff",Hamasa:"#e6fcf5",SDC:"#fff9db",Travelio:"#e3fafc",Lainnya:"#f0f1f7"};
const ASSET_CATS= ["Properti","Kendaraan","Saham","Reksa Dana","Crypto","Emas","Deposito","Barang Berharga","FX/Cash"];
const LIAB_CATS = ["KPR","Kredit Kendaraan","Pinjaman"];
const ASSET_ICON= {Properti:"🏠",Kendaraan:"🚗",Saham:"📈","Reksa Dana":"💼",Crypto:"🪙",Emas:"🏅",Deposito:"🏦","Barang Berharga":"💎","FX/Cash":"💵"};
const ASSET_COL = {Properti:"#3b5bdb",Kendaraan:"#0c8599",Saham:"#0ca678","Reksa Dana":"#7048e8",Crypto:"#e67700",Emas:"#d4a017",Deposito:"#2563eb","Barang Berharga":"#9333ea","FX/Cash":"#0891b2"};
const ASSET_BG  = {Properti:"#eef2ff",Kendaraan:"#e3fafc",Saham:"#e6fcf5","Reksa Dana":"#f3f0ff",Crypto:"#fff9db",Emas:"#fef9c3",Deposito:"#eff6ff","Barang Berharga":"#faf5ff","FX/Cash":"#ecfeff"};
const INCOME_CATS=["Gaji","Sewa","Dividen","Bunga Deposito","Freelance","Bonus","Transfer Masuk","Lainnya"];

// ─── HELPERS ──────────────────────────────────────────────────
const getCur   = c => CURRENCIES.find(x=>x.code===c)||CURRENCIES[0];
const toIDR    = (a,c,fx={}) => a*(fx[c]||getCur(c).rate);
const fmtIDR   = (n,s=false) => {
  const v=Math.abs(Number(n||0));
  if(s&&v>=1e9) return"Rp "+(v/1e9).toFixed(1)+"M";
  if(s&&v>=1e6) return"Rp "+(v/1e6).toFixed(1)+"jt";
  if(s&&v>=1e3) return"Rp "+(v/1e3).toFixed(0)+"rb";
  return"Rp "+v.toLocaleString("id-ID");
};
const fmtCur   = (a,c) => c==="IDR"?"Rp "+Number(a||0).toLocaleString("id-ID"):(({USD:"$",SGD:"S$",MYR:"RM",JPY:"¥",EUR:"€",AUD:"A$"}[c]||c)+" "+Number(a||0).toFixed(2));
const today    = () => new Date().toISOString().slice(0,10);
const ym       = d => d?.slice(0,7)||"";
const mlFull   = s => { try{const[y,m]=s.split("-");return new Date(y,m-1).toLocaleDateString("id-ID",{month:"long",year:"numeric"});}catch{return s;} };
const mlShort  = s => { try{const[y,m]=s.split("-");return new Date(y,m-1).toLocaleDateString("id-ID",{month:"short",year:"2-digit"});}catch{return s;} };
const daysUntil= d => { const n=new Date();let t=new Date(n.getFullYear(),n.getMonth(),d);if(t<=n)t=new Date(n.getFullYear(),n.getMonth()+1,d);return Math.ceil((t-n)/86400000); };
const agingLabel= d => { const days=Math.floor((new Date()-new Date(d))/86400000); if(days<=30)return{label:"< 30 hari",color:"#0ca678"}; if(days<=60)return{label:"31–60 hari",color:"#e67700"}; return{label:"60+ hari",color:"#e03131"}; };

// ─── THEME ────────────────────────────────────────────────────
const LIGHT = {
  bg:"#f5f6fa", sur:"#ffffff", sur2:"#f0f1f7", sur3:"#e8eaf2",
  bor:"#e2e4ed", bor2:"#d0d3e0",
  tx:"#0f1117", tx2:"#4a4f6a", tx3:"#8a90aa",
  ac:"#3b5bdb", acBg:"#eef2ff",
  gr:"#0ca678", grBg:"#e6fcf5",
  rd:"#e03131", rdBg:"#fff5f5",
  am:"#e67700", amBg:"#fff9db",
  pu:"#7048e8", puBg:"#f3f0ff",
  te:"#0c8599", teBg:"#e3fafc",
  sh:"0 1px 3px rgba(0,0,0,.05),0 4px 16px rgba(0,0,0,.04)",
  sh2:"0 4px 24px rgba(0,0,0,.08)",
};
const DARK = {
  bg:"#0d0f18", sur:"#141620", sur2:"#1a1d2e", sur3:"#1f2338",
  bor:"#252840", bor2:"#2e3250",
  tx:"#eef0f8", tx2:"#9099c0", tx3:"#5a6090",
  ac:"#7c8ff0", acBg:"#1a1f3a",
  gr:"#38d9a9", grBg:"#0d2420",
  rd:"#fc8181", rdBg:"#2d1515",
  am:"#fcd34d", amBg:"#2a2000",
  pu:"#b197fc", puBg:"#1e1530",
  te:"#63e6e2", teBg:"#0d2426",
  sh:"0 1px 3px rgba(0,0,0,.3),0 4px 16px rgba(0,0,0,.2)",
  sh2:"0 4px 24px rgba(0,0,0,.4)",
};

// ─── AI ───────────────────────────────────────────────────────
const AI_HEADERS={"Content-Type":"application/json","anthropic-version":"2023-06-01","x-api-key":process.env.REACT_APP_ANTHROPIC_KEY||""};
async function aiScanReceipt(b64,mime) {
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:AI_HEADERS,body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:800,messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:mime,data:b64}},{type:"text",text:`Ekstrak data struk/nota/invoice ini. Response HANYA JSON tanpa markdown:\n{"amount":<angka>,"currency":"IDR","date":"YYYY-MM-DD","merchant":"<nama toko/vendor>","category":"<Belanja|Makan & Minum|Transport|Tagihan|Hotel/Travel|Elektronik|Kesehatan|Hiburan|Lainnya>","fee":0,"type":"out","notes":""}`}]}]})});
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error?.message||`HTTP ${r.status}`);}
  const d=await r.json();
  const text=(d.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim();
  console.log("[aiScanReceipt] raw:",text);
  return JSON.parse(text);
}
async function aiParsePDF(b64) {
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:AI_HEADERS,body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:4000,messages:[{role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}},{type:"text",text:`Ekstrak SEMUA transaksi dari mutasi rekening koran/bank statement ini.\nResponse HANYA JSON array tanpa markdown:\n[{"date":"YYYY-MM-DD","description":"<keterangan transaksi>","amount":<angka_positif>,"type":"in|out","balance":<saldo_atau_null>}]\nUrutkan dari terlama ke terbaru. Jika tidak bisa baca saldo pakai null.`}]}]})});
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error?.message||`HTTP ${r.status}`);}
  const d=await r.json();
  const text=(d.content?.[0]?.text||"[]").replace(/```json|```/g,"").trim();
  console.log("[aiParsePDF] raw preview:",text.slice(0,200));
  return JSON.parse(text);
}
async function aiCategorize(desc) {
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:AI_HEADERS,body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:50,messages:[{role:"user",content:`Kategorikan transaksi bank: "${desc}"\nPilih: Gaji|Transfer Masuk|Tarik Tunai|Belanja|Makan & Minum|Transport|Tagihan|Investasi|Lainnya\nJawab nama kategori saja.`}]})});
  if(!r.ok)return"Lainnya";
  const d=await r.json(); return d.content?.[0]?.text?.trim()||"Lainnya";
}
async function aiAdvisor(q,ctx) {
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:AI_HEADERS,body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:600,messages:[{role:"user",content:`Kamu financial advisor pribadi.\nData: saldo bank ${fmtIDR(ctx.bank)}, hutang CC ${fmtIDR(ctx.cc)}, piutang ${fmtIDR(ctx.piutang)}.\nPertanyaan: ${q}\nJawab Bahasa Indonesia, singkat & actionable. Max 150 kata.`}]})});
  if(!r.ok)return"Maaf, AI tidak bisa dijangkau sekarang.";
  const d=await r.json(); return d.content?.[0]?.text||"Maaf, tidak bisa menjawab.";
}
async function aiAssetValuation(asset) {
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:AI_HEADERS,body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:400,messages:[{role:"user",content:`Estimasikan nilai pasar aset berikut dalam IDR (Rupiah Indonesia) berdasarkan kondisi pasar Indonesia saat ini.\n\nAset: ${asset.name}\nKategori: ${asset.category}\nNilai Beli: Rp ${Number(asset.purchase_value||0).toLocaleString("id-ID")}\nTanggal Beli: ${asset.purchase_date||"tidak diketahui"}\nNilai Tercatat: Rp ${Number(asset.current_value||0).toLocaleString("id-ID")}\nCatatan: ${asset.notes||"-"}\n\nJawab HANYA JSON: {"estimated_value":<angka_IDR>,"confidence":"low|medium|high","reasoning":"<max 60 kata>"}`}]})});
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error?.message||`HTTP ${r.status}`);}
  const d=await r.json();
  return JSON.parse((d.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim());
}

// ─── SUPABASE API ─────────────────────────────────────────────
const api = {
  cards:{
    getAll: async u=>{const{data}=await supabase.from("cards").select("*").eq("user_id",u).order("sort_order");return data||[];},
    create: async(u,d)=>{const{data}=await supabase.from("cards").insert([{...d,user_id:u}]).select().single();return data;},
    update: async(id,d)=>{const{data}=await supabase.from("cards").update(d).eq("id",id).select().single();return data;},
    delete: async id=>supabase.from("cards").delete().eq("id",id),
  },
  tx:{
    getAll: async u=>{const{data}=await supabase.from("transactions").select("*").eq("user_id",u).order("tx_date",{ascending:false});return data||[];},
    create: async(u,d)=>{const{data,error}=await supabase.from("transactions").insert([{...d,user_id:u}]).select().single();if(error)throw new Error(error.message);return data;},
    update: async(id,d)=>{const{data,error}=await supabase.from("transactions").update(d).eq("id",id).select().single();if(error)throw new Error(error.message);return data;},
    delete: async id=>supabase.from("transactions").delete().eq("id",id),
    toggleReimb: async(id,v)=>supabase.from("transactions").update({reimbursed:v}).eq("id",id),
  },
  inst:{
    getAll: async u=>{const{data}=await supabase.from("installments").select("*").eq("user_id",u);return data||[];},
    create: async(u,d)=>{const{data}=await supabase.from("installments").insert([{...d,user_id:u}]).select().single();return data;},
    update: async(id,d)=>{const{data}=await supabase.from("installments").update(d).eq("id",id).select().single();return data;},
    delete: async id=>supabase.from("installments").delete().eq("id",id),
    markPaid: async(id,n)=>supabase.from("installments").update({paid_months:n}).eq("id",id),
  },
  budgets:{
    getMonth: async(u,my)=>{const{data}=await supabase.from("budgets").select("*").eq("user_id",u).eq("month_year",my);const r={Pribadi:0,Hamasa:0,SDC:0,Travelio:0,Lainnya:0};(data||[]).forEach(b=>{r[b.entity]=Number(b.amount);});return r;},
    upsertAll: async(u,my,obj)=>{const rows=Object.entries(obj).map(([entity,amount])=>({user_id:u,entity,amount,month_year:my}));await supabase.from("budgets").upsert(rows,{onConflict:"user_id,entity,month_year"});},
  },
  recur:{
    getAll: async u=>{const{data}=await supabase.from("recurring_templates").select("*").eq("user_id",u);return data||[];},
    create: async(u,d)=>{const{data}=await supabase.from("recurring_templates").insert([{...d,user_id:u}]).select().single();return data;},
    update: async(id,d)=>{const{data}=await supabase.from("recurring_templates").update(d).eq("id",id).select().single();return data;},
    delete: async id=>supabase.from("recurring_templates").delete().eq("id",id),
    toggle: async(id,v)=>supabase.from("recurring_templates").update({active:v}).eq("id",id),
  },
  fx:{
    getAll: async u=>{const{data}=await supabase.from("fx_rates").select("*").eq("user_id",u);return Object.fromEntries((data||[]).map(r=>[r.currency,r.rate_to_idr]));},
    upsertAll: async(u,obj)=>{const rows=Object.entries(obj).map(([currency,rate_to_idr])=>({user_id:u,currency,rate_to_idr}));await supabase.from("fx_rates").upsert(rows,{onConflict:"user_id,currency"});},
  },
  bank:{
    getAll: async u=>{const{data}=await supabase.from("bank_accounts").select("*").eq("user_id",u).order("sort_order");return data||[];},
    create: async(u,d)=>{const{data}=await supabase.from("bank_accounts").insert([{...d,user_id:u}]).select().single();return data;},
    update: async(id,d)=>{const{data}=await supabase.from("bank_accounts").update(d).eq("id",id).select().single();return data;},
    delete: async id=>supabase.from("bank_accounts").delete().eq("id",id),
  },
  mut:{
    getAll: async u=>{const{data}=await supabase.from("bank_mutations").select("*").eq("user_id",u).order("mut_date",{ascending:false});return data||[];},
    create: async(u,d)=>{const{data}=await supabase.from("bank_mutations").insert([{...d,user_id:u}]).select().single();return data;},
    update: async(id,d)=>{const{data}=await supabase.from("bank_mutations").update(d).eq("id",id).select().single();return data;},
    delete: async id=>supabase.from("bank_mutations").delete().eq("id",id),
  },
  // Piutang reimburse
  reimb:{
    getAccounts: async u=>{const{data}=await supabase.from("reimburse_accounts").select("*").eq("user_id",u);return data||[];},
    createAccount: async(u,d)=>{const{data}=await supabase.from("reimburse_accounts").insert([{...d,user_id:u}]).select().single();return data;},
    deleteAccount: async id=>supabase.from("reimburse_accounts").delete().eq("id",id),
    getTx: async u=>{const{data}=await supabase.from("reimburse_transactions").select("*").eq("user_id",u).order("tx_date",{ascending:false});return data||[];},
    createTx: async(u,d)=>{const{data}=await supabase.from("reimburse_transactions").insert([{...d,user_id:u}]).select().single();return data;},
    updateTx: async(id,d)=>{const{data}=await supabase.from("reimburse_transactions").update(d).eq("id",id).select().single();return data;},
    deleteTx: async id=>supabase.from("reimburse_transactions").delete().eq("id",id),
    settle: async(id,bankId,date)=>supabase.from("reimburse_transactions").update({settled:true,settled_date:date,settled_bank_id:bankId}).eq("id",id),
  },
  // Piutang karyawan
  empLoan:{
    getAll: async u=>{const{data}=await supabase.from("employee_loans").select("*").eq("user_id",u);return data||[];},
    create: async(u,d)=>{const{data,error}=await supabase.from("employee_loans").insert([{...d,user_id:u}]).select().single();if(error)throw new Error(error.message);return data;},
    update: async(id,d)=>{const{data,error}=await supabase.from("employee_loans").update(d).eq("id",id).select().single();if(error)throw new Error(error.message);return data;},
    delete: async id=>supabase.from("employee_loans").delete().eq("id",id),
    getPayments: async u=>{const{data}=await supabase.from("employee_loan_payments").select("*").eq("user_id",u);return data||[];},
    addPayment: async(u,d)=>{const{data,error}=await supabase.from("employee_loan_payments").insert([{...d,user_id:u}]).select().single();if(error)throw new Error(error.message);return data;},
  },
  income:{
    getAll: async u=>{const{data}=await supabase.from("income_records").select("*").eq("user_id",u).order("income_date",{ascending:false});return data||[];},
    create: async(u,d)=>{const{data,error}=await supabase.from("income_records").insert([{...d,user_id:u}]).select().single();if(error)throw new Error(error.message);return data;},
    update: async(id,d)=>{const{data,error}=await supabase.from("income_records").update(d).eq("id",id).select().single();if(error)throw new Error(error.message);return data;},
    delete: async id=>supabase.from("income_records").delete().eq("id",id),
  },
  asset:{
    getAll: async u=>{const{data}=await supabase.from("assets").select("*").eq("user_id",u).order("created_at",{ascending:false});return data||[];},
    create: async(u,d)=>{const{data}=await supabase.from("assets").insert([{...d,user_id:u}]).select().single();return data;},
    update: async(id,d)=>{const{data}=await supabase.from("assets").update(d).eq("id",id).select().single();return data;},
    delete: async id=>supabase.from("assets").delete().eq("id",id),
  },
  liab:{
    getAll: async u=>{const{data}=await supabase.from("liabilities").select("*").eq("user_id",u).order("created_at",{ascending:false});return data||[];},
    create: async(u,d)=>{const{data}=await supabase.from("liabilities").insert([{...d,user_id:u}]).select().single();return data;},
    update: async(id,d)=>{const{data}=await supabase.from("liabilities").update(d).eq("id",id).select().single();return data;},
    delete: async id=>supabase.from("liabilities").delete().eq("id",id),
  },
  assetHist:{
    getAll: async u=>{const{data}=await supabase.from("asset_price_history").select("*").eq("user_id",u).order("recorded_date",{ascending:false});return data||[];},
    create: async(u,d)=>{const{data}=await supabase.from("asset_price_history").insert([{...d,user_id:u}]).select().single();return data;},
  },
  settings:{
    get: async(u,k,def)=>{const{data}=await supabase.from("app_settings").select("value").eq("user_id",u).eq("key",k).single();return data?.value!==undefined?JSON.parse(data.value):def;},
    set: async(u,k,v)=>supabase.from("app_settings").upsert({user_id:u,key:k,value:JSON.stringify(v)},{onConflict:"user_id,key"}),
  },
};

// ─── AUTH GATE ────────────────────────────────────────────────
function AuthGate({children}) {
  const [user,setUser]   = useState(null);
  const [loading,setLoading] = useState(true);
  const [mode,setMode]   = useState("login");
  const [email,setEmail] = useState("");
  const [pass,setPass]   = useState("");
  const [err,setErr]     = useState("");
  const [busy,setBusy]   = useState(false);

  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{setUser(data.user);setLoading(false);});
    const{data:{subscription}}=supabase.auth.onAuthStateChange((_,s)=>setUser(s?.user??null));
    return()=>subscription.unsubscribe();
  },[]);

  const submit=async()=>{
    setErr("");setBusy(true);
    try{
      if(mode==="login"){const{error}=await supabase.auth.signInWithPassword({email,password:pass});if(error)throw error;}
      else{const{error}=await supabase.auth.signUp({email,password:pass});if(error)throw error;setErr("✅ Cek email untuk konfirmasi.");setMode("login");setBusy(false);return;}
    }catch(e){setErr(e.message||"Error");}
    setBusy(false);
  };

  if(loading) return(
    <div style={{minHeight:"100vh",background:"#f5f6fa",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Sora',system-ui"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{width:32,height:32,border:"3px solid #e2e4ed",borderTop:"3px solid #3b5bdb",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
    </div>
  );

  if(!user) return(
    <div style={{minHeight:"100vh",background:"#f5f6fa",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Sora',system-ui,sans-serif",padding:16}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');@keyframes spin{to{transform:rotate(360deg)}}*{box-sizing:border-box;margin:0;padding:0}`}</style>
      <div style={{background:"#fff",border:"1px solid #e2e4ed",borderRadius:20,padding:"36px 32px",width:"100%",maxWidth:380,textAlign:"center",boxShadow:"0 4px 24px rgba(0,0,0,.08)"}}>
        <div style={{width:52,height:52,background:"linear-gradient(135deg,#3b5bdb,#7048e8)",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,margin:"0 auto 16px"}}>💎</div>
        <div style={{fontSize:22,fontWeight:800,color:"#0f1117",marginBottom:4,letterSpacing:"-.3px"}}>Paulus Finance</div>
        <div style={{fontSize:12,color:"#8a90aa",marginBottom:24}}>Personal Financial OS</div>
        <div style={{display:"flex",background:"#f0f1f7",borderRadius:10,padding:3,marginBottom:18}}>
          {["login","signup"].map(m=><button key={m} onClick={()=>setMode(m)} style={{flex:1,border:"none",padding:"8px",borderRadius:8,fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",background:mode===m?"#fff":"transparent",color:mode===m?"#3b5bdb":"#8a90aa",boxShadow:mode===m?"0 1px 4px rgba(0,0,0,.08)":"none",transition:"all .15s"}}>{m==="login"?"Masuk":"Daftar"}</button>)}
        </div>
        <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} style={{width:"100%",border:"1px solid #e2e4ed",borderRadius:10,padding:"10px 13px",fontFamily:"'Sora',sans-serif",fontSize:13,outline:"none",marginBottom:10,color:"#0f1117",background:"#f5f6fa"}}/>
        <input type="password" placeholder="Password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} style={{width:"100%",border:"1px solid #e2e4ed",borderRadius:10,padding:"10px 13px",fontFamily:"'Sora',sans-serif",fontSize:13,outline:"none",marginBottom:err?10:0,color:"#0f1117",background:"#f5f6fa"}}/>
        {err&&<div style={{fontSize:12,color:err.startsWith("✅")?"#0ca678":"#e03131",marginBottom:12,padding:"8px 12px",background:err.startsWith("✅")?"#e6fcf5":"#fff5f5",border:`1px solid ${err.startsWith("✅")?"#b2f2e8":"#ffc9c9"}`,borderRadius:8,textAlign:"left"}}>{err}</div>}
        <button onClick={submit} disabled={busy} style={{width:"100%",background:"linear-gradient(135deg,#3b5bdb,#7048e8)",color:"white",border:"none",padding:"11px",borderRadius:10,fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:14,cursor:"pointer",marginTop:12,opacity:busy?.7:1}}>{busy?"...":mode==="login"?"Masuk":"Buat Akun"}</button>
        <div style={{fontSize:11,color:"#8a90aa",marginTop:16}}>Data tersimpan aman · Supabase encrypted</div>
      </div>
    </div>
  );
  return children({user,signOut:()=>supabase.auth.signOut()});
}

export default function App(){return<AuthGate>{({user,signOut})=><Finance user={user} signOut={signOut}/>}</AuthGate>;}

// ─── FINANCE APP ──────────────────────────────────────────────
function Finance({user,signOut}){
  const [isDark,setIsDark]   = useState(false); // DEFAULT LIGHT
  const [tab,setTab]         = useState("dashboard");
  const [loading,setLoading] = useState(true);
  const [saving,setSaving]   = useState(false);

  // CC
  const [cards,setCards]       = useState([]);
  const [txList,setTxList]     = useState([]);
  const [instList,setInstList] = useState([]);
  const [budgets,setBudgets]   = useState({Pribadi:0,Hamasa:0,SDC:0,Travelio:0,Lainnya:0});
  const [recurList,setRecur]   = useState([]);
  const [fxRates,setFxRates]   = useState({USD:16400,SGD:12200,MYR:3700,JPY:110,EUR:17800,AUD:10500});

  // Bank
  const [bankAccs,setBankAccs] = useState([]);
  const [muts,setMuts]         = useState([]);
  const [bankBal,setBankBal]   = useState({});

  // Piutang
  const [reimbAccs,setReimbAccs]   = useState([]);
  const [reimbTx,setReimbTx]       = useState([]);
  const [empLoans,setEmpLoans]     = useState([]);
  const [empPayments,setEmpPayments] = useState([]);

  // Assets
  const [assets,setAssets]           = useState([]);
  const [liabilities,setLiabilities] = useState([]);
  const [assetHistory,setAssetHistory] = useState([]);

  // UI
  const [ccSubTab,setCCSubTab]   = useState("transactions");
  const [piSubTab,setPiSubTab]   = useState("reimburse");
  const [assetSubTab,setAssetSubTab] = useState("overview");
  const [incomeSubTab,setIncomeSubTab] = useState("pemasukan");
  const [cardTargetDraft,setCardTargetDraft] = useState({});
  const [incomes,setIncomes] = useState([]);
  const [showIncomeForm,setShowIncomeForm] = useState(false);
  const [editIncomeId,setEditIncomeId] = useState(null);
  const [showUniTxForm,setShowUniTxForm] = useState(false);
  const [filterUniMonth,setFilterUniMonth] = useState("all");
  const [filterUniType,setFilterUniType] = useState("all");
  const [filterUniSource,setFilterUniSource] = useState("all");
  const [filterUniEnt,setFilterUniEnt] = useState("all");
  const [searchUni,setSearchUni] = useState("");
  const [showTxForm,setShowTxForm]     = useState(false);
  const [showCardForm,setShowCardForm] = useState(false);
  const [showInstForm,setShowInstForm] = useState(false);
  const [showRecurForm,setShowRecur2]  = useState(false);
  const [showBudForm,setShowBudForm]   = useState(false);
  const [showBankForm,setShowBankForm] = useState(false);
  const [showMutForm,setShowMutForm]   = useState(false);
  const [showPayCC,setShowPayCC]       = useState(false);
  const [showScanner,setShowScanner]   = useState(false);
  const [showAIChat,setShowAIChat]     = useState(false);
  const [showReimbAcc,setShowReimbAcc] = useState(false);
  const [showReimbTx,setShowReimbTx]   = useState(false);
  const [showLoanForm,setShowLoanForm] = useState(false);
  const [showPayLoan,setShowPayLoan]   = useState(false);
  const [showSettlePiu,setShowSettlePiu] = useState(false);
  const [showAssetForm,setShowAssetForm] = useState(false);
  const [showLiabForm,setShowLiabForm]   = useState(false);
  const [showUpdateVal,setShowUpdateVal] = useState(false);
  const [aiValLoading,setAiValLoading]   = useState(false);
  const [aiValResult,setAiValResult]     = useState(null);

  const [editTxId,setEditTxId]     = useState(null);
  const [editCardId,setEditCardId] = useState(null);
  const [editInstId,setEditInstId] = useState(null);
  const [editRecurId,setEditRecurId] = useState(null);
  const [editBankId,setEditBankId] = useState(null);
  const [editMutId,setEditMutId]   = useState(null);
  const [editLoanId,setEditLoanId] = useState(null);
  const [selectedLoan,setSelectedLoan] = useState(null);
  const [selectedReimbTx,setSelectedReimbTx] = useState(null);
  const [editAssetId,setEditAssetId]   = useState(null);
  const [editLiabId,setEditLiabId]     = useState(null);
  const [selectedAsset,setSelectedAsset] = useState(null);

  const [filterCard,setFilterCard]     = useState("all");
  const [filterMonth,setFilterMonth]   = useState("all");
  const [filterEntity,setFilterEntity] = useState("all");
  const [filterBank,setFilterBank]     = useState("all");
  const [filterReimb,setFilterReimb]   = useState("all");
  const [filterPiEnt,setFilterPiEnt]   = useState("all");
  const [searchQ,setSearchQ]           = useState("");
  const [searchMut,setSearchMut]       = useState("");

  // Scanner
  const [scanImg,setScanImg]     = useState(null);
  const [scanMime,setScanMime]   = useState("image/jpeg");
  const [scanLoading,setScanLoading] = useState(false);
  const [scanResult,setScanResult]   = useState(null);
  const [scanError,setScanError]     = useState(null);
  const [scanTarget,setScanTarget]   = useState("cc");
  const fileRef = useRef(null);

  // PDF Upload
  const [showPdfUpload,setShowPdfUpload] = useState(false);
  const [pdfLoading,setPdfLoading]       = useState(false);
  const [pdfRows,setPdfRows]             = useState([]);
  const [pdfSelRows,setPdfSelRows]       = useState({});
  const [pdfBankId,setPdfBankId]         = useState("");
  const [pdfError,setPdfError]           = useState(null);
  const pdfRef = useRef(null);

  // AI
  const [aiMsgs,setAiMsgs]   = useState([]);
  const [aiInput,setAiInput] = useState("");
  const [aiLoading,setAiLoading] = useState(false);

  // Pay CC
  const [payCC,setPayCC] = useState({cardId:"",bankId:"",amount:"",adminFee:"",materai:"",notes:""});

  // Loan payment
  const [loanPay,setLoanPay] = useState({amount:"",date:today(),notes:""});

  // Settle piutang
  const [settlePiu,setSettlePiu] = useState({bankId:"",date:today()});

  const th = isDark?DARK:LIGHT;
  const curMonth = ym(today());

  // Empty forms
  const ET = {tx_date:today(),card_id:"",description:"",amount:"",currency:"IDR",fee:"",category:"Belanja",entity:"Pribadi",reimbursed:false,notes:"",tx_type:"out"};
  const EC = {name:"",bank:"BCA",last4:"",color:"#1d4ed8",accent:"#60a5fa",card_limit:"",statement_day:25,due_day:17,monthly_target:"",network:"Visa"};
  const EI = {card_id:"",description:"",total_amount:"",months:12,start_date:today(),currency:"IDR",entity:"Pribadi"};
  const ER = {card_id:"",description:"",amount:"",currency:"IDR",fee:"",category:"Tagihan",entity:"Pribadi",frequency:"Bulanan",day_of_month:1,active:true};
  const EBA= {name:"",bank:"BCA",account_no:"",type:"pribadi",owner_entity:"",currency:"IDR",initial_balance:"",color:"#1d4ed8",accent:"#60a5fa",include_networth:true};
  const EMU= {account_id:"",mut_date:today(),description:"",amount:"",type:"out",category:"Lainnya",entity:"Pribadi",notes:"",transfer_to_account_id:"",transfer_fee:"",is_cc_payment:false,cc_card_id:"",cc_admin_fee:"",cc_materai:"",is_piutang:false,piutang_entity:"",piutang_description:""};
  const ERA= {entity:"Hamasa",description:"",color:"#0ca678"};
  const ERT= {account_id:"",tx_date:today(),description:"",amount:"",type:"out",source:"cc",notes:""};
  const EL = {employee_name:"",employee_dept:"",total_amount:"",monthly_installment:"",start_date:today(),notes:""};
  const EA = {name:"",category:"Properti",current_value:"",purchase_value:"",purchase_date:"",currency:"IDR",notes:"",linked_bank_id:""};
  const ELB= {name:"",category:"KPR",outstanding:"",original_amount:"",monthly_payment:"",interest_rate:"",start_date:today(),end_date:"",linked_asset_id:"",notes:""};
  const EUV= {value:"",date:today(),notes:""};
  const EIN= {income_date:today(),category:"Gaji",description:"",amount:"",currency:"IDR",entity:"Pribadi",bank_account_id:"",is_recurring:false,recur_frequency:"Bulanan",notes:""};
  const EUT= {type:"out",tx_date:today(),description:"",amount:"",currency:"IDR",source_type:"bank",source_id:"",dest_type:"bank",dest_id:"",category:"Lainnya",entity:"Pribadi",notes:"",is_reimb:false};

  const [txForm,setTxForm]     = useState(ET);
  const [cardForm,setCardForm] = useState(EC);
  const [instForm,setInstForm] = useState(EI);
  const [recurForm,setRecurForm] = useState(ER);
  const [bankForm,setBankForm] = useState(EBA);
  const [mutForm,setMutForm]   = useState(EMU);
  const [budForm,setBudForm]   = useState(budgets);
  const [reimbAccForm,setReimbAccForm] = useState(ERA);
  const [reimbTxForm,setReimbTxForm]   = useState(ERT);
  const [loanForm,setLoanForm] = useState(EL);
  const [assetForm,setAssetForm]   = useState(EA);
  const [liabForm,setLiabForm]     = useState(ELB);
  const [updateValForm,setUpdateValForm] = useState(EUV);
  const [incomeForm,setIncomeForm] = useState(EIN);
  const [uniTxForm,setUniTxForm]   = useState(EUT);

  // Load all data
  useEffect(()=>{
    (async()=>{
      setLoading(true);
      const [c,t,i,b,r,fx,ba,mu,ra,rt,el,ep,dark,as,ls,ah,inc]=await Promise.all([
        api.cards.getAll(user.id),api.tx.getAll(user.id),api.inst.getAll(user.id),
        api.budgets.getMonth(user.id,curMonth),api.recur.getAll(user.id),
        api.fx.getAll(user.id),api.bank.getAll(user.id),api.mut.getAll(user.id),
        api.reimb.getAccounts(user.id),api.reimb.getTx(user.id),
        api.empLoan.getAll(user.id),api.empLoan.getPayments(user.id),
        api.settings.get(user.id,"isDark",false),
        api.asset.getAll(user.id),api.liab.getAll(user.id),api.assetHist.getAll(user.id),
        api.income.getAll(user.id),
      ]);
      setCards(c);setTxList(t);setInstList(i);setBudgets(b);setRecur(r);
      if(Object.keys(fx).length)setFxRates(fx);
      setBankAccs(ba);setMuts(mu);setReimbAccs(ra);setReimbTx(rt);
      setEmpLoans(el);setEmpPayments(ep);setIsDark(dark);
      setAssets(as);setLiabilities(ls);setAssetHistory(ah);setIncomes(inc);
      setLoading(false);
    })();
  },[user.id]);

  useEffect(()=>{api.settings.set(user.id,"isDark",isDark);},[isDark]);

  // Bank balances
  useEffect(()=>{
    const bal={};
    bankAccs.forEach(acc=>{
      let b=Number(acc.initial_balance||0);
      muts.filter(m=>m.account_id===acc.id).forEach(m=>{
        if(m.type==="in")b+=Number(m.amount);
        else if(m.type==="out")b-=Number(m.amount);
        else if(m.type==="transfer")b-=Number(m.amount)+(Number(m.transfer_fee)||0);
        b-=(Number(m.cc_admin_fee)||0)+(Number(m.cc_materai)||0);
      });
      muts.filter(m=>m.transfer_to_account_id===acc.id).forEach(m=>{b+=Number(m.amount);});
      bal[acc.id]=b;
    });
    setBankBal(bal);
  },[bankAccs,muts]);

  const cardMap = useMemo(()=>Object.fromEntries(cards.map(c=>[c.id,c])),[cards]);
  const bankMap = useMemo(()=>Object.fromEntries(bankAccs.map(b=>[b.id,b])),[bankAccs]);
  const reimbMap= useMemo(()=>Object.fromEntries(reimbAccs.map(a=>[a.id,a])),[reimbAccs]);
  const txIDR   = useCallback(t=>toIDR(t.amount||0,t.currency||"IDR",fxRates)+(Number(t.fee)||0),[fxRates]);
  const allMonths= useMemo(()=>[...new Set(txList.map(t=>ym(t.tx_date)))].sort().reverse(),[txList]);

  // CC Stats
  const ccStats = useMemo(()=>{
    const cardStats=cards.map(c=>{
      const thisTx=txList.filter(t=>t.card_id===c.id&&ym(t.tx_date)===curMonth);
      const spent=thisTx.reduce((s,t)=>s+txIDR(t),0);
      const mt=Number(c.monthly_target||0);
      const targetPct=mt>0?spent/mt*100:0;
      return{...c,thisTx,spent,avail:(c.card_limit||0)-spent,pct:c.card_limit>0?spent/c.card_limit*100:0,dueIn:daysUntil(c.due_day),statIn:daysUntil(c.statement_day),monthly_target:mt,targetPct,targetOver:mt>0&&spent>mt,targetRemaining:Math.max(0,mt-spent)};
    });
    const totalCC=cardStats.reduce((s,c)=>s+c.spent,0);
    return{cardStats,totalCC};
  },[cards,txList,curMonth,txIDR]);

  // Budget stats
  const budgetStats=useMemo(()=>ENTITIES.map(e=>({
    entity:e,budget:budgets[e]||0,
    spent:txList.filter(t=>t.entity===e&&ym(t.tx_date)===curMonth).reduce((s,t)=>s+txIDR(t),0),
  })).map(b=>({...b,pct:b.budget>0?b.spent/b.budget*100:0,remaining:Math.max(0,b.budget-b.spent)})),[budgets,txList,curMonth,txIDR]);

  // Bank stats
  const bankStats=useMemo(()=>({
    private:bankAccs.filter(a=>a.include_networth).reduce((s,a)=>s+(bankBal[a.id]||0),0),
    reimb:bankAccs.filter(a=>!a.include_networth).reduce((s,a)=>s+(bankBal[a.id]||0),0),
  }),[bankAccs,bankBal]);

  // Piutang stats
  const piutangStats=useMemo(()=>{
    const byEntity={};
    reimbAccs.forEach(a=>{
      const txs=reimbTx.filter(t=>t.account_id===a.id);
      const out=txs.filter(t=>t.type==="out"&&!t.settled).reduce((s,t)=>s+Number(t.amount),0);
      const settled=txs.filter(t=>t.settled).reduce((s,t)=>s+Number(t.amount),0);
      byEntity[a.entity]={...a,out,settled,txs};
    });
    const totalOut=reimbTx.filter(t=>t.type==="out"&&!t.settled).reduce((s,t)=>s+Number(t.amount),0);
    const totalSettled=reimbTx.filter(t=>t.settled).reduce((s,t)=>s+Number(t.amount),0);

    // Employee loans
    const loanStats=empLoans.map(l=>{
      const paid=empPayments.filter(p=>p.loan_id===l.id).reduce((s,p)=>s+Number(p.amount),0);
      const remaining=Number(l.total_amount)-paid;
      const paidMonths=Math.floor(paid/Number(l.monthly_installment));
      const totalMonths=Math.ceil(Number(l.total_amount)/Number(l.monthly_installment));
      const pct=Number(l.total_amount)>0?paid/Number(l.total_amount)*100:0;
      return{...l,paid,remaining,paidMonths,totalMonths,pct,aging:agingLabel(l.start_date)};
    });
    const totalLoans=loanStats.reduce((s,l)=>s+l.remaining,0);

    return{byEntity,totalOut,totalSettled,loanStats,totalLoans,grandTotal:totalOut+totalLoans};
  },[reimbAccs,reimbTx,empLoans,empPayments]);

  const totalAssets=assets.reduce((s,a)=>s+Number(a.current_value||0),0);
  const totalLiabs=liabilities.reduce((s,l)=>s+Number(l.outstanding||0),0);
  const netWorth=bankStats.private+totalAssets-ccStats.totalCC-totalLiabs;

  // Alerts
  const alerts=useMemo(()=>{
    const a=[];
    ccStats.cardStats.forEach(c=>{if(c.dueIn<=5)a.push({type:"danger",msg:`${c.name} JT ${c.dueIn} hari`});});
    budgetStats.forEach(b=>{if(b.pct>=100)a.push({type:"danger",msg:`Budget ${b.entity} habis!`});else if(b.pct>=80)a.push({type:"warn",msg:`Budget ${b.entity} ${b.pct.toFixed(0)}%`});});
    if(piutangStats.totalOut>0)a.push({type:"info",msg:`Piutang belum settled: ${fmtIDR(piutangStats.totalOut,true)}`});
    return a;
  },[ccStats,budgetStats,piutangStats]);

  // Chart data
  const chartData=useMemo(()=>{
    const months=[...new Set(txList.map(t=>ym(t.tx_date)))].sort().slice(-6);
    return months.map(m=>{
      const txs=txList.filter(t=>ym(t.tx_date)===m);
      const r={month:mlShort(m)};
      ENTITIES.forEach(e=>{r[e]=txs.filter(t=>t.entity===e).reduce((s,t)=>s+txIDR(t),0);});
      r.Total=txs.reduce((s,t)=>s+txIDR(t),0);
      return r;
    });
  },[txList,txIDR]);

  // Filtered tx
  const filteredTx=useMemo(()=>txList
    .filter(t=>filterCard==="all"||t.card_id===filterCard)
    .filter(t=>filterMonth==="all"||ym(t.tx_date)===filterMonth)
    .filter(t=>filterEntity==="all"||t.entity===filterEntity)
    .filter(t=>filterReimb==="all"||String(t.reimbursed)===filterReimb)
    .filter(t=>!searchQ||t.description?.toLowerCase().includes(searchQ.toLowerCase()))
    ,[txList,filterCard,filterMonth,filterEntity,filterReimb,searchQ]);

  const filteredMut=useMemo(()=>muts
    .filter(m=>filterBank==="all"||m.account_id===filterBank)
    .filter(m=>!searchMut||m.description?.toLowerCase().includes(searchMut.toLowerCase()))
    ,[muts,filterBank,searchMut]);

  const filteredReimbTx=useMemo(()=>reimbTx
    .filter(t=>filterPiEnt==="all"||reimbMap[t.account_id]?.entity===filterPiEnt)
    ,[reimbTx,filterPiEnt,reimbMap]);

  // ── CC Handlers
  const submitTx=async()=>{
    console.log("submitTx called",txForm);
    if(!txForm.description||!txForm.amount||!txForm.card_id){console.warn("submitTx: validasi gagal",{desc:txForm.description,amt:txForm.amount,card:txForm.card_id});return;}
    setSaving(true);
    try{
      const d={...txForm,amount:Number(txForm.amount),fee:Number(txForm.fee||0),amount_idr:toIDR(Number(txForm.amount),txForm.currency,fxRates)};
      if(editTxId){const r=await api.tx.update(editTxId,d);if(r)setTxList(p=>p.map(t=>t.id===editTxId?r:t));setEditTxId(null);}
      else{const r=await api.tx.create(user.id,d);if(r)setTxList(p=>[r,...p]);}
      setTxForm({...ET,card_id:cards[0]?.id||""});setShowTxForm(false);setScanResult(null);
    }catch(e){console.error("submitTx error:",e);alert("Gagal simpan transaksi: "+e.message);}
    finally{setSaving(false);}
  };
  const submitCard=async()=>{
    if(!cardForm.name||!cardForm.last4)return;
    setSaving(true);
    const d={...cardForm,card_limit:Number(cardForm.card_limit),statement_day:Number(cardForm.statement_day),due_day:Number(cardForm.due_day),monthly_target:Number(cardForm.monthly_target||0)};
    if(editCardId){const r=await api.cards.update(editCardId,d);setCards(p=>p.map(c=>c.id===editCardId?r:c));setEditCardId(null);}
    else{const r=await api.cards.create(user.id,d);setCards(p=>[...p,r]);}
    setCardForm(EC);setShowCardForm(false);setSaving(false);
  };
  const submitInst=async()=>{
    if(!instForm.description||!instForm.total_amount)return;
    setSaving(true);
    const m=Math.round(Number(instForm.total_amount)/Number(instForm.months));
    const d={...instForm,total_amount:Number(instForm.total_amount),months:Number(instForm.months),monthly_amount:m,paid_months:0};
    if(editInstId){const r=await api.inst.update(editInstId,d);setInstList(p=>p.map(i=>i.id===editInstId?r:i));setEditInstId(null);}
    else{const r=await api.inst.create(user.id,d);setInstList(p=>[...p,r]);}
    setInstForm({...EI,card_id:cards[0]?.id||""});setShowInstForm(false);setSaving(false);
  };
  const submitRecur=async()=>{
    if(!recurForm.description||!recurForm.amount)return;
    setSaving(true);
    const d={...recurForm,amount:Number(recurForm.amount),fee:Number(recurForm.fee||0),day_of_month:Number(recurForm.day_of_month)};
    if(editRecurId){const r=await api.recur.update(editRecurId,d);setRecur(p=>p.map(r2=>r2.id===editRecurId?r:r2));setEditRecurId(null);}
    else{const r=await api.recur.create(user.id,d);setRecur(p=>[...p,r]);}
    setRecurForm({...ER,card_id:cards[0]?.id||""});setShowRecur2(false);setSaving(false);
  };
  const saveBudgets=async()=>{setSaving(true);await api.budgets.upsertAll(user.id,curMonth,budForm);setBudgets(budForm);setShowBudForm(false);setSaving(false);};
  const editTxFn=t=>{setTxForm({...t,amount:String(t.amount),fee:String(t.fee||"")});setEditTxId(t.id);setShowTxForm(true);};
  const deleteTx=async id=>{await api.tx.delete(id);setTxList(p=>p.filter(t=>t.id!==id));};
  const togReimb=async(id,v)=>{await api.tx.toggleReimb(id,!v);setTxList(p=>p.map(t=>t.id===id?{...t,reimbursed:!t.reimbursed}:t));};
  const delCard=async id=>{if(window.confirm("Hapus kartu?")){{await api.cards.delete(id);setCards(p=>p.filter(c=>c.id!==id));}}};
  const markInstPaid=async i=>{await api.inst.markPaid(i.id,i.paid_months+1);setInstList(p=>p.map(x=>x.id===i.id?{...x,paid_months:x.paid_months+1}:x));};
  const delInst=async id=>{await api.inst.delete(id);setInstList(p=>p.filter(i=>i.id!==id));};
  const togRecur=async(id,v)=>{await api.recur.toggle(id,!v);setRecur(p=>p.map(r=>r.id===id?{...r,active:!r.active}:r));};
  const delRecur=async id=>{await api.recur.delete(id);setRecur(p=>p.filter(r=>r.id!==id));};
  const applyRecur=async r=>{
    setSaving(true);
    const d={tx_date:today(),card_id:r.card_id,description:r.description,amount:r.amount,currency:r.currency,fee:r.fee||0,category:r.category,entity:r.entity,reimbursed:false,notes:"Auto recurring",is_recurring:true,amount_idr:toIDR(r.amount,r.currency,fxRates)};
    const res=await api.tx.create(user.id,d);setTxList(p=>[res,...p]);setSaving(false);
  };

  // ── Bank Handlers
  const submitBank=async()=>{
    if(!bankForm.name)return;
    setSaving(true);
    const d={...bankForm,initial_balance:Number(bankForm.initial_balance||0),include_networth:bankForm.type==="pribadi"};
    if(editBankId){const r=await api.bank.update(editBankId,d);setBankAccs(p=>p.map(b=>b.id===editBankId?r:b));setEditBankId(null);}
    else{const r=await api.bank.create(user.id,d);setBankAccs(p=>[...p,r]);}
    setBankForm(EBA);setShowBankForm(false);setSaving(false);
  };
  const submitMut=async()=>{
    if(!mutForm.account_id||!mutForm.description||!mutForm.amount)return;
    setSaving(true);
    const d={...mutForm,amount:Number(mutForm.amount),transfer_fee:Number(mutForm.transfer_fee||0),cc_admin_fee:Number(mutForm.cc_admin_fee||0),cc_materai:Number(mutForm.cc_materai||0)};
    if(!d.category||d.category==="Lainnya"){try{d.category=await aiCategorize(d.description);d.ai_categorized=true;}catch{}}
    if(editMutId){const r=await api.mut.update(editMutId,d);setMuts(p=>p.map(m=>m.id===editMutId?r:m));setEditMutId(null);}
    else{const r=await api.mut.create(user.id,d);setMuts(p=>[r,...p]);}
    setMutForm({...EMU,account_id:bankAccs[0]?.id||""});setShowMutForm(false);setSaving(false);setScanResult(null);
  };
  const submitPayCC=async()=>{
    if(!payCC.cardId||!payCC.bankId||!payCC.amount)return;
    setSaving(true);
    const d={account_id:payCC.bankId,mut_date:today(),description:`Bayar CC ${cardMap[payCC.cardId]?.name||""}`,amount:Number(payCC.amount),type:"out",category:"Tagihan",entity:"Pribadi",is_cc_payment:true,cc_card_id:payCC.cardId,cc_payment_amount:Number(payCC.amount),cc_admin_fee:Number(payCC.adminFee||0),cc_materai:Number(payCC.materai||0),notes:payCC.notes||""};
    const r=await api.mut.create(user.id,d);setMuts(p=>[r,...p]);
    setPayCC({cardId:"",bankId:"",amount:"",adminFee:"",materai:"",notes:""});setShowPayCC(false);setSaving(false);
  };
  const delBank=async id=>{if(window.confirm("Hapus rekening?")){await api.bank.delete(id);setBankAccs(p=>p.filter(b=>b.id!==id));}};
  const delMut=async id=>{await api.mut.delete(id);setMuts(p=>p.filter(m=>m.id!==id));};

  // ── Piutang Handlers
  const submitReimbAcc=async()=>{
    if(!reimbAccForm.entity)return;
    setSaving(true);
    const r=await api.reimb.createAccount(user.id,reimbAccForm);
    setReimbAccs(p=>[...p,r]);setReimbAccForm(ERA);setShowReimbAcc(false);setSaving(false);
  };
  const delReimbAcc=async id=>{if(window.confirm("Hapus akun piutang?")){await api.reimb.deleteAccount(id);setReimbAccs(p=>p.filter(a=>a.id!==id));}};
  const submitReimbTx=async()=>{
    if(!reimbTxForm.account_id||!reimbTxForm.description||!reimbTxForm.amount)return;
    setSaving(true);
    const d={...reimbTxForm,amount:Number(reimbTxForm.amount)};
    const r=await api.reimb.createTx(user.id,d);setReimbTx(p=>[r,...p]);
    setReimbTxForm({...ERT,account_id:reimbAccs[0]?.id||""});setShowReimbTx(false);setSaving(false);
  };
  const delReimbTx=async id=>{await api.reimb.deleteTx(id);setReimbTx(p=>p.filter(t=>t.id!==id));};
  const settleReimbTx=async()=>{
    if(!selectedReimbTx||!settlePiu.bankId)return;
    setSaving(true);
    await api.reimb.settle(selectedReimbTx.id,settlePiu.bankId,settlePiu.date);
    setReimbTx(p=>p.map(t=>t.id===selectedReimbTx.id?{...t,settled:true,settled_date:settlePiu.date,settled_bank_id:settlePiu.bankId}:t));
    setShowSettlePiu(false);setSelectedReimbTx(null);setSaving(false);
  };
  const submitLoan=async()=>{
    console.log("submitLoan called",loanForm);
    if(!loanForm.employee_name||!loanForm.total_amount){console.warn("submitLoan: validasi gagal",loanForm);return;}
    setSaving(true);
    try{
      const d={...loanForm,total_amount:Number(loanForm.total_amount),monthly_installment:Number(loanForm.monthly_installment||0),paid_months:0,status:"active"};
      if(editLoanId){const r=await api.empLoan.update(editLoanId,d);if(r)setEmpLoans(p=>p.map(l=>l.id===editLoanId?r:l));setEditLoanId(null);}
      else{const r=await api.empLoan.create(user.id,d);if(r)setEmpLoans(p=>[...p,r]);}
      setLoanForm(EL);setShowLoanForm(false);
    }catch(e){console.error("submitLoan error:",e);alert("Gagal simpan piutang karyawan: "+e.message);}
    finally{setSaving(false);}
  };
  const submitLoanPay=async()=>{
    if(!selectedLoan||!loanPay.amount)return;
    setSaving(true);
    const d={loan_id:selectedLoan.id,pay_date:loanPay.date,amount:Number(loanPay.amount),notes:loanPay.notes};
    const r=await api.empLoan.addPayment(user.id,d);setEmpPayments(p=>[...p,r]);
    setLoanPay({amount:"",date:today(),notes:""});setShowPayLoan(false);setSaving(false);
  };
  const delLoan=async id=>{if(window.confirm("Hapus piutang karyawan?")){await api.empLoan.delete(id);setEmpLoans(p=>p.filter(l=>l.id!==id));}};

  // ── Income Handlers
  const submitIncome=async()=>{
    if(!incomeForm.amount||!incomeForm.category)return;
    setSaving(true);
    try{
      const d={...incomeForm,amount:Number(incomeForm.amount),amount_idr:toIDR(Number(incomeForm.amount),incomeForm.currency,fxRates)};
      if(editIncomeId){const r=await api.income.update(editIncomeId,d);if(r)setIncomes(p=>p.map(x=>x.id===editIncomeId?r:x));setEditIncomeId(null);}
      else{const r=await api.income.create(user.id,d);if(r)setIncomes(p=>[r,...p]);}
      setIncomeForm(EIN);setShowIncomeForm(false);
    }catch(e){console.error("submitIncome:",e);alert("Gagal simpan income: "+e.message);}
    finally{setSaving(false);}
  };
  const delIncome=async id=>{await api.income.delete(id);setIncomes(p=>p.filter(x=>x.id!==id));};

  // ── Universal TX Handler
  const submitUniTx=async()=>{
    if(!uniTxForm.description||!uniTxForm.amount||!uniTxForm.source_id)return;
    setSaving(true);
    try{
      const amt=Number(uniTxForm.amount);
      const amtIDR=toIDR(amt,uniTxForm.currency,fxRates);
      if(uniTxForm.source_type==="cc"){
        const d={tx_date:uniTxForm.tx_date,card_id:uniTxForm.source_id,description:uniTxForm.description,amount:amt,currency:uniTxForm.currency,fee:0,category:uniTxForm.category,entity:uniTxForm.entity,reimbursed:uniTxForm.is_reimb,notes:uniTxForm.notes,tx_type:uniTxForm.type,amount_idr:amtIDR};
        const r=await api.tx.create(user.id,d);if(r)setTxList(p=>[r,...p]);
      } else {
        const isTransferToCC=uniTxForm.type==="transfer"&&uniTxForm.dest_type==="cc";
        const d={account_id:uniTxForm.source_id,mut_date:uniTxForm.tx_date,description:uniTxForm.description,amount:amt,type:uniTxForm.type==="transfer"?"transfer":uniTxForm.type,category:uniTxForm.category,entity:uniTxForm.entity,notes:uniTxForm.notes,is_cc_payment:isTransferToCC,cc_card_id:isTransferToCC?uniTxForm.dest_id:"",transfer_to_account_id:(uniTxForm.type==="transfer"&&uniTxForm.dest_type==="bank")?uniTxForm.dest_id:"",is_piutang:uniTxForm.is_reimb};
        const r=await api.mut.create(user.id,d);if(r)setMuts(p=>[r,...p]);
      }
      setUniTxForm({...EUT,source_id:bankAccs[0]?.id||""});setShowUniTxForm(false);
    }catch(e){console.error("submitUniTx:",e);alert("Gagal simpan transaksi: "+e.message);}
    finally{setSaving(false);}
  };

  // ── Asset Handlers
  const submitAsset=async()=>{
    if(!assetForm.name||!assetForm.category)return;
    setSaving(true);
    const d={...assetForm,current_value:Number(assetForm.current_value||0),purchase_value:Number(assetForm.purchase_value||0)};
    if(editAssetId){const r=await api.asset.update(editAssetId,d);setAssets(p=>p.map(a=>a.id===editAssetId?r:a));setEditAssetId(null);}
    else{const r=await api.asset.create(user.id,d);setAssets(p=>[r,...p]);}
    setAssetForm(EA);setShowAssetForm(false);setSaving(false);
  };
  const deleteAsset=async id=>{if(window.confirm("Hapus aset?")){await api.asset.delete(id);setAssets(p=>p.filter(a=>a.id!==id));}};
  const submitLiab=async()=>{
    if(!liabForm.name||!liabForm.category)return;
    setSaving(true);
    const d={...liabForm,outstanding:Number(liabForm.outstanding||0),original_amount:Number(liabForm.original_amount||0),monthly_payment:Number(liabForm.monthly_payment||0),interest_rate:Number(liabForm.interest_rate||0)};
    if(editLiabId){const r=await api.liab.update(editLiabId,d);setLiabilities(p=>p.map(l=>l.id===editLiabId?r:l));setEditLiabId(null);}
    else{const r=await api.liab.create(user.id,d);setLiabilities(p=>[r,...p]);}
    setLiabForm(ELB);setShowLiabForm(false);setSaving(false);
  };
  const deleteLiab=async id=>{if(window.confirm("Hapus liabilitas?")){await api.liab.delete(id);setLiabilities(p=>p.filter(l=>l.id!==id));}};
  const submitUpdateVal=async()=>{
    if(!selectedAsset||!updateValForm.value)return;
    setSaving(true);
    const newVal=Number(updateValForm.value);
    await api.asset.update(selectedAsset.id,{current_value:newVal});
    setAssets(p=>p.map(a=>a.id===selectedAsset.id?{...a,current_value:newVal}:a));
    await api.assetHist.create(user.id,{asset_id:selectedAsset.id,recorded_date:updateValForm.date,value:newVal,notes:updateValForm.notes||""});
    setAssetHistory(p=>[{asset_id:selectedAsset.id,recorded_date:updateValForm.date,value:newVal},...p]);
    setShowUpdateVal(false);setSelectedAsset(null);setUpdateValForm(EUV);setAiValResult(null);setSaving(false);
  };
  const runAIValuation=async()=>{
    if(!selectedAsset)return;
    setAiValLoading(true);setAiValResult(null);
    try{
      const r=await aiAssetValuation(selectedAsset);
      setAiValResult(r);
      if(r.estimated_value)setUpdateValForm(f=>({...f,value:String(r.estimated_value)}));
    }catch{setAiValResult({error:"Gagal mendapat estimasi AI"});}
    setAiValLoading(false);
  };

  // ── Scanner
  const handleFile=e=>{
    const f=e.target.files?.[0];if(!f)return;
    setScanMime(f.type||"image/jpeg");setScanResult(null);
    const reader=new FileReader();
    reader.onload=ev=>setScanImg(ev.target.result.split(",")[1]);
    reader.readAsDataURL(f);
  };
  const runScan=async()=>{
    if(!scanImg)return;setScanLoading(true);setScanError(null);
    try{
      const r=await aiScanReceipt(scanImg,scanMime);
      console.log("[Scan] result:",r);
      setScanResult(r);
      if(scanTarget==="cc"){
        setTxForm(f=>({...f,description:r.merchant||f.description,amount:r.amount?String(r.amount):f.amount,currency:r.currency||"IDR",tx_date:r.date||today(),category:r.category||"Lainnya",fee:r.fee?String(r.fee):"",tx_type:r.type==="in"?"in":"out"}));
      } else if(scanTarget==="bank"){
        setMutForm(f=>({...f,description:r.merchant||f.description,amount:r.amount?String(r.amount):f.amount,mut_date:r.date||today(),type:r.type||"out",category:r.category||"Lainnya"}));
      } else if(scanTarget==="asset"){
        setAssetForm(f=>({...f,name:r.merchant||f.name,purchase_value:r.amount?String(r.amount):f.purchase_value,purchase_date:r.date||f.purchase_date,notes:r.notes||f.notes}));
      }
    }catch(e){
      console.error("[Scan] error:",e);
      setScanError(e.message||"Gagal menghubungi AI. Pastikan REACT_APP_ANTHROPIC_KEY sudah di-set.");
    }
    setScanLoading(false);
  };
  const confirmScan=()=>{
    setShowScanner(false);setScanImg(null);setScanError(null);
    if(scanTarget==="cc")setShowTxForm(true);
    else if(scanTarget==="bank")setShowMutForm(true);
    else if(scanTarget==="asset")setShowAssetForm(true);
  };
  const handlePdfFile=e=>{
    const f=e.target.files?.[0];if(!f)return;
    setPdfError(null);setPdfRows([]);setPdfSelRows({});
    const reader=new FileReader();
    reader.onload=async ev=>{
      const b64=ev.target.result.split(",")[1];
      setPdfLoading(true);
      try{
        const rows=await aiParsePDF(b64);
        console.log("[PDF] parsed rows:",rows.length);
        setPdfRows(rows);
        const sel={};rows.forEach((_,i)=>{sel[i]=true;});setPdfSelRows(sel);
      }catch(e){
        console.error("[PDF] error:",e);
        setPdfError(e.message||"Gagal parse PDF. Pastikan file adalah mutasi rekening koran.");
      }
      setPdfLoading(false);
    };
    reader.readAsDataURL(f);
  };
  const importPdfRows=async()=>{
    if(!pdfBankId)return;
    setSaving(true);
    const selected=pdfRows.filter((_,i)=>pdfSelRows[i]);
    for(const row of selected){
      const d={account_id:pdfBankId,mut_date:row.date||today(),description:row.description||"Import PDF",amount:Number(row.amount||0),type:row.type||"out",category:"Lainnya",entity:"Pribadi",notes:"Import dari PDF"};
      const r=await api.mut.create(user.id,d);
      setMuts(p=>[r,...p]);
    }
    setShowPdfUpload(false);setPdfRows([]);setPdfSelRows({});setPdfBankId("");setSaving(false);
  };

  // ── AI
  const sendAI=async()=>{
    if(!aiInput.trim())return;
    const q=aiInput;setAiInput("");setAiLoading(true);
    setAiMsgs(p=>[...p,{role:"user",text:q}]);
    const ans=await aiAdvisor(q,{bank:bankStats.private,cc:ccStats.totalCC,piutang:piutangStats.grandTotal});
    setAiMsgs(p=>[...p,{role:"ai",text:ans}]);
    setAiLoading(false);
  };

  const saveFx=async()=>{await api.fx.upsertAll(user.id,fxRates);};

  const instStats=useMemo(()=>instList.map(i=>{
    const m=i.monthly_amount||Math.round((i.total_amount||0)/(i.months||1));
    const rem=i.months-i.paid_months;
    return{...i,monthly:m,remaining:rem,remainingAmt:m*rem,pct:((i.paid_months||0)/(i.months||1))*100};
  }),[instList]);

  // Income stats
  const incomeStats=useMemo(()=>{
    const totalThisMonth=incomes.filter(x=>ym(x.income_date)===curMonth).reduce((s,x)=>s+Number(x.amount_idr||x.amount||0),0);
    const last6=[...new Set([...incomes.map(x=>ym(x.income_date)),...muts.map(m=>ym(m.mut_date)),...txList.map(t=>ym(t.tx_date))].filter(Boolean))].sort().slice(-6);
    const chartData=last6.map(m=>({
      month:mlShort(m),
      income:incomes.filter(x=>ym(x.income_date)===m).reduce((s,x)=>s+Number(x.amount_idr||x.amount||0),0),
      expense:txList.filter(t=>ym(t.tx_date)===m).reduce((s,t)=>s+txIDR(t),0)+muts.filter(mu=>ym(mu.mut_date)===m&&mu.type==="out").reduce((s,mu)=>s+Number(mu.amount||0),0),
    }));
    const byCat=INCOME_CATS.map(cat=>({name:cat,value:incomes.filter(x=>x.category===cat).reduce((s,x)=>s+Number(x.amount_idr||x.amount||0),0)})).filter(x=>x.value>0);
    const expenseThisMonth=txList.filter(t=>ym(t.tx_date)===curMonth).reduce((s,t)=>s+txIDR(t),0)+muts.filter(m=>ym(m.mut_date)===curMonth&&m.type==="out").reduce((s,m)=>s+Number(m.amount||0),0);
    const avg3=()=>{const r=last6.slice(-3);return r.length?r.reduce((s,m)=>s+incomes.filter(x=>ym(x.income_date)===m).reduce((ss,x)=>ss+Number(x.amount_idr||x.amount||0),0),0)/r.length:0;};
    return{totalThisMonth,chartData,byCat,expenseThisMonth,surplus:totalThisMonth-expenseThisMonth,avg3Income:avg3()};
  },[incomes,txList,muts,curMonth,txIDR]);

  // Universal transactions (combined muts + txList)
  const uniTxAll=useMemo(()=>{
    const bankRows=muts.map(m=>({...m,_src:"bank",_date:m.mut_date,_type:m.type,_id:m.id,_desc:m.description,_amt:Number(m.amount||0),_ent:m.entity,_cat:m.category}));
    const ccRows=txList.map(t=>({...t,_src:"cc",_date:t.tx_date,_type:t.tx_type||"out",_id:t.id,_desc:t.description,_amt:txIDR(t),_ent:t.entity,_cat:t.category}));
    return [...bankRows,...ccRows].sort((a,b)=>b._date.localeCompare(a._date));
  },[muts,txList,txIDR]);

  const filteredUni=useMemo(()=>uniTxAll
    .filter(x=>filterUniMonth==="all"||ym(x._date)===filterUniMonth)
    .filter(x=>filterUniType==="all"||x._type===filterUniType)
    .filter(x=>filterUniSource==="all"||x._src===filterUniSource)
    .filter(x=>filterUniEnt==="all"||x._ent===filterUniEnt)
    .filter(x=>!searchUni||x._desc?.toLowerCase().includes(searchUni.toLowerCase()))
  ,[uniTxAll,filterUniMonth,filterUniType,filterUniSource,filterUniEnt,searchUni]);

  const TABS=[
    {id:"dashboard",icon:"◈",label:"Dashboard"},
    {id:"cc",icon:"💳",label:"Credit Card"},
    {id:"bank",icon:"🏦",label:"Bank"},
    {id:"transaksi",icon:"🔄",label:"Transaksi"},
    {id:"piutang",icon:"📋",label:"Piutang"},
    {id:"asset",icon:"📈",label:"Asset"},
    {id:"income",icon:"💰",label:"Income"},
    {id:"calendar",icon:"📅",label:"Calendar"},
    {id:"settings",icon:"⚙️",label:"Settings"},
  ];

  if(loading)return(
    <div style={{minHeight:"100vh",background:th.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14,fontFamily:"'Sora',system-ui"}}>
      <style>{GCS+DCS(th)}</style>
      <div style={{width:36,height:36,border:`3px solid ${th.bor}`,borderTop:`3px solid ${th.ac}`,borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      <div style={{fontSize:12,color:th.tx3}}>Memuat Paulus Finance...</div>
    </div>
  );

  return(
    <div style={{display:"flex",minHeight:"100vh",background:th.bg,color:th.tx,fontFamily:"'Sora',system-ui,sans-serif",transition:"background .3s,color .3s"}}>
      <style>{GCS+DCS(th)}</style>

      {/* SIDEBAR */}
      <nav className="sidebar">
        <div>
          <div className="brand">
            <div className="brand-logo">💎</div>
            <div>
              <div className="brand-name">Paulus Finance</div>
              <div className="brand-sub">Personal Financial OS</div>
            </div>
          </div>
          <div className="nav-sec">Menu Utama</div>
          {TABS.slice(0,7).map(t=>(
            <button key={t.id} className={`nb ${tab===t.id?"on":""}`} onClick={()=>setTab(t.id)}>
              <div className="nb-ic">{t.icon}</div>{t.label}
              {t.id==="dashboard"&&alerts.length>0&&<span className="n-badge">{alerts.length}</span>}
              {t.id==="piutang"&&piutangStats.grandTotal>0&&<span className="n-badge" style={{background:th.am}}>{fmtIDR(piutangStats.grandTotal,true)}</span>}
              {t.id==="asset"&&assets.length>0&&<span className="n-badge" style={{background:th.te,fontSize:8}}>{fmtIDR(totalAssets,true)}</span>}
              {t.id==="income"&&incomeStats.totalThisMonth>0&&<span className="n-badge" style={{background:th.gr,fontSize:8}}>{fmtIDR(incomeStats.totalThisMonth,true)}</span>}
            </button>
          ))}
          <div className="nav-sec">Segera Hadir</div>
          {[TABS[7]].map(t=>(
            <button key={t.id} className="nb" onClick={()=>setTab(t.id)}>
              <div className="nb-ic">{t.icon}</div>{t.label}
              <span className="n-soon">Soon</span>
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <button className="fb" onClick={()=>setShowAIChat(true)}>🤖 AI Advisor</button>
          <button className="fb" onClick={()=>setShowScanner(true)}>📷 Scan Struk</button>
          <button className="fb" onClick={()=>setIsDark(d=>!d)}>{isDark?"☀️ Light Mode":"🌙 Dark Mode"}</button>
          <button className="fb" onClick={()=>setTab("settings")}>⚙️ Settings</button>
          <button className="fb" onClick={signOut} style={{color:th.rd}}>🚪 Sign Out</button>
        </div>
      </nav>

      {/* BOTTOM NAV */}
      <div className="bottom-nav">
        {[TABS[0],TABS[1],TABS[2],TABS[5],TABS[6]].map(t=>(
          <button key={t.id} className={`bot-btn ${tab===t.id?"on":""}`} onClick={()=>setTab(t.id)}>
            <span style={{fontSize:18}}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* MAIN */}
      <main className="main">
        {/* TOPBAR */}
        <div className="topbar">
          <div>
            <div className="page-title">{TABS.find(t=>t.id===tab)?.label||"Dashboard"}</div>
            <div className="page-date">{new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            {saving&&<span style={{fontSize:10,color:th.tx3}}>Menyimpan...</span>}
            <button className="btn-ic" onClick={()=>setIsDark(d=>!d)}>{isDark?"☀️":"🌙"}</button>
            <button className="btn btn-ghost" onClick={()=>{setScanImg(null);setScanResult(null);setScanTarget("cc");setShowScanner(true);}}>📷 Scan</button>
            <button className="btn btn-ai" onClick={()=>setShowAIChat(true)}>🤖 AI</button>
            {tab==="cc"&&<button className="btn btn-primary" onClick={()=>{setEditTxId(null);setTxForm({...ET,card_id:cards[0]?.id||""});setShowTxForm(true);}}>+ Transaksi</button>}
            {tab==="bank"&&<button className="btn btn-primary" onClick={()=>{setEditBankId(null);setBankForm(EBA);setShowBankForm(true);}}>+ Rekening</button>}
            {tab==="transaksi"&&<button className="btn btn-primary" onClick={()=>{setUniTxForm({...EUT,source_id:bankAccs[0]?.id||""});setShowUniTxForm(true);}}>+ Transaksi</button>}
            {tab==="piutang"&&<button className="btn btn-primary" onClick={()=>{setShowReimbTx(true);setReimbTxForm({...ERT,account_id:reimbAccs[0]?.id||""});}}>+ Piutang</button>}
            {tab==="asset"&&<button className="btn btn-primary" onClick={()=>{setEditAssetId(null);setAssetForm(EA);setShowAssetForm(true);}}>+ Aset</button>}
            {tab==="income"&&<button className="btn btn-primary" onClick={()=>{setEditIncomeId(null);setIncomeForm(EIN);setShowIncomeForm(true);}}>+ Income</button>}
          </div>
        </div>

        <div className="content">
          {/* Alerts */}
          {alerts.length>0&&tab==="dashboard"&&alerts.slice(0,3).map((a,i)=>(
            <div key={i} className={`alert-bar alert-${a.type}`}>
              <span>{a.type==="danger"?"⚠️":a.type==="warn"?"💸":"ℹ️"}</span>
              <span style={{fontSize:12,fontWeight:600}}>{a.msg}</span>
            </div>
          ))}

          {/* ══ DASHBOARD ══ */}
          {tab==="dashboard"&&(
            <>
              {/* Net Worth Hero */}
              <div className="hero-card anim">
                <div style={{fontSize:10,fontWeight:700,opacity:.6,textTransform:"uppercase",letterSpacing:1.5,marginBottom:5}}>Estimasi Net Worth</div>
                <div style={{fontSize:28,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",letterSpacing:"-1px",marginBottom:14}}>{fmtIDR(netWorth)}</div>
                <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
                  {[["Saldo Bank",bankStats.private,"rgba(255,255,255,.9)"],["Total Aset",totalAssets,"#a5f3fc"],["Hutang CC",ccStats.totalCC,"#ffa8a8"],["Liabilitas",totalLiabs,"#fca5a5"]].map(([l,v,c])=>(
                    <div key={l}>
                      <div style={{fontSize:9,opacity:.5,marginBottom:2,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
                      <div style={{fontSize:13,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:c}}>{fmtIDR(v,true)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div className="stat-grid anim">
                {[
                  ["CC Bulan Ini","💳",fmtIDR(ccStats.totalCC,true),`${cards.length} kartu`,th.acBg,th.ac],
                  ["Saldo Bank","🏦",fmtIDR(bankStats.private,true),`${bankAccs.filter(b=>b.include_networth).length} rekening`,th.grBg,th.gr],
                  ["Total Aset","📈",fmtIDR(totalAssets,true),`${assets.length} aset`,th.teBg,th.te],
                  ["Net Worth","💎",fmtIDR(netWorth,true),"estimasi",th.puBg,th.pu],
                ].map(([l,ic,v,sub,bg,col])=>(
                  <div key={l} className="stat-card" style={{background:bg,borderColor:col+"44"}}>
                    <div style={{fontSize:20,marginBottom:7}}>{ic}</div>
                    <div style={{fontSize:9,fontWeight:700,color:col,textTransform:"uppercase",letterSpacing:.8}}>{l}</div>
                    <div style={{fontSize:15,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:col,marginTop:3}}>{v}</div>
                    <div style={{fontSize:9,color:th.tx3,marginTop:2}}>{sub}</div>
                  </div>
                ))}
              </div>

              {/* Budget */}
              <div className="sec-hd"><div className="sec-title">Budget April</div><button className="sec-link" onClick={()=>{setBudForm({...budgets});setShowBudForm(true);}}>Edit</button></div>
              <div className="budget-grid anim">
                {budgetStats.slice(0,4).map((b,i)=>{
                  const over=b.pct>=100,warn=b.pct>=80;
                  const bc=over?th.rd:warn?th.am:ENT_COL[b.entity];
                  return(
                    <div key={b.entity} className="card" style={{animationDelay:`${i*.04}s`}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{width:7,height:7,borderRadius:"50%",background:ENT_COL[b.entity]}}/>
                          <span style={{fontSize:12,fontWeight:600}}>{b.entity}</span>
                        </div>
                        <span style={{fontSize:11,fontWeight:700,color:bc}}>{b.pct.toFixed(0)}%{over?" 🚨":warn?" ⚠️":""}</span>
                      </div>
                      <div className="prog-wrap"><div className="prog" style={{width:`${Math.min(b.pct,100)}%`,background:bc}}/></div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginTop:5}}>
                        <span style={{color:th.tx2,fontFamily:"'JetBrains Mono',monospace"}}>{fmtIDR(b.spent,true)}</span>
                        <span style={{color:th.tx3,fontFamily:"'JetBrains Mono',monospace"}}>/ {fmtIDR(b.budget,true)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Chart */}
              <div className="sec-hd"><div className="sec-title">Pengeluaran CC 6 Bulan</div></div>
              <div className="card anim" style={{padding:16,marginBottom:14}}>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={chartData} barSize={20} margin={{left:-18,right:5}}>
                    <XAxis dataKey="month" tick={{fill:th.tx3,fontSize:10}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fill:th.tx3,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtIDR(v,true)}/>
                    <Tooltip contentStyle={{background:th.sur,border:`1px solid ${th.bor}`,borderRadius:10,fontSize:11}}/>
                    {ENTITIES.map(e=><Bar key={e} dataKey={e} stackId="a" fill={ENT_COL[e]}/>)}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Cards quick */}
              <div className="sec-hd"><div className="sec-title">Kartu Kredit</div><button className="sec-link" onClick={()=>setTab("cc")}>Semua →</button></div>
              {ccStats.cardStats.slice(0,3).map((c,i)=>{
                const sc=c.targetOver?th.rd:c.targetPct>=80?th.am:th.gr;
                return(
                  <div key={c.id} className="card card-hover anim" style={{marginBottom:9,animationDelay:`${i*.04}s`}}>
                    <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:9}}>
                      <div style={{width:38,height:38,borderRadius:10,background:`linear-gradient(135deg,${c.color||"#1d4ed8"},${c.accent||"#60a5fa"})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>💳</div>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:700,fontSize:13}}>{c.name}</div>
                        <div style={{fontSize:10,color:th.tx3,marginTop:2}}>···· {c.last4} · JT Tgl {c.due_day} · <span style={{color:c.dueIn<=5?th.rd:th.gr,fontWeight:600}}>{c.dueIn} hari</span></div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:15,fontWeight:700,color:sc}}>{fmtIDR(c.spent,true)}</div>
                        <div style={{fontSize:10,color:th.tx3}}>/ {fmtIDR(c.card_limit,true)}</div>
                      </div>
                    </div>
                    <div style={{position:"relative",height:5,background:th.sur3,borderRadius:3,marginBottom:5}}>
                      <div style={{height:"100%",width:`${Math.min(c.pct,100)}%`,background:`linear-gradient(90deg,${c.color||"#1d4ed8"},${c.accent||"#60a5fa"})`,borderRadius:3}}/>
                      {c.monthly_target>0&&<div style={{position:"absolute",top:-3,left:`${Math.min(c.monthly_target/(c.card_limit||1)*100,100)}%`,width:2,height:11,background:th.am,borderRadius:1}}/>}
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:th.tx3}}>
                      <span style={{color:sc,fontWeight:600}}>{c.monthly_target>0?`${c.targetPct.toFixed(0)}% target`:`${c.pct.toFixed(1)}% limit`}</span>
                      <span>{c.monthly_target>0?(c.targetOver?`Over ${fmtIDR(c.spent-c.monthly_target,true)}`:`Sisa ${fmtIDR(c.targetRemaining,true)}`):(`Sisa ${fmtIDR(c.avail,true)}`)}</span>
                    </div>
                  </div>
                );
              })}

              {/* Piutang quick */}
              {piutangStats.grandTotal>0&&<>
                <div className="sec-hd" style={{marginTop:6}}><div className="sec-title">Piutang Belum Lunas</div><button className="sec-link" onClick={()=>setTab("piutang")}>Semua →</button></div>
                <div className="card anim" style={{borderLeft:`3px solid ${th.am}`}}>
                  {Object.entries(piutangStats.byEntity).filter(([,v])=>v.out>0).map(([ent,data])=>(
                    <div key={ent} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${th.bor}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:ENT_COL[ent]||th.tx3}}/>
                        <span style={{fontSize:13,fontWeight:600}}>{ent}</span>
                      </div>
                      <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:th.am}}>{fmtIDR(data.out,true)}</span>
                    </div>
                  ))}
                  <div style={{display:"flex",justifyContent:"space-between",paddingTop:8,fontWeight:700}}>
                    <span style={{fontSize:12}}>Total Piutang</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",color:th.am}}>{fmtIDR(piutangStats.grandTotal)}</span>
                  </div>
                </div>
              </>}
            </>
          )}

          {/* ══ CC TRACKER ══ */}
          {tab==="cc"&&(
            <>
              <div className="subtabs anim">
                {[["transactions","≡ Transaksi"],["cards","💳 Kartu"],["installments","⟳ Cicilan"],["recurring","↺ Recurring"],["target","◎ Target"]].map(([id,label])=>(
                  <button key={id} className={`stab ${ccSubTab===id?"on":""}`} onClick={()=>setCCSubTab(id)}>{label}</button>
                ))}
              </div>

              {ccSubTab==="transactions"&&<>
                <div className="card anim" style={{marginBottom:12}}>
                  <input className="search-inp" placeholder="🔍 Cari transaksi..." value={searchQ} onChange={e=>setSearchQ(e.target.value)} style={{marginBottom:9}}/>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    <select className="mini-sel" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)}><option value="all">Semua Bulan</option>{allMonths.map(m=><option key={m} value={m}>{mlFull(m)}</option>)}</select>
                    <select className="mini-sel" value={filterCard} onChange={e=>setFilterCard(e.target.value)}><option value="all">Semua Kartu</option>{cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
                    <select className="mini-sel" value={filterEntity} onChange={e=>setFilterEntity(e.target.value)}><option value="all">Semua Entitas</option>{ENTITIES.map(e=><option key={e}>{e}</option>)}</select>
                    <select className="mini-sel" value={filterReimb} onChange={e=>setFilterReimb(e.target.value)}><option value="all">Semua Status</option><option value="false">Belum Reimb</option><option value="true">Sudah Reimb</option></select>
                  </div>
                  <div style={{fontSize:11,color:th.tx3,marginTop:8}}>{filteredTx.length} transaksi · Total: <span style={{color:th.rd,fontWeight:700}}>{fmtIDR(filteredTx.reduce((s,t)=>s+txIDR(t),0),true)}</span></div>
                </div>
                {filteredTx.length===0?<Empty icon="📋" msg="Belum ada transaksi" th={th} onAdd={()=>{setEditTxId(null);setTxForm({...ET,card_id:cards[0]?.id||""});setShowTxForm(true);}}/>
                :<div className="card anim">
                  {filteredTx.map((t,i)=>{
                    const c=cardMap[t.card_id];
                    return(
                      <div key={t.id} className="tx-row" style={{animationDelay:`${Math.min(i,8)*.02}s`}}>
                        <div className="tx-ic" style={{background:ENT_BG[t.entity]||th.sur2,color:ENT_COL[t.entity]||th.tx3}}>💳</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600,fontSize:13,marginBottom:5,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.description}</div>
                          <div className="tag-row">
                            <Tag bg={th.sur3} color={th.tx3}>{t.tx_date}</Tag>
                            <Tag bg={th.sur3} color={th.tx3}>{t.category}</Tag>
                            {c&&<Tag bg={c.color+"22"} color={c.accent||c.color}>{c.bank||c.name}</Tag>}
                            <Tag bg={ENT_BG[t.entity]} color={ENT_COL[t.entity]}>{t.entity}</Tag>
                            {t.currency!=="IDR"&&<Tag bg={th.amBg} color={th.am}>🌏 {t.currency}</Tag>}
                            {t.fee>0&&<Tag bg={th.rdBg} color={th.rd}>Fee</Tag>}
                          </div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,marginBottom:3}}>{fmtCur(t.amount,t.currency)}</div>
                          {t.currency!=="IDR"&&<div style={{fontSize:10,color:th.tx3}}>≈{fmtIDR(toIDR(t.amount,t.currency,fxRates),true)}</div>}
                          {t.fee>0&&<div style={{fontSize:10,color:th.am}}>+fee {fmtIDR(t.fee)}</div>}
                          <div className="act-row">
                            <button className={`reimb-btn ${t.reimbursed?"done":""}`} onClick={()=>togReimb(t.id,t.reimbursed)} style={{borderColor:t.reimbursed?th.gr:th.bor,background:t.reimbursed?th.grBg:"transparent",color:t.reimbursed?th.gr:th.tx3}}>{t.reimbursed?"✓ Reimb":"Reimb?"}</button>
                            <button className="act-btn" onClick={()=>editTxFn(t)} style={{borderColor:th.bor,color:th.tx3}}>✏️</button>
                            <button className="act-btn" onClick={()=>deleteTx(t.id)} style={{borderColor:th.bor,color:th.rd}}>🗑</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>}
              </>}

              {ccSubTab==="cards"&&<>
                <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
                  <button className="btn btn-primary" onClick={()=>{setEditCardId(null);setCardForm(EC);setShowCardForm(true);}}>+ Kartu</button>
                </div>
                {ccStats.cardStats.map((c,i)=>(
                  <div key={c.id} className="cc-card anim" style={{background:`linear-gradient(135deg,${c.color||"#1d4ed8"},${c.accent||"#60a5fa"})`,animationDelay:`${i*.06}s`}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
                      <div><div style={{fontSize:9,opacity:.5,fontWeight:600,textTransform:"uppercase",letterSpacing:1}}>{c.bank} · {c.network}</div><div style={{fontSize:16,fontWeight:800,marginTop:2}}>{c.name}</div></div>
                      <div style={{fontSize:11,fontWeight:800,opacity:.55}}>{c.network==="Visa"?"VISA":"MC"}</div>
                    </div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",letterSpacing:4,fontSize:14,opacity:.7,marginBottom:14}}>•••• •••• •••• {c.last4}</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5,marginBottom:11}}>
                      {[["Limit",fmtIDR(c.card_limit,true)],["Terpakai",fmtIDR(c.spent,true)],["Tersedia",fmtIDR(c.avail,true)],["Tgl Cetak","Tgl "+c.statement_day],["Jatuh Tempo",`Tgl ${c.due_day} (${c.dueIn}h)`],["Target/Bln",c.monthly_target>0?fmtIDR(c.monthly_target,true):"—"]].map(([l,v])=>(
                        <div key={l} style={{background:"rgba(255,255,255,.12)",borderRadius:7,padding:"6px 8px"}}>
                          <div style={{fontSize:8,opacity:.45,fontWeight:600,textTransform:"uppercase"}}>{l}</div>
                          <div style={{fontSize:10,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",marginTop:1}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{height:4,background:"rgba(255,255,255,.15)",borderRadius:2,overflow:"hidden",marginBottom:9}}>
                      <div style={{height:"100%",width:`${Math.min(c.pct,100)}%`,background:"rgba(255,255,255,.75)",borderRadius:2}}/>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      {[["✏️ Edit",()=>{setCardForm({...c,card_limit:String(c.card_limit)});setEditCardId(c.id);setShowCardForm(true);}],["🗑 Hapus",()=>delCard(c.id)]].map(([l,fn])=>(
                        <button key={l} onClick={fn} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.2)",color:"rgba(255,255,255,.9)",padding:"5px 12px",borderRadius:7,fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:11,cursor:"pointer"}}>{l}</button>
                      ))}
                    </div>
                  </div>
                ))}
                {cards.length===0&&<Empty icon="💳" msg="Belum ada kartu kredit" th={th} onAdd={()=>{setEditCardId(null);setCardForm(EC);setShowCardForm(true);}}/>}
              </>}

              {ccSubTab==="installments"&&<>
                <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
                  <button className="btn btn-primary" onClick={()=>{setEditInstId(null);setInstForm({...EI,card_id:cards[0]?.id||""});setShowInstForm(true);}}>+ Cicilan</button>
                </div>
                {instStats.map((i,idx)=>{
                  const c=cardMap[i.card_id];
                  return(
                    <div key={i.id} className="card anim" style={{marginBottom:10,animationDelay:`${idx*.05}s`}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                        <div><div style={{fontWeight:700,fontSize:14}}>{i.description}</div><div style={{fontSize:11,color:th.tx3,marginTop:2}}>{c?.name} · {i.entity}</div></div>
                        <div style={{textAlign:"right"}}><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:800,color:th.ac}}>{fmtIDR(i.monthly,true)}<span style={{fontSize:10,color:th.tx3}}>/bln</span></div><div style={{fontSize:11,color:th.tx3}}>Total: {fmtIDR(i.total_amount)}</div></div>
                      </div>
                      <div style={{height:7,background:th.sur3,borderRadius:4,overflow:"hidden",marginBottom:7}}>
                        <div style={{height:"100%",width:`${i.pct}%`,background:`linear-gradient(90deg,${th.ac},${th.gr})`,borderRadius:4}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:th.tx3,marginBottom:9}}><span>{i.paid_months}/{i.months} bulan ({i.pct.toFixed(0)}%)</span><span>Sisa: {fmtIDR(i.remainingAmt,true)}</span></div>
                      <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:9}}>{Array.from({length:i.months}).map((_,j)=><div key={j} style={{width:11,height:11,borderRadius:3,background:j<i.paid_months?th.gr:th.sur3}}/>)}</div>
                      <div style={{display:"flex",gap:6}}>
                        <button className="btn btn-ghost" style={{fontSize:11,padding:"5px 11px"}} onClick={()=>markInstPaid(i)} disabled={i.paid_months>=i.months}>✓ Terbayar</button>
                        <button className="btn btn-ghost" style={{fontSize:11,padding:"5px 11px"}} onClick={()=>{setInstForm({...i,total_amount:String(i.total_amount),months:String(i.months)});setEditInstId(i.id);setShowInstForm(true);}}>✏️</button>
                        <button className="btn btn-ghost" style={{fontSize:11,padding:"5px 11px",color:th.rd}} onClick={()=>delInst(i.id)}>🗑</button>
                      </div>
                    </div>
                  );
                })}
                {instStats.length===0&&<Empty icon="🔄" msg="Belum ada cicilan" th={th} onAdd={()=>{setEditInstId(null);setInstForm({...EI,card_id:cards[0]?.id||""});setShowInstForm(true);}}/>}
              </>}

              {ccSubTab==="recurring"&&<>
                <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
                  <button className="btn btn-primary" onClick={()=>{setEditRecurId(null);setRecurForm({...ER,card_id:cards[0]?.id||""});setShowRecur2(true);}}>+ Recurring</button>
                </div>
                {recurList.map((r,i)=>{
                  const c=cardMap[r.card_id];
                  return(
                    <div key={r.id} className="card anim" style={{marginBottom:8,opacity:r.active?1:.5,animationDelay:`${i*.04}s`}}>
                      <div style={{display:"flex",gap:10,alignItems:"center"}}>
                        <div style={{width:36,height:36,borderRadius:9,background:r.active?`linear-gradient(135deg,${c?.color||"#334"},${c?.accent||"#667"})`:th.sur3,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>↺</div>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:700,fontSize:13,marginBottom:5}}>{r.description}</div>
                          <div className="tag-row">
                            <Tag bg={th.sur3} color={th.tx3}>{r.frequency} · Tgl {r.day_of_month}</Tag>
                            <Tag bg={ENT_BG[r.entity]} color={ENT_COL[r.entity]}>{r.entity}</Tag>
                          </div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,marginBottom:6}}>{fmtCur(r.amount,r.currency)}</div>
                          <div className="act-row">
                            <button className="act-btn" onClick={()=>applyRecur(r)} style={{color:th.gr,borderColor:th.gr}}>▶ Apply</button>
                            <button className="act-btn" onClick={()=>togRecur(r.id,r.active)} style={{borderColor:th.bor,color:th.tx3}}>{r.active?"Pause":"Resume"}</button>
                            <button className="act-btn" onClick={()=>delRecur(r.id)} style={{borderColor:th.bor,color:th.rd}}>🗑</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {recurList.length===0&&<Empty icon="↺" msg="Belum ada recurring" th={th} onAdd={()=>{setEditRecurId(null);setRecurForm({...ER,card_id:cards[0]?.id||""});setShowRecur2(true);}}/>}
              </>}

              {ccSubTab==="target"&&<>
                <div style={{fontSize:11,color:th.tx3,marginBottom:14,padding:"9px 12px",background:th.acBg,border:`1px solid ${th.ac}33`,borderRadius:9}}>
                  💡 Set target pengeluaran nominal per kartu. Edit langsung di kolom "Target/Bln" — tekan Enter atau klik di luar untuk simpan.
                </div>
                {ccStats.cardStats.length===0?
                  <Empty icon="💳" msg="Belum ada kartu kredit" th={th} onAdd={()=>{setEditCardId(null);setCardForm(EC);setShowCardForm(true);}}/>
                :ccStats.cardStats.map((c,i)=>{
                  const bc=c.targetOver?th.rd:c.targetPct>=80?th.am:th.gr;
                  const draftVal=cardTargetDraft[c.id]??String(c.monthly_target||"");
                  const saveTarget=async()=>{
                    const val=Number(draftVal||0);
                    if(val!==(c.monthly_target||0)){
                      const r=await api.cards.update(c.id,{monthly_target:val});
                      setCards(p=>p.map(x=>x.id===c.id?r:x));
                    }
                  };
                  return(
                    <div key={c.id} className="card anim" style={{marginBottom:12,animationDelay:`${i*.05}s`,borderLeft:`3px solid ${c.color||th.ac}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:c.monthly_target>0?12:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <div style={{width:40,height:40,borderRadius:11,background:`linear-gradient(135deg,${c.color||"#1d4ed8"},${c.accent||"#60a5fa"})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>💳</div>
                          <div>
                            <div style={{fontWeight:700,fontSize:14}}>{c.name}</div>
                            <div style={{fontSize:11,color:th.tx3,marginTop:1}}>···· {c.last4}{c.monthly_target>0?(c.targetOver?" · 🚨 Over!":c.targetPct>=80?" · ⚠️ "+c.targetPct.toFixed(0)+"%":" · "+c.targetPct.toFixed(0)+"%"):" · Belum ada target"}</div>
                          </div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontSize:9,color:th.tx3,marginBottom:3}}>Target / Bulan</div>
                          <div style={{display:"flex",alignItems:"center",gap:5}}>
                            <span style={{fontSize:11,color:th.tx3}}>Rp</span>
                            <input
                              className="inp"
                              type="number"
                              placeholder="0"
                              value={draftVal}
                              onChange={e=>setCardTargetDraft(d=>({...d,[c.id]:e.target.value}))}
                              onBlur={saveTarget}
                              onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
                              style={{width:130,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,padding:"6px 10px"}}
                            />
                          </div>
                        </div>
                      </div>
                      {c.monthly_target>0&&<>
                        <div style={{height:8,background:th.sur3,borderRadius:4,overflow:"hidden",marginBottom:8}}>
                          <div style={{height:"100%",width:`${Math.min(c.targetPct,100)}%`,background:`linear-gradient(90deg,${bc},${bc}dd)`,borderRadius:4,transition:"width .4s"}}/>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between"}}>
                          <div>
                            <div style={{fontSize:9,color:th.tx3}}>Terpakai</div>
                            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:bc}}>{fmtIDR(c.spent,true)}</div>
                          </div>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:9,color:th.tx3}}>Progres</div>
                            <div style={{fontSize:17,fontWeight:800,color:bc}}>{c.targetPct.toFixed(0)}%</div>
                          </div>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontSize:9,color:th.tx3}}>{c.targetOver?"Over":"Sisa"}</div>
                            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:c.targetOver?th.rd:th.gr}}>{fmtIDR(c.targetOver?c.spent-c.monthly_target:c.targetRemaining,true)}</div>
                          </div>
                        </div>
                      </>}
                    </div>
                  );
                })}
                {/* Summary */}
                {ccStats.cardStats.some(c=>c.monthly_target>0)&&(
                  <div className="card anim" style={{background:th.sur2,borderTop:`2px solid ${th.ac}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}>
                      <span style={{color:th.tx3}}>Total Target Bulan Ini</span>
                      <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>{fmtIDR(ccStats.cardStats.reduce((s,c)=>s+c.monthly_target,0))}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginTop:6}}>
                      <span style={{color:th.tx3}}>Total Terpakai</span>
                      <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:th.rd}}>{fmtIDR(ccStats.totalCC)}</span>
                    </div>
                  </div>
                )}
              </>}
            </>
          )}

          {/* ══ BANK ══ */}
          {tab==="bank"&&(
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:9,marginBottom:16}}>
                {[["Total",bankStats.private+bankStats.reimb,th.tx2],["Pribadi",bankStats.private,th.ac],["Reimburse",bankStats.reimb,th.am]].map(([l,v,col])=>(
                  <div key={l} className="stat-card anim" style={{borderTop:`2px solid ${col}`}}>
                    <div style={{fontSize:9,fontWeight:700,color:th.tx3,textTransform:"uppercase",letterSpacing:.8,marginBottom:4}}>{l}</div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:15,fontWeight:700,color:col}}>{fmtIDR(v,true)}</div>
                  </div>
                ))}
              </div>

              <div className="sec-hd">
                <div className="sec-title">Rekening Bank</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <button className="btn btn-ghost" onClick={()=>setShowPayCC(true)}>💳 Bayar CC</button>
                  <button className="btn btn-ghost" onClick={()=>{setPdfRows([]);setPdfSelRows({});setPdfBankId(bankAccs[0]?.id||"");setPdfError(null);setShowPdfUpload(true);}}>📄 Upload PDF</button>
                  <button className="btn btn-primary" onClick={()=>{setEditBankId(null);setBankForm(EBA);setShowBankForm(true);}}>+ Rekening</button>
                </div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:11,marginBottom:18}}>
                {bankAccs.map((b,i)=>(
                  <div key={b.id} className="bank-card anim" style={{background:`linear-gradient(135deg,${b.color||"#1d4ed8"},${b.accent||"#60a5fa"})`,animationDelay:`${i*.05}s`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                      <div>
                        <div style={{fontSize:9,opacity:.5,fontWeight:600,textTransform:"uppercase",letterSpacing:1}}>{b.bank} · {b.type==="pribadi"?"Pribadi":"Reimburse"}</div>
                        <div style={{fontSize:15,fontWeight:800,marginTop:2}}>{b.name}</div>
                        {b.account_no&&<div style={{fontSize:10,opacity:.4,marginTop:1,fontFamily:"'JetBrains Mono',monospace"}}>···· {b.account_no.slice(-4)}</div>}
                      </div>
                      <div style={{fontSize:9,fontWeight:700,opacity:.5,padding:"2px 7px",background:"rgba(255,255,255,.15)",borderRadius:5}}>{b.include_networth?"✓ Net Worth":"× Reimburse"}</div>
                    </div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:20,fontWeight:900,marginBottom:12}}>{fmtIDR(bankBal[b.id]||0)}</div>
                    <div style={{display:"flex",gap:5}}>
                      {[["+ Mutasi",()=>{setMutForm({...EMU,account_id:b.id});setEditMutId(null);setShowMutForm(true);}],["✏️",()=>{setBankForm({...b,initial_balance:String(b.initial_balance)});setEditBankId(b.id);setShowBankForm(true);}],["🗑",()=>delBank(b.id)]].map(([l,fn])=>(
                        <button key={l} onClick={fn} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.2)",color:"rgba(255,255,255,.9)",padding:"5px 11px",borderRadius:7,fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:11,cursor:"pointer"}}>{l}</button>
                      ))}
                    </div>
                  </div>
                ))}
                {bankAccs.length===0&&<div style={{gridColumn:"1/-1"}}><Empty icon="🏦" msg="Belum ada rekening bank" th={th} onAdd={()=>{setEditBankId(null);setBankForm(EBA);setShowBankForm(true);}}/></div>}
              </div>

              <div className="sec-hd">
                <div className="sec-title">Mutasi Terbaru</div>
                <button className="btn btn-ghost" onClick={()=>{setScanTarget("bank");setScanImg(null);setScanResult(null);setShowScanner(true);}}>📷 Scan</button>
              </div>
              <div className="card anim" style={{marginBottom:12}}>
                <input className="search-inp" placeholder="🔍 Cari mutasi..." value={searchMut} onChange={e=>setSearchMut(e.target.value)} style={{marginBottom:9}}/>
                <select className="mini-sel" value={filterBank} onChange={e=>setFilterBank(e.target.value)}><option value="all">Semua Rekening</option>{bankAccs.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>
              </div>
              {filteredMut.length===0?<Empty icon="📊" msg="Belum ada mutasi" th={th} onAdd={()=>{setMutForm({...EMU,account_id:bankAccs[0]?.id||""});setShowMutForm(true);}}/>
              :<div className="card anim">
                {filteredMut.map((m,i)=>{
                  const acc=bankMap[m.account_id];
                  const toAcc=m.transfer_to_account_id?bankMap[m.transfer_to_account_id]:null;
                  const isIn=m.type==="in",isT=m.type==="transfer";
                  return(
                    <div key={m.id} className="tx-row" style={{animationDelay:`${Math.min(i,8)*.02}s`}}>
                      <div className="tx-ic" style={{background:isIn?th.grBg:isT?th.acBg:th.rdBg,color:isIn?th.gr:isT?th.ac:th.rd,fontSize:16}}>{isIn?"↓":isT?"↔":"↑"}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,fontSize:13,marginBottom:5,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.description}</div>
                        <div className="tag-row">
                          <Tag bg={th.sur3} color={th.tx3}>{m.mut_date}</Tag>
                          <Tag bg={th.sur3} color={th.tx3}>{m.category}</Tag>
                          {acc&&<Tag bg={acc.color+"22"} color={acc.accent||acc.color}>{acc.name}</Tag>}
                          {toAcc&&<Tag bg={th.acBg} color={th.ac}>→ {toAcc.name}</Tag>}
                          {m.is_cc_payment&&<Tag bg={th.amBg} color={th.am}>Bayar CC</Tag>}
                          {m.is_piutang&&<Tag bg={th.teBg} color={th.te}>Piutang {m.piutang_entity}</Tag>}
                          {m.ai_categorized&&<Tag bg={th.puBg} color={th.pu}>🤖 AI</Tag>}
                        </div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:isIn?th.gr:isT?th.ac:th.rd}}>{isIn?"+":"-"}{fmtIDR(Number(m.amount))}</div>
                        <div className="act-row" style={{marginTop:5}}>
                          <button className="act-btn" onClick={()=>{setMutForm({...m,amount:String(m.amount),transfer_fee:String(m.transfer_fee||""),cc_admin_fee:String(m.cc_admin_fee||""),cc_materai:String(m.cc_materai||"")});setEditMutId(m.id);setShowMutForm(true);}} style={{borderColor:th.bor,color:th.tx3}}>✏️</button>
                          <button className="act-btn" onClick={()=>delMut(m.id)} style={{borderColor:th.bor,color:th.rd}}>🗑</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>}
            </>
          )}

          {/* ══ TRANSAKSI UNIVERSAL ══ */}
          {tab==="transaksi"&&(
            <>
              {/* Summary */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:9,marginBottom:14}}>
                {[["Semua",uniTxAll.length,th.ac],["Keluar",uniTxAll.filter(x=>x._type==="out").length,th.rd],["Masuk",uniTxAll.filter(x=>x._type==="in").length,th.gr]].map(([l,v,col])=>(
                  <div key={l} className="stat-card anim" style={{borderTop:`2px solid ${col}`}}>
                    <div style={{fontSize:9,fontWeight:700,color:th.tx3,textTransform:"uppercase",letterSpacing:.6,marginBottom:4}}>{l}</div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:17,fontWeight:800,color:col}}>{v}</div>
                  </div>
                ))}
              </div>
              {/* Filters */}
              <div className="card anim" style={{marginBottom:12}}>
                <input className="search-inp" placeholder="🔍 Cari transaksi..." value={searchUni} onChange={e=>setSearchUni(e.target.value)} style={{marginBottom:9}}/>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <select className="mini-sel" value={filterUniMonth} onChange={e=>setFilterUniMonth(e.target.value)}>
                    <option value="all">Semua Bulan</option>
                    {[...new Set(uniTxAll.map(x=>ym(x._date)))].sort().reverse().map(m=><option key={m} value={m}>{mlFull(m)}</option>)}
                  </select>
                  <select className="mini-sel" value={filterUniType} onChange={e=>setFilterUniType(e.target.value)}>
                    <option value="all">Semua Tipe</option>
                    <option value="out">↑ Keluar</option>
                    <option value="in">↓ Masuk</option>
                    <option value="transfer">↔ Transfer</option>
                  </select>
                  <select className="mini-sel" value={filterUniSource} onChange={e=>setFilterUniSource(e.target.value)}>
                    <option value="all">Semua Sumber</option>
                    <option value="bank">🏦 Bank</option>
                    <option value="cc">💳 CC</option>
                  </select>
                  <select className="mini-sel" value={filterUniEnt} onChange={e=>setFilterUniEnt(e.target.value)}>
                    <option value="all">Semua Entitas</option>
                    {ENTITIES.map(e=><option key={e}>{e}</option>)}
                  </select>
                </div>
                <div style={{fontSize:11,color:th.tx3,marginTop:8}}>{filteredUni.length} transaksi · Keluar: <span style={{color:th.rd,fontWeight:700}}>{fmtIDR(filteredUni.filter(x=>x._type==="out"||x._type==="transfer").reduce((s,x)=>s+x._amt,0),true)}</span> · Masuk: <span style={{color:th.gr,fontWeight:700}}>{fmtIDR(filteredUni.filter(x=>x._type==="in").reduce((s,x)=>s+x._amt,0),true)}</span></div>
              </div>
              {filteredUni.length===0?<Empty icon="🔄" msg="Belum ada transaksi" th={th} onAdd={()=>{setUniTxForm({...EUT,source_id:bankAccs[0]?.id||""});setShowUniTxForm(true);}}/>
              :<div className="card anim">
                {filteredUni.map((x,i)=>{
                  const isIn=x._type==="in",isT=x._type==="transfer";
                  const acc=x._src==="bank"?bankMap[x.account_id]:cardMap[x.card_id];
                  const toAcc=x.transfer_to_account_id?bankMap[x.transfer_to_account_id]:x.is_cc_payment&&x.cc_card_id?cardMap[x.cc_card_id]:null;
                  return(
                    <div key={x._id} className="tx-row" style={{animationDelay:`${Math.min(i,8)*.02}s`}}>
                      <div className="tx-ic" style={{background:isIn?th.grBg:isT?th.acBg:th.rdBg,color:isIn?th.gr:isT?th.ac:th.rd,fontSize:16}}>{isIn?"↓":isT?"↔":"↑"}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,fontSize:13,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{x._desc}</div>
                        <div className="tag-row">
                          <Tag bg={th.sur3} color={th.tx3}>{x._date}</Tag>
                          <Tag bg={x._src==="cc"?th.acBg:th.grBg} color={x._src==="cc"?th.ac:th.gr}>{x._src==="cc"?"💳 CC":"🏦 Bank"}</Tag>
                          {acc&&<Tag bg={(acc.color||"#1d4ed8")+"22"} color={acc.color||th.ac}>{acc.name}</Tag>}
                          {toAcc&&<Tag bg={th.acBg} color={th.ac}>→ {toAcc.name}</Tag>}
                          {x._cat&&<Tag bg={th.sur3} color={th.tx3}>{x._cat}</Tag>}
                          {x._ent&&<Tag bg={ENT_BG[x._ent]||th.sur3} color={ENT_COL[x._ent]||th.tx3}>{x._ent}</Tag>}
                        </div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:isIn?th.gr:isT?th.ac:th.rd}}>{isIn?"+":"-"}{fmtIDR(x._amt,true)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>}
            </>
          )}

          {/* ══ PIUTANG ══ */}
          {tab==="piutang"&&(
            <>
              {/* Summary */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:9,marginBottom:16}}>
                {[["Piutang Reimburse",piutangStats.totalOut,th.am],["Piutang Karyawan",piutangStats.totalLoans,th.rd],["Total Piutang",piutangStats.grandTotal,th.pu]].map(([l,v,col])=>(
                  <div key={l} className="stat-card anim" style={{borderTop:`2px solid ${col}`}}>
                    <div style={{fontSize:9,fontWeight:700,color:th.tx3,textTransform:"uppercase",letterSpacing:.6,marginBottom:4}}>{l}</div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:700,color:col}}>{fmtIDR(v,true)}</div>
                  </div>
                ))}
              </div>

              {/* Sub tabs */}
              <div className="subtabs anim">
                {[["reimburse","🔄 Reimburse"],["karyawan","👥 Karyawan"],["history","📋 History"]].map(([id,label])=>(
                  <button key={id} className={`stab ${piSubTab===id?"on":""}`} onClick={()=>setPiSubTab(id)}>{label}</button>
                ))}
              </div>

              {/* Reimburse Tab */}
              {piSubTab==="reimburse"&&<>
                <div className="sec-hd">
                  <div className="sec-title">Akun Piutang ({reimbAccs.length})</div>
                  <button className="btn btn-ghost" onClick={()=>{setReimbAccForm(ERA);setShowReimbAcc(true);}}>+ Akun</button>
                </div>
                {reimbAccs.map((a,i)=>{
                  const txs=reimbTx.filter(t=>t.account_id===a.id);
                  const out=txs.filter(t=>t.type==="out"&&!t.settled).reduce((s,t)=>s+Number(t.amount),0);
                  const settled=txs.filter(t=>t.settled).reduce((s,t)=>s+Number(t.amount),0);
                  return(
                    <div key={a.id} className="card anim" style={{marginBottom:10,borderLeft:`3px solid ${a.color||ENT_COL[a.entity]||th.am}`,animationDelay:`${i*.04}s`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                        <div style={{display:"flex",alignItems:"center",gap:9}}>
                          <div style={{width:38,height:38,borderRadius:10,background:ENT_BG[a.entity]||th.amBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{a.entity==="Hamasa"?"🏭":a.entity==="SDC"?"🔧":a.entity==="Travelio"?"🏢":"📋"}</div>
                          <div><div style={{fontWeight:700,fontSize:14}}>{a.entity}</div><div style={{fontSize:11,color:th.tx3,marginTop:1}}>{a.description}</div></div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:10,color:th.tx3}}>Belum Lunas</div>
                          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:800,color:out>0?th.am:th.gr}}>{fmtIDR(out,true)}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:8,fontSize:11,color:th.tx3,marginBottom:10}}>
                        <span>Settled: <span style={{color:th.gr,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>{fmtIDR(settled,true)}</span></span>
                        <span>·</span>
                        <span>{txs.length} transaksi</span>
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        <button className="btn btn-primary" style={{fontSize:11,padding:"5px 12px"}} onClick={()=>{setReimbTxForm({...ERT,account_id:a.id});setShowReimbTx(true);}}>+ Transaksi</button>
                        <button className="btn btn-ghost" style={{fontSize:11,padding:"5px 12px"}} onClick={()=>delReimbAcc(a.id)}>🗑</button>
                      </div>
                    </div>
                  );
                })}
                {reimbAccs.length===0&&(
                  <div style={{textAlign:"center",padding:"40px 20px"}}>
                    <div style={{fontSize:40,marginBottom:10}}>📋</div>
                    <div style={{fontSize:13,color:th.tx3,marginBottom:16}}>Belum ada akun piutang reimburse</div>
                    <div style={{fontSize:12,color:th.tx3,marginBottom:16}}>Buat akun untuk tiap entitas (Hamasa, SDC, Travelio)</div>
                    <button className="btn btn-primary" onClick={()=>{setReimbAccForm(ERA);setShowReimbAcc(true);}}>+ Buat Akun Piutang</button>
                  </div>
                )}

                {/* Transactions list */}
                {reimbAccs.length>0&&<>
                  <div className="sec-hd" style={{marginTop:6}}>
                    <div className="sec-title">Transaksi Piutang</div>
                    <select className="mini-sel" value={filterPiEnt} onChange={e=>setFilterPiEnt(e.target.value)}>
                      <option value="all">Semua Entitas</option>
                      {reimbAccs.map(a=><option key={a.id} value={a.entity}>{a.entity}</option>)}
                    </select>
                  </div>
                  {filteredReimbTx.length===0?<Empty icon="📄" msg="Belum ada transaksi piutang" th={th} onAdd={()=>{setReimbTxForm({...ERT,account_id:reimbAccs[0]?.id||""});setShowReimbTx(true);}}/>
                  :<div className="card anim">
                    {filteredReimbTx.map((t,i)=>{
                      const acc=reimbMap[t.account_id];
                      const ag=!t.settled?agingLabel(t.tx_date):{label:"Settled",color:th.gr};
                      return(
                        <div key={t.id} className="tx-row" style={{animationDelay:`${Math.min(i,8)*.02}s`}}>
                          <div className="tx-ic" style={{background:t.settled?th.grBg:th.amBg,color:t.settled?th.gr:th.am,fontSize:16}}>{t.settled?"✓":"⏳"}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:600,fontSize:13,marginBottom:5,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.description}</div>
                            <div className="tag-row">
                              <Tag bg={th.sur3} color={th.tx3}>{t.tx_date}</Tag>
                              {acc&&<Tag bg={ENT_BG[acc.entity]} color={ENT_COL[acc.entity]}>{acc.entity}</Tag>}
                              <Tag bg={th.sur3} color={th.tx3}>{t.source==="cc"?"Via CC":"Via Bank"}</Tag>
                              <Tag bg={t.settled?th.grBg:th.amBg} color={t.settled?th.gr:th.am}>{ag.label}</Tag>
                            </div>
                          </div>
                          <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:t.settled?th.gr:th.am,marginBottom:3}}>{fmtIDR(Number(t.amount))}</div>
                            <div className="act-row">
                              {!t.settled&&<button className="act-btn" onClick={()=>{setSelectedReimbTx(t);setSettlePiu({bankId:bankAccs[0]?.id||"",date:today()});setShowSettlePiu(true);}} style={{borderColor:th.gr,color:th.gr}}>✓ Settle</button>}
                              <button className="act-btn" onClick={()=>delReimbTx(t.id)} style={{borderColor:th.bor,color:th.rd}}>🗑</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>}
                </>}
              </>}

              {/* Karyawan Tab */}
              {piSubTab==="karyawan"&&<>
                <div className="sec-hd">
                  <div className="sec-title">Piutang Karyawan ({empLoans.length})</div>
                  <button className="btn btn-primary" onClick={()=>{setEditLoanId(null);setLoanForm(EL);setShowLoanForm(true);}}>+ Piutang Baru</button>
                </div>
                {piutangStats.loanStats.map((l,i)=>(
                  <div key={l.id} className="card anim" style={{marginBottom:10,animationDelay:`${i*.05}s`}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:14}}>{l.employee_name}</div>
                        <div style={{fontSize:11,color:th.tx3,marginTop:2}}>{l.employee_dept||"—"} · Mulai {l.start_date}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:10,color:th.tx3}}>Sisa</div>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:15,fontWeight:800,color:l.remaining>0?th.rd:th.gr}}>{fmtIDR(l.remaining,true)}</div>
                      </div>
                    </div>
                    <div style={{height:7,background:th.sur3,borderRadius:4,overflow:"hidden",marginBottom:7}}>
                      <div style={{height:"100%",width:`${l.pct}%`,background:`linear-gradient(90deg,${th.ac},${th.gr})`,borderRadius:4}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:th.tx3,marginBottom:9}}>
                      <span>Dibayar: {fmtIDR(l.paid,true)} / {fmtIDR(Number(l.total_amount),true)}</span>
                      <span style={{color:l.aging.color,fontWeight:600}}>{l.aging.label}</span>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <button className="btn btn-primary" style={{fontSize:11,padding:"5px 12px"}} onClick={()=>{setSelectedLoan(l);setLoanPay({amount:String(l.monthly_installment),date:today(),notes:""});setShowPayLoan(true);}}>+ Bayar</button>
                      <button className="btn btn-ghost" style={{fontSize:11,padding:"5px 12px"}} onClick={()=>{setLoanForm({...l,total_amount:String(l.total_amount),monthly_installment:String(l.monthly_installment)});setEditLoanId(l.id);setShowLoanForm(true);}}>✏️</button>
                      <button className="btn btn-ghost" style={{fontSize:11,padding:"5px 12px",color:th.rd}} onClick={()=>delLoan(l.id)}>🗑</button>
                    </div>
                  </div>
                ))}
                {empLoans.length===0&&<Empty icon="👥" msg="Belum ada piutang karyawan" th={th} onAdd={()=>{setEditLoanId(null);setLoanForm(EL);setShowLoanForm(true);}}/>}
              </>}

              {/* History Tab */}
              {piSubTab==="history"&&<>
                <div className="sec-title" style={{marginBottom:12}}>Riwayat Piutang Settled</div>
                <div className="card anim">
                  {reimbTx.filter(t=>t.settled).length===0?
                    <div style={{textAlign:"center",padding:"30px 0",color:th.tx3,fontSize:12}}>Belum ada piutang yang settled</div>
                  :reimbTx.filter(t=>t.settled).map((t,i)=>{
                    const acc=reimbMap[t.account_id];
                    return(
                      <div key={t.id} className="tx-row" style={{animationDelay:`${Math.min(i,8)*.02}s`}}>
                        <div className="tx-ic" style={{background:th.grBg,color:th.gr,fontSize:15}}>✓</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600,fontSize:13,marginBottom:4}}>{t.description}</div>
                          <div className="tag-row">
                            <Tag bg={th.sur3} color={th.tx3}>{t.tx_date}</Tag>
                            {acc&&<Tag bg={ENT_BG[acc.entity]} color={ENT_COL[acc.entity]}>{acc.entity}</Tag>}
                            {t.settled_date&&<Tag bg={th.grBg} color={th.gr}>Settled {t.settled_date}</Tag>}
                          </div>
                        </div>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:th.gr}}>{fmtIDR(Number(t.amount))}</div>
                      </div>
                    );
                  })}
                </div>
              </>}
            </>
          )}

          {/* ══ ASSET TRACKER ══ */}
          {tab==="asset"&&(
            <>
              {/* Summary Hero */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
                {[["Total Aset",totalAssets,th.te,th.teBg,"📈"],["Total Liabilitas",totalLiabs,th.rd,th.rdBg,"📉"],["Aset Bersih",totalAssets-totalLiabs,totalAssets-totalLiabs>=0?th.gr:th.rd,totalAssets-totalLiabs>=0?th.grBg:th.rdBg,"💎"]].map(([l,v,col,bg,ic])=>(
                  <div key={l} className="card anim" style={{background:bg,borderColor:col+"33",border:`1px solid ${col}33`,textAlign:"center",padding:"12px 10px"}}>
                    <div style={{fontSize:18,marginBottom:4}}>{ic}</div>
                    <div style={{fontSize:9,fontWeight:700,color:col,textTransform:"uppercase",letterSpacing:.8,marginBottom:3}}>{l}</div>
                    <div style={{fontSize:13,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:col}}>{fmtIDR(v,true)}</div>
                  </div>
                ))}
              </div>

              {/* Subtabs */}
              <div className="subtabs anim">
                {[["overview","◎ Overview"],["assets","📊 Aset"],["liabilitas","📉 Liabilitas"]].map(([id,label])=>(
                  <button key={id} className={`stab ${assetSubTab===id?"on":""}`} onClick={()=>setAssetSubTab(id)}>{label}</button>
                ))}
              </div>

              {/* ── Overview ── */}
              {assetSubTab==="overview"&&(
                <>
                  {assets.length===0&&liabilities.length===0?
                    <Empty icon="📈" msg="Belum ada aset atau liabilitas. Mulai tambah aset kamu!" th={th} onAdd={()=>{setEditAssetId(null);setAssetForm(EA);setShowAssetForm(true);}}/>
                  :<>
                    {/* Allocation by Category */}
                    {assets.length>0&&(
                      <>
                        <div className="sec-hd"><div className="sec-title">Alokasi Aset</div></div>
                        <div className="card anim" style={{marginBottom:14}}>
                          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                            <div style={{flex:"0 0 140px"}}>
                              <ResponsiveContainer width={140} height={140}>
                                <PieChart>
                                  <Pie data={ASSET_CATS.map(cat=>({name:cat,value:assets.filter(a=>a.category===cat).reduce((s,a)=>s+Number(a.current_value||0),0)})).filter(d=>d.value>0)} cx={65} cy={65} innerRadius={40} outerRadius={65} paddingAngle={2} dataKey="value">
                                    {ASSET_CATS.map(cat=><Cell key={cat} fill={ASSET_COL[cat]||th.ac}/>)}
                                  </Pie>
                                  <Tooltip contentStyle={{background:th.sur,border:`1px solid ${th.bor}`,borderRadius:8,fontSize:10}} formatter={v=>fmtIDR(v,true)}/>
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                            <div style={{flex:1,minWidth:120}}>
                              {ASSET_CATS.map(cat=>{
                                const val=assets.filter(a=>a.category===cat).reduce((s,a)=>s+Number(a.current_value||0),0);
                                if(!val)return null;
                                const pct=totalAssets>0?(val/totalAssets*100).toFixed(1):0;
                                return(
                                  <div key={cat} style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
                                    <div style={{width:8,height:8,borderRadius:"50%",background:ASSET_COL[cat],flexShrink:0}}/>
                                    <span style={{fontSize:11,flex:1}}>{ASSET_ICON[cat]} {cat}</span>
                                    <span style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:th.tx2,fontWeight:600}}>{pct}%</span>
                                    <span style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:th.tx3}}>{fmtIDR(val,true)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Category Summary Cards */}
                    {ASSET_CATS.map(cat=>{
                      const items=assets.filter(a=>a.category===cat);
                      if(!items.length)return null;
                      const total=items.reduce((s,a)=>s+Number(a.current_value||0),0);
                      const totalBuy=items.reduce((s,a)=>s+Number(a.purchase_value||0),0);
                      const gain=total-totalBuy;
                      const gainPct=totalBuy>0?(gain/totalBuy*100):0;
                      return(
                        <div key={cat} className="card anim" style={{marginBottom:10,borderLeft:`3px solid ${ASSET_COL[cat]}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <div style={{width:32,height:32,borderRadius:9,background:ASSET_BG[cat],display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>{ASSET_ICON[cat]}</div>
                              <div>
                                <div style={{fontWeight:700,fontSize:13}}>{cat}</div>
                                <div style={{fontSize:10,color:th.tx3}}>{items.length} item</div>
                              </div>
                            </div>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:800}}>{fmtIDR(total,true)}</div>
                              {totalBuy>0&&<div style={{fontSize:10,color:gain>=0?th.gr:th.rd,fontWeight:600}}>{gain>=0?"+":""}{gainPct.toFixed(1)}%</div>}
                            </div>
                          </div>
                          {items.map(a=>(
                            <div key={a.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderTop:`1px solid ${th.bor}`}}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:12,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.name}</div>
                                {a.purchase_date&&<div style={{fontSize:10,color:th.tx3}}>Beli: {a.purchase_date}</div>}
                              </div>
                              <div style={{textAlign:"right",marginLeft:10,flexShrink:0}}>
                                <div style={{fontSize:12,fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{fmtIDR(Number(a.current_value||0),true)}</div>
                                <div style={{display:"flex",gap:4,justifyContent:"flex-end",marginTop:4}}>
                                  <button className="act-btn" onClick={()=>{setSelectedAsset(a);setUpdateValForm({...EUV,value:String(a.current_value||"")});setAiValResult(null);setShowUpdateVal(true);}} style={{borderColor:th.te,color:th.te,fontSize:9}}>✏️ Nilai</button>
                                  <button className="act-btn" onClick={()=>{setAssetForm({...a,current_value:String(a.current_value||""),purchase_value:String(a.purchase_value||"")});setEditAssetId(a.id);setShowAssetForm(true);}} style={{borderColor:th.bor,color:th.tx3}}>⚙️</button>
                                  <button className="act-btn" onClick={()=>deleteAsset(a.id)} style={{borderColor:th.bor,color:th.rd}}>🗑</button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}

                    {/* Liabilities quick */}
                    {liabilities.length>0&&(
                      <>
                        <div className="sec-hd" style={{marginTop:4}}><div className="sec-title">Liabilitas</div><button className="sec-link" onClick={()=>setAssetSubTab("liabilitas")}>Semua →</button></div>
                        <div className="card anim" style={{borderLeft:`3px solid ${th.rd}`}}>
                          {liabilities.map((l,i)=>{
                            const pct=Number(l.original_amount)>0?(1-Number(l.outstanding)/Number(l.original_amount))*100:0;
                            return(
                              <div key={l.id} style={{padding:"8px 0",borderBottom:i<liabilities.length-1?`1px solid ${th.bor}`:"none"}}>
                                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                                  <div>
                                    <span style={{fontSize:12,fontWeight:600}}>{l.name}</span>
                                    <Tag bg={th.rdBg} color={th.rd} style={{marginLeft:6}}>{l.category}</Tag>
                                  </div>
                                  <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:th.rd}}>{fmtIDR(Number(l.outstanding),true)}</span>
                                </div>
                                {Number(l.original_amount)>0&&<div style={{height:4,background:th.sur3,borderRadius:2}}><div style={{height:"100%",width:`${pct}%`,background:th.gr,borderRadius:2}}/></div>}
                              </div>
                            );
                          })}
                          <div style={{display:"flex",justifyContent:"space-between",paddingTop:8,fontWeight:700,fontSize:12}}>
                            <span>Total Liabilitas</span>
                            <span style={{fontFamily:"'JetBrains Mono',monospace",color:th.rd}}>{fmtIDR(totalLiabs)}</span>
                          </div>
                        </div>
                      </>
                    )}
                  </>}
                </>
              )}

              {/* ── Aset Detail ── */}
              {assetSubTab==="assets"&&(
                <>
                  <div className="sec-hd">
                    <div className="sec-title">Semua Aset ({assets.length})</div>
                    <button className="btn btn-primary" onClick={()=>{setEditAssetId(null);setAssetForm(EA);setShowAssetForm(true);}}>+ Tambah</button>
                  </div>
                  {assets.length===0?<Empty icon="📈" msg="Belum ada aset" th={th} onAdd={()=>{setEditAssetId(null);setAssetForm(EA);setShowAssetForm(true);}}/>
                  :<div className="card anim">
                    {assets.map((a,i)=>{
                      const gain=Number(a.current_value||0)-Number(a.purchase_value||0);
                      const gainPct=Number(a.purchase_value)>0?(gain/Number(a.purchase_value)*100):null;
                      const lastH=assetHistory.filter(h=>h.asset_id===a.id)[0];
                      return(
                        <div key={a.id} className="tx-row" style={{animationDelay:`${Math.min(i,8)*.02}s`}}>
                          <div className="tx-ic" style={{background:ASSET_BG[a.category]||th.sur2,color:ASSET_COL[a.category]||th.ac,fontSize:16}}>{ASSET_ICON[a.category]||"💼"}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:600,fontSize:13,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.name}</div>
                            <div className="tag-row">
                              <Tag bg={ASSET_BG[a.category]||th.sur3} color={ASSET_COL[a.category]||th.tx3}>{a.category}</Tag>
                              {a.currency&&a.currency!=="IDR"&&<Tag bg={th.amBg} color={th.am}>🌏 {a.currency}</Tag>}
                              {a.purchase_date&&<Tag bg={th.sur3} color={th.tx3}>{a.purchase_date}</Tag>}
                              {lastH&&<Tag bg={th.sur3} color={th.tx3}>Update: {lastH.recorded_date}</Tag>}
                            </div>
                          </div>
                          <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700}}>{fmtIDR(Number(a.current_value||0),true)}</div>
                            {gainPct!==null&&<div style={{fontSize:10,color:gain>=0?th.gr:th.rd,fontWeight:600}}>{gain>=0?"+":""}{gainPct.toFixed(1)}%</div>}
                            <div className="act-row">
                              <button className="act-btn" onClick={()=>{setSelectedAsset(a);setUpdateValForm({...EUV,value:String(a.current_value||"")});setAiValResult(null);setShowUpdateVal(true);}} style={{borderColor:th.te,color:th.te}}>✏️ Nilai</button>
                              <button className="act-btn" onClick={()=>{setAssetForm({...a,current_value:String(a.current_value||""),purchase_value:String(a.purchase_value||"")});setEditAssetId(a.id);setShowAssetForm(true);}} style={{borderColor:th.bor,color:th.tx3}}>⚙️</button>
                              <button className="act-btn" onClick={()=>deleteAsset(a.id)} style={{borderColor:th.bor,color:th.rd}}>🗑</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>}
                </>
              )}

              {/* ── Liabilitas ── */}
              {assetSubTab==="liabilitas"&&(
                <>
                  <div className="sec-hd">
                    <div className="sec-title">Liabilitas ({liabilities.length})</div>
                    <button className="btn btn-primary" onClick={()=>{setEditLiabId(null);setLiabForm(ELB);setShowLiabForm(true);}}>+ Tambah</button>
                  </div>
                  {liabilities.length===0?<Empty icon="📉" msg="Belum ada liabilitas" th={th} onAdd={()=>{setEditLiabId(null);setLiabForm(ELB);setShowLiabForm(true);}}/>
                  :<>
                    {liabilities.map((l,i)=>{
                      const orig=Number(l.original_amount||0);
                      const out=Number(l.outstanding||0);
                      const paid=orig-out;
                      const pct=orig>0?(paid/orig*100):0;
                      return(
                        <div key={l.id} className="card anim" style={{marginBottom:10,animationDelay:`${i*.04}s`,borderLeft:`3px solid ${th.rd}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                            <div>
                              <div style={{fontWeight:700,fontSize:14}}>{l.name}</div>
                              <div style={{fontSize:10,color:th.tx3,marginTop:2,display:"flex",gap:6}}>
                                <Tag bg={th.rdBg} color={th.rd}>{l.category}</Tag>
                                {l.interest_rate>0&&<Tag bg={th.amBg} color={th.am}>{l.interest_rate}% p.a.</Tag>}
                                {l.monthly_payment>0&&<Tag bg={th.sur3} color={th.tx3}>{fmtIDR(l.monthly_payment,true)}/bln</Tag>}
                              </div>
                            </div>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:9,color:th.tx3}}>Outstanding</div>
                              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:15,fontWeight:800,color:th.rd}}>{fmtIDR(out,true)}</div>
                            </div>
                          </div>
                          {orig>0&&(
                            <>
                              <div style={{height:7,background:th.sur3,borderRadius:4,overflow:"hidden",marginBottom:6}}>
                                <div style={{height:"100%",width:`${Math.min(pct,100)}%`,background:`linear-gradient(90deg,${th.gr},#059669)`,borderRadius:4}}/>
                              </div>
                              <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:th.tx3,marginBottom:8}}>
                                <span>Dibayar: {fmtIDR(paid,true)}</span>
                                <span>Total: {fmtIDR(orig,true)} · {pct.toFixed(0)}%</span>
                              </div>
                            </>
                          )}
                          {(l.start_date||l.end_date)&&<div style={{fontSize:10,color:th.tx3,marginBottom:8}}>{l.start_date&&`Mulai: ${l.start_date}`}{l.end_date&&` · Selesai: ${l.end_date}`}</div>}
                          <div style={{display:"flex",gap:6}}>
                            <button className="btn btn-ghost" style={{fontSize:11,padding:"5px 12px"}} onClick={()=>{setLiabForm({...l,outstanding:String(l.outstanding||""),original_amount:String(l.original_amount||""),monthly_payment:String(l.monthly_payment||""),interest_rate:String(l.interest_rate||"")});setEditLiabId(l.id);setShowLiabForm(true);}}>✏️ Edit</button>
                            <button className="btn btn-ghost" style={{fontSize:11,padding:"5px 12px",color:th.rd}} onClick={()=>deleteLiab(l.id)}>🗑 Hapus</button>
                          </div>
                        </div>
                      );
                    })}
                    <div className="card anim" style={{background:th.rdBg,border:`1px solid ${th.rd}33`}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,fontSize:13}}>
                        <span>Total Outstanding</span>
                        <span style={{fontFamily:"'JetBrains Mono',monospace",color:th.rd}}>{fmtIDR(totalLiabs)}</span>
                      </div>
                    </div>
                  </>}
                </>
              )}
            </>
          )}

          {/* ══ INCOME ══ */}
          {tab==="income"&&(
            <>
              {/* Summary */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:9,marginBottom:14}}>
                {[["Pemasukan Bulan Ini",incomeStats.totalThisMonth,th.gr],["Pengeluaran Bulan Ini",incomeStats.expenseThisMonth,th.rd],["Surplus / Defisit",incomeStats.surplus,incomeStats.surplus>=0?th.gr:th.rd]].map(([l,v,col])=>(
                  <div key={l} className="stat-card anim" style={{borderTop:`2px solid ${col}`}}>
                    <div style={{fontSize:9,fontWeight:700,color:th.tx3,textTransform:"uppercase",letterSpacing:.6,marginBottom:4}}>{l}</div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:800,color:col}}>{fmtIDR(v,true)}</div>
                  </div>
                ))}
              </div>

              {/* Subtabs */}
              <div className="subtabs anim">
                {[["pemasukan","💰 Pemasukan"],["cashflow","📊 Cash Flow"],["proyeksi","🔮 Proyeksi"]].map(([id,label])=>(
                  <button key={id} className={`stab ${incomeSubTab===id?"on":""}`} onClick={()=>setIncomeSubTab(id)}>{label}</button>
                ))}
              </div>

              {/* Pemasukan */}
              {incomeSubTab==="pemasukan"&&<>
                {incomes.length===0?<Empty icon="💰" msg="Belum ada income. Catat gaji atau pemasukan pertamamu!" th={th} onAdd={()=>{setEditIncomeId(null);setIncomeForm(EIN);setShowIncomeForm(true);}}/>
                :<div className="card anim">
                  {incomes.map((x,i)=>(
                    <div key={x.id} className="tx-row" style={{animationDelay:`${Math.min(i,8)*.02}s`}}>
                      <div className="tx-ic" style={{background:th.grBg,color:th.gr,fontSize:15}}>💰</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,fontSize:13,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{x.description||x.category}</div>
                        <div className="tag-row">
                          <Tag bg={th.sur3} color={th.tx3}>{x.income_date}</Tag>
                          <Tag bg={th.grBg} color={th.gr}>{x.category}</Tag>
                          <Tag bg={ENT_BG[x.entity]||th.sur3} color={ENT_COL[x.entity]||th.tx3}>{x.entity}</Tag>
                          {x.bank_account_id&&bankMap[x.bank_account_id]&&<Tag bg={th.acBg} color={th.ac}>→ {bankMap[x.bank_account_id].name}</Tag>}
                          {x.is_recurring&&<Tag bg={th.puBg} color={th.pu}>↺ Rutin</Tag>}
                        </div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:th.gr}}>+{fmtIDR(Number(x.amount_idr||x.amount||0),true)}</div>
                        {x.currency!=="IDR"&&<div style={{fontSize:10,color:th.tx3}}>{fmtCur(x.amount,x.currency)}</div>}
                        <div className="act-row" style={{marginTop:4}}>
                          <button className="act-btn" onClick={()=>{setIncomeForm({...x,amount:String(x.amount)});setEditIncomeId(x.id);setShowIncomeForm(true);}} style={{borderColor:th.bor,color:th.tx3}}>✏️</button>
                          <button className="act-btn" onClick={()=>delIncome(x.id)} style={{borderColor:th.bor,color:th.rd}}>🗑</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>}
              </>}

              {/* Cash Flow */}
              {incomeSubTab==="cashflow"&&<>
                <div className="sec-hd"><div className="sec-title">Income vs Expense 6 Bulan</div></div>
                <div className="card anim" style={{marginBottom:14}}>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={incomeStats.chartData} barSize={14} margin={{left:-15,right:5}}>
                      <XAxis dataKey="month" tick={{fill:th.tx3,fontSize:10}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fill:th.tx3,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtIDR(v,true)}/>
                      <Tooltip contentStyle={{background:th.sur,border:`1px solid ${th.bor}`,borderRadius:10,fontSize:11}}/>
                      <Bar dataKey="income" name="Pemasukan" fill={th.gr} radius={[4,4,0,0]}/>
                      <Bar dataKey="expense" name="Pengeluaran" fill={th.rd} radius={[4,4,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {incomeStats.byCat.length>0&&<>
                  <div className="sec-hd"><div className="sec-title">Breakdown Income</div></div>
                  <div className="card anim" style={{marginBottom:14}}>
                    <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                      <div style={{flex:"0 0 130px"}}>
                        <ResponsiveContainer width={130} height={130}>
                          <PieChart>
                            <Pie data={incomeStats.byCat} cx={60} cy={60} innerRadius={35} outerRadius={60} paddingAngle={2} dataKey="value">
                              {incomeStats.byCat.map((_,idx)=>{const cols=["#0ca678","#3b5bdb","#7048e8","#e67700","#0c8599","#e03131","#d4a017","#9333ea"];return<Cell key={idx} fill={cols[idx%cols.length]}/>;})}</Pie>
                            <Tooltip contentStyle={{background:th.sur,border:`1px solid ${th.bor}`,borderRadius:8,fontSize:10}} formatter={v=>fmtIDR(v,true)}/>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={{flex:1}}>
                        {incomeStats.byCat.map((c,idx)=>{
                          const cols=["#0ca678","#3b5bdb","#7048e8","#e67700","#0c8599","#e03131","#d4a017","#9333ea"];
                          const total=incomeStats.byCat.reduce((s,x)=>s+x.value,0);
                          return(
                            <div key={c.name} style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
                              <div style={{width:8,height:8,borderRadius:"50%",background:cols[idx%cols.length],flexShrink:0}}/>
                              <span style={{fontSize:11,flex:1}}>{c.name}</span>
                              <span style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:th.tx3}}>{total>0?(c.value/total*100).toFixed(0):0}%</span>
                              <span style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:th.gr,fontWeight:600}}>{fmtIDR(c.value,true)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>}
                {incomeStats.chartData.map((m,i)=>{
                  const surplus=m.income-m.expense;
                  return(
                    <div key={i} className="card anim" style={{marginBottom:8,borderLeft:`3px solid ${surplus>=0?th.gr:th.rd}`,animationDelay:`${i*.04}s`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{fontWeight:700,fontSize:13}}>{m.month}</div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:10,color:th.tx3}}>Surplus / Defisit</div>
                          <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,color:surplus>=0?th.gr:th.rd}}>{surplus>=0?"+":""}{fmtIDR(surplus,true)}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:16,marginTop:7,fontSize:11}}>
                        <span>💰 In: <span style={{color:th.gr,fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{fmtIDR(m.income,true)}</span></span>
                        <span>💸 Out: <span style={{color:th.rd,fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{fmtIDR(m.expense,true)}</span></span>
                      </div>
                    </div>
                  );
                })}
              </>}

              {/* Proyeksi */}
              {incomeSubTab==="proyeksi"&&<>
                <div className="card anim" style={{marginBottom:12,borderLeft:`3px solid ${th.te}`}}>
                  <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>🔮 Proyeksi Berdasarkan Rata-rata 3 Bulan Terakhir</div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:6}}>
                    <span style={{color:th.tx3}}>Rata-rata pemasukan</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:th.gr}}>{fmtIDR(incomeStats.avg3Income,true)}</span>
                  </div>
                  {[1,2,3].map(n=>{
                    const d=new Date();d.setMonth(d.getMonth()+n);
                    const label=d.toLocaleDateString("id-ID",{month:"long",year:"numeric"});
                    return(
                      <div key={n} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderTop:`1px solid ${th.bor}`,fontSize:12}}>
                        <span style={{color:th.tx2}}>{label}</span>
                        <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:th.te}}>{fmtIDR(incomeStats.avg3Income,true)}</span>
                      </div>
                    );
                  })}
                </div>
                {incomes.filter(x=>x.is_recurring).length>0&&<>
                  <div className="sec-hd"><div className="sec-title">Income Rutin</div></div>
                  {incomes.filter(x=>x.is_recurring).map((x,i)=>(
                    <div key={x.id} className="card anim" style={{marginBottom:8,animationDelay:`${i*.04}s`,borderLeft:`3px solid ${th.gr}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div>
                          <div style={{fontWeight:600,fontSize:13}}>{x.description||x.category}</div>
                          <div style={{fontSize:10,color:th.tx3,marginTop:2}}>{x.category} · {x.recur_frequency||"Bulanan"}</div>
                        </div>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:th.gr}}>{fmtIDR(Number(x.amount_idr||x.amount||0),true)}</div>
                      </div>
                    </div>
                  ))}
                </>}
                {incomes.filter(x=>x.is_recurring).length===0&&<div style={{textAlign:"center",padding:"20px",color:th.tx3,fontSize:12}}>Belum ada income rutin. Tandai income sebagai "Rutin" untuk proyeksi yang lebih akurat.</div>}
              </>}
            </>
          )}

          {/* Coming Soon tabs */}
          {tab==="calendar"&&(
            <div style={{textAlign:"center",padding:"60px 20px"}}>
              <div style={{fontSize:48,marginBottom:14}}>🚧</div>
              <div style={{fontSize:20,fontWeight:800,marginBottom:8}}>Coming Soon</div>
              <div style={{fontSize:13,color:th.tx3,marginBottom:22}}>Modul <strong>Calendar</strong> akan hadir di sesi berikutnya!</div>
              <div style={{display:"inline-flex",flexDirection:"column",gap:7,textAlign:"left"}}>
                {["Monthly calendar view","Upcoming transactions","Reminder H-7, H-3, H-1","Browser push notification"].map(f=>(
                  <div key={f} style={{display:"flex",gap:9,fontSize:12,color:th.tx2}}>
                    <span style={{color:th.ac,fontWeight:700}}>→</span>{f}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Settings */}
          {tab==="settings"&&(
            <>
              <div className="card anim" style={{marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>👤 Akun</div>
                <div style={{fontSize:12,color:th.tx2,marginBottom:4}}>Email: <span style={{fontWeight:600}}>{user.email}</span></div>
                <button onClick={signOut} style={{background:th.rdBg,color:th.rd,border:`1px solid ${th.rd}44`,padding:"8px 16px",borderRadius:8,fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",marginTop:10}}>🚪 Sign Out</button>
              </div>
              <div className="card anim" style={{marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🎨 Tampilan</div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{fontSize:12,color:th.tx2}}>Mode</span>
                  <button onClick={()=>setIsDark(d=>!d)} className="btn btn-ghost">{isDark?"🌙 Dark":"☀️ Light"}</button>
                </div>
              </div>
              <div className="card anim" style={{marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>💱 Kurs Mata Uang</div>
                <div style={{fontSize:11,color:th.tx3,marginBottom:12}}>Update kurs untuk konversi akurat</div>
                {CURRENCIES.filter(c=>c.code!=="IDR").map(cur=>(
                  <div key={cur.code} style={{display:"flex",alignItems:"center",gap:9,marginBottom:9}}>
                    <span style={{fontSize:15}}>{cur.flag}</span>
                    <span style={{fontSize:12,fontWeight:600,color:th.tx2,width:34}}>{cur.code}</span>
                    <input className="inp" type="number" value={fxRates[cur.code]||cur.rate} onChange={e=>setFxRates(r=>({...r,[cur.code]:Number(e.target.value)}))} style={{flex:1}}/>
                    <span style={{fontSize:11,color:th.tx3}}>IDR</span>
                  </div>
                ))}
                <button className="btn btn-primary" style={{marginTop:6}} onClick={saveFx}>Simpan Kurs</button>
              </div>
            </>
          )}
        </div>
      </main>

      {/* ══ MODALS ══ */}

      {/* AI Chat */}
      {showAIChat&&<Overlay onClose={()=>setShowAIChat(false)} th={th} title="🤖 AI Financial Advisor" sub="Powered by Claude AI">
        <div style={{flex:1,overflowY:"auto",marginBottom:12}}>
          {aiMsgs.length===0&&<div style={{textAlign:"center",padding:"24px 0",color:th.tx3}}>
            <div style={{fontSize:32,marginBottom:8}}>💬</div>
            <div style={{fontSize:12,marginBottom:14}}>Tanya tentang keuangan kamu</div>
            {["Bagaimana kondisi keuangan saya?","Hutang CC saya berapa?","Total piutang yang belum lunas?"].map(q=>(
              <button key={q} onClick={()=>setAiInput(q)} style={{display:"block",width:"100%",background:th.sur2,border:`1px solid ${th.bor}`,borderRadius:8,padding:"8px 12px",fontFamily:"'Sora',sans-serif",fontSize:11,color:th.tx2,cursor:"pointer",marginBottom:5,textAlign:"left"}}>{q}</button>
            ))}
          </div>}
          {aiMsgs.map((m,i)=>(
            <div key={i} style={{display:"flex",gap:8,marginBottom:11,flexDirection:m.role==="user"?"row-reverse":"row"}}>
              <div style={{width:28,height:28,borderRadius:"50%",background:m.role==="user"?`linear-gradient(135deg,${th.ac},${th.pu})`:`linear-gradient(135deg,${th.gr},#059669)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,flexShrink:0}}>{m.role==="user"?"👤":"🤖"}</div>
              <div style={{background:m.role==="user"?th.acBg:th.sur2,border:`1px solid ${m.role==="user"?th.ac+"44":th.bor}`,borderRadius:12,padding:"9px 12px",maxWidth:"80%",fontSize:12,lineHeight:1.6,color:th.tx}}>{m.text}</div>
            </div>
          ))}
          {aiLoading&&<div style={{display:"flex",gap:8}}><div style={{width:28,height:28,borderRadius:"50%",background:`linear-gradient(135deg,${th.gr},#059669)`,display:"flex",alignItems:"center",justifyContent:"center"}}>🤖</div><div style={{background:th.sur2,border:`1px solid ${th.bor}`,borderRadius:12,padding:"9px 12px",fontSize:12,color:th.tx3}}>Berpikir...</div></div>}
        </div>
        <div style={{display:"flex",gap:8,flexShrink:0}}>
          <input className="inp" placeholder="Tanya tentang keuangan kamu..." value={aiInput} onChange={e=>setAiInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendAI()} style={{flex:1}}/>
          <button className="btn btn-primary" onClick={sendAI} disabled={aiLoading||!aiInput.trim()}>→</button>
        </div>
      </Overlay>}

      {/* Scanner */}
      {showScanner&&<Overlay onClose={()=>{setShowScanner(false);setScanImg(null);setScanResult(null);setScanError(null);}} th={th} title="📷 Scan Struk / Nota">
        <div style={{marginBottom:12}}>
          <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
            {[["cc","💳 CC"],["bank","🏦 Bank"],["asset","📈 Aset"]].map(([v,l])=>(
              <button key={v} onClick={()=>setScanTarget(v)} className="btn" style={{flex:1,background:scanTarget===v?th.acBg:"transparent",border:`1px solid ${scanTarget===v?th.ac:th.bor}`,color:scanTarget===v?th.ac:th.tx3,fontWeight:scanTarget===v?700:500}}>{l}</button>
            ))}
          </div>
          <div onClick={()=>fileRef.current?.click()} style={{border:`2px dashed ${scanImg?th.ac:th.bor}`,borderRadius:14,padding:"28px 20px",textAlign:"center",cursor:"pointer",background:th.sur2,transition:"all .2s"}}>
            {!scanImg?<>
              <div style={{fontSize:32,marginBottom:8}}>📷</div>
              <div style={{fontSize:13,fontWeight:600,color:th.tx2}}>Klik untuk pilih foto</div>
              <div style={{fontSize:11,color:th.tx3,marginTop:3}}>Dari galeri atau kamera · JPG, PNG, HEIC</div>
            </>:<>
              <div style={{fontSize:13,color:th.gr,fontWeight:700,marginBottom:4}}>✓ Foto dipilih</div>
              <div style={{fontSize:10,color:th.tx3}}>Klik untuk ganti foto</div>
            </>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleFile}/>
        </div>
        {scanError&&<div style={{padding:"10px 13px",background:th.rdBg,border:`1px solid ${th.rd}44`,borderRadius:10,marginBottom:12,fontSize:12,color:th.rd}}>⚠️ {scanError}</div>}
        {scanResult&&!scanResult.error&&<div style={{padding:14,background:th.acBg,border:`1px solid ${th.ac}44`,borderRadius:12,marginBottom:12}}>
          <div style={{fontSize:10,color:th.ac,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:10}}>✨ Hasil AI Scan</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            {[["Merchant / Nama",scanResult.merchant||"-"],["Nominal",scanResult.amount?fmtIDR(scanResult.amount):"-"],["Tanggal",scanResult.date||"-"],["Kategori",scanResult.category||"-"],["Tipe",scanResult.type==="in"?"↓ Masuk":"↑ Keluar"],["Fee",scanResult.fee>0?fmtIDR(scanResult.fee):"-"]].map(([l,v])=>(
              <div key={l} style={{background:th.sur2,borderRadius:8,padding:"7px 9px"}}>
                <div style={{fontSize:9,color:th.tx3,fontWeight:700,textTransform:"uppercase"}}>{l}</div>
                <div style={{fontSize:12,fontWeight:700,marginTop:1}}>{v}</div>
              </div>
            ))}
          </div>
        </div>}
        {scanLoading&&<div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:th.acBg,border:`1px solid ${th.ac}44`,borderRadius:10,marginBottom:12}}>
          <div style={{width:20,height:20,border:`2px solid ${th.ac}44`,borderTop:`2px solid ${th.ac}`,borderRadius:"50%",animation:"spin .7s linear infinite",flexShrink:0}}/>
          <div style={{fontSize:12,color:th.ac,fontWeight:600}}>AI sedang menganalisis foto...</div>
        </div>}
        <BtnRow onCancel={()=>{setShowScanner(false);setScanImg(null);setScanResult(null);setScanError(null);}} onOk={scanResult&&!scanResult.error?confirmScan:runScan} label={scanResult&&!scanResult.error?"✅ Lanjut Isi Form":scanLoading?"🔄 Scanning...":"✨ Scan dengan AI"} th={th} disabled={!scanImg||scanLoading}/>
      </Overlay>}

      {/* Pay CC */}
      {showPayCC&&<Overlay onClose={()=>setShowPayCC(false)} th={th} title="💳 Bayar Tagihan CC">
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          <F label="Kartu Kredit" th={th}><select className="inp" value={payCC.cardId} onChange={e=>setPayCC(p=>({...p,cardId:e.target.value}))}><option value="">Pilih kartu...</option>{ccStats.cardStats.map(c=><option key={c.id} value={c.id}>{c.name} — Tagihan: {fmtIDR(c.spent,true)}</option>)}</select></F>
          <F label="Bayar dari Rekening" th={th}><select className="inp" value={payCC.bankId} onChange={e=>setPayCC(p=>({...p,bankId:e.target.value}))}><option value="">Pilih rekening...</option>{bankAccs.map(b=><option key={b.id} value={b.id}>{b.name} — {fmtIDR(bankBal[b.id]||0,true)}</option>)}</select></F>
          <R2><F label="Jumlah Bayar" th={th}><input className="inp" type="number" placeholder="0" value={payCC.amount} onChange={e=>setPayCC(p=>({...p,amount:e.target.value}))}/></F></R2>
          <R2>
            <F label="Biaya Admin" th={th}><input className="inp" type="number" placeholder="0" value={payCC.adminFee} onChange={e=>setPayCC(p=>({...p,adminFee:e.target.value}))}/></F>
            <F label="Materai" th={th}><input className="inp" type="number" placeholder="0" value={payCC.materai} onChange={e=>setPayCC(p=>({...p,materai:e.target.value}))}/></F>
          </R2>
          <BtnRow onCancel={()=>setShowPayCC(false)} onOk={submitPayCC} label="Bayar" th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* TX Form */}
      {showTxForm&&<Overlay onClose={()=>setShowTxForm(false)} th={th} title={editTxId?"✏️ Edit Transaksi":"➕ Tambah Transaksi CC"}>
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          {scanResult&&!scanResult.error&&<div style={{padding:"8px 12px",background:th.acBg,border:`1px solid ${th.ac}44`,borderRadius:9,fontSize:11,color:th.ac}}>✨ Data dari AI scan · <button onClick={()=>{setScanImg(null);setScanResult(null);setScanError(null);setScanTarget("cc");setShowScanner(true);setShowTxForm(false);}} style={{background:"none",border:"none",color:th.ac,fontWeight:700,cursor:"pointer",fontFamily:"'Sora',sans-serif",fontSize:11}}>Scan ulang →</button></div>}
          {/* Tipe */}
          <F label="Tipe Transaksi" th={th}>
            <div style={{display:"flex",gap:7}}>
              {[["out","↑ Keluar (Charge)"],["in","↓ Masuk (Refund)"]].map(([v,l])=>(
                <button key={v} onClick={()=>setTxForm(f=>({...f,tx_type:v}))} style={{flex:1,padding:"8px",borderRadius:9,border:`1px solid ${txForm.tx_type===v?(v==="out"?th.rd:th.gr):th.bor}`,background:txForm.tx_type===v?(v==="out"?th.rdBg:th.grBg):th.sur2,fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:11,cursor:"pointer",color:txForm.tx_type===v?(v==="out"?th.rd:th.gr):th.tx3}}>{l}</button>
              ))}
            </div>
          </F>
          <R2>
            <F label="Tanggal" th={th}><input className="inp" type="date" value={txForm.tx_date} onChange={e=>setTxForm(f=>({...f,tx_date:e.target.value}))}/></F>
            <F label="Kartu" th={th}><select className="inp" value={txForm.card_id} onChange={e=>setTxForm(f=>({...f,card_id:e.target.value}))}><option value="">Pilih...</option>{cards.map(c=><option key={c.id} value={c.id}>{c.name} ···· {c.last4}</option>)}</select></F>
          </R2>
          <F label="Keterangan" th={th}><input className="inp" placeholder="Makan siang, belanja..." value={txForm.description} onChange={e=>setTxForm(f=>({...f,description:e.target.value}))}/></F>
          <R2>
            <F label="Jumlah" th={th}>
              <div style={{display:"flex",gap:5}}>
                <select className="inp" value={txForm.currency} onChange={e=>setTxForm(f=>({...f,currency:e.target.value}))} style={{width:80,flexShrink:0}}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select>
                <input className="inp" type="number" placeholder="0" value={txForm.amount} onChange={e=>setTxForm(f=>({...f,amount:e.target.value}))}/>
              </div>
              {txForm.currency!=="IDR"&&txForm.amount&&<div style={{fontSize:10,color:th.tx3,marginTop:3}}>≈ {fmtIDR(toIDR(Number(txForm.amount),txForm.currency,fxRates))}</div>}
            </F>
            <F label="Fee Gestun (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={txForm.fee} onChange={e=>setTxForm(f=>({...f,fee:e.target.value}))}/></F>
          </R2>
          <R2>
            <F label="Kategori" th={th}><select className="inp" value={txForm.category} onChange={e=>setTxForm(f=>({...f,category:e.target.value}))}>{CC_CATS.map(c=><option key={c}>{c}</option>)}</select></F>
            <F label="Entitas" th={th}><select className="inp" value={txForm.entity} onChange={e=>setTxForm(f=>({...f,entity:e.target.value}))}>{CC_ENTS.map(e=><option key={e}>{e}</option>)}</select></F>
          </R2>
          <div className="tog-row" onClick={()=>setTxForm(f=>({...f,reimbursed:!f.reimbursed}))} style={{borderColor:txForm.reimbursed?th.gr:th.bor,background:txForm.reimbursed?th.grBg:th.sur2}}>
            <div className="tog-dot" style={{background:txForm.reimbursed?th.gr:th.bor}}>{txForm.reimbursed?"✓":""}</div>
            <div style={{fontSize:12,color:txForm.reimbursed?th.gr:th.tx3,fontWeight:600}}>Sudah Direimburse</div>
          </div>
          <button onClick={()=>{setShowTxForm(false);setScanImg(null);setScanResult(null);setScanError(null);setScanTarget("cc");setShowScanner(true);}} style={{background:th.sur2,border:`1px solid ${th.bor}`,borderRadius:9,padding:"8px",fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:12,cursor:"pointer",color:th.tx3}}>📷 Scan Struk</button>
          <BtnRow onCancel={()=>setShowTxForm(false)} onOk={submitTx} label={editTxId?"Simpan":"Tambah"} th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Card Form */}
      {showCardForm&&<Overlay onClose={()=>setShowCardForm(false)} th={th} title={editCardId?"✏️ Edit Kartu":"🏦 Tambah Kartu Kredit"}>
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          <R2><F label="Nama Kartu" th={th}><input className="inp" placeholder="BCA Platinum" value={cardForm.name} onChange={e=>setCardForm(f=>({...f,name:e.target.value}))}/></F><F label="Bank" th={th}><select className="inp" value={cardForm.bank} onChange={e=>setCardForm(f=>({...f,bank:e.target.value}))}>{BANKS_L.map(b=><option key={b}>{b}</option>)}</select></F></R2>
          <R2><F label="4 Digit Terakhir" th={th}><input className="inp" placeholder="1234" maxLength={4} value={cardForm.last4} onChange={e=>setCardForm(f=>({...f,last4:e.target.value}))}/></F><F label="Network" th={th}><select className="inp" value={cardForm.network} onChange={e=>setCardForm(f=>({...f,network:e.target.value}))}>{NETWORKS.map(n=><option key={n}>{n}</option>)}</select></F></R2>
          <F label="Limit (Rp)" th={th}><input className="inp" type="number" value={cardForm.card_limit} onChange={e=>setCardForm(f=>({...f,card_limit:e.target.value}))}/></F>
          <R2><F label="Tgl Cetak" th={th}><input className="inp" type="number" min={1} max={31} value={cardForm.statement_day} onChange={e=>setCardForm(f=>({...f,statement_day:e.target.value}))}/></F><F label="Tgl Jatuh Tempo" th={th}><input className="inp" type="number" min={1} max={31} value={cardForm.due_day} onChange={e=>setCardForm(f=>({...f,due_day:e.target.value}))}/></F></R2>
          <F label="Target Pengeluaran / Bulan (Rp)" th={th}><input className="inp" type="number" placeholder="0 = tidak ada target" value={cardForm.monthly_target} onChange={e=>setCardForm(f=>({...f,monthly_target:e.target.value}))}/>{Number(cardForm.monthly_target)>0&&<div style={{fontSize:10,color:th.ac,marginTop:3}}>{fmtIDR(Number(cardForm.monthly_target))} / bulan</div>}</F>
          <R2><F label="Warna Utama" th={th}><input type="color" value={cardForm.color} onChange={e=>setCardForm(f=>({...f,color:e.target.value}))} style={{width:44,height:36,border:"none",borderRadius:8,cursor:"pointer"}}/></F><F label="Warna Aksen" th={th}><input type="color" value={cardForm.accent} onChange={e=>setCardForm(f=>({...f,accent:e.target.value}))} style={{width:44,height:36,border:"none",borderRadius:8,cursor:"pointer"}}/></F></R2>
          {/* Preview */}
          <div style={{background:`linear-gradient(135deg,${cardForm.color},${cardForm.accent})`,borderRadius:12,padding:"13px 15px",color:"white"}}>
            <div style={{fontWeight:800,fontSize:14}}>{cardForm.name||"Nama Kartu"}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",letterSpacing:3,margin:"6px 0",opacity:.8}}>•••• •••• •••• {cardForm.last4||"0000"}</div>
            <div style={{fontSize:11,opacity:.5}}>{cardForm.bank} · {cardForm.network} · {fmtIDR(Number(cardForm.card_limit||0),true)}</div>
          </div>
          <BtnRow onCancel={()=>setShowCardForm(false)} onOk={submitCard} label={editCardId?"Simpan":"Tambah"} th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Inst Form */}
      {showInstForm&&<Overlay onClose={()=>setShowInstForm(false)} th={th} title={editInstId?"✏️ Edit Cicilan":"🔄 Tambah Cicilan"}>
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          <F label="Nama Item" th={th}><input className="inp" placeholder="iPhone, Laptop..." value={instForm.description} onChange={e=>setInstForm(f=>({...f,description:e.target.value}))}/></F>
          <R2><F label="Kartu" th={th}><select className="inp" value={instForm.card_id} onChange={e=>setInstForm(f=>({...f,card_id:e.target.value}))}><option value="">Pilih...</option>{cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></F><F label="Entitas" th={th}><select className="inp" value={instForm.entity} onChange={e=>setInstForm(f=>({...f,entity:e.target.value}))}>{CC_ENTS.map(e=><option key={e}>{e}</option>)}</select></F></R2>
          <R2><F label="Total Harga" th={th}><input className="inp" type="number" value={instForm.total_amount} onChange={e=>setInstForm(f=>({...f,total_amount:e.target.value}))}/></F><F label="Jumlah Bulan" th={th}><select className="inp" value={instForm.months} onChange={e=>setInstForm(f=>({...f,months:Number(e.target.value)}))}>{[3,6,9,12,18,24,36].map(m=><option key={m} value={m}>{m} bulan</option>)}</select></F></R2>
          {instForm.total_amount&&<div style={{padding:"9px 12px",background:th.acBg,border:`1px solid ${th.ac}44`,borderRadius:9,fontFamily:"'JetBrains Mono',monospace",fontSize:13,color:th.ac,fontWeight:700}}>Cicilan/bulan: {fmtIDR(Math.round(Number(instForm.total_amount)/Number(instForm.months)))}</div>}
          <BtnRow onCancel={()=>setShowInstForm(false)} onOk={submitInst} label={editInstId?"Simpan":"Tambah"} th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Recur Form */}
      {showRecurForm&&<Overlay onClose={()=>setShowRecur2(false)} th={th} title={editRecurId?"✏️ Edit Recurring":"↺ Tambah Recurring"}>
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          <F label="Nama" th={th}><input className="inp" placeholder="Netflix, Spotify..." value={recurForm.description} onChange={e=>setRecurForm(f=>({...f,description:e.target.value}))}/></F>
          <R2><F label="Kartu" th={th}><select className="inp" value={recurForm.card_id} onChange={e=>setRecurForm(f=>({...f,card_id:e.target.value}))}><option value="">Pilih...</option>{cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></F><F label="Entitas" th={th}><select className="inp" value={recurForm.entity} onChange={e=>setRecurForm(f=>({...f,entity:e.target.value}))}>{CC_ENTS.map(e=><option key={e}>{e}</option>)}</select></F></R2>
          <R2>
            <F label="Jumlah" th={th}><div style={{display:"flex",gap:5}}><select className="inp" value={recurForm.currency} onChange={e=>setRecurForm(f=>({...f,currency:e.target.value}))} style={{width:76,flexShrink:0}}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select><input className="inp" type="number" value={recurForm.amount} onChange={e=>setRecurForm(f=>({...f,amount:e.target.value}))}/></div></F>
            <F label="Frekuensi" th={th}><select className="inp" value={recurForm.frequency} onChange={e=>setRecurForm(f=>({...f,frequency:e.target.value}))}>{["Bulanan","Mingguan","Tahunan"].map(f=><option key={f}>{f}</option>)}</select></F>
          </R2>
          <F label="Tanggal" th={th}><input className="inp" type="number" min={1} max={31} value={recurForm.day_of_month} onChange={e=>setRecurForm(f=>({...f,day_of_month:e.target.value}))}/></F>
          <BtnRow onCancel={()=>setShowRecur2(false)} onOk={submitRecur} label={editRecurId?"Simpan":"Tambah"} th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Budget Form */}
      {showBudForm&&<Overlay onClose={()=>setShowBudForm(false)} th={th} title="◎ Edit Target Bulanan">
        <div style={{fontSize:11,color:th.tx3,marginBottom:14}}>Set target pengeluaran CC per entitas bulan ini.</div>
        {ENTITIES.map(e=>(
          <div key={e} style={{marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}><div style={{width:7,height:7,borderRadius:"50%",background:ENT_COL[e]}}/><span style={{fontSize:13,fontWeight:600}}>{e}</span></div>
            <input className="inp" type="number" placeholder="0 = tidak ada limit" value={budForm[e]||""} onChange={e2=>setBudForm(f=>({...f,[e]:Number(e2.target.value)}))}/>
            {budForm[e]>0&&<div style={{fontSize:10,color:ENT_COL[e],marginTop:3}}>{fmtIDR(budForm[e])} / bulan</div>}
          </div>
        ))}
        <BtnRow onCancel={()=>setShowBudForm(false)} onOk={saveBudgets} label="Simpan Target" th={th} saving={saving}/>
      </Overlay>}

      {/* Bank Form */}
      {showBankForm&&<Overlay onClose={()=>setShowBankForm(false)} th={th} title={editBankId?"✏️ Edit Rekening":"🏦 Tambah Rekening"}>
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          <R2><F label="Nama Rekening" th={th}><input className="inp" placeholder="BCA Tahapan Pribadi" value={bankForm.name} onChange={e=>setBankForm(f=>({...f,name:e.target.value}))}/></F><F label="Bank" th={th}><select className="inp" value={bankForm.bank} onChange={e=>setBankForm(f=>({...f,bank:e.target.value}))}>{BANKS_L.map(b=><option key={b}>{b}</option>)}</select></F></R2>
          <R2><F label="No. Rekening" th={th}><input className="inp" placeholder="1234567890" value={bankForm.account_no} onChange={e=>setBankForm(f=>({...f,account_no:e.target.value}))}/></F><F label="Saldo Awal (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={bankForm.initial_balance} onChange={e=>setBankForm(f=>({...f,initial_balance:e.target.value}))}/></F></R2>
          <F label="Jenis Rekening" th={th}>
            <div style={{display:"flex",gap:7}}>
              {[["pribadi","🏠 Pribadi (masuk net worth)"],["reimburse","🔄 Reimburse"]].map(([v,l])=>(
                <button key={v} onClick={()=>setBankForm(f=>({...f,type:v,include_networth:v==="pribadi"}))} style={{flex:1,background:bankForm.type===v?th.acBg:th.sur2,border:`1px solid ${bankForm.type===v?th.ac:th.bor}`,borderRadius:9,padding:"8px",fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:11,cursor:"pointer",color:bankForm.type===v?th.ac:th.tx3}}>{l}</button>
              ))}
            </div>
          </F>
          {bankForm.type==="reimburse"&&<F label="Entitas" th={th}><select className="inp" value={bankForm.owner_entity} onChange={e=>setBankForm(f=>({...f,owner_entity:e.target.value}))}><option value="">Pilih...</option>{["Hamasa","SDC","Travelio"].map(e=><option key={e}>{e}</option>)}</select></F>}
          <R2><F label="Warna Utama" th={th}><input type="color" value={bankForm.color} onChange={e=>setBankForm(f=>({...f,color:e.target.value}))} style={{width:44,height:36,border:"none",borderRadius:8,cursor:"pointer"}}/></F><F label="Warna Aksen" th={th}><input type="color" value={bankForm.accent} onChange={e=>setBankForm(f=>({...f,accent:e.target.value}))} style={{width:44,height:36,border:"none",borderRadius:8,cursor:"pointer"}}/></F></R2>
          <BtnRow onCancel={()=>setShowBankForm(false)} onOk={submitBank} label={editBankId?"Simpan":"Tambah"} th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Mutation Form */}
      {showMutForm&&<Overlay onClose={()=>setShowMutForm(false)} th={th} title={editMutId?"✏️ Edit Mutasi":"➕ Tambah Mutasi Bank"}>
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          {scanResult&&<div style={{padding:"8px 12px",background:th.acBg,border:`1px solid ${th.ac}44`,borderRadius:9,fontSize:11,color:th.ac}}>✨ Data dari AI scan</div>}
          <R2><F label="Tanggal" th={th}><input className="inp" type="date" value={mutForm.mut_date} onChange={e=>setMutForm(f=>({...f,mut_date:e.target.value}))}/></F><F label="Rekening" th={th}><select className="inp" value={mutForm.account_id} onChange={e=>setMutForm(f=>({...f,account_id:e.target.value}))}><option value="">Pilih...</option>{bankAccs.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></F></R2>
          <F label="Keterangan" th={th}><input className="inp" placeholder="Gaji bulan April..." value={mutForm.description} onChange={e=>setMutForm(f=>({...f,description:e.target.value}))}/></F>
          <R2><F label="Jumlah (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={mutForm.amount} onChange={e=>setMutForm(f=>({...f,amount:e.target.value}))}/></F><F label="Tipe" th={th}><select className="inp" value={mutForm.type} onChange={e=>setMutForm(f=>({...f,type:e.target.value}))}><option value="in">↓ Masuk</option><option value="out">↑ Keluar</option><option value="transfer">↔ Transfer</option></select></F></R2>
          <R2><F label="Kategori" th={th}><select className="inp" value={mutForm.category} onChange={e=>setMutForm(f=>({...f,category:e.target.value}))}>{BNK_CATS.map(c=><option key={c}>{c}</option>)}</select></F><F label="Entitas" th={th}><select className="inp" value={mutForm.entity} onChange={e=>setMutForm(f=>({...f,entity:e.target.value}))}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</select></F></R2>
          {mutForm.type==="transfer"&&<><F label="Transfer ke Rekening" th={th}><select className="inp" value={mutForm.transfer_to_account_id} onChange={e=>setMutForm(f=>({...f,transfer_to_account_id:e.target.value}))}><option value="">Pilih...</option>{bankAccs.filter(b=>b.id!==mutForm.account_id).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></F><F label="Biaya Transfer" th={th}><input className="inp" type="number" placeholder="0" value={mutForm.transfer_fee} onChange={e=>setMutForm(f=>({...f,transfer_fee:e.target.value}))}/></F></>}
          <div className="tog-row" onClick={()=>setMutForm(f=>({...f,is_piutang:!f.is_piutang}))} style={{borderColor:mutForm.is_piutang?th.te:th.bor,background:mutForm.is_piutang?th.teBg:th.sur2}}>
            <div className="tog-dot" style={{background:mutForm.is_piutang?th.te:th.bor}}>{mutForm.is_piutang?"✓":""}</div>
            <div><div style={{fontSize:12,color:mutForm.is_piutang?th.te:th.tx3,fontWeight:600}}>Ini adalah piutang reimburse</div><div style={{fontSize:10,color:th.tx3}}>Tidak masuk expense pribadi</div></div>
          </div>
          {mutForm.is_piutang&&<R2><F label="Entitas Piutang" th={th}><select className="inp" value={mutForm.piutang_entity} onChange={e=>setMutForm(f=>({...f,piutang_entity:e.target.value}))}><option value="">Pilih...</option>{["Hamasa","SDC","Travelio"].map(e=><option key={e}>{e}</option>)}</select></F><F label="Keterangan Piutang" th={th}><input className="inp" placeholder="Billing listrik..." value={mutForm.piutang_description} onChange={e=>setMutForm(f=>({...f,piutang_description:e.target.value}))}/></F></R2>}
          <button onClick={()=>{setShowMutForm(false);setScanImg(null);setScanResult(null);setScanError(null);setScanTarget("bank");setShowScanner(true);}} style={{background:th.sur2,border:`1px solid ${th.bor}`,borderRadius:9,padding:"8px",fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:12,cursor:"pointer",color:th.tx3}}>📷 Scan Struk / Nota</button>
          <BtnRow onCancel={()=>setShowMutForm(false)} onOk={submitMut} label={editMutId?"Simpan":"Tambah"} th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Reimb Account Form */}
      {showReimbAcc&&<Overlay onClose={()=>setShowReimbAcc(false)} th={th} title="📋 Tambah Akun Piutang">
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          <div style={{padding:"10px 13px",background:th.acBg,border:`1px solid ${th.ac}44`,borderRadius:9,fontSize:11,color:th.tx2}}>Buat satu akun per entitas (Hamasa, SDC, Travelio) untuk tracking piutang reimburse.</div>
          <F label="Entitas" th={th}><select className="inp" value={reimbAccForm.entity} onChange={e=>setReimbAccForm(f=>({...f,entity:e.target.value}))}>{["Hamasa","SDC","Travelio"].map(e=><option key={e}>{e}</option>)}</select></F>
          <F label="Deskripsi" th={th}><input className="inp" placeholder="Piutang reimburse operasional..." value={reimbAccForm.description} onChange={e=>setReimbAccForm(f=>({...f,description:e.target.value}))}/></F>
          <BtnRow onCancel={()=>setShowReimbAcc(false)} onOk={submitReimbAcc} label="Buat Akun" th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Reimb TX Form */}
      {showReimbTx&&<Overlay onClose={()=>setShowReimbTx(false)} th={th} title="➕ Tambah Transaksi Piutang">
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          <F label="Akun Piutang" th={th}><select className="inp" value={reimbTxForm.account_id} onChange={e=>setReimbTxForm(f=>({...f,account_id:e.target.value}))}><option value="">Pilih akun...</option>{reimbAccs.map(a=><option key={a.id} value={a.id}>{a.entity} — {a.description}</option>)}</select></F>
          <R2><F label="Tanggal" th={th}><input className="inp" type="date" value={reimbTxForm.tx_date} onChange={e=>setReimbTxForm(f=>({...f,tx_date:e.target.value}))}/></F><F label="Tipe" th={th}><select className="inp" value={reimbTxForm.type} onChange={e=>setReimbTxForm(f=>({...f,type:e.target.value}))}><option value="out">Pengeluaran</option><option value="in">Penerimaan</option></select></F></R2>
          <F label="Keterangan" th={th}><input className="inp" placeholder="Billing listrik, makan klien..." value={reimbTxForm.description} onChange={e=>setReimbTxForm(f=>({...f,description:e.target.value}))}/></F>
          <R2><F label="Jumlah (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={reimbTxForm.amount} onChange={e=>setReimbTxForm(f=>({...f,amount:e.target.value}))}/></F><F label="Sumber" th={th}><select className="inp" value={reimbTxForm.source} onChange={e=>setReimbTxForm(f=>({...f,source:e.target.value}))}><option value="cc">Via CC</option><option value="bank">Via Bank</option></select></F></R2>
          <F label="Catatan" th={th}><input className="inp" placeholder="Opsional..." value={reimbTxForm.notes} onChange={e=>setReimbTxForm(f=>({...f,notes:e.target.value}))}/></F>
          <BtnRow onCancel={()=>setShowReimbTx(false)} onOk={submitReimbTx} label="Tambah" th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* PDF Upload Mutasi */}
      {showPdfUpload&&<Overlay onClose={()=>{setShowPdfUpload(false);setPdfRows([]);setPdfError(null);}} th={th} title="📄 Upload PDF Mutasi Bank" sub="Ekstrak transaksi otomatis dari rekening koran">
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <F label="Rekening Tujuan" th={th}>
            <select className="inp" value={pdfBankId} onChange={e=>setPdfBankId(e.target.value)}>
              <option value="">Pilih rekening...</option>
              {bankAccs.map(b=><option key={b.id} value={b.id}>{b.name} ({b.bank})</option>)}
            </select>
          </F>
          {pdfRows.length===0&&!pdfLoading&&<>
            <div onClick={()=>pdfRef.current?.click()} style={{border:`2px dashed ${th.bor}`,borderRadius:14,padding:"32px 20px",textAlign:"center",cursor:"pointer",background:th.sur2,transition:"all .2s"}}>
              <div style={{fontSize:32,marginBottom:8}}>📄</div>
              <div style={{fontSize:13,fontWeight:600,color:th.tx2}}>Klik untuk upload PDF</div>
              <div style={{fontSize:11,color:th.tx3,marginTop:3}}>Rekening koran / bank statement · PDF</div>
            </div>
            <input ref={pdfRef} type="file" accept="application/pdf" style={{display:"none"}} onChange={handlePdfFile}/>
          </>}
          {pdfLoading&&<div style={{display:"flex",alignItems:"center",gap:10,padding:"16px",background:th.acBg,border:`1px solid ${th.ac}44`,borderRadius:12}}>
            <div style={{width:22,height:22,border:`2px solid ${th.ac}44`,borderTop:`2px solid ${th.ac}`,borderRadius:"50%",animation:"spin .7s linear infinite",flexShrink:0}}/>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:th.ac}}>AI sedang membaca PDF...</div>
              <div style={{fontSize:10,color:th.tx3,marginTop:2}}>Ini mungkin membutuhkan 10–30 detik</div>
            </div>
          </div>}
          {pdfError&&<div style={{padding:"10px 13px",background:th.rdBg,border:`1px solid ${th.rd}44`,borderRadius:10,fontSize:12,color:th.rd}}>⚠️ {pdfError}</div>}
          {pdfRows.length>0&&<>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:12,fontWeight:700,color:th.tx}}>{pdfRows.length} transaksi ditemukan · {Object.values(pdfSelRows).filter(Boolean).length} dipilih</div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>{const s={};pdfRows.forEach((_,i)=>{s[i]=true;});setPdfSelRows(s);}} style={{background:"none",border:`1px solid ${th.ac}`,color:th.ac,borderRadius:7,padding:"4px 9px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'Sora',sans-serif"}}>Pilih Semua</button>
                <button onClick={()=>setPdfSelRows({})} style={{background:"none",border:`1px solid ${th.bor}`,color:th.tx3,borderRadius:7,padding:"4px 9px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'Sora',sans-serif"}}>Batal Semua</button>
              </div>
            </div>
            <div style={{maxHeight:320,overflowY:"auto",border:`1px solid ${th.bor}`,borderRadius:12}}>
              {pdfRows.map((row,i)=>(
                <div key={i} onClick={()=>setPdfSelRows(s=>({...s,[i]:!s[i]}))} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 13px",borderBottom:i<pdfRows.length-1?`1px solid ${th.bor}`:"none",cursor:"pointer",background:pdfSelRows[i]?(row.type==="in"?th.grBg:th.rdBg):"transparent",transition:"background .1s"}}>
                  <div style={{width:18,height:18,borderRadius:5,border:`2px solid ${pdfSelRows[i]?th.ac:th.bor}`,background:pdfSelRows[i]?th.ac:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:"white",fontSize:11}}>{pdfSelRows[i]?"✓":""}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{row.description}</div>
                    <div style={{fontSize:10,color:th.tx3,marginTop:2}}>{row.date}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,color:row.type==="in"?th.gr:th.rd}}>{row.type==="in"?"+":"-"}{fmtIDR(Number(row.amount||0),true)}</div>
                    {row.balance!=null&&<div style={{fontSize:9,color:th.tx3}}>Saldo: {fmtIDR(row.balance,true)}</div>}
                  </div>
                </div>
              ))}
            </div>
            <div style={{padding:"10px 13px",background:th.sur2,border:`1px solid ${th.bor}`,borderRadius:10,display:"flex",justifyContent:"space-between",fontSize:12}}>
              <span style={{color:th.tx3}}>Total masuk</span>
              <span style={{color:th.gr,fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{fmtIDR(pdfRows.filter((_,i)=>pdfSelRows[i]&&pdfRows[i].type==="in").reduce((s,r)=>s+Number(r.amount||0),0),true)}</span>
            </div>
            <BtnRow onCancel={()=>{setShowPdfUpload(false);setPdfRows([]);setPdfError(null);}} onOk={importPdfRows} label={`Import ${Object.values(pdfSelRows).filter(Boolean).length} Transaksi`} th={th} saving={saving} disabled={!pdfBankId||Object.values(pdfSelRows).filter(Boolean).length===0}/>
          </>}
          {pdfRows.length===0&&!pdfLoading&&<button onClick={()=>setShowPdfUpload(false)} style={{padding:"10px",borderRadius:9,border:`1px solid ${th.bor}`,background:th.sur2,color:th.tx3,fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:13,cursor:"pointer"}}>Batal</button>}
        </div>
      </Overlay>}

      {/* Settle Piutang */}
      {showSettlePiu&&<Overlay onClose={()=>setShowSettlePiu(false)} th={th} title="✓ Settle Piutang">
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          {selectedReimbTx&&<div style={{padding:"10px 13px",background:th.grBg,border:`1px solid ${th.gr}44`,borderRadius:9}}>
            <div style={{fontSize:11,color:th.gr,fontWeight:700,marginBottom:4}}>{selectedReimbTx.description}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:800,color:th.gr}}>{fmtIDR(Number(selectedReimbTx.amount))}</div>
          </div>}
          <F label="Tanggal Settle" th={th}><input className="inp" type="date" value={settlePiu.date} onChange={e=>setSettlePiu(p=>({...p,date:e.target.value}))}/></F>
          <F label="Diterima di Rekening" th={th}><select className="inp" value={settlePiu.bankId} onChange={e=>setSettlePiu(p=>({...p,bankId:e.target.value}))}><option value="">Pilih rekening...</option>{bankAccs.map(b=><option key={b.id} value={b.id}>{b.name} — {fmtIDR(bankBal[b.id]||0,true)}</option>)}</select></F>
          <BtnRow onCancel={()=>setShowSettlePiu(false)} onOk={settleReimbTx} label="✓ Tandai Settled" th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Loan Form */}
      {showLoanForm&&<Overlay onClose={()=>setShowLoanForm(false)} th={th} title={editLoanId?"✏️ Edit Piutang Karyawan":"👤 Tambah Piutang Karyawan"}>
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          <R2><F label="Nama Karyawan" th={th}><input className="inp" placeholder="Nama..." value={loanForm.employee_name} onChange={e=>setLoanForm(f=>({...f,employee_name:e.target.value}))}/></F><F label="Departemen" th={th}><input className="inp" placeholder="Ops, Finance..." value={loanForm.employee_dept} onChange={e=>setLoanForm(f=>({...f,employee_dept:e.target.value}))}/></F></R2>
          <R2><F label="Total Pinjaman (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={loanForm.total_amount} onChange={e=>setLoanForm(f=>({...f,total_amount:e.target.value}))}/></F><F label="Cicilan/Bulan (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={loanForm.monthly_installment} onChange={e=>setLoanForm(f=>({...f,monthly_installment:e.target.value}))}/></F></R2>
          <F label="Tanggal Mulai" th={th}><input className="inp" type="date" value={loanForm.start_date} onChange={e=>setLoanForm(f=>({...f,start_date:e.target.value}))}/></F>
          {loanForm.total_amount&&loanForm.monthly_installment&&<div style={{padding:"9px 12px",background:th.acBg,border:`1px solid ${th.ac}44`,borderRadius:9,fontSize:12,color:th.ac,fontWeight:700}}>Estimasi: {Math.ceil(Number(loanForm.total_amount)/Number(loanForm.monthly_installment))} bulan</div>}
          <BtnRow onCancel={()=>setShowLoanForm(false)} onOk={submitLoan} label={editLoanId?"Simpan":"Tambah"} th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Pay Loan */}
      {showPayLoan&&<Overlay onClose={()=>setShowPayLoan(false)} th={th} title="💰 Catat Pembayaran Karyawan">
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          {selectedLoan&&<div style={{padding:"10px 13px",background:th.acBg,border:`1px solid ${th.ac}44`,borderRadius:9}}>
            <div style={{fontSize:11,color:th.ac,fontWeight:700,marginBottom:2}}>{selectedLoan.employee_name}</div>
            <div style={{fontSize:12,color:th.tx2}}>Sisa: <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:th.rd}}>{fmtIDR(selectedLoan.remaining)}</span></div>
          </div>}
          <R2><F label="Tanggal Bayar" th={th}><input className="inp" type="date" value={loanPay.date} onChange={e=>setLoanPay(p=>({...p,date:e.target.value}))}/></F><F label="Jumlah (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={loanPay.amount} onChange={e=>setLoanPay(p=>({...p,amount:e.target.value}))}/></F></R2>
          <F label="Catatan" th={th}><input className="inp" placeholder="Opsional..." value={loanPay.notes} onChange={e=>setLoanPay(p=>({...p,notes:e.target.value}))}/></F>
          <BtnRow onCancel={()=>setShowPayLoan(false)} onOk={submitLoanPay} label="Catat Pembayaran" th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Asset Form */}
      {showAssetForm&&<Overlay onClose={()=>setShowAssetForm(false)} th={th} title={editAssetId?"✏️ Edit Aset":"📈 Tambah Aset"}>
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          <R2>
            <F label="Nama Aset" th={th}><input className="inp" placeholder="Rumah Cipete, BBCA 100 lot..." value={assetForm.name} onChange={e=>setAssetForm(f=>({...f,name:e.target.value}))}/></F>
            <F label="Kategori" th={th}><select className="inp" value={assetForm.category} onChange={e=>setAssetForm(f=>({...f,category:e.target.value}))}>{ASSET_CATS.map(c=><option key={c}>{c}</option>)}</select></F>
          </R2>
          <R2>
            <F label="Nilai Sekarang (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={assetForm.current_value} onChange={e=>setAssetForm(f=>({...f,current_value:e.target.value}))}/></F>
            <F label="Nilai Beli (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={assetForm.purchase_value} onChange={e=>setAssetForm(f=>({...f,purchase_value:e.target.value}))}/></F>
          </R2>
          <R2>
            <F label="Tanggal Beli" th={th}><input className="inp" type="date" value={assetForm.purchase_date} onChange={e=>setAssetForm(f=>({...f,purchase_date:e.target.value}))}/></F>
            <F label="Mata Uang" th={th}><select className="inp" value={assetForm.currency} onChange={e=>setAssetForm(f=>({...f,currency:e.target.value}))}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select></F>
          </R2>
          {assetForm.category==="Deposito"&&<F label="Link Rekening Bank (Opsional)" th={th}><select className="inp" value={assetForm.linked_bank_id} onChange={e=>setAssetForm(f=>({...f,linked_bank_id:e.target.value}))}><option value="">— Tidak di-link —</option>{bankAccs.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></F>}
          <F label="Catatan" th={th}><input className="inp" placeholder="Detail, lokasi, ticker symbol..." value={assetForm.notes} onChange={e=>setAssetForm(f=>({...f,notes:e.target.value}))}/></F>
          {assetForm.current_value&&assetForm.purchase_value&&(
            <div style={{padding:"8px 12px",background:Number(assetForm.current_value)>=Number(assetForm.purchase_value)?th.grBg:th.rdBg,border:`1px solid ${Number(assetForm.current_value)>=Number(assetForm.purchase_value)?th.gr:th.rd}44`,borderRadius:9,fontSize:12,fontWeight:700,color:Number(assetForm.current_value)>=Number(assetForm.purchase_value)?th.gr:th.rd}}>
              {Number(assetForm.current_value)>=Number(assetForm.purchase_value)?"▲":"▼"} {Math.abs(((Number(assetForm.current_value)-Number(assetForm.purchase_value))/Number(assetForm.purchase_value))*100).toFixed(1)}% dari harga beli · {fmtIDR(Number(assetForm.current_value)-Number(assetForm.purchase_value),true)}
            </div>
          )}
          {!editAssetId&&<button onClick={()=>{setShowAssetForm(false);setScanImg(null);setScanResult(null);setScanError(null);setScanTarget("asset");setShowScanner(true);}} style={{background:th.sur2,border:`1px solid ${th.bor}`,borderRadius:9,padding:"8px",fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:12,cursor:"pointer",color:th.tx3}}>📷 Scan Nota Pembelian</button>}
          <BtnRow onCancel={()=>setShowAssetForm(false)} onOk={submitAsset} label={editAssetId?"Simpan":"Tambah Aset"} th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Liability Form */}
      {showLiabForm&&<Overlay onClose={()=>setShowLiabForm(false)} th={th} title={editLiabId?"✏️ Edit Liabilitas":"📉 Tambah Liabilitas"}>
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          <R2>
            <F label="Nama" th={th}><input className="inp" placeholder="KPR Cipete, Kredit Mobil..." value={liabForm.name} onChange={e=>setLiabForm(f=>({...f,name:e.target.value}))}/></F>
            <F label="Kategori" th={th}><select className="inp" value={liabForm.category} onChange={e=>setLiabForm(f=>({...f,category:e.target.value}))}>{LIAB_CATS.map(c=><option key={c}>{c}</option>)}</select></F>
          </R2>
          <R2>
            <F label="Sisa Hutang (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={liabForm.outstanding} onChange={e=>setLiabForm(f=>({...f,outstanding:e.target.value}))}/></F>
            <F label="Total Awal (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={liabForm.original_amount} onChange={e=>setLiabForm(f=>({...f,original_amount:e.target.value}))}/></F>
          </R2>
          <R2>
            <F label="Cicilan/Bulan (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={liabForm.monthly_payment} onChange={e=>setLiabForm(f=>({...f,monthly_payment:e.target.value}))}/></F>
            <F label="Bunga (% p.a.)" th={th}><input className="inp" type="number" placeholder="0" step="0.1" value={liabForm.interest_rate} onChange={e=>setLiabForm(f=>({...f,interest_rate:e.target.value}))}/></F>
          </R2>
          <R2>
            <F label="Tanggal Mulai" th={th}><input className="inp" type="date" value={liabForm.start_date} onChange={e=>setLiabForm(f=>({...f,start_date:e.target.value}))}/></F>
            <F label="Tanggal Selesai" th={th}><input className="inp" type="date" value={liabForm.end_date} onChange={e=>setLiabForm(f=>({...f,end_date:e.target.value}))}/></F>
          </R2>
          {liabForm.outstanding&&liabForm.original_amount&&<div style={{padding:"8px 12px",background:th.rdBg,border:`1px solid ${th.rd}44`,borderRadius:9,fontSize:12,color:th.rd,fontWeight:700}}>Sudah dibayar: {fmtIDR(Number(liabForm.original_amount)-Number(liabForm.outstanding),true)} ({((1-Number(liabForm.outstanding)/Number(liabForm.original_amount))*100).toFixed(0)}%)</div>}
          <F label="Catatan" th={th}><input className="inp" placeholder="Bank pemberi, nomor akun..." value={liabForm.notes} onChange={e=>setLiabForm(f=>({...f,notes:e.target.value}))}/></F>
          <BtnRow onCancel={()=>setShowLiabForm(false)} onOk={submitLiab} label={editLiabId?"Simpan":"Tambah Liabilitas"} th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Income Form */}
      {showIncomeForm&&<Overlay onClose={()=>setShowIncomeForm(false)} th={th} title={editIncomeId?"✏️ Edit Income":"💰 Tambah Income"}>
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          <R2>
            <F label="Tanggal" th={th}><input className="inp" type="date" value={incomeForm.income_date} onChange={e=>setIncomeForm(f=>({...f,income_date:e.target.value}))}/></F>
            <F label="Kategori" th={th}><select className="inp" value={incomeForm.category} onChange={e=>setIncomeForm(f=>({...f,category:e.target.value}))}>{INCOME_CATS.map(c=><option key={c}>{c}</option>)}</select></F>
          </R2>
          <F label="Keterangan" th={th}><input className="inp" placeholder="Gaji April, Dividen BBCA..." value={incomeForm.description} onChange={e=>setIncomeForm(f=>({...f,description:e.target.value}))}/></F>
          <R2>
            <F label="Jumlah" th={th}>
              <div style={{display:"flex",gap:5}}>
                <select className="inp" value={incomeForm.currency} onChange={e=>setIncomeForm(f=>({...f,currency:e.target.value}))} style={{width:80,flexShrink:0}}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select>
                <input className="inp" type="number" placeholder="0" value={incomeForm.amount} onChange={e=>setIncomeForm(f=>({...f,amount:e.target.value}))}/>
              </div>
              {incomeForm.currency!=="IDR"&&incomeForm.amount&&<div style={{fontSize:10,color:th.tx3,marginTop:3}}>≈ {fmtIDR(toIDR(Number(incomeForm.amount),incomeForm.currency,fxRates))}</div>}
            </F>
            <F label="Entitas" th={th}><select className="inp" value={incomeForm.entity} onChange={e=>setIncomeForm(f=>({...f,entity:e.target.value}))}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</select></F>
          </R2>
          <F label="Masuk ke Rekening (Opsional)" th={th}><select className="inp" value={incomeForm.bank_account_id} onChange={e=>setIncomeForm(f=>({...f,bank_account_id:e.target.value}))}><option value="">— Tidak di-link —</option>{bankAccs.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></F>
          <div className="tog-row" onClick={()=>setIncomeForm(f=>({...f,is_recurring:!f.is_recurring}))} style={{borderColor:incomeForm.is_recurring?th.gr:th.bor,background:incomeForm.is_recurring?th.grBg:th.sur2}}>
            <div className="tog-dot" style={{background:incomeForm.is_recurring?th.gr:th.bor}}>{incomeForm.is_recurring?"✓":""}</div>
            <div><div style={{fontSize:12,color:incomeForm.is_recurring?th.gr:th.tx3,fontWeight:600}}>Income Rutin / Recurring</div><div style={{fontSize:10,color:th.tx3}}>Masuk ke proyeksi bulanan</div></div>
          </div>
          {incomeForm.is_recurring&&<F label="Frekuensi" th={th}><select className="inp" value={incomeForm.recur_frequency} onChange={e=>setIncomeForm(f=>({...f,recur_frequency:e.target.value}))}>{["Bulanan","Mingguan","Tahunan"].map(f=><option key={f}>{f}</option>)}</select></F>}
          <F label="Catatan" th={th}><input className="inp" placeholder="Opsional..." value={incomeForm.notes} onChange={e=>setIncomeForm(f=>({...f,notes:e.target.value}))}/></F>
          <BtnRow onCancel={()=>setShowIncomeForm(false)} onOk={submitIncome} label={editIncomeId?"Simpan":"Tambah Income"} th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Universal TX Form */}
      {showUniTxForm&&<Overlay onClose={()=>setShowUniTxForm(false)} th={th} title="🔄 Tambah Transaksi">
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          {/* Tipe */}
          <F label="Tipe Transaksi" th={th}>
            <div style={{display:"flex",gap:6}}>
              {[["out","↑ Keluar",th.rd,th.rdBg],["in","↓ Masuk",th.gr,th.grBg],["transfer","↔ Transfer",th.ac,th.acBg]].map(([v,l,col,bg])=>(
                <button key={v} onClick={()=>setUniTxForm(f=>({...f,type:v}))} style={{flex:1,padding:"8px 4px",borderRadius:9,border:`1px solid ${uniTxForm.type===v?col:th.bor}`,background:uniTxForm.type===v?bg:th.sur2,fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:11,cursor:"pointer",color:uniTxForm.type===v?col:th.tx3}}>{l}</button>
              ))}
            </div>
          </F>
          <R2>
            <F label="Tanggal" th={th}><input className="inp" type="date" value={uniTxForm.tx_date} onChange={e=>setUniTxForm(f=>({...f,tx_date:e.target.value}))}/></F>
            <F label="Entitas" th={th}><select className="inp" value={uniTxForm.entity} onChange={e=>setUniTxForm(f=>({...f,entity:e.target.value}))}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</select></F>
          </R2>
          <F label="Keterangan" th={th}><input className="inp" placeholder="Makan siang, transfer, gaji..." value={uniTxForm.description} onChange={e=>setUniTxForm(f=>({...f,description:e.target.value}))}/></F>
          <R2>
            <F label="Jumlah" th={th}>
              <div style={{display:"flex",gap:5}}>
                <select className="inp" value={uniTxForm.currency} onChange={e=>setUniTxForm(f=>({...f,currency:e.target.value}))} style={{width:80,flexShrink:0}}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select>
                <input className="inp" type="number" placeholder="0" value={uniTxForm.amount} onChange={e=>setUniTxForm(f=>({...f,amount:e.target.value}))}/>
              </div>
              {uniTxForm.currency!=="IDR"&&uniTxForm.amount&&<div style={{fontSize:10,color:th.tx3,marginTop:3}}>≈ {fmtIDR(toIDR(Number(uniTxForm.amount),uniTxForm.currency,fxRates))}</div>}
            </F>
            <F label="Kategori" th={th}><select className="inp" value={uniTxForm.category} onChange={e=>setUniTxForm(f=>({...f,category:e.target.value}))}>{[...BNK_CATS,...CC_CATS.filter(c=>!BNK_CATS.includes(c))].map(c=><option key={c}>{c}</option>)}</select></F>
          </R2>
          {/* Dari (Source) */}
          <F label="Dari (Sumber)" th={th}>
            <div style={{display:"flex",gap:6,marginBottom:6}}>
              {[["bank","🏦 Bank"],["cc","💳 CC"]].map(([v,l])=>(
                <button key={v} onClick={()=>setUniTxForm(f=>({...f,source_type:v,source_id:""}))} style={{flex:1,padding:"6px",borderRadius:8,border:`1px solid ${uniTxForm.source_type===v?th.ac:th.bor}`,background:uniTxForm.source_type===v?th.acBg:th.sur2,fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:11,cursor:"pointer",color:uniTxForm.source_type===v?th.ac:th.tx3}}>{l}</button>
              ))}
            </div>
            <select className="inp" value={uniTxForm.source_id} onChange={e=>setUniTxForm(f=>({...f,source_id:e.target.value}))}>
              <option value="">Pilih...</option>
              {uniTxForm.source_type==="bank"?bankAccs.map(b=><option key={b.id} value={b.id}>{b.name} — {fmtIDR(bankBal[b.id]||0,true)}</option>):cards.map(c=><option key={c.id} value={c.id}>{c.name} ···· {c.last4}</option>)}
            </select>
          </F>
          {/* Ke (Destination) — hanya kalau Transfer */}
          {uniTxForm.type==="transfer"&&<F label="Ke (Tujuan)" th={th}>
            <div style={{display:"flex",gap:6,marginBottom:6}}>
              {[["bank","🏦 Bank"],["cc","💳 Bayar CC"]].map(([v,l])=>(
                <button key={v} onClick={()=>setUniTxForm(f=>({...f,dest_type:v,dest_id:""}))} style={{flex:1,padding:"6px",borderRadius:8,border:`1px solid ${uniTxForm.dest_type===v?th.te:th.bor}`,background:uniTxForm.dest_type===v?th.teBg:th.sur2,fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:11,cursor:"pointer",color:uniTxForm.dest_type===v?th.te:th.tx3}}>{l}</button>
              ))}
            </div>
            <select className="inp" value={uniTxForm.dest_id} onChange={e=>setUniTxForm(f=>({...f,dest_id:e.target.value}))}>
              <option value="">Pilih...</option>
              {uniTxForm.dest_type==="bank"?bankAccs.filter(b=>b.id!==uniTxForm.source_id).map(b=><option key={b.id} value={b.id}>{b.name}</option>):cards.map(c=><option key={c.id} value={c.id}>{c.name} — Tagihan: {fmtIDR(ccStats.cardStats.find(x=>x.id===c.id)?.spent||0,true)}</option>)}
            </select>
          </F>}
          <div className="tog-row" onClick={()=>setUniTxForm(f=>({...f,is_reimb:!f.is_reimb}))} style={{borderColor:uniTxForm.is_reimb?th.te:th.bor,background:uniTxForm.is_reimb?th.teBg:th.sur2}}>
            <div className="tog-dot" style={{background:uniTxForm.is_reimb?th.te:th.bor}}>{uniTxForm.is_reimb?"✓":""}</div>
            <div><div style={{fontSize:12,color:uniTxForm.is_reimb?th.te:th.tx3,fontWeight:600}}>Ini piutang reimburse</div><div style={{fontSize:10,color:th.tx3}}>Tidak masuk expense pribadi</div></div>
          </div>
          <F label="Catatan" th={th}><input className="inp" placeholder="Opsional..." value={uniTxForm.notes} onChange={e=>setUniTxForm(f=>({...f,notes:e.target.value}))}/></F>
          <BtnRow onCancel={()=>setShowUniTxForm(false)} onOk={submitUniTx} label="Simpan" th={th} saving={saving}/>
        </div>
      </Overlay>}

      {/* Update Asset Value */}
      {showUpdateVal&&<Overlay onClose={()=>{setShowUpdateVal(false);setAiValResult(null);}} th={th} title="✏️ Update Nilai Aset" sub={selectedAsset?.name}>
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          {selectedAsset&&<div style={{padding:"10px 13px",background:th.sur2,border:`1px solid ${th.bor}`,borderRadius:9}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:11,color:th.tx3}}>Nilai Saat Ini</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:15,fontWeight:800}}>{fmtIDR(Number(selectedAsset.current_value||0))}</div>
              </div>
              <Tag bg={ASSET_BG[selectedAsset.category]||th.sur3} color={ASSET_COL[selectedAsset.category]||th.ac}>{ASSET_ICON[selectedAsset.category]} {selectedAsset.category}</Tag>
            </div>
          </div>}

          {/* AI Valuation Button */}
          <button onClick={runAIValuation} disabled={aiValLoading} style={{width:"100%",padding:"10px",borderRadius:9,border:`1px solid ${th.te}`,background:th.teBg,color:th.te,fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",opacity:aiValLoading?.7:1,transition:"all .2s"}}>
            {aiValLoading?"🔄 AI sedang mengestimasi...":"✨ Estimasi Nilai dengan AI"}
          </button>

          {aiValResult&&!aiValResult.error&&<div style={{padding:"12px 14px",background:th.acBg,border:`1px solid ${th.ac}44`,borderRadius:10}}>
            <div style={{fontSize:10,color:th.ac,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>✨ Estimasi AI</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:800,color:th.ac}}>{fmtIDR(aiValResult.estimated_value)}</div>
                <div style={{fontSize:10,color:th.tx3,marginTop:2}}>Confidence: <span style={{fontWeight:700,color:aiValResult.confidence==="high"?th.gr:aiValResult.confidence==="medium"?th.am:th.rd}}>{aiValResult.confidence}</span></div>
              </div>
              <button onClick={()=>setUpdateValForm(f=>({...f,value:String(aiValResult.estimated_value)}))} style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${th.ac}`,background:"transparent",color:th.ac,fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:11,cursor:"pointer"}}>Pakai Nilai Ini →</button>
            </div>
            <div style={{fontSize:11,color:th.tx2,lineHeight:1.5}}>{aiValResult.reasoning}</div>
          </div>}
          {aiValResult?.error&&<div style={{padding:"9px 12px",background:th.rdBg,border:`1px solid ${th.rd}44`,borderRadius:9,fontSize:12,color:th.rd}}>{aiValResult.error}</div>}

          <R2>
            <F label="Nilai Baru (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={updateValForm.value} onChange={e=>setUpdateValForm(f=>({...f,value:e.target.value}))}/></F>
            <F label="Tanggal" th={th}><input className="inp" type="date" value={updateValForm.date} onChange={e=>setUpdateValForm(f=>({...f,date:e.target.value}))}/></F>
          </R2>
          <F label="Catatan (Opsional)" th={th}><input className="inp" placeholder="Sumber harga, keterangan..." value={updateValForm.notes} onChange={e=>setUpdateValForm(f=>({...f,notes:e.target.value}))}/></F>
          {updateValForm.value&&selectedAsset&&(
            <div style={{padding:"8px 12px",background:Number(updateValForm.value)>=Number(selectedAsset.current_value)?th.grBg:th.rdBg,border:`1px solid ${Number(updateValForm.value)>=Number(selectedAsset.current_value)?th.gr:th.rd}44`,borderRadius:9,fontSize:12,fontWeight:700,color:Number(updateValForm.value)>=Number(selectedAsset.current_value)?th.gr:th.rd}}>
              Perubahan: {Number(updateValForm.value)>=Number(selectedAsset.current_value)?"▲":"▼"} {fmtIDR(Math.abs(Number(updateValForm.value)-Number(selectedAsset.current_value||0)),true)}
            </div>
          )}
          <BtnRow onCancel={()=>{setShowUpdateVal(false);setAiValResult(null);}} onOk={submitUpdateVal} label="Simpan Nilai" th={th} saving={saving} disabled={!updateValForm.value}/>
        </div>
      </Overlay>}
    </div>
  );
}

// ─── SHARED COMPONENTS ────────────────────────────────────────
const Overlay = ({children,onClose,title,sub,th})=>(
  <div style={{position:"fixed",inset:0,background:"rgba(15,17,23,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:14,overflow:"auto",backdropFilter:"blur(6px)"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:th.sur,border:`1px solid ${th.bor}`,borderRadius:20,padding:22,width:"100%",maxWidth:460,maxHeight:"90vh",overflowY:"auto",boxShadow:th.sh2}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <div>
          <div style={{fontWeight:800,fontSize:16}}>{title}</div>
          {sub&&<div style={{fontSize:11,color:th.tx3,marginTop:2}}>{sub}</div>}
        </div>
        <button onClick={onClose} style={{width:28,height:28,borderRadius:8,border:`1px solid ${th.bor}`,background:th.sur2,cursor:"pointer",fontSize:12,color:th.tx3,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

const Tag = ({children,bg,color})=>(
  <span style={{display:"inline-block",padding:"2px 7px",borderRadius:20,fontSize:9,fontWeight:600,background:bg,color:color,whiteSpace:"nowrap"}}>{children}</span>
);

const F = ({label,children,th})=>(
  <div style={{flex:1}}>
    <div style={{fontSize:9,fontWeight:700,color:th.tx3,letterSpacing:.8,textTransform:"uppercase",marginBottom:5}}>{label}</div>
    {children}
  </div>
);

const R2 = ({children})=><div style={{display:"flex",gap:10}}>{children}</div>;

const BtnRow = ({onCancel,onOk,label,th,saving,disabled})=>(
  <div style={{display:"flex",gap:10,marginTop:6}}>
    <button onClick={onCancel} style={{flex:1,padding:"10px",borderRadius:9,fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:12,cursor:"pointer",background:th.sur2,border:`1px solid ${th.bor}`,color:th.tx3}}>Batal</button>
    <button onClick={onOk} disabled={saving||disabled} style={{flex:2,background:`linear-gradient(135deg,${th.ac},${th.pu})`,color:"white",border:"none",padding:"10px",borderRadius:9,fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:13,cursor:"pointer",opacity:(saving||disabled)?.6:1}}>{saving?"Menyimpan...":label}</button>
  </div>
);

const Empty = ({icon,msg,th,onAdd})=>(
  <div style={{textAlign:"center",padding:"36px 20px"}}>
    <div style={{fontSize:34,marginBottom:8}}>{icon}</div>
    <div style={{fontSize:13,color:th.tx3,marginBottom:14}}>{msg}</div>
    {onAdd&&<button onClick={onAdd} style={{background:`linear-gradient(135deg,#3b5bdb,#7048e8)`,color:"white",border:"none",padding:"8px 18px",borderRadius:9,fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer"}}>Tambah Sekarang</button>}
  </div>
);

// ─── CSS ──────────────────────────────────────────────────────
const GCS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(0,0,0,.1);border-radius:2px}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes spin{to{transform:rotate(360deg)}}
.anim{animation:fadeUp .28s cubic-bezier(.22,1,.36,1) both}
.sidebar{width:208px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;justify-content:space-between;flex-shrink:0;overflow-y:auto;transition:background .3s}
.brand{padding:16px 14px 12px;display:flex;align-items:center;gap:9px}
.brand-logo{width:32px;height:32px;background:linear-gradient(135deg,#3b5bdb,#7048e8);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
.brand-name{font-weight:700;font-size:12px;letter-spacing:-.2px}
.brand-sub{font-size:9px;margin-top:1px}
.nav-sec{padding:10px 14px 3px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px}
.nb{display:flex;align-items:center;gap:8px;padding:8px 10px;border:none;background:transparent;font-family:'Sora',sans-serif;font-size:12px;font-weight:500;cursor:pointer;border-radius:9px;margin:1px 6px;width:calc(100% - 12px);transition:all .15s;text-align:left}
.nb-ic{width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;transition:all .15s}
.n-badge{font-size:9px;font-weight:700;padding:1px 6px;border-radius:20px;margin-left:auto;color:#fff}
.n-soon{font-size:9px;font-weight:600;padding:1px 5px;border-radius:4px;margin-left:auto}
.sidebar-footer{padding:10px 8px;margin-top:auto}
.fb{display:flex;align-items:center;gap:7px;width:100%;padding:7px 10px;border:none;background:transparent;font-family:'Sora',sans-serif;font-size:11px;font-weight:500;cursor:pointer;border-radius:7px;margin-bottom:2px;transition:all .15s}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.topbar{padding:13px 20px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:40;flex-shrink:0;backdrop-filter:blur(20px);gap:10px;flex-wrap:wrap;transition:background .3s}
.page-title{font-weight:800;font-size:17px;letter-spacing:-.3px}
.page-date{font-size:10px;margin-top:1px}
.content{max-width:740px;width:100%;padding:18px 20px;overflow-y:auto;flex:1}
.card{border-radius:14px;padding:14px 16px;transition:background .15s}
.card-hover:hover{transform:translateY(-1px);box-shadow:0 4px 20px rgba(0,0,0,.1)}
.hero-card{border-radius:20px;padding:20px 22px;color:#fff;background:linear-gradient(135deg,#3b5bdb,#7048e8);margin-bottom:14px;position:relative;overflow:hidden}
.hero-card::before{content:'';position:absolute;top:-30px;right:-30px;width:130px;height:130px;border-radius:50%;background:rgba(255,255,255,.07)}
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
.stat-card{border-radius:12px;padding:12px 13px}
.budget-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
.prog-wrap{height:4px;border-radius:3px;overflow:hidden;margin:5px 0}
.prog{height:100%;border-radius:3px;transition:width .5s}
.sec-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.sec-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px}
.sec-link{font-size:10px;font-weight:600;background:none;border:none;cursor:pointer;font-family:'Sora',sans-serif}
.alert-bar{display:flex;align-items:center;gap:10px;padding:9px 13px;border-radius:10px;margin-bottom:7px;border:1px solid;font-size:12px;font-weight:600}
.alert-danger{background:#fff5f5;border-color:#ffc9c9;color:#e03131}
.alert-warn{background:#fff9db;border-color:#ffe066;color:#e67700}
.alert-info{background:#e3fafc;border-color:#99e9f2;color:#0c8599}
.subtabs{display:flex;gap:2px;border-radius:10px;padding:3px;margin-bottom:14px;border:1px solid}
.stab{flex:1;padding:6px 3px;border:none;background:transparent;font-family:'Sora',sans-serif;font-size:10px;font-weight:600;cursor:pointer;border-radius:8px;transition:all .15s;white-space:nowrap}
.tx-row{display:flex;align-items:flex-start;gap:10px;padding:11px 0;border-bottom:1px solid}
.tx-row:last-child{border-bottom:none!important}
.tx-ic{width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.tag-row{display:flex;gap:3px;flex-wrap:wrap;margin-top:4px}
.act-row{display:flex;gap:4px;justify-content:flex-end}
.act-btn{border:1px solid;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:500;cursor:pointer;font-family:'Sora',sans-serif;background:transparent;white-space:nowrap}
.reimb-btn{border:1px solid;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;white-space:nowrap}
.cc-card{border-radius:17px;padding:18px;color:#fff;margin-bottom:12px;position:relative;overflow:hidden}
.cc-card::before{content:'';position:absolute;top:-25px;right:-25px;width:110px;height:110px;border-radius:50%;background:rgba(255,255,255,.07)}
.bank-card{border-radius:16px;padding:17px;color:#fff;position:relative;overflow:hidden}
.inp{border:1px solid;color:inherit;padding:8px 11px;border-radius:9px;font-family:'Sora',sans-serif;font-size:12px;width:100%;outline:none;transition:border-color .15s;background:transparent}
.search-inp{width:100%;padding:9px 13px;border:1px solid;border-radius:10px;font-family:'Sora',sans-serif;font-size:12px;outline:none;transition:border-color .15s;background:transparent;color:inherit}
.mini-sel{padding:5px 8px;border:1px solid;border-radius:8px;font-family:'Sora',sans-serif;font-size:10px;outline:none;cursor:pointer;background:transparent;color:inherit}
.tog-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid;border-radius:10px;cursor:pointer;transition:all .15s}
.tog-dot{width:18px;height:18px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;flex-shrink:0;transition:all .2s}
.btn{padding:7px 14px;border-radius:9px;font-family:'Sora',sans-serif;font-size:11px;font-weight:600;cursor:pointer;transition:all .15s;border:none;white-space:nowrap}
.btn-primary{background:linear-gradient(135deg,#3b5bdb,#7048e8);color:#fff}
.btn-ghost{background:transparent;border:1px solid;font-family:'Sora',sans-serif}
.btn-ai{background:linear-gradient(135deg,#0ca678,#059669);color:#fff}
.btn-ic{width:32px;height:32px;border-radius:8px;border:1px solid;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;transition:all .15s}
.bottom-nav{display:none;position:fixed;bottom:0;left:0;right:0;z-index:50;backdrop-filter:blur(20px)}
.bot-btn{display:flex;flex-direction:column;align-items:center;flex:1;padding:7px 4px 11px;background:none;border:none;cursor:pointer;font-family:'Sora',sans-serif;font-size:9px;font-weight:600;gap:2px;transition:all .15s}
@media(max-width:720px){
  .sidebar{display:none!important}
  .bottom-nav{display:flex!important;justify-content:space-around}
  .main{padding-bottom:64px}
  .content{padding:13px 14px!important}
  .stat-grid{grid-template-columns:repeat(2,1fr)!important}
  .budget-grid{grid-template-columns:1fr!important}
  .topbar{padding:11px 14px!important}
  .page-title{font-size:15px!important}
  .hero-card{padding:16px 18px!important}
  .hv{font-size:22px!important}
}
`;

const DCS = th => `
.sidebar{background:${th.sur};border-right:1px solid ${th.bor}}
.brand{border-bottom:1px solid ${th.bor}}
.brand-name{color:${th.tx}}
.brand-sub{color:${th.tx3}}
.nav-sec{color:${th.tx3}}
.nb{color:${th.tx2}}
.nb:hover{background:${th.sur2};color:${th.tx}}
.nb.on{background:${th.acBg};color:${th.ac}}
.nb.on .nb-ic{background:${th.ac};color:#fff}
.n-badge{background:${th.am}}
.n-soon{background:${th.sur3};color:${th.tx3}}
.sidebar-footer{border-top:1px solid ${th.bor}}
.fb{color:${th.tx3}}
.fb:hover{background:${th.sur2};color:${th.tx2}}
.topbar{background:${th.sur}cc;border-bottom:1px solid ${th.bor}}
.page-title{color:${th.tx}}
.page-date{color:${th.tx3}}
.card{background:${th.sur};border:1px solid ${th.bor};box-shadow:${th.sh}}
.stat-card{background:${th.sur};border:1px solid ${th.bor};box-shadow:${th.sh}}
.budget-grid .card{background:${th.sur}}
.sec-title{color:${th.tx3}}
.sec-link{color:${th.ac}}
.subtabs{background:${th.sur2};border-color:${th.bor}}
.stab{color:${th.tx3}}
.stab.on{background:${th.sur};color:${th.tx};box-shadow:${th.sh}}
.tx-row{border-bottom-color:${th.bor}}
.inp{border-color:${th.bor};background:${th.sur2};color:${th.tx}}
.inp:focus{border-color:${th.ac}!important}
.search-inp{border-color:${th.bor};background:${th.sur2}}
.mini-sel{border-color:${th.bor};background:${th.sur2};color:${th.tx2}}
.mini-sel option{background:${th.sur}}
.inp option{background:${th.sur}}
.btn-ghost{border-color:${th.bor2};color:${th.tx2}}
.btn-ghost:hover{background:${th.sur2}}
.btn-ic{border-color:${th.bor};color:${th.tx2}}
.act-btn{border-color:${th.bor};color:${th.tx3}}
.bottom-nav{background:${th.sur}ee;border-top:1px solid ${th.bor}}
.bot-btn{color:${th.tx3}}
.bot-btn.on{color:${th.ac}}
.prog-wrap{background:${th.sur3}}
`;