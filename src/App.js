import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const CURRENCIES = [
  { code:"IDR", symbol:"Rp", rate:1, flag:"🇮🇩" },
  { code:"USD", symbol:"$", rate:16400, flag:"🇺🇸" },
  { code:"SGD", symbol:"S$", rate:12200, flag:"🇸🇬" },
  { code:"MYR", symbol:"RM", rate:3700, flag:"🇲🇾" },
  { code:"JPY", symbol:"¥", rate:110, flag:"🇯🇵" },
  { code:"EUR", symbol:"€", rate:17800, flag:"🇪🇺" },
  { code:"AUD", symbol:"A$", rate:10500, flag:"🇦🇺" },
];
const CATEGORIES = ["Belanja","Makan & Minum","Transport","Tagihan","Hotel/Travel","Elektronik","Kesehatan","Hiburan","Lainnya"];
const ENTITIES   = ["Pribadi","Hamasa","SDC","Lainnya"];
const NETWORKS   = ["Visa","Mastercard","JCB","Amex"];
const BANKS      = ["BCA","Mandiri","BNI","CIMB","BRI","Permata","Danamon","OCBC","Lainnya"];
const RECUR_FREQ = ["Bulanan","Mingguan","Tahunan"];

const ENTITY_COLORS = { Pribadi:"#6366f1", Hamasa:"#10b981", SDC:"#f59e0b", Lainnya:"#64748b" };

const DEFAULT_CARDS = [
  { id:"bca", name:"BCA Mastercard", bank:"BCA", last4:"4521", color:"#1d4ed8", accent:"#60a5fa", limit:15000000, statementDay:25, dueDay:17, targetPct:30, network:"Mastercard" },
  { id:"mandiri", name:"Mandiri Visa", bank:"Mandiri", last4:"8832", color:"#4338ca", accent:"#818cf8", limit:20000000, statementDay:28, dueDay:20, targetPct:40, network:"Visa" },
  { id:"bni", name:"BNI Visa", bank:"BNI", last4:"1107", color:"#c2410c", accent:"#fb923c", limit:10000000, statementDay:15, dueDay:7, targetPct:25, network:"Visa" },
  { id:"cimb", name:"CIMB Niaga", bank:"CIMB", last4:"3390", color:"#991b1b", accent:"#f87171", limit:12000000, statementDay:20, dueDay:12, targetPct:35, network:"Mastercard" },
];
const DEFAULT_TX = [
  { id:1, date:"2025-04-01", card:"bca", desc:"Groceries Hypermart", amount:450000, currency:"IDR", fee:0, category:"Belanja", entity:"Pribadi", reimbursed:true, notes:"" },
  { id:2, date:"2025-04-02", card:"mandiri", desc:"Client Dinner SCBD", amount:320000, currency:"IDR", fee:0, category:"Makan & Minum", entity:"Hamasa", reimbursed:false, notes:"Meeting vendor" },
  { id:3, date:"2025-04-03", card:"bni", desc:"Grab Car", amount:85000, currency:"IDR", fee:0, category:"Transport", entity:"Pribadi", reimbursed:true, notes:"" },
  { id:4, date:"2025-04-04", card:"bca", desc:"Shopee Online", amount:899000, currency:"IDR", fee:5000, category:"Belanja", entity:"Pribadi", reimbursed:false, notes:"" },
  { id:5, date:"2025-04-05", card:"cimb", desc:"Hotel Aston Semarang", amount:1250000, currency:"IDR", fee:0, category:"Hotel/Travel", entity:"SDC", reimbursed:false, notes:"1 malam" },
];
const DEFAULT_BUDGETS    = { Pribadi:3000000, Hamasa:8000000, SDC:5000000, Lainnya:1000000 };
const DEFAULT_RECURRING  = [
  { id:1, card:"bca", desc:"Netflix", amount:54000, currency:"IDR", fee:0, category:"Hiburan", entity:"Pribadi", frequency:"Bulanan", dayOfMonth:1, active:true },
];
const DEFAULT_INSTALLMENTS = [
  { id:1, card:"bca", desc:"iPhone 15 Pro", totalAmount:18000000, months:12, startDate:"2025-01-01", monthlyAmount:1500000, currency:"IDR", entity:"Pribadi", paidMonths:3 },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const getCur   = c => CURRENCIES.find(x => x.code === c) || CURRENCIES[0];
const toIDR    = (amt, cur, rates={}) => amt * (rates[cur] || getCur(cur).rate);
const fmtIDR   = (n, short=false) => {
  const v = Math.abs(Number(n||0));
  if (short && v>=1000000) return "Rp "+(v/1000000).toFixed(1)+"jt";
  if (short && v>=1000)    return "Rp "+(v/1000).toFixed(0)+"rb";
  return "Rp "+v.toLocaleString("id-ID");
};
const fmtCur   = (amt, cur) => { const c=getCur(cur); return cur==="IDR"?"Rp "+Number(amt).toLocaleString("id-ID"):c.symbol+" "+Number(amt).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); };
const today    = () => new Date().toISOString().slice(0,10);
const ym       = d  => d.slice(0,7);
const mlFull   = s  => { const [y,m]=s.split("-"); return new Date(y,m-1).toLocaleDateString("id-ID",{month:"long",year:"numeric"}); };
const mlShort  = s  => { const [y,m]=s.split("-"); return new Date(y,m-1).toLocaleDateString("id-ID",{month:"short",year:"2-digit"}); };
const daysUntil= d  => { const now=new Date(); let t=new Date(now.getFullYear(),now.getMonth(),d); if(t<=now) t=new Date(now.getFullYear(),now.getMonth()+1,d); return Math.ceil((t-now)/86400000); };
const urgColor = d  => d<=2?"#ef4444":d<=5?"#f59e0b":d<=10?"#eab308":"#22c55e";

async function ls(k,fb){ try{ const r=await window.storage.get(k); return r?JSON.parse(r.value):fb; }catch{ return fb; } }
async function ss(k,v){ try{ await window.storage.set(k,JSON.stringify(v)); }catch{} }

function exportCSV(transactions, cards){
  const cm = Object.fromEntries(cards.map(c=>[c.id,c.name]));
  const hdr = ["Tanggal","Kartu","Keterangan","Kategori","Entitas","Nominal","Mata Uang","Fee","Reimburse","Catatan"];
  const rows = transactions.map(t=>[t.date,cm[t.card]||t.card,`"${t.desc}"`,t.category,t.entity,t.amount,t.currency,t.fee||0,t.reimbursed?"Ya":"Tidak",`"${t.notes||""}"`]);
  const csv = [hdr,...rows].map(r=>r.join(",")).join("\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"})); a.download=`cc-tracker-${today()}.csv`; a.click();
}

// ─── AI RECEIPT SCANNER ───────────────────────────────────────────────────────
async function scanReceiptWithAI(base64Image, mimeType) {
  const prompt = `Kamu adalah AI yang mengekstrak data dari foto struk/nota/receipt kartu kredit.

Analisis foto ini dan ekstrak informasi berikut dalam format JSON:
{
  "amount": <nominal transaksi dalam angka, tanpa titik/koma, contoh: 450000>,
  "currency": <"IDR" atau kode mata uang lain jika terlihat>,
  "date": <tanggal dalam format YYYY-MM-DD, jika tidak ada gunakan null>,
  "merchant": <nama merchant/toko/restoran>,
  "last4": <4 digit terakhir nomor kartu jika terlihat, jika tidak ada gunakan null>,
  "category": <salah satu dari: "Belanja", "Makan & Minum", "Transport", "Tagihan", "Hotel/Travel", "Elektronik", "Kesehatan", "Hiburan", "Lainnya">,
  "fee": <nominal fee/admin jika ada, default 0>,
  "notes": <catatan tambahan yang relevan, boleh kosong string>
}

Aturan:
- Jika ada beberapa nominal, ambil TOTAL yang dibayar
- Jika mata uang tidak jelas, asumsikan IDR
- Kategori harus PERSIS salah satu dari list di atas
- Jika informasi tidak ditemukan, gunakan null
- Response HANYA JSON, tidak ada teks lain`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } },
          { type: "text", text: prompt }
        ]
      }]
    })
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || "{}";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─── THEME ────────────────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    bg:         "#050510",
    bgNav:      "rgba(8,8,20,0.97)",
    bgCard:     "rgba(255,255,255,0.025)",
    bgCardHov:  "rgba(255,255,255,0.045)",
    bgInput:    "rgba(255,255,255,0.04)",
    bgModal:    "rgba(10,10,25,0.98)",
    border:     "rgba(255,255,255,0.07)",
    borderFoc:  "rgba(99,102,241,0.5)",
    text:       "#f1f5f9",
    textSub:    "#94a3b8",
    textMuted:  "#475569",
    textFaint:  "#1e293b",
    shadow:     "0 8px 32px rgba(0,0,0,0.4)",
    heroP:      "rgba(79,70,229,0.25)",
    heroG:      "rgba(5,150,105,0.25)",
    heroA:      "rgba(217,119,6,0.25)",
    heroS:      "rgba(71,85,105,0.25)",
  },
  light: {
    bg:         "#f8fafc",
    bgNav:      "rgba(255,255,255,0.97)",
    bgCard:     "#ffffff",
    bgCardHov:  "#f1f5f9",
    bgInput:    "#f8fafc",
    bgModal:    "#ffffff",
    border:     "rgba(0,0,0,0.08)",
    borderFoc:  "rgba(99,102,241,0.6)",
    text:       "#0f172a",
    textSub:    "#475569",
    textMuted:  "#94a3b8",
    textFaint:  "#cbd5e1",
    shadow:     "0 4px 24px rgba(0,0,0,0.08)",
    heroP:      "rgba(99,102,241,0.1)",
    heroG:      "rgba(16,185,129,0.1)",
    heroA:      "rgba(245,158,11,0.1)",
    heroS:      "rgba(100,116,139,0.1)",
  }
};

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

// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [isDark, setIsDark]         = useState(true);
  const [cards, setCards]           = useState(DEFAULT_CARDS);
  const [transactions, setTx]       = useState(DEFAULT_TX);
  const [installments, setInst]     = useState(DEFAULT_INSTALLMENTS);
  const [budgets, setBudgets]       = useState(DEFAULT_BUDGETS);
  const [recurring, setRecurring]   = useState(DEFAULT_RECURRING);
  const [fxRates, setFxRates]       = useState({USD:16400,SGD:12200,MYR:3700,JPY:110,EUR:17800,AUD:10500});
  const [loaded, setLoaded]         = useState(false);
  const [tab, setTab]               = useState("dashboard");
  const [nextId, setNextId]         = useState(300);
  const [dismissed, setDismissed]   = useState([]);

  // Modals
  const [showTxForm, setShowTxForm]       = useState(false);
  const [showCardForm, setShowCardForm]   = useState(false);
  const [showInstForm, setShowInstForm]   = useState(false);
  const [showRecurForm, setShowRecurForm] = useState(false);
  const [showBudgetForm, setShowBudForm]  = useState(false);
  const [showFxPanel, setShowFxPanel]     = useState(false);
  const [showStatement, setShowStatement] = useState(false);
  const [showScanner, setShowScanner]     = useState(false);
  const [detailCardId, setDetailCardId]   = useState(null);

  // Edit IDs
  const [editTxId, setEditTxId]     = useState(null);
  const [editCardId, setEditCardId] = useState(null);
  const [editInstId, setEditInstId] = useState(null);
  const [editRecurId,setEditRecurId]= useState(null);

  // Filters
  const [filterCard, setFilterCard]   = useState("all");
  const [filterReimb, setFilterReimb] = useState("all");
  const [filterMonth, setFilterMonth] = useState("all");
  const [filterEntity, setFilterEnt]  = useState("all");
  const [searchQ, setSearchQ]         = useState("");
  const [statCard, setStatCard]       = useState("");

  // Scanner state
  const [scanImg, setScanImg]         = useState(null);
  const [scanMime, setScanMime]       = useState("image/jpeg");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult]   = useState(null);
  const [scanError, setScanError]     = useState("");
  const fileInputRef                  = useRef(null);

  const th = THEMES[isDark ? "dark" : "light"];

  // Empty forms
  const ET = { date:today(), card:cards[0]?.id||"", desc:"", amount:"", currency:"IDR", fee:"", category:"Belanja", entity:"Pribadi", reimbursed:false, notes:"" };
  const EC = { name:"", bank:"BCA", last4:"", color:"#1d4ed8", accent:"#60a5fa", limit:"", statementDay:25, dueDay:17, targetPct:30, network:"Visa" };
  const EI = { card:cards[0]?.id||"", desc:"", totalAmount:"", months:12, startDate:today(), currency:"IDR", entity:"Pribadi" };
  const ER = { card:cards[0]?.id||"", desc:"", amount:"", currency:"IDR", fee:"", category:"Hiburan", entity:"Pribadi", frequency:"Bulanan", dayOfMonth:1, active:true };

  const [txForm, setTxForm]       = useState(ET);
  const [cardForm, setCardForm]   = useState(EC);
  const [instForm, setInstForm]   = useState(EI);
  const [recurForm, setRecurForm] = useState(ER);
  const [budgetForm, setBudForm]  = useState(DEFAULT_BUDGETS);

  // Storage
  useEffect(()=>{
    (async()=>{
      const [c,t,i,b,r,fx,n,dm,dark] = await Promise.all([
        ls("cc5-cards",DEFAULT_CARDS), ls("cc5-tx",DEFAULT_TX),
        ls("cc5-inst",DEFAULT_INSTALLMENTS), ls("cc5-budgets",DEFAULT_BUDGETS),
        ls("cc5-recur",DEFAULT_RECURRING), ls("cc5-fx",fxRates),
        ls("cc5-nextid",300), ls("cc5-dismissed",[]), ls("cc5-dark",true),
      ]);
      setCards(c); setTx(t); setInst(i); setBudgets(b); setRecurring(r);
      setFxRates(fx); setNextId(n); setDismissed(dm); setIsDark(dark);
      setStatCard(c[0]?.id||"");
      setLoaded(true);
    })();
  },[]);

  useEffect(()=>{ if(loaded){ ss("cc5-cards",cards); } },[cards,loaded]);
  useEffect(()=>{ if(loaded){ ss("cc5-tx",transactions); } },[transactions,loaded]);
  useEffect(()=>{ if(loaded){ ss("cc5-inst",installments); } },[installments,loaded]);
  useEffect(()=>{ if(loaded){ ss("cc5-budgets",budgets); } },[budgets,loaded]);
  useEffect(()=>{ if(loaded){ ss("cc5-recur",recurring); } },[recurring,loaded]);
  useEffect(()=>{ if(loaded){ ss("cc5-fx",fxRates); } },[fxRates,loaded]);
  useEffect(()=>{ if(loaded){ ss("cc5-nextid",nextId); } },[nextId,loaded]);
  useEffect(()=>{ if(loaded){ ss("cc5-dismissed",dismissed); } },[dismissed,loaded]);
  useEffect(()=>{ if(loaded){ ss("cc5-dark",isDark); } },[isDark,loaded]);

  const cardMap = useMemo(()=>Object.fromEntries(cards.map(c=>[c.id,c])),[cards]);
  const txIDR   = useCallback((t)=>toIDR(t.amount,t.currency,fxRates)+(t.fee||0),[fxRates]);
  const curMonth = ym(today());

  // Stats
  const stats = useMemo(()=>{
    const total     = transactions.reduce((s,t)=>s+txIDR(t),0);
    const fees      = transactions.reduce((s,t)=>s+(t.fee||0),0);
    const reimbursed= transactions.filter(t=>t.reimbursed).reduce((s,t)=>s+toIDR(t.amount,t.currency,fxRates),0);
    const pending   = transactions.filter(t=>!t.reimbursed).reduce((s,t)=>s+toIDR(t.amount,t.currency,fxRates),0);
    const byEntity  = Object.fromEntries(ENTITIES.map(e=>[e,transactions.filter(t=>t.entity===e).reduce((s,t)=>s+txIDR(t),0)]));
    return { total, fees, reimbursed, pending, byEntity, txCount:transactions.length };
  },[transactions,txIDR,fxRates]);

  const cardStats = useMemo(()=>cards.map(c=>{
    const allTx   = transactions.filter(t=>t.card===c.id);
    const thisM   = allTx.filter(t=>ym(t.date)===curMonth);
    const spent   = thisM.reduce((s,t)=>s+txIDR(t),0);
    const total   = allTx.reduce((s,t)=>s+txIDR(t),0);
    const reimb   = allTx.filter(t=>t.reimbursed).reduce((s,t)=>s+toIDR(t.amount,t.currency,fxRates),0);
    const avail   = c.limit-spent;
    const pct     = c.limit>0?(spent/c.limit*100):0;
    const instTot = installments.filter(i=>i.card===c.id).reduce((s,i)=>s+toIDR(i.monthlyAmount||(i.totalAmount/i.months),i.currency,fxRates),0);
    return{...c,allTx,thisM,spent,total,reimb,avail,pct,instTot,txCount:allTx.length,dueIn:daysUntil(c.dueDay),statIn:daysUntil(c.statementDay)};
  }),[cards,transactions,installments,curMonth,txIDR,fxRates]);

  const budgetStats = useMemo(()=>ENTITIES.map(e=>{
    const budget = budgets[e]||0;
    const spent  = transactions.filter(t=>t.entity===e&&ym(t.date)===curMonth).reduce((s,t)=>s+txIDR(t),0);
    const pct    = budget>0?(spent/budget*100):0;
    return{ entity:e, budget, spent, pct, remaining:Math.max(0,budget-spent) };
  }),[budgets,transactions,curMonth,txIDR]);

  const alerts = useMemo(()=>{
    const a=[];
    cards.forEach(c=>{ const d=daysUntil(c.dueDay); if(d<=5) a.push({id:`due-${c.id}`,type:"danger",icon:"⚠️",title:`JT: ${c.name}`,msg:`Jatuh tempo ${d} hari lagi (Tgl ${c.dueDay})`}); });
    ENTITIES.forEach(e=>{ const b=budgets[e]||0; if(!b) return; const spent=transactions.filter(t=>t.entity===e&&ym(t.date)===curMonth).reduce((s,t)=>s+txIDR(t),0); const p=spent/b*100; if(p>=100) a.push({id:`bud-${e}`,type:"danger",icon:"🚨",title:`Budget ${e} Habis`,msg:`${p.toFixed(0)}% terpakai`}); else if(p>=80) a.push({id:`bw-${e}`,type:"warning",icon:"💸",title:`Budget ${e} Hampir Habis`,msg:`${p.toFixed(0)}% — sisa ${fmtIDR(b-spent,true)}`}); });
    return a.filter(x=>!dismissed.includes(x.id));
  },[cards,transactions,budgets,curMonth,txIDR,dismissed]);

  const chartData = useMemo(()=>{
    const months=[...new Set(transactions.map(t=>ym(t.date)))].sort().slice(-6);
    return months.map(m=>{ const txs=transactions.filter(t=>ym(t.date)===m); const r={month:mlShort(m)}; ENTITIES.forEach(e=>{r[e]=txs.filter(t=>t.entity===e).reduce((s,t)=>s+txIDR(t),0);}); r.Total=txs.reduce((s,t)=>s+txIDR(t),0); r.Reimburse=txs.filter(t=>t.reimbursed).reduce((s,t)=>s+toIDR(t.amount,t.currency,fxRates),0); return r; });
  },[transactions,txIDR,fxRates]);

  const allMonths = useMemo(()=>[...new Set(transactions.map(t=>ym(t.date)))].sort().reverse(),[transactions]);
  const filtered  = useMemo(()=>transactions.filter(t=>filterCard==="all"||t.card===filterCard).filter(t=>filterReimb==="all"||String(t.reimbursed)===filterReimb).filter(t=>filterMonth==="all"||ym(t.date)===filterMonth).filter(t=>filterEntity==="all"||t.entity===filterEntity).filter(t=>!searchQ||t.desc.toLowerCase().includes(searchQ.toLowerCase())).sort((a,b)=>b.date.localeCompare(a.date)),[transactions,filterCard,filterReimb,filterMonth,filterEntity,searchQ]);

  const instStats = useMemo(()=>installments.map(i=>{ const m=i.monthlyAmount||Math.round(i.totalAmount/i.months); const rem=i.months-i.paidMonths; return{...i,monthly:m,remaining:rem,remainingAmt:m*rem,paidAmt:m*i.paidMonths,pct:(i.paidMonths/i.months)*100}; }),[installments]);

  const statData = useMemo(()=>{
    if(!statCard) return null;
    const c=cardMap[statCard]; const cs=cardStats.find(x=>x.id===statCard); if(!c||!cs) return null;
    const inst=installments.filter(i=>i.card===statCard&&i.paidMonths<i.months).reduce((s,i)=>s+toIDR(i.monthlyAmount||(i.totalAmount/i.months),i.currency,fxRates),0);
    const fees=cs.thisM.reduce((s,t)=>s+(t.fee||0),0);
    const pokok=cs.thisM.reduce((s,t)=>s+toIDR(t.amount,t.currency,fxRates),0);
    const total=pokok+inst+fees;
    return{c,cs,pokok,inst,fees,total,min:Math.max(total*0.1,100000)};
  },[statCard,cardMap,cardStats,installments,fxRates]);

  const entityPie = ENTITIES.map(e=>({name:e,value:stats.byEntity[e]||0})).filter(d=>d.value>0);

  // ── Handlers
  const newId = ()=>{ const id=nextId; setNextId(n=>n+1); return id; };
  const submitTx = ()=>{
    if(!txForm.desc||!txForm.amount||!txForm.card) return;
    const d={...txForm,amount:Number(txForm.amount),fee:Number(txForm.fee||0)};
    if(editTxId){ setTx(p=>p.map(t=>t.id===editTxId?{...d,id:editTxId}:t)); setEditTxId(null); }
    else setTx(p=>[...p,{...d,id:newId()}]);
    setTxForm({...ET,card:cards[0]?.id||""}); setShowTxForm(false);
  };
  const submitCard = ()=>{
    if(!cardForm.name||!cardForm.last4||!cardForm.limit) return;
    const id=editCardId||cardForm.name.toLowerCase().replace(/\s+/g,"-")+"-"+Date.now();
    const d={...cardForm,limit:Number(cardForm.limit),statementDay:Number(cardForm.statementDay),dueDay:Number(cardForm.dueDay),targetPct:Number(cardForm.targetPct)};
    if(editCardId){ setCards(p=>p.map(c=>c.id===editCardId?{...d,id:editCardId}:c)); setEditCardId(null); }
    else setCards(p=>[...p,{...d,id}]);
    setCardForm(EC); setShowCardForm(false);
  };
  const submitInst = ()=>{
    if(!instForm.desc||!instForm.totalAmount||!instForm.card) return;
    const m=Math.round(Number(instForm.totalAmount)/Number(instForm.months));
    const d={...instForm,totalAmount:Number(instForm.totalAmount),months:Number(instForm.months),monthlyAmount:m,paidMonths:0};
    if(editInstId){ setInst(p=>p.map(i=>i.id===editInstId?{...d,id:editInstId,paidMonths:p.find(x=>x.id===editInstId)?.paidMonths||0}:i)); setEditInstId(null); }
    else setInst(p=>[...p,{...d,id:newId()}]);
    setInstForm({...EI,card:cards[0]?.id||""}); setShowInstForm(false);
  };
  const submitRecur = ()=>{
    if(!recurForm.desc||!recurForm.amount||!recurForm.card) return;
    const d={...recurForm,amount:Number(recurForm.amount),fee:Number(recurForm.fee||0),dayOfMonth:Number(recurForm.dayOfMonth)};
    if(editRecurId){ setRecurring(p=>p.map(r=>r.id===editRecurId?{...d,id:editRecurId}:r)); setEditRecurId(null); }
    else setRecurring(p=>[...p,{...d,id:newId()}]);
    setRecurForm({...ER,card:cards[0]?.id||""}); setShowRecurForm(false);
  };
  const editTx  = t=>{ setTxForm({...t,amount:String(t.amount),fee:String(t.fee||"")}); setEditTxId(t.id); setShowTxForm(true); };
  const deleteTx= id=>setTx(p=>p.filter(t=>t.id!==id));
  const togReimb= id=>setTx(p=>p.map(t=>t.id===id?{...t,reimbursed:!t.reimbursed}:t));
  const editCard= c=>{ setCardForm({...c,limit:String(c.limit)}); setEditCardId(c.id); setShowCardForm(true); };
  const delCard = id=>{ if(window.confirm("Hapus kartu ini?")){ setCards(p=>p.filter(c=>c.id!==id)); setTx(p=>p.filter(t=>t.card!==id)); } };
  const markPaid= id=>setInst(p=>p.map(i=>i.id===id&&i.paidMonths<i.months?{...i,paidMonths:i.paidMonths+1}:i));
  const delInst = id=>setInst(p=>p.filter(i=>i.id!==id));
  const togRecur= id=>setRecurring(p=>p.map(r=>r.id===id?{...r,active:!r.active}:r));
  const delRecur= id=>setRecurring(p=>p.filter(r=>r.id!==id));
  const applyRecur=r=>{ setTx(p=>[...p,{...r,id:newId(),date:today(),notes:`Auto recurring (${r.frequency})`,reimbursed:false}]); };
  const togTheme= ()=>setIsDark(d=>!d);

  // ── AI Scanner
  const handleFileSelect = e => {
    const file = e.target.files?.[0];
    if(!file) return;
    const mime = file.type || "image/jpeg";
    setScanMime(mime); setScanResult(null); setScanError("");
    const reader = new FileReader();
    reader.onload = ev => setScanImg(ev.target.result.split(",")[1]);
    reader.readAsDataURL(file);
  };

  const runScan = async () => {
    if(!scanImg) return;
    setScanLoading(true); setScanError("");
    try {
      const result = await scanReceiptWithAI(scanImg, scanMime);
      setScanResult(result);
      // Pre-fill form
      const matchedCard = result.last4 ? cards.find(c=>c.last4===result.last4) : null;
      setTxForm(f=>({
        ...f,
        desc:    result.merchant || f.desc,
        amount:  result.amount ? String(result.amount) : f.amount,
        currency:result.currency || "IDR",
        date:    result.date || today(),
        category:result.category || "Lainnya",
        fee:     result.fee ? String(result.fee) : "",
        notes:   result.notes || "",
        card:    matchedCard?.id || f.card,
      }));
    } catch(e) {
      setScanError("Gagal scan. Pastikan foto jelas dan coba lagi.");
    }
    setScanLoading(false);
  };

  const confirmScan = () => {
    setShowScanner(false);
    setScanImg(null); setScanResult(null);
    setShowTxForm(true);
  };

  const detailCard = detailCardId ? cardStats.find(c=>c.id===detailCardId) : null;

  // ── CSS variables based on theme
  const rootStyle = {
    "--bg":       th.bg,
    "--bg-nav":   th.bgNav,
    "--bg-card":  th.bgCard,
    "--bg-input": th.bgInput,
    "--bg-modal": th.bgModal,
    "--border":   th.border,
    "--text":     th.text,
    "--text-sub": th.textSub,
    "--text-mut": th.textMuted,
    "--shadow":   th.shadow,
  };

  const TABS=[
    {id:"dashboard",icon:"◈",label:"Dashboard"},
    {id:"cards",icon:"▣",label:"Kartu"},
    {id:"transactions",icon:"≡",label:"Transaksi"},
    {id:"installments",icon:"⟳",label:"Cicilan"},
    {id:"recurring",icon:"↺",label:"Recurring"},
    {id:"budget",icon:"◎",label:"Budget"},
    {id:"monthly",icon:"◷",label:"Bulanan"},
  ];

  // ── Monthly summary
  const monthlySummary = useMemo(()=>allMonths.map(m=>{
    const txs=transactions.filter(t=>ym(t.date)===m);
    const total=txs.reduce((s,t)=>s+txIDR(t),0);
    const reimb=txs.filter(t=>t.reimbursed).reduce((s,t)=>s+toIDR(t.amount,t.currency,fxRates),0);
    const fees=txs.reduce((s,t)=>s+(t.fee||0),0);
    const byEntity=Object.fromEntries(ENTITIES.map(e=>[e,txs.filter(t=>t.entity===e).reduce((s,t)=>s+txIDR(t),0)]));
    const byCard=cards.map(c=>({...c,amt:txs.filter(t=>t.card===c.id).reduce((s,t)=>s+txIDR(t),0)})).filter(c=>c.amt>0);
    return{month:m,txs,total,reimb,pending:total-reimb-fees,fees,byEntity,byCard,count:txs.length};
  }),[transactions,allMonths,cards,txIDR,fxRates]);

  // ═══════════════ RENDER ═══════════════════════════════════════════════════
  return (
    <div style={{...rootStyle,display:"flex",minHeight:"100vh",background:th.bg,color:th.text,fontFamily:"'Plus Jakarta Sans',system-ui,sans-serif",transition:"background .3s,color .3s"}}>
      <style>{css(th)}</style>

      {/* SIDEBAR */}
      <nav className="sidebar">
        <div>
          <div className="brand">
            <div className="brand-icon">💳</div>
            <div>
              <div className="brand-name">CC Tracker</div>
              <div className="brand-sub">Hamasa · SDC · Pribadi</div>
            </div>
          </div>
          <div style={{padding:"0 10px",marginBottom:8}}>
            {TABS.map(t=>(
              <button key={t.id} className={`side-btn ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>
                <span style={{fontSize:15,width:20,textAlign:"center"}}>{t.icon}</span>
                <span>{t.label}</span>
                {t.id==="dashboard"&&alerts.length>0&&<span className="badge">{alerts.length}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="side-footer">
          <button className="side-act" onClick={togTheme}>{isDark?"☀️ Light Mode":"🌙 Dark Mode"}</button>
          <button className="side-act" onClick={()=>setShowFxPanel(true)}>💱 Update Kurs</button>
          <button className="side-act" onClick={()=>{setStatCard(cards[0]?.id||"");setShowStatement(true);}}>🧾 Statement</button>
          <button className="side-act" onClick={()=>exportCSV(transactions,cards)}>📥 Export CSV</button>
        </div>
      </nav>

      {/* MOBILE BOTTOM NAV */}
      <div className="bottom-nav">
        {TABS.slice(0,5).map(t=>(
          <button key={t.id} className={`bot-btn ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>
            <span style={{fontSize:18}}>{t.icon}</span>
            <span style={{fontSize:9,marginTop:1}}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* MAIN */}
      <main className="main">
        {/* TOPBAR */}
        <div className="topbar">
          <div>
            <div className="page-title">{TABS.find(t=>t.id===tab)?.label}</div>
            <div className="page-sub">{new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button className="theme-tog" onClick={togTheme} title={isDark?"Light Mode":"Dark Mode"}>{isDark?"☀️":"🌙"}</button>
            {alerts.length>0&&<div className="alert-dot">{alerts.length}</div>}
            <button className="btn-scan" onClick={()=>{setScanImg(null);setScanResult(null);setScanError("");setShowScanner(true);}}>📷 Scan Struk</button>
            <button className="btn-add" onClick={()=>{setEditTxId(null);setTxForm({...ET,card:cards[0]?.id||""});setShowTxForm(true);}}>+ Transaksi</button>
          </div>
        </div>

        <div className="content">

          {/* ALERTS */}
          {alerts.length>0&&tab==="dashboard"&&(
            <div style={{marginBottom:18}}>
              {alerts.slice(0,3).map(a=>(
                <div key={a.id} className={`alert-bar ${a.type}`}>
                  <span>{a.icon}</span>
                  <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13}}>{a.title}</div><div style={{fontSize:11,opacity:.8}}>{a.msg}</div></div>
                  <button className="alert-x" onClick={()=>setDismissed(p=>[...p,a.id])}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* ══ DASHBOARD ══ */}
          {tab==="dashboard"&&(<>
            <div className="hero-grid">
              {[
                ["Total","💳",fmtIDR(stats.total),`${stats.txCount} transaksi`,th.heroP,"#818cf8"],
                ["Reimburse","✅",fmtIDR(stats.reimbursed),`${transactions.filter(t=>t.reimbursed).length} tx`,th.heroG,"#4ade80"],
                ["Pending","⏳",fmtIDR(stats.pending),`${transactions.filter(t=>!t.reimbursed).length} tx`,th.heroA,"#f59e0b"],
                ["Fee","💸",fmtIDR(stats.fees),"tidak direimburse",th.heroS,"#94a3b8"],
              ].map(([l,ic,v,sub,bg,col])=>(
                <div key={l} className="hero-card anim-in" style={{background:bg,borderColor:col+"33"}}>
                  <div style={{fontSize:22,marginBottom:6}}>{ic}</div>
                  <div style={{fontSize:10,color:th.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
                  <div style={{fontSize:16,fontWeight:900,fontFamily:"monospace",color:col,marginTop:2}}>{v}</div>
                  <div style={{fontSize:10,color:th.textMuted,marginTop:2}}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Budget */}
            <div className="sec-head"><div className="sec-label">Budget Bulan Ini</div><button className="link-btn" onClick={()=>{setBudForm({...budgets});setShowBudForm(true);}}>Edit</button></div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:22}}>
              {budgetStats.map(b=>{
                const over=b.pct>=100, warn=b.pct>=80;
                const bc=over?"#ef4444":warn?"#f59e0b":ENTITY_COLORS[b.entity];
                return(
                  <div key={b.entity} className="glass-card anim-in" style={{padding:"14px 16px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:7,height:7,borderRadius:"50%",background:ENTITY_COLORS[b.entity]}}/><span style={{fontSize:12,fontWeight:700}}>{b.entity}</span></div>
                      <span style={{fontSize:11,color:bc,fontWeight:700}}>{b.pct.toFixed(0)}%{over?" 🚨":warn?" ⚠️":""}</span>
                    </div>
                    <div style={{height:6,background:th.border,borderRadius:3,overflow:"hidden",marginBottom:6}}>
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
            <div className="sec-label" style={{marginBottom:10}}>Pemakaian 6 Bulan</div>
            <div className="glass-card anim-in" style={{padding:16,marginBottom:12}}>
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={chartData} margin={{top:0,right:0,left:-18,bottom:0}} barSize={24}>
                  <XAxis dataKey="month" tick={{fill:th.textMuted,fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:th.textMuted,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtIDR(v,true)}/>
                  <Tooltip content={<CTip th={th}/>}/>
                  {ENTITIES.map((e,i)=><Bar key={e} dataKey={e} stackId="a" fill={ENTITY_COLORS[e]} radius={i===ENTITIES.length-1?[3,3,0,0]:[0,0,0,0]}/>)}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="glass-card anim-in" style={{padding:16,marginBottom:22}}>
              <div style={{fontSize:10,color:th.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:10}}>Trend Total vs Reimburse</div>
              <ResponsiveContainer width="100%" height={130}>
                <AreaChart data={chartData} margin={{top:5,right:5,left:-18,bottom:0}}>
                  <defs>
                    <linearGradient id="gT" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={.3}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient>
                    <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={{fill:th.textMuted,fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:th.textMuted,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtIDR(v,true)}/>
                  <Tooltip content={<CTip th={th}/>}/>
                  <Area type="monotone" dataKey="Total" stroke="#6366f1" strokeWidth={2} fill="url(#gT)" dot={{r:3,fill:"#6366f1"}} name="Total"/>
                  <Area type="monotone" dataKey="Reimburse" stroke="#10b981" strokeWidth={2} fill="url(#gR)" dot={{r:3,fill:"#10b981"}} name="Reimburse" strokeDasharray="5 3"/>
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Pie + Due */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:22}}>
              <div className="glass-card anim-in" style={{padding:16}}>
                <div style={{fontSize:10,color:th.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Entitas</div>
                <ResponsiveContainer width="100%" height={130}>
                  <PieChart><Pie data={entityPie} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={4} dataKey="value">{entityPie.map((e,i)=><Cell key={i} fill={ENTITY_COLORS[e.name]}/>)}</Pie><Tooltip formatter={v=>fmtIDR(v,true)} contentStyle={{background:th.bgModal,border:`1px solid ${th.border}`,borderRadius:10,fontSize:11}}/></PieChart>
                </ResponsiveContainer>
                <div style={{display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center"}}>
                  {entityPie.map(e=><div key={e.name} style={{display:"flex",alignItems:"center",gap:3,fontSize:10,color:th.textMuted}}><div style={{width:5,height:5,borderRadius:"50%",background:ENTITY_COLORS[e.name]}}/>{e.name}</div>)}
                </div>
              </div>
              <div className="glass-card anim-in" style={{padding:16}}>
                <div style={{fontSize:10,color:th.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:10}}>Jatuh Tempo</div>
                {cardStats.map(c=>(
                  <div key={c.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${th.border}`}}>
                    <div style={{fontSize:11,color:th.textSub}}>{c.name.split(" ").slice(0,2).join(" ")}</div>
                    <div style={{fontSize:12,fontWeight:700,color:urgColor(c.dueIn),fontFamily:"monospace"}}>{c.dueIn}hr</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Card usage */}
            <div className="sec-label" style={{marginBottom:10}}>Kartu Bulan Ini</div>
            {cardStats.map((c,i)=>{
              const over=c.pct>c.targetPct;
              const sc=c.pct>80?"#ef4444":over?"#f59e0b":"#22c55e";
              return(
                <div key={c.id} className="glass-card card-hov anim-in" style={{padding:14,marginBottom:9,cursor:"pointer",animationDelay:`${i*.04}s`}} onClick={()=>setDetailCardId(c.id)}>
                  <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
                    <div style={{width:40,height:40,borderRadius:11,background:`linear-gradient(135deg,${c.color},${c.accent})`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>💳</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:13}}>{c.name}</div>
                      <div style={{fontSize:10,color:th.textMuted}}>···· {c.last4} · JT Tgl {c.dueDay} · {c.dueIn} hari</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:sc}}>{fmtIDR(c.spent,true)}</div>
                      <div style={{fontSize:10,color:th.textMuted}}>/ {fmtIDR(c.limit,true)}</div>
                    </div>
                  </div>
                  <div style={{position:"relative",height:5,background:th.border,borderRadius:3,marginBottom:5}}>
                    <div style={{height:"100%",width:Math.min(c.pct,100)+"%",background:`linear-gradient(90deg,${c.color},${c.accent})`,borderRadius:3}}/>
                    <div style={{position:"absolute",top:-4,left:c.targetPct+"%",width:2,height:13,background:"#f59e0b",borderRadius:1,opacity:.8}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:th.textMuted}}>
                    <span style={{color:over?"#f59e0b":th.textMuted}}>{c.pct.toFixed(1)}%{over?" ⚠️":""}</span>
                    <span>Target {c.targetPct}% · Sisa {fmtIDR(c.avail,true)}</span>
                  </div>
                </div>
              );
            })}
          </>)}

          {/* ══ CARDS ══ */}
          {tab==="cards"&&(<>
            <div className="tab-hdr"><div className="sec-label">Kartu Kredit</div><button className="btn-add" onClick={()=>{setEditCardId(null);setCardForm(EC);setShowCardForm(true);}}>+ Kartu</button></div>
            {cardStats.map((c,i)=>(
              <div key={c.id} className="credit-card anim-in" style={{"--cc":c.color,"--ca":c.accent,animationDelay:`${i*.06}s`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
                  <div><div style={{fontSize:10,opacity:.5,fontWeight:600,textTransform:"uppercase",letterSpacing:1}}>{c.bank} · {c.network}</div><div style={{fontSize:18,fontWeight:800,marginTop:2}}>{c.name}</div></div>
                  <div style={{fontSize:12,fontWeight:900,opacity:.7,letterSpacing:1}}>{c.network==="Visa"?"VISA":"MC"}</div>
                </div>
                <div style={{fontFamily:"monospace",letterSpacing:4,fontSize:15,marginBottom:16,opacity:.85}}>•••• •••• •••• {c.last4}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginBottom:12}}>
                  {[["Limit",fmtIDR(c.limit,true)],["Terpakai",fmtIDR(c.spent,true)],["Tersedia",fmtIDR(c.avail,true)],["Cetak",`Tgl ${c.statementDay}`],["Jatuh Tempo",`Tgl ${c.dueDay}`],["Target",`${c.targetPct}%`]].map(([l,v])=>(
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
                  <button className="btn-cc" onClick={()=>editCard(c)}>✏️ Edit</button>
                  <button className="btn-cc" onClick={()=>delCard(c.id)}>🗑 Hapus</button>
                </div>
              </div>
            ))}
          </>)}

          {/* ══ TRANSACTIONS ══ */}
          {tab==="transactions"&&(<>
            <div className="glass-card anim-in" style={{padding:14,marginBottom:12}}>
              <input className="search-box" placeholder="🔍 Cari transaksi..." value={searchQ} onChange={e=>setSearchQ(e.target.value)}/>
              <div style={{display:"flex",gap:6,marginTop:9,flexWrap:"wrap"}}>
                <select className="mini-sel" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)}><option value="all">Semua Bulan</option>{allMonths.map(m=><option key={m} value={m}>{mlFull(m)}</option>)}</select>
                <select className="mini-sel" value={filterCard} onChange={e=>setFilterCard(e.target.value)}><option value="all">Semua Kartu</option>{cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <select className="mini-sel" value={filterEntity} onChange={e=>setFilterEnt(e.target.value)}><option value="all">Semua Entitas</option>{ENTITIES.map(e=><option key={e} value={e}>{e}</option>)}</select>
                <select className="mini-sel" value={filterReimb} onChange={e=>setFilterReimb(e.target.value)}><option value="all">Semua Status</option><option value="false">Belum Reimburse</option><option value="true">Sudah Reimburse</option></select>
              </div>
              <div style={{fontSize:11,color:th.textMuted,marginTop:7}}>{filtered.length} transaksi · {fmtIDR(filtered.reduce((s,t)=>s+txIDR(t),0))}</div>
            </div>
            {filtered.length===0?<div style={{textAlign:"center",color:th.textFaint,padding:"50px 0"}}>Tidak ada transaksi</div>
            :filtered.map((t,i)=>{
              const c=cardMap[t.card]||{name:"?",color:"#334155",accent:"#64748b",bank:"?"};
              return(
                <div key={t.id} className="tx-row anim-in" style={{animationDelay:`${Math.min(i,10)*.03}s`}}>
                  <div style={{width:38,height:38,borderRadius:10,background:`linear-gradient(135deg,${c.color},${c.accent})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{getCur(t.currency).flag}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:4}}>{t.desc}</div>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      <Tag th={th}>{t.date}</Tag>
                      <Tag th={th}>{t.category}</Tag>
                      <Tag th={th} color={c.accent} bg={c.color+"22"}>{c.bank}</Tag>
                      <Tag th={th} color={ENTITY_COLORS[t.entity]} bg={ENTITY_COLORS[t.entity]+"22"}>{t.entity}</Tag>
                      {t.currency!=="IDR"&&<Tag th={th} color="#f59e0b">🌏 {t.currency}</Tag>}
                      {t.fee>0&&<Tag th={th} color="#f97316">Fee</Tag>}
                    </div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                    <div style={{fontFamily:"monospace",fontSize:13,fontWeight:800,marginBottom:2}}>{fmtCur(t.amount,t.currency)}</div>
                    {t.currency!=="IDR"&&<div style={{fontSize:10,color:th.textMuted,fontFamily:"monospace"}}>≈{fmtIDR(toIDR(t.amount,t.currency,fxRates),true)}</div>}
                    {t.fee>0&&<div style={{fontSize:10,color:"#f97316",fontFamily:"monospace"}}>+{fmtIDR(t.fee)}</div>}
                    <div style={{display:"flex",gap:4,justifyContent:"flex-end",marginTop:5}}>
                      <button className={`reimb-btn ${t.reimbursed?"done":""}`} onClick={()=>togReimb(t.id)}>{t.reimbursed?"✓ Reimb":"Reimb?"}</button>
                      <button className="icon-btn" onClick={()=>editTx(t)}>✏️</button>
                      <button className="icon-btn danger" onClick={()=>deleteTx(t.id)}>🗑</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </>)}

          {/* ══ INSTALLMENTS ══ */}
          {tab==="installments"&&(<>
            <div className="tab-hdr"><div className="sec-label">Cicilan</div><button className="btn-add" onClick={()=>{setEditInstId(null);setInstForm({...EI,card:cards[0]?.id||""});setShowInstForm(true);}}>+ Cicilan</button></div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:9,marginBottom:14}}>
              {[["Total",fmtIDR(instStats.reduce((s,i)=>s+toIDR(i.totalAmount,i.currency,fxRates),0),true),"#818cf8"],["Per Bulan",fmtIDR(instStats.reduce((s,i)=>s+toIDR(i.monthly,i.currency,fxRates),0),true),"#34d399"],["Terbayar",fmtIDR(instStats.reduce((s,i)=>s+toIDR(i.paidAmt,i.currency,fxRates),0),true),"#4ade80"],["Sisa",fmtIDR(instStats.reduce((s,i)=>s+toIDR(i.remainingAmt,i.currency,fxRates),0),true),"#f87171"]].map(([l,v,col])=>(
                <div key={l} className="glass-card anim-in" style={{padding:"12px 14px",borderTop:`2px solid ${col}`}}>
                  <div style={{fontSize:10,color:th.textMuted,fontWeight:700,textTransform:"uppercase"}}>{l}</div>
                  <div style={{fontSize:14,fontWeight:800,fontFamily:"monospace",color:col,marginTop:3}}>{v}</div>
                </div>
              ))}
            </div>
            {instStats.map((i,idx)=>{
              const c=cardMap[i.card];
              return(
                <div key={i.id} className="glass-card anim-in" style={{padding:16,marginBottom:9,animationDelay:`${idx*.05}s`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                    <div><div style={{fontWeight:700,fontSize:13}}>{i.desc}</div><div style={{fontSize:11,color:th.textMuted,marginTop:2}}>{c?.name} · {i.entity}</div></div>
                    <div style={{textAlign:"right"}}><div style={{fontSize:15,fontWeight:800,fontFamily:"monospace",color:"#818cf8"}}>{fmtIDR(toIDR(i.monthly,i.currency,fxRates),true)}<span style={{fontSize:10,color:th.textMuted}}>/bln</span></div><div style={{fontSize:11,color:th.textMuted}}>Total: {fmtIDR(toIDR(i.totalAmount,i.currency,fxRates))}</div></div>
                  </div>
                  <div style={{height:7,background:th.border,borderRadius:4,overflow:"hidden",marginBottom:6}}>
                    <div style={{height:"100%",width:i.pct+"%",background:"linear-gradient(90deg,#6366f1,#10b981)",borderRadius:4,transition:"width .6s"}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:th.textMuted,marginBottom:10}}><span>{i.paidMonths}/{i.months} bulan ({i.pct.toFixed(0)}%)</span><span>Sisa: {fmtIDR(toIDR(i.remainingAmt,i.currency,fxRates),true)}</span></div>
                  <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:11}}>{Array.from({length:i.months}).map((_,j)=><div key={j} style={{width:13,height:13,borderRadius:3,background:j<i.paidMonths?"#10b981":th.border,border:`1px solid ${j<i.paidMonths?"#059669":th.border}`}}/>)}</div>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn-sm" onClick={()=>markPaid(i.id)} disabled={i.paidMonths>=i.months}>✓ Terbayar</button>
                    <button className="btn-sm" onClick={()=>{setInstForm({...i,totalAmount:String(i.totalAmount),months:String(i.months)});setEditInstId(i.id);setShowInstForm(true);}}>✏️</button>
                    <button className="btn-sm danger" onClick={()=>delInst(i.id)}>🗑</button>
                  </div>
                </div>
              );
            })}
          </>)}

          {/* ══ RECURRING ══ */}
          {tab==="recurring"&&(<>
            <div className="tab-hdr"><div className="sec-label">Recurring</div><button className="btn-add" onClick={()=>{setEditRecurId(null);setRecurForm({...ER,card:cards[0]?.id||""});setShowRecurForm(true);}}>+ Recurring</button></div>
            <div className="glass-card anim-in" style={{padding:"12px 14px",marginBottom:12,borderLeft:"3px solid #6366f1"}}>
              <div style={{fontSize:11,color:"#818cf8",fontWeight:700,marginBottom:3}}>💡 Cara Kerja</div>
              <div style={{fontSize:11,color:th.textMuted}}>Template transaksi berulang. Klik <strong>▶ Apply</strong> untuk tambah ke transaksi hari ini.</div>
            </div>
            {recurring.map((r,idx)=>{
              const c=cardMap[r.card];
              return(
                <div key={r.id} className="glass-card anim-in" style={{padding:"13px 15px",marginBottom:8,opacity:r.active?1:.5,animationDelay:`${idx*.04}s`}}>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <div style={{width:36,height:36,borderRadius:9,background:r.active?`linear-gradient(135deg,${c?.color||"#334155"},${c?.accent||"#64748b"})`:"transparent",border:`1px solid ${th.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>↺</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:13}}>{r.desc}</div>
                      <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
                        <Tag th={th}>{r.frequency} · Tgl {r.dayOfMonth}</Tag>
                        <Tag th={th} color={ENTITY_COLORS[r.entity]} bg={ENTITY_COLORS[r.entity]+"22"}>{r.entity}</Tag>
                        {c&&<Tag th={th} color={c.accent} bg={c.color+"22"}>{c.bank}</Tag>}
                      </div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontFamily:"monospace",fontSize:13,fontWeight:800}}>{fmtCur(r.amount,r.currency)}</div>
                      <div style={{display:"flex",gap:4,marginTop:5,justifyContent:"flex-end"}}>
                        <button className="btn-sm" style={{color:"#10b981",borderColor:"#10b98144"}} onClick={()=>applyRecur(r)}>▶ Apply</button>
                        <button className="btn-sm" onClick={()=>togRecur(r.id)}>{r.active?"Pause":"Resume"}</button>
                        <button className="icon-btn" onClick={()=>{setRecurForm({...r,amount:String(r.amount),fee:String(r.fee||""),dayOfMonth:String(r.dayOfMonth)});setEditRecurId(r.id);setShowRecurForm(true);}}>✏️</button>
                        <button className="icon-btn danger" onClick={()=>delRecur(r.id)}>🗑</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>)}

          {/* ══ BUDGET ══ */}
          {tab==="budget"&&(<>
            <div className="tab-hdr"><div className="sec-label">Budget Planner</div><button className="btn-add" onClick={()=>{setBudForm({...budgets});setShowBudForm(true);}}>Edit Budget</button></div>
            {budgetStats.map((b,idx)=>{
              const over=b.pct>=100, warn=b.pct>=80;
              const bc=over?"#ef4444":warn?"#f59e0b":ENTITY_COLORS[b.entity];
              const txs=transactions.filter(t=>t.entity===b.entity&&ym(t.date)===curMonth);
              return(
                <div key={b.entity} className="glass-card anim-in" style={{padding:18,marginBottom:12,animationDelay:`${idx*.06}s`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:42,height:42,borderRadius:11,background:`linear-gradient(135deg,${ENTITY_COLORS[b.entity]}88,${ENTITY_COLORS[b.entity]})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{b.entity==="Pribadi"?"🏠":b.entity==="Hamasa"?"🏭":b.entity==="SDC"?"🔧":"📁"}</div>
                      <div><div style={{fontWeight:800,fontSize:15}}>{b.entity}</div><div style={{fontSize:11,color:th.textMuted}}>{txs.length} tx bulan ini</div></div>
                    </div>
                    <div style={{textAlign:"right"}}><div style={{fontSize:10,color:th.textMuted}}>Budget</div><div style={{fontFamily:"monospace",fontSize:15,fontWeight:800,color:th.textSub}}>{fmtIDR(b.budget,true)}</div></div>
                  </div>
                  <div style={{height:9,background:th.border,borderRadius:5,overflow:"hidden",marginBottom:8}}>
                    <div style={{height:"100%",width:Math.min(b.pct,100)+"%",background:bc,borderRadius:5,transition:"width .7s",boxShadow:`0 0 10px ${bc}66`}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:b.pct>0?12:0}}>
                    <div><div style={{fontSize:11,color:th.textMuted}}>Terpakai</div><div style={{fontFamily:"monospace",fontSize:15,fontWeight:800,color:bc}}>{fmtIDR(b.spent,true)}</div></div>
                    <div style={{textAlign:"center"}}><div style={{fontSize:11,color:th.textMuted}}>%</div><div style={{fontSize:20,fontWeight:900,color:bc}}>{b.pct.toFixed(0)}%</div></div>
                    <div style={{textAlign:"right"}}><div style={{fontSize:11,color:th.textMuted}}>Sisa</div><div style={{fontFamily:"monospace",fontSize:15,fontWeight:800,color:"#22c55e"}}>{fmtIDR(b.remaining,true)}</div></div>
                  </div>
                  {txs.slice(0,3).map(t=>(
                    <div key={t.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${th.border}`,fontSize:11}}>
                      <span style={{color:th.textMuted}}>{t.date.slice(5)} · {t.desc}</span>
                      <span style={{fontFamily:"monospace",color:th.textSub}}>{fmtIDR(txIDR(t),true)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </>)}

          {/* ══ MONTHLY ══ */}
          {tab==="monthly"&&(<>
            <div className="sec-label" style={{marginBottom:12}}>Ringkasan Bulanan</div>
            {monthlySummary.map((m,idx)=>(
              <div key={m.month} className="glass-card anim-in" style={{padding:16,marginBottom:11,animationDelay:`${idx*.04}s`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
                  <div style={{fontWeight:800,fontSize:15}}>{mlFull(m.month)}</div>
                  <div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:th.textSub}}>{fmtIDR(m.total)}</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:12}}>
                  {[["Total",fmtIDR(m.total,true),th.textSub],["Reimb",fmtIDR(m.reimb,true),"#4ade80"],["Pending",fmtIDR(m.pending,true),"#f87171"],["Fee",fmtIDR(m.fees,true),"#f59e0b"]].map(([l,v,col])=>(
                    <div key={l} style={{background:th.bgInput,border:`1px solid ${th.border}`,borderRadius:7,padding:"7px 9px"}}>
                      <div style={{fontSize:9,color:th.textMuted,fontWeight:700,textTransform:"uppercase"}}>{l}</div>
                      <div style={{fontSize:11,fontWeight:700,fontFamily:"monospace",color:col,marginTop:1}}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
                  {ENTITIES.map(e=>m.byEntity[e]>0&&<div key={e} style={{background:ENTITY_COLORS[e]+"18",border:`1px solid ${ENTITY_COLORS[e]}33`,borderRadius:6,padding:"3px 9px",fontSize:11}}><span style={{color:ENTITY_COLORS[e],fontWeight:700}}>{e}: </span><span style={{fontFamily:"monospace",color:th.textSub}}>{fmtIDR(m.byEntity[e],true)}</span></div>)}
                </div>
                {m.byCard.map(c=>{ const p=m.total>0?c.amt/m.total*100:0; return(<div key={c.id} style={{marginBottom:6}}><div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:2}}><span style={{color:c.accent}}>{c.name}</span><span style={{fontFamily:"monospace",color:th.textMuted}}>{fmtIDR(c.amt,true)} · {p.toFixed(0)}%</span></div><div style={{height:3,background:th.border,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:p+"%",background:`linear-gradient(90deg,${c.color},${c.accent})`,borderRadius:2}}/></div></div>); })}
                <div style={{fontSize:10,color:th.textFaint,marginTop:8}}>{m.count} transaksi</div>
              </div>
            ))}
          </>)}
        </div>
      </main>

      {/* ══ AI SCANNER MODAL ══ */}
      {showScanner&&(
        <Overlay onClose={()=>setShowScanner(false)} th={th}>
          <div style={{fontWeight:800,fontSize:17,marginBottom:4}}>📷 Scan Struk / Nota</div>
          <div style={{fontSize:11,color:th.textMuted,marginBottom:18}}>Upload foto struk, AI akan otomatis baca nominal, merchant, tanggal, dan nomor kartu.</div>

          {/* Upload area */}
          <div className="scan-drop" onClick={()=>fileInputRef.current?.click()} style={{borderColor:scanImg?"#6366f1":th.border,background:scanImg?`url(data:${scanMime};base64,${scanImg}) center/contain no-repeat`:"transparent"}}>
            {!scanImg&&(<>
              <div style={{fontSize:36,marginBottom:8}}>📷</div>
              <div style={{fontSize:13,fontWeight:700,color:th.textSub}}>Klik untuk upload foto</div>
              <div style={{fontSize:11,color:th.textMuted,marginTop:4}}>JPG, PNG, HEIC — Max 10MB</div>
            </>)}
            {scanImg&&<div style={{position:"absolute",bottom:8,right:8,background:"rgba(0,0,0,.6)",color:"white",fontSize:10,padding:"3px 8px",borderRadius:5}}>✓ Foto dipilih</div>}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleFileSelect} capture="environment"/>

          {scanError&&<div style={{padding:"9px 12px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",borderRadius:9,fontSize:12,color:"#f87171",marginTop:12}}>{scanError}</div>}

          {/* Scan result preview */}
          {scanResult&&(
            <div style={{marginTop:14,padding:"14px",background:"rgba(99,102,241,.06)",border:"1px solid rgba(99,102,241,.2)",borderRadius:12}}>
              <div style={{fontSize:11,color:"#818cf8",fontWeight:700,marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>✨ Hasil AI Scan</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[
                  ["Merchant",scanResult.merchant||"-"],
                  ["Nominal",scanResult.amount?fmtIDR(scanResult.amount):"-"],
                  ["Tanggal",scanResult.date||"-"],
                  ["Kategori",scanResult.category||"-"],
                  ["4 Digit Kartu",scanResult.last4||"Tidak terdeteksi"],
                  ["Fee",scanResult.fee>0?fmtIDR(scanResult.fee):"0"],
                ].map(([l,v])=>(
                  <div key={l} style={{background:th.bgInput,borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:th.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
                    <div style={{fontSize:12,fontWeight:700,color:th.text,marginTop:2}}>{v}</div>
                  </div>
                ))}
              </div>
              {scanResult.notes&&<div style={{marginTop:8,fontSize:11,color:th.textMuted}}>📝 {scanResult.notes}</div>}
            </div>
          )}

          <div style={{display:"flex",gap:10,marginTop:16}}>
            <button className="btn-cancel" onClick={()=>setShowScanner(false)}>Batal</button>
            {!scanResult
              ?<button className="btn-confirm" onClick={runScan} disabled={!scanImg||scanLoading} style={{opacity:(!scanImg||scanLoading)?.5:1}}>
                {scanLoading?"🔄 Scanning...":"✨ Scan dengan AI"}
              </button>
              :<button className="btn-confirm" onClick={confirmScan}>
                ✅ Lanjut Isi Form
              </button>
            }
          </div>
          {scanResult&&<div style={{fontSize:10,color:th.textMuted,marginTop:8,textAlign:"center"}}>Form transaksi akan terbuka dengan data hasil scan. Kamu bisa cek dan edit sebelum simpan.</div>}
        </Overlay>
      )}

      {/* ══ CARD DETAIL ══ */}
      {detailCard&&(
        <Overlay onClose={()=>setDetailCardId(null)} th={th} title={detailCard.name}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            {[["Limit",fmtIDR(detailCard.limit)],["Terpakai",fmtIDR(detailCard.spent)],["Sisa",fmtIDR(detailCard.avail)],["Target",`${detailCard.targetPct}%`],["Tgl Cetak",`Tgl ${detailCard.statementDay} (${detailCard.statIn}hr)`],["Jatuh Tempo",`Tgl ${detailCard.dueDay} (${detailCard.dueIn}hr)`],["Total Semua",fmtIDR(detailCard.total)],["Reimburse",fmtIDR(detailCard.reimb)]].map(([l,v])=>(
              <div key={l} style={{background:th.bgInput,border:`1px solid ${th.border}`,borderRadius:9,padding:"9px 11px"}}>
                <div style={{fontSize:9,color:th.textMuted,fontWeight:700,textTransform:"uppercase",marginBottom:2}}>{l}</div>
                <div style={{fontSize:12,fontWeight:700,fontFamily:"monospace"}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:10,color:th.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Transaksi Terakhir</div>
          {detailCard.allTx.slice(-5).reverse().map(t=>(
            <div key={t.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${th.border}`,fontSize:12}}>
              <span style={{color:th.textMuted}}>{t.date.slice(5)} · {t.desc} <span style={{color:ENTITY_COLORS[t.entity],fontSize:10}}>[{t.entity}]</span></span>
              <span style={{fontFamily:"monospace",color:t.reimbursed?"#4ade80":"#f87171"}}>{fmtIDR(txIDR(t),true)}</span>
            </div>
          ))}
        </Overlay>
      )}

      {/* ══ STATEMENT MODAL ══ */}
      {showStatement&&(
        <Overlay onClose={()=>setShowStatement(false)} th={th} title="🧾 Statement Simulator" wide>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
            {cards.map(c=><button key={c.id} className={`card-sel ${statCard===c.id?"active":""}`} style={statCard===c.id?{"--cc":c.color,"--ca":c.accent}:{}} onClick={()=>setStatCard(c.id)}>{c.name.split(" ").slice(0,2).join(" ")} ···· {c.last4}</button>)}
          </div>
          {statData&&(<>
            <div style={{background:"rgba(99,102,241,.06)",border:"1px solid rgba(99,102,241,.2)",borderRadius:12,padding:16,marginBottom:14}}>
              <div style={{fontSize:10,color:"#6366f1",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:10}}>Estimasi Tagihan {mlFull(curMonth)}</div>
              {[["Transaksi Biasa",statData.pokok,`${statData.cs.thisM.length} tx`],["Cicilan Aktif",statData.inst,"bulanan"],["Fee & Charge",statData.fees,"tidak direimburse"]].map(([l,v,s])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${th.border}`}}>
                  <div><div style={{fontSize:12,color:th.textSub}}>{l}</div><div style={{fontSize:10,color:th.textMuted}}>{s}</div></div>
                  <div style={{fontFamily:"monospace",fontSize:13,fontWeight:700}}>{fmtIDR(v)}</div>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",paddingTop:12,marginTop:4}}>
                <div style={{fontWeight:800,fontSize:14}}>TOTAL</div>
                <div style={{fontFamily:"monospace",fontSize:19,fontWeight:900,color:"#f59e0b"}}>{fmtIDR(statData.total)}</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div style={{background:"rgba(239,68,68,.06)",border:"1px solid rgba(239,68,68,.15)",borderRadius:10,padding:12}}>
                <div style={{fontSize:10,color:"#ef4444",fontWeight:700,textTransform:"uppercase"}}>Pembayaran Minimum</div>
                <div style={{fontFamily:"monospace",fontSize:15,fontWeight:800,color:"#f87171",marginTop:4}}>{fmtIDR(statData.min)}</div>
              </div>
              <div style={{background:"rgba(16,185,129,.06)",border:"1px solid rgba(16,185,129,.15)",borderRadius:10,padding:12}}>
                <div style={{fontSize:10,color:"#10b981",fontWeight:700,textTransform:"uppercase"}}>Jatuh Tempo</div>
                <div style={{fontFamily:"monospace",fontSize:15,fontWeight:800,color:"#4ade80",marginTop:4}}>{statData.cs.dueIn} hari lagi</div>
              </div>
            </div>
          </>)}
        </Overlay>
      )}

      {/* ══ FX MODAL ══ */}
      {showFxPanel&&(
        <Overlay onClose={()=>setShowFxPanel(false)} th={th} title="💱 Kurs Mata Uang">
          {CURRENCIES.filter(c=>c.code!=="IDR").map(cur=>(
            <div key={cur.code} style={{display:"flex",alignItems:"center",gap:10,marginBottom:11}}>
              <span style={{fontSize:18}}>{cur.flag}</span>
              <span style={{fontSize:13,fontWeight:700,color:th.textSub,width:34}}>{cur.code}</span>
              <span style={{fontSize:12,color:th.textMuted,flex:1}}>1 {cur.code} =</span>
              <input className="inp" type="number" value={fxRates[cur.code]||cur.rate} onChange={e=>setFxRates(r=>({...r,[cur.code]:Number(e.target.value)}))} style={{width:110}}/>
              <span style={{fontSize:11,color:th.textMuted}}>IDR</span>
            </div>
          ))}
        </Overlay>
      )}

      {/* ══ TX FORM ══ */}
      {showTxForm&&(
        <Overlay onClose={()=>setShowTxForm(false)} th={th} title={editTxId?"✏️ Edit Transaksi":"➕ Tambah Transaksi"}>
          <div style={{display:"flex",flexDirection:"column",gap:11}}>
            {scanResult&&<div style={{padding:"9px 13px",background:"rgba(99,102,241,.06)",border:"1px solid rgba(99,102,241,.2)",borderRadius:9,fontSize:11,color:"#818cf8"}}>✨ Data dari hasil scan AI — cek dan lengkapi yang kurang</div>}
            <R2><F label="Tanggal" th={th}><input className="inp" type="date" value={txForm.date} onChange={e=>setTxForm(f=>({...f,date:e.target.value}))}/></F><F label="Kartu" th={th}><select className="inp" value={txForm.card} onChange={e=>setTxForm(f=>({...f,card:e.target.value}))}>{cards.map(c=><option key={c.id} value={c.id}>{c.name} ···· {c.last4}</option>)}</select></F></R2>
            <F label="Keterangan" th={th}><input className="inp" placeholder="Contoh: Makan siang client..." value={txForm.desc} onChange={e=>setTxForm(f=>({...f,desc:e.target.value}))}/></F>
            <R2>
              <F label="Jumlah" th={th}><div style={{display:"flex",gap:5}}><select className="inp" value={txForm.currency} onChange={e=>setTxForm(f=>({...f,currency:e.target.value}))} style={{width:86,flexShrink:0}}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select><input className="inp" type="number" placeholder="0" value={txForm.amount} onChange={e=>setTxForm(f=>({...f,amount:e.target.value}))}/></div>{txForm.currency!=="IDR"&&txForm.amount&&<div style={{fontSize:10,color:th.textMuted,marginTop:3}}>≈ {fmtIDR(toIDR(Number(txForm.amount),txForm.currency,fxRates))}</div>}</F>
              <F label="Fee (Rp)" th={th}><input className="inp" type="number" placeholder="0" value={txForm.fee} onChange={e=>setTxForm(f=>({...f,fee:e.target.value}))}/><div style={{fontSize:9,color:th.textMuted,marginTop:3}}>Tidak direimburse</div></F>
            </R2>
            <R2><F label="Kategori" th={th}><select className="inp" value={txForm.category} onChange={e=>setTxForm(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></F><F label="Entitas" th={th}><select className="inp" value={txForm.entity} onChange={e=>setTxForm(f=>({...f,entity:e.target.value}))}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</select></F></R2>
            <F label="Catatan" th={th}><input className="inp" placeholder="Opsional..." value={txForm.notes} onChange={e=>setTxForm(f=>({...f,notes:e.target.value}))}/></F>
            <div className="tog-row" onClick={()=>setTxForm(f=>({...f,reimbursed:!f.reimbursed}))} style={{background:txForm.reimbursed?"rgba(16,185,129,.06)":"rgba(255,255,255,.02)",borderColor:txForm.reimbursed?"rgba(16,185,129,.2)":th.border}}>
              <div className={`tog-check ${txForm.reimbursed?"on":""}`}>{txForm.reimbursed?"✓":""}</div>
              <div><div style={{fontSize:13,color:txForm.reimbursed?"#4ade80":th.textMuted,fontWeight:600}}>Sudah Direimburse</div><div style={{fontSize:10,color:th.textMuted}}>Fee tidak termasuk</div></div>
            </div>
            <BtnRow onCancel={()=>setShowTxForm(false)} onOk={submitTx} label={editTxId?"Simpan":"Tambah"} th={th}/>
          </div>
        </Overlay>
      )}

      {/* ══ CARD FORM ══ */}
      {showCardForm&&(
        <Overlay onClose={()=>setShowCardForm(false)} th={th} title={editCardId?"✏️ Edit Kartu":"🏦 Tambah Kartu"}>
          <div style={{display:"flex",flexDirection:"column",gap:11}}>
            <R2><F label="Nama Kartu" th={th}><input className="inp" placeholder="BCA Platinum" value={cardForm.name} onChange={e=>setCardForm(f=>({...f,name:e.target.value}))}/></F><F label="Bank" th={th}><select className="inp" value={cardForm.bank} onChange={e=>setCardForm(f=>({...f,bank:e.target.value}))}>{BANKS.map(b=><option key={b}>{b}</option>)}</select></F></R2>
            <R2><F label="4 Digit Terakhir" th={th}><input className="inp" placeholder="1234" maxLength={4} value={cardForm.last4} onChange={e=>setCardForm(f=>({...f,last4:e.target.value}))}/></F><F label="Network" th={th}><select className="inp" value={cardForm.network} onChange={e=>setCardForm(f=>({...f,network:e.target.value}))}>{NETWORKS.map(n=><option key={n}>{n}</option>)}</select></F></R2>
            <F label="Limit (Rp)" th={th}><input className="inp" type="number" value={cardForm.limit} onChange={e=>setCardForm(f=>({...f,limit:e.target.value}))}/></F>
            <R2><F label="Tgl Cetak" th={th}><input className="inp" type="number" min={1} max={31} value={cardForm.statementDay} onChange={e=>setCardForm(f=>({...f,statementDay:e.target.value}))}/></F><F label="Tgl Jatuh Tempo" th={th}><input className="inp" type="number" min={1} max={31} value={cardForm.dueDay} onChange={e=>setCardForm(f=>({...f,dueDay:e.target.value}))}/></F></R2>
            <F label={`Target: ${cardForm.targetPct}%`} th={th}><input type="range" min={5} max={100} step={5} value={cardForm.targetPct} onChange={e=>setCardForm(f=>({...f,targetPct:Number(e.target.value)}))} style={{width:"100%",accentColor:"#6366f1"}}/><div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:th.textMuted,marginTop:2}}><span>5%</span><span style={{color:"#818cf8",fontWeight:700}}>{cardForm.targetPct}% = {fmtIDR(Number(cardForm.limit||0)*cardForm.targetPct/100,true)}</span><span>100%</span></div></F>
            <R2><F label="Warna Utama" th={th}><div style={{display:"flex",gap:8,alignItems:"center"}}><input type="color" value={cardForm.color} onChange={e=>setCardForm(f=>({...f,color:e.target.value}))} style={{width:44,height:36,border:"none",borderRadius:8,cursor:"pointer"}}/><span style={{fontSize:11,color:th.textMuted}}>{cardForm.color}</span></div></F><F label="Warna Aksen" th={th}><div style={{display:"flex",gap:8,alignItems:"center"}}><input type="color" value={cardForm.accent} onChange={e=>setCardForm(f=>({...f,accent:e.target.value}))} style={{width:44,height:36,border:"none",borderRadius:8,cursor:"pointer"}}/><span style={{fontSize:11,color:th.textMuted}}>{cardForm.accent}</span></div></F></R2>
            <div style={{background:`linear-gradient(135deg,${cardForm.color},${cardForm.accent})`,borderRadius:12,padding:"13px 15px",color:"white"}}>
              <div style={{fontWeight:800,fontSize:14}}>{cardForm.name||"Nama Kartu"}</div>
              <div style={{fontFamily:"monospace",letterSpacing:3,margin:"7px 0",opacity:.85}}>•••• •••• •••• {cardForm.last4||"0000"}</div>
              <div style={{fontSize:11,opacity:.5}}>{cardForm.bank} · {cardForm.network} · {fmtIDR(Number(cardForm.limit||0),true)}</div>
            </div>
            <BtnRow onCancel={()=>setShowCardForm(false)} onOk={submitCard} label={editCardId?"Simpan":"Tambah"} th={th}/>
          </div>
        </Overlay>
      )}

      {/* ══ INSTALLMENT FORM ══ */}
      {showInstForm&&(
        <Overlay onClose={()=>setShowInstForm(false)} th={th} title={editInstId?"✏️ Edit Cicilan":"🔄 Tambah Cicilan"}>
          <div style={{display:"flex",flexDirection:"column",gap:11}}>
            <F label="Nama Item" th={th}><input className="inp" placeholder="iPhone, Laptop..." value={instForm.desc} onChange={e=>setInstForm(f=>({...f,desc:e.target.value}))}/></F>
            <R2><F label="Kartu" th={th}><select className="inp" value={instForm.card} onChange={e=>setInstForm(f=>({...f,card:e.target.value}))}>{cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></F><F label="Entitas" th={th}><select className="inp" value={instForm.entity} onChange={e=>setInstForm(f=>({...f,entity:e.target.value}))}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</select></F></R2>
            <R2><F label="Mata Uang" th={th}><select className="inp" value={instForm.currency} onChange={e=>setInstForm(f=>({...f,currency:e.target.value}))}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select></F><F label="Total Harga" th={th}><input className="inp" type="number" value={instForm.totalAmount} onChange={e=>setInstForm(f=>({...f,totalAmount:e.target.value}))}/></F></R2>
            <R2><F label="Jumlah Bulan" th={th}><select className="inp" value={instForm.months} onChange={e=>setInstForm(f=>({...f,months:Number(e.target.value)}))}>{[3,6,9,12,18,24,36].map(m=><option key={m} value={m}>{m} bulan</option>)}</select></F><F label="Mulai" th={th}><input className="inp" type="date" value={instForm.startDate} onChange={e=>setInstForm(f=>({...f,startDate:e.target.value}))}/></F></R2>
            {instForm.totalAmount&&instForm.months&&<div style={{padding:"9px 13px",background:"rgba(99,102,241,.07)",border:"1px solid rgba(99,102,241,.2)",borderRadius:9,fontFamily:"monospace",fontSize:13,color:"#818cf8",fontWeight:700}}>Cicilan/bulan: {fmtIDR(Math.round(Number(instForm.totalAmount)/Number(instForm.months)))}</div>}
            <BtnRow onCancel={()=>setShowInstForm(false)} onOk={submitInst} label={editInstId?"Simpan":"Tambah"} th={th}/>
          </div>
        </Overlay>
      )}

      {/* ══ RECURRING FORM ══ */}
      {showRecurForm&&(
        <Overlay onClose={()=>setShowRecurForm(false)} th={th} title={editRecurId?"✏️ Edit Recurring":"↺ Tambah Recurring"}>
          <div style={{display:"flex",flexDirection:"column",gap:11}}>
            <F label="Nama" th={th}><input className="inp" placeholder="Netflix, Spotify..." value={recurForm.desc} onChange={e=>setRecurForm(f=>({...f,desc:e.target.value}))}/></F>
            <R2><F label="Kartu" th={th}><select className="inp" value={recurForm.card} onChange={e=>setRecurForm(f=>({...f,card:e.target.value}))}>{cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></F><F label="Entitas" th={th}><select className="inp" value={recurForm.entity} onChange={e=>setRecurForm(f=>({...f,entity:e.target.value}))}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</select></F></R2>
            <R2><F label="Jumlah" th={th}><div style={{display:"flex",gap:5}}><select className="inp" value={recurForm.currency} onChange={e=>setRecurForm(f=>({...f,currency:e.target.value}))} style={{width:80,flexShrink:0}}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select><input className="inp" type="number" value={recurForm.amount} onChange={e=>setRecurForm(f=>({...f,amount:e.target.value}))}/></div></F><F label="Fee" th={th}><input className="inp" type="number" placeholder="0" value={recurForm.fee} onChange={e=>setRecurForm(f=>({...f,fee:e.target.value}))}/></F></R2>
            <R2><F label="Kategori" th={th}><select className="inp" value={recurForm.category} onChange={e=>setRecurForm(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></F><F label="Frekuensi" th={th}><select className="inp" value={recurForm.frequency} onChange={e=>setRecurForm(f=>({...f,frequency:e.target.value}))}>{RECUR_FREQ.map(f=><option key={f}>{f}</option>)}</select></F></R2>
            <F label="Tanggal" th={th}><input className="inp" type="number" min={1} max={31} value={recurForm.dayOfMonth} onChange={e=>setRecurForm(f=>({...f,dayOfMonth:e.target.value}))}/></F>
            <BtnRow onCancel={()=>setShowRecurForm(false)} onOk={submitRecur} label={editRecurId?"Simpan":"Tambah"} th={th}/>
          </div>
        </Overlay>
      )}

      {/* ══ BUDGET FORM ══ */}
      {showBudgetForm&&(
        <Overlay onClose={()=>setShowBudForm(false)} th={th} title="◎ Edit Budget Bulanan">
          {ENTITIES.map(e=>(
            <div key={e} style={{marginBottom:13}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}><div style={{width:7,height:7,borderRadius:"50%",background:ENTITY_COLORS[e]}}/><span style={{fontSize:13,fontWeight:700}}>{e}</span></div>
              <input className="inp" type="number" placeholder="0 = tidak ada limit" value={budgetForm[e]||""} onChange={e2=>setBudForm(f=>({...f,[e]:Number(e2.target.value)}))}/>
              {budgetForm[e]>0&&<div style={{fontSize:10,color:ENTITY_COLORS[e],marginTop:3}}>{fmtIDR(budgetForm[e])} / bulan</div>}
            </div>
          ))}
          <BtnRow onCancel={()=>setShowBudForm(false)} onOk={()=>{setBudgets(budgetForm);setShowBudForm(false);}} label="Simpan" th={th}/>
        </Overlay>
      )}
    </div>
  );
}

// ─── MINI COMPONENTS ──────────────────────────────────────────────────────────
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
const BtnRow = ({onCancel,onOk,label,th}) => <div style={{display:"flex",gap:10,marginTop:6}}><button className="btn-cancel" style={{background:th.bgInput,color:th.textMuted,border:`1px solid ${th.border}`}} onClick={onCancel}>Batal</button><button className="btn-confirm" onClick={onOk}>{label}</button></div>;

// ─── DYNAMIC CSS ──────────────────────────────────────────────────────────────
const css = th => `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${th.border};border-radius:2px}
.anim-in{animation:fu .28s cubic-bezier(.22,1,.36,1) both}
@keyframes fu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

.sidebar{width:214px;background:${th.bgNav};border-right:1px solid ${th.border};display:flex;flex-direction:column;justify-content:space-between;position:sticky;top:0;height:100vh;flex-shrink:0;backdrop-filter:blur(20px);transition:background .3s}
.brand{padding:18px 14px 14px;display:flex;align-items:center;gap:10;border-bottom:1px solid ${th.border};margin-bottom:8px}
.brand-icon{width:34px;height:34px;background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.brand-name{font-weight:800;font-size:14px;color:${th.text}}
.brand-sub{font-size:9px;color:${th.textMuted};letter-spacing:.3px}
.side-btn{display:flex;align-items:center;gap:9px;width:100%;padding:8px 11px;border:none;background:transparent;color:${th.textMuted};font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;border-radius:9px;margin-bottom:2px;transition:all .15s;text-align:left}
.side-btn:hover{background:${th.bgCard};color:${th.textSub}}
.side-btn.active{background:rgba(99,102,241,0.12);color:#a5b4fc}
.badge{background:#ef4444;color:white;border-radius:20px;padding:1px 6px;font-size:10px;font-weight:700;margin-left:auto}
.side-footer{padding:10px 12px;border-top:1px solid ${th.border}}
.side-act{display:block;width:100%;padding:6px 9px;border:none;background:transparent;color:${th.textMuted};font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;border-radius:7px;margin-bottom:3px;text-align:left;transition:all .15s}
.side-act:hover{background:${th.bgCard};color:${th.textSub}}

.main{flex:1;display:flex;flex-direction:column;min-width:0;overflow-x:hidden;transition:background .3s}
.topbar{padding:14px 22px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${th.border};background:${th.bgNav};backdrop-filter:blur(20px);position:sticky;top:0;z-index:40;transition:background .3s}
.page-title{font-weight:800;font-size:19px;color:${th.text};letter-spacing:-.3px}
.page-sub{font-size:11px;color:${th.textMuted};margin-top:2px}
.content{max-width:760px;width:100%;padding:18px 20px;transition:background .3s}

.theme-tog{background:${th.bgCard};border:1px solid ${th.border};width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .15s}
.theme-tog:hover{background:${th.bgCardHov}}
.btn-scan{background:rgba(99,102,241,.12);color:#a5b4fc;border:1px solid rgba(99,102,241,.25);padding:8px 14px;border-radius:9px;font-family:inherit;font-weight:700;font-size:12px;cursor:pointer;transition:all .15s}
.btn-scan:hover{background:rgba(99,102,241,.2)}
.btn-add{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;padding:8px 16px;border-radius:9px;font-family:inherit;font-weight:700;font-size:12px;cursor:pointer;transition:filter .15s}
.btn-add:hover{filter:brightness(1.12)}

.alert-dot{background:#ef4444;color:white;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:700}
.alert-bar{display:flex;align-items:center;gap:11px;padding:10px 13px;border-radius:11px;margin-bottom:7px;animation:fu .3s ease both}
.alert-bar.danger{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2)}
.alert-bar.warning{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2)}
.alert-x{background:transparent;border:none;color:${th.textMuted};cursor:pointer;font-size:13px;margin-left:auto}

.hero-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:22px}
.hero-card{border-radius:13px;padding:15px;border:1px solid;position:relative;overflow:hidden;transition:transform .2s}
.hero-card:hover{transform:translateY(-2px)}

.glass-card{background:${th.bgCard};border:1px solid ${th.border};border-radius:13px;backdrop-filter:blur(10px);transition:background .3s,border-color .15s}
.card-hov{transition:transform .2s,background .15s,border-color .15s;cursor:pointer}
.card-hov:hover{transform:translateY(-2px);background:${th.bgCardHov};border-color:rgba(99,102,241,.25)}
.sec-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.sec-label{font-size:10px;color:${th.textMuted};font-weight:700;letter-spacing:1.5px;text-transform:uppercase}
.tab-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:13px}
.link-btn{background:transparent;border:none;color:#6366f1;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;padding:4px 8px;border-radius:6px}
.link-btn:hover{background:rgba(99,102,241,.1)}

.credit-card{background:linear-gradient(135deg,var(--cc),var(--ca));border-radius:17px;padding:20px;color:white;box-shadow:0 10px 40px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.15);margin-bottom:13px;position:relative;overflow:hidden}
.credit-card::before{content:"";position:absolute;top:-40px;right:-40px;width:130px;height:130px;border-radius:50%;background:rgba(255,255,255,.07)}
.btn-cc{background:rgba(255,255,255,.12);color:rgba(255,255,255,.85);border:1px solid rgba(255,255,255,.2);padding:6px 13px;border-radius:8px;font-family:inherit;font-weight:600;font-size:11px;cursor:pointer;transition:background .15s}
.btn-cc:hover{background:rgba(255,255,255,.22)}

.tx-row{display:flex;align-items:flex-start;gap:11px;background:${th.bgCard};border:1px solid ${th.border};border-radius:11px;padding:11px 13px;margin-bottom:6px;transition:background .15s}
.tx-row:hover{background:${th.bgCardHov}}
.reimb-btn{background:${th.bgInput};color:${th.textMuted};border:1px solid ${th.border};padding:3px 8px;border-radius:5px;font-family:inherit;font-weight:700;font-size:10px;cursor:pointer;white-space:nowrap;transition:all .15s}
.reimb-btn.done{background:rgba(16,185,129,.1);color:#4ade80;border-color:rgba(16,185,129,.25)}
.icon-btn{background:${th.bgInput};border:1px solid ${th.border};color:${th.textMuted};padding:3px 7px;border-radius:5px;font-size:10px;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
.icon-btn.danger{color:#f87171;border-color:rgba(239,68,68,.2)}

.search-box{width:100%;background:${th.bgInput};border:1px solid ${th.border};color:${th.text};padding:9px 13px;border-radius:10px;font-family:inherit;font-size:13px;outline:none;transition:border-color .15s}
.search-box:focus{border-color:rgba(99,102,241,.4)}
.mini-sel{background:${th.bgInput};border:1px solid ${th.border};color:${th.textSub};padding:6px 9px;border-radius:8px;font-family:inherit;font-size:11px;outline:none;cursor:pointer}
.mini-sel option{background:${th.bgModal}}

.btn-sm{background:${th.bgInput};border:1px solid ${th.border};color:${th.textSub};padding:5px 11px;border-radius:7px;font-family:inherit;font-weight:600;font-size:11px;cursor:pointer;transition:all .15s}
.btn-sm:hover{background:${th.bgCardHov}}
.btn-sm.danger{color:#f87171;border-color:rgba(239,68,68,.2)}
.btn-sm:disabled{opacity:.35;cursor:not-allowed}

.scan-drop{position:relative;border:2px dashed ${th.border};border-radius:14px;padding:40px 20px;text-align:center;cursor:pointer;transition:all .2s;min-height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center;background-size:contain!important;background-repeat:no-repeat!important;background-position:center!important}
.scan-drop:hover{border-color:rgba(99,102,241,.5);background:rgba(99,102,241,.03)}

.overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:200;padding:14px;overflow-y:auto;backdrop-filter:blur(6px)}
.modal{border-radius:18px;padding:22px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.5);transition:background .3s}
.close-x{width:29px;height:29px;border-radius:8px;cursor:pointer;font-size:12px;font-family:inherit;display:flex;align-items:center;justify-content:center;transition:all .15s;color:${th.textMuted}}
.inp{background:${th.bgInput};border:1px solid ${th.border};color:${th.text};padding:8px 11px;border-radius:9px;font-family:inherit;font-size:12px;width:100%;outline:none;transition:border-color .15s}
.inp:focus{border-color:rgba(99,102,241,.5)}
.inp option{background:${th.bgModal}}
.tog-row{display:flex;align-items:center;gap:11px;padding:10px 13px;border:1px solid;border-radius:10px;cursor:pointer;transition:all .15s}
.tog-check{width:19px;height:19px;border-radius:6px;border:2px solid ${th.border};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;flex-shrink:0;transition:all .2s}
.tog-check.on{background:#10b981;border-color:#10b981;color:#fff}
.btn-confirm{flex:2;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;padding:10px;border-radius:9px;font-family:inherit;font-weight:700;font-size:13px;cursor:pointer;transition:filter .15s}
.btn-confirm:hover{filter:brightness(1.1)}
.btn-confirm:disabled{opacity:.5;cursor:not-allowed}
.btn-cancel{flex:1;padding:10px;border-radius:9px;font-family:inherit;font-weight:600;font-size:12px;cursor:pointer;transition:all .15s}

.card-sel{background:${th.bgInput};border:1px solid ${th.border};color:${th.textMuted};padding:7px 12px;border-radius:9px;font-family:inherit;font-weight:600;font-size:11px;cursor:pointer;transition:all .15s}
.card-sel.active{background:linear-gradient(135deg,var(--cc),var(--ca));color:white;border-color:transparent}

.bottom-nav{display:none;position:fixed;bottom:0;left:0;right:0;background:${th.bgNav};border-top:1px solid ${th.border};z-index:50;backdrop-filter:blur(20px)}
.bot-btn{display:flex;flex-direction:column;align-items:center;background:transparent;border:none;color:${th.textMuted};font-family:inherit;cursor:pointer;padding:8px 10px 12px;border-radius:10px;transition:color .15s;min-width:52px}
.bot-btn.active{color:#a5b4fc}

@media(max-width:768px){
  .sidebar{display:none!important}
  .bottom-nav{display:flex!important;justify-content:space-around}
  .main{padding-bottom:70px}
  .content{padding:14px!important}
  .hero-grid{grid-template-columns:repeat(2,1fr)!important}
  .topbar{padding:12px 14px!important}
}
`;