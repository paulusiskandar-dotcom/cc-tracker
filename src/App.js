import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const CURRENCIES = [
  { code: "IDR", symbol: "Rp", rate: 1, flag: "🇮🇩" },
  { code: "USD", symbol: "$", rate: 16400, flag: "🇺🇸" },
  { code: "SGD", symbol: "S$", rate: 12200, flag: "🇸🇬" },
  { code: "MYR", symbol: "RM", rate: 3700, flag: "🇲🇾" },
  { code: "JPY", symbol: "¥", rate: 110, flag: "🇯🇵" },
  { code: "EUR", symbol: "€", rate: 17800, flag: "🇪🇺" },
  { code: "AUD", symbol: "A$", rate: 10500, flag: "🇦🇺" },
];
const CATEGORIES = ["Belanja","Makan & Minum","Transport","Tagihan","Hotel/Travel","Elektronik","Kesehatan","Hiburan","Lainnya"];
const ENTITIES = ["Pribadi","Hamasa","SDC","Lainnya"];
const ENTITY_COLORS = { Pribadi:"#6366f1", Hamasa:"#10b981", SDC:"#f59e0b", Lainnya:"#64748b" };
const ENTITY_GRADIENTS = { Pribadi:["#4f46e5","#6366f1"], Hamasa:["#059669","#10b981"], SDC:["#d97706","#f59e0b"], Lainnya:["#475569","#64748b"] };
const NETWORKS = ["Visa","Mastercard","JCB","Amex"];
const BANKS = ["BCA","Mandiri","BNI","CIMB","BRI","Permata","Danamon","OCBC","Lainnya"];
const RECUR_FREQ = ["Bulanan","Mingguan","Tahunan"];

const DEFAULT_CARDS = [
  { id:"bca", name:"BCA Mastercard", bank:"BCA", last4:"4521", color:"#1d4ed8", accent:"#60a5fa", limit:15000000, statementDay:25, dueDay:17, targetPct:30, network:"Mastercard" },
  { id:"mandiri", name:"Mandiri Visa", bank:"Mandiri", last4:"8832", color:"#4338ca", accent:"#818cf8", limit:20000000, statementDay:28, dueDay:20, targetPct:40, network:"Visa" },
  { id:"bni", name:"BNI Visa", bank:"BNI", last4:"1107", color:"#c2410c", accent:"#fb923c", limit:10000000, statementDay:15, dueDay:7, targetPct:25, network:"Visa" },
  { id:"cimb", name:"CIMB Niaga", bank:"CIMB", last4:"3390", color:"#991b1b", accent:"#f87171", limit:12000000, statementDay:20, dueDay:12, targetPct:35, network:"Mastercard" },
];
const DEFAULT_TX = [
  { id:1, date:"2025-04-01", card:"bca", desc:"Groceries Hypermart", amount:450000, currency:"IDR", fee:0, category:"Belanja", entity:"Pribadi", reimbursed:true, notes:"", recurring:false },
  { id:2, date:"2025-04-02", card:"mandiri", desc:"Client Dinner SCBD", amount:320000, currency:"IDR", fee:0, category:"Makan & Minum", entity:"Hamasa", reimbursed:false, notes:"Meeting vendor", recurring:false },
  { id:3, date:"2025-04-03", card:"bni", desc:"Grab Car", amount:85000, currency:"IDR", fee:0, category:"Transport", entity:"Pribadi", reimbursed:true, notes:"", recurring:false },
  { id:4, date:"2025-04-04", card:"bca", desc:"Shopee Online", amount:899000, currency:"IDR", fee:5000, category:"Belanja", entity:"Pribadi", reimbursed:false, notes:"", recurring:false },
  { id:5, date:"2025-04-05", card:"cimb", desc:"Hotel Aston Semarang", amount:1250000, currency:"IDR", fee:0, category:"Hotel/Travel", entity:"SDC", reimbursed:false, notes:"1 malam", recurring:false },
  { id:6, date:"2025-03-20", card:"bca", desc:"Alfamart", amount:125000, currency:"IDR", fee:0, category:"Belanja", entity:"Pribadi", reimbursed:true, notes:"", recurring:false },
  { id:7, date:"2025-03-22", card:"mandiri", desc:"Makan Siang Tim", amount:210000, currency:"IDR", fee:0, category:"Makan & Minum", entity:"Hamasa", reimbursed:true, notes:"", recurring:false },
  { id:8, date:"2025-03-28", card:"bni", desc:"Tokopedia Laptop", amount:2750000, currency:"IDR", fee:12000, category:"Elektronik", entity:"SDC", reimbursed:false, notes:"", recurring:false },
  { id:9, date:"2025-02-14", card:"mandiri", desc:"Hotel Singapore", amount:280, currency:"SGD", fee:0, category:"Hotel/Travel", entity:"Pribadi", reimbursed:false, notes:"Valentine trip", recurring:false },
  { id:10, date:"2025-02-15", card:"bca", desc:"Dinner Singapore", amount:85, currency:"SGD", fee:0, category:"Makan & Minum", entity:"Pribadi", reimbursed:false, notes:"", recurring:false },
];
const DEFAULT_INSTALLMENTS = [
  { id:1, card:"bca", desc:"iPhone 15 Pro", totalAmount:18000000, months:12, startDate:"2025-01-01", monthlyAmount:1500000, currency:"IDR", entity:"Pribadi", paidMonths:3 },
  { id:2, card:"mandiri", desc:"Laptop Dell", totalAmount:24000000, months:24, startDate:"2024-10-01", monthlyAmount:1000000, currency:"IDR", entity:"SDC", paidMonths:6 },
];
const DEFAULT_BUDGETS = { Pribadi:3000000, Hamasa:8000000, SDC:5000000, Lainnya:1000000 };
const DEFAULT_RECURRING = [
  { id:1, card:"bca", desc:"Netflix", amount:54000, currency:"IDR", fee:0, category:"Hiburan", entity:"Pribadi", frequency:"Bulanan", dayOfMonth:1, active:true },
  { id:2, card:"mandiri", desc:"Spotify", amount:54990, currency:"IDR", fee:0, category:"Hiburan", entity:"Pribadi", frequency:"Bulanan", dayOfMonth:15, active:true },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const getCur = (code) => CURRENCIES.find(c => c.code === code) || CURRENCIES[0];
const toIDR = (amount, currency, rates) => {
  const r = rates || {};
  const base = getCur(currency).rate;
  return amount * (r[currency] || base);
};
const fmtIDR = (n, short=false) => {
  const v = Math.abs(Number(n||0));
  if (short && v>=1000000000) return "Rp "+(v/1000000000).toFixed(1)+"M";
  if (short && v>=1000000) return "Rp "+(v/1000000).toFixed(1)+"jt";
  if (short && v>=1000) return "Rp "+(v/1000).toFixed(0)+"rb";
  return "Rp "+v.toLocaleString("id-ID");
};
const fmtCur = (amount, currency) => {
  const cur = getCur(currency);
  const v = Number(amount||0);
  if (currency === "IDR") return "Rp "+v.toLocaleString("id-ID");
  return cur.symbol+" "+v.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
};
const today = () => new Date().toISOString().slice(0,10);
const ym = d => d.slice(0,7);
const mlFull = ymStr => { const [y,m]=ymStr.split("-"); return new Date(y,m-1).toLocaleDateString("id-ID",{month:"long",year:"numeric"}); };
const mlShort = ymStr => { const [y,m]=ymStr.split("-"); return new Date(y,m-1).toLocaleDateString("id-ID",{month:"short",year:"2-digit"}); };
const daysUntil = dayOfMonth => {
  const now = new Date();
  let t = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
  if (t <= now) t = new Date(now.getFullYear(), now.getMonth()+1, dayOfMonth);
  return Math.ceil((t-now)/86400000);
};
const urgencyColor = days => days <= 2 ? "#ef4444" : days <= 5 ? "#f59e0b" : days <= 10 ? "#eab308" : "#22c55e";

async function ls(key,fb){ try{ const r=await window.storage.get(key); return r?JSON.parse(r.value):fb; }catch{ return fb; } }
async function ss(key,val){ try{ await window.storage.set(key,JSON.stringify(val)); }catch{} }

function exportCSV(transactions, cards){
  const cm = Object.fromEntries(cards.map(c=>[c.id,c.name]));
  const hdr = ["Tanggal","Kartu","Keterangan","Kategori","Entitas","Nominal","Mata Uang","Fee","Reimburse","Catatan"];
  const rows = transactions.map(t=>[t.date,cm[t.card]||t.card,`"${t.desc}"`,t.category,t.entity,t.amount,t.currency,t.fee||0,t.reimbursed?"Ya":"Tidak",`"${t.notes||""}"`]);
  const csv = [hdr,...rows].map(r=>r.join(",")).join("\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"})); a.download=`cc-tracker-${today()}.csv`; a.click();
}

// ─── CUSTOM TOOLTIP ───────────────────────────────────────────────────────────
const CTip = ({active,payload,label}) => {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:"rgba(10,10,20,0.95)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:"10px 14px",backdropFilter:"blur(20px)",boxShadow:"0 8px 32px rgba(0,0,0,0.4)"}}>
      <div style={{color:"#64748b",fontSize:11,fontWeight:700,marginBottom:6,letterSpacing:0.5}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:p.color||p.fill}}/>
          <span style={{color:"#94a3b8",fontSize:11}}>{p.name}:</span>
          <span style={{color:"#f1f5f9",fontFamily:"monospace",fontWeight:700,fontSize:11}}>{fmtIDR(p.value,true)}</span>
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [cards,setCards]=useState(DEFAULT_CARDS);
  const [transactions,setTransactions]=useState(DEFAULT_TX);
  const [installments,setInstallments]=useState(DEFAULT_INSTALLMENTS);
  const [budgets,setBudgets]=useState(DEFAULT_BUDGETS);
  const [recurringList,setRecurringList]=useState(DEFAULT_RECURRING);
  const [fxRates,setFxRates]=useState({USD:16400,SGD:12200,MYR:3700,JPY:110,EUR:17800,AUD:10500});
  const [loaded,setLoaded]=useState(false);
  const [tab,setTab]=useState("dashboard");
  const [sideOpen,setSideOpen]=useState(false);
  const [nextId,setNextId]=useState(300);
  const [alerts,setAlerts]=useState([]);
  const [dismissedAlerts,setDismissedAlerts]=useState([]);
  const [showTxForm,setShowTxForm]=useState(false);
  const [showCardForm,setShowCardForm]=useState(false);
  const [showInstForm,setShowInstForm]=useState(false);
  const [showBudgetForm,setShowBudgetForm]=useState(false);
  const [showRecurForm,setShowRecurForm]=useState(false);
  const [showFxPanel,setShowFxPanel]=useState(false);
  const [showStatementModal,setShowStatementModal]=useState(false);
  const [editTxId,setEditTxId]=useState(null);
  const [editCardId,setEditCardId]=useState(null);
  const [editInstId,setEditInstId]=useState(null);
  const [editRecurId,setEditRecurId]=useState(null);
  const [detailCardId,setDetailCardId]=useState(null);
  const [filterCard,setFilterCard]=useState("all");
  const [filterReimb,setFilterReimb]=useState("all");
  const [filterMonth,setFilterMonth]=useState("all");
  const [filterEntity,setFilterEntity]=useState("all");
  const [searchQ,setSearchQ]=useState("");
  const [statementCard,setStatementCard]=useState("");

  const ET = {date:today(),card:cards[0]?.id||"",desc:"",amount:"",currency:"IDR",fee:"",category:"Belanja",entity:"Pribadi",reimbursed:false,notes:"",recurring:false};
  const EC = {name:"",bank:"BCA",last4:"",color:"#1d4ed8",accent:"#60a5fa",limit:"",statementDay:25,dueDay:17,targetPct:30,network:"Visa"};
  const EI = {card:cards[0]?.id||"",desc:"",totalAmount:"",months:12,startDate:today(),currency:"IDR",entity:"Pribadi"};
  const ER = {card:cards[0]?.id||"",desc:"",amount:"",currency:"IDR",fee:"",category:"Hiburan",entity:"Pribadi",frequency:"Bulanan",dayOfMonth:1,active:true};

  const [txForm,setTxForm]=useState(ET);
  const [cardForm,setCardForm]=useState(EC);
  const [instForm,setInstForm]=useState(EI);
  const [recurForm,setRecurForm]=useState(ER);
  const [budgetForm,setBudgetForm]=useState(DEFAULT_BUDGETS);

  useEffect(()=>{
    (async()=>{
      const c=await ls("cc4-cards",DEFAULT_CARDS);
      const t=await ls("cc4-tx",DEFAULT_TX);
      const i=await ls("cc4-inst",DEFAULT_INSTALLMENTS);
      const b=await ls("cc4-budgets",DEFAULT_BUDGETS);
      const r=await ls("cc4-recur",DEFAULT_RECURRING);
      const fx=await ls("cc4-fx",fxRates);
      const n=await ls("cc4-nextid",300);
      const da=await ls("cc4-dismissed",[]);
      setCards(c);setTransactions(t);setInstallments(i);setBudgets(b);setRecurringList(r);setFxRates(fx);setNextId(n);setDismissedAlerts(da);
      setLoaded(true);
    })();
  },[]);

  useEffect(()=>{ if(loaded){ss("cc4-cards",cards);} },[cards,loaded]);
  useEffect(()=>{ if(loaded){ss("cc4-tx",transactions);} },[transactions,loaded]);
  useEffect(()=>{ if(loaded){ss("cc4-inst",installments);} },[installments,loaded]);
  useEffect(()=>{ if(loaded){ss("cc4-budgets",budgets);} },[budgets,loaded]);
  useEffect(()=>{ if(loaded){ss("cc4-recur",recurringList);} },[recurringList,loaded]);
  useEffect(()=>{ if(loaded){ss("cc4-fx",fxRates);} },[fxRates,loaded]);
  useEffect(()=>{ if(loaded){ss("cc4-nextid",nextId);} },[nextId,loaded]);
  useEffect(()=>{ if(loaded){ss("cc4-dismissed",dismissedAlerts);} },[dismissedAlerts,loaded]);

  const cardMap = useMemo(()=>Object.fromEntries(cards.map(c=>[c.id,c])),[cards]);
  const txIDR = useCallback((t)=>toIDR(t.amount,t.currency,fxRates)+(t.fee||0),[fxRates]);
  const curMonth = ym(today());

  // ── Smart Alerts
  const activeAlerts = useMemo(()=>{
    const a = [];
    // Due date alerts
    cards.forEach(c=>{
      const d=daysUntil(c.dueDay);
      if(d<=5) a.push({id:`due-${c.id}`,type:"danger",icon:"⚠️",title:`Jatuh Tempo: ${c.name}`,msg:`Tagihan jatuh tempo dalam ${d} hari (Tgl ${c.dueDay})`,card:c.id});
      else if(d<=10) a.push({id:`due-warn-${c.id}`,type:"warning",icon:"📅",title:`Reminder: ${c.name}`,msg:`Tagihan jatuh tempo dalam ${d} hari`,card:c.id});
    });
    // Budget alerts
    ENTITIES.forEach(e=>{
      const budget = budgets[e]||0;
      if(!budget) return;
      const spent = transactions.filter(t=>t.entity===e&&ym(t.date)===curMonth).reduce((s,t)=>s+txIDR(t),0);
      const pct = spent/budget*100;
      if(pct>=100) a.push({id:`budget-over-${e}`,type:"danger",icon:"🚨",title:`Budget ${e} Habis!`,msg:`Sudah ${fmtIDR(spent,true)} dari ${fmtIDR(budget,true)} (${pct.toFixed(0)}%)`,entity:e});
      else if(pct>=80) a.push({id:`budget-warn-${e}`,type:"warning",icon:"💸",title:`Budget ${e} Hampir Habis`,msg:`${pct.toFixed(0)}% terpakai — ${fmtIDR(budget-spent,true)} tersisa`,entity:e});
    });
    // Usage alerts
    cards.forEach(c=>{
      const spent=transactions.filter(t=>t.card===c.id&&ym(t.date)===curMonth).reduce((s,t)=>s+txIDR(t),0);
      const pct=spent/c.limit*100;
      if(pct>c.targetPct+20) a.push({id:`usage-${c.id}`,type:"warning",icon:"📈",title:`Pemakaian ${c.name} Tinggi`,msg:`${pct.toFixed(0)}% dari limit — melebihi target ${c.targetPct}%`,card:c.id});
    });
    // Unpaid installments
    installments.forEach(i=>{
      const monthly=i.monthlyAmount||(i.totalAmount/i.months);
      if(i.paidMonths<i.months) a.push({id:`inst-${i.id}`,type:"info",icon:"🔄",title:`Cicilan: ${i.desc}`,msg:`${fmtIDR(toIDR(monthly,i.currency,fxRates),true)}/bulan · ${i.months-i.paidMonths} bulan tersisa`});
    });
    return a.filter(a=>!dismissedAlerts.includes(a.id));
  },[cards,transactions,budgets,installments,curMonth,txIDR,dismissedAlerts,fxRates]);

  // ── Per-card stats
  const cardStats = useMemo(()=>cards.map(c=>{
    const allTx=transactions.filter(t=>t.card===c.id);
    const thisM=allTx.filter(t=>ym(t.date)===curMonth);
    const spent=thisM.reduce((s,t)=>s+txIDR(t),0);
    const totalSpent=allTx.reduce((s,t)=>s+txIDR(t),0);
    const reimbursed=allTx.filter(t=>t.reimbursed).reduce((s,t)=>s+toIDR(t.amount,t.currency,fxRates),0);
    const available=c.limit-spent;
    const usagePct=c.limit>0?(spent/c.limit*100):0;
    const targetAmt=c.limit*(c.targetPct/100);
    const instTotal=installments.filter(i=>i.card===c.id).reduce((s,i)=>s+toIDR(i.monthlyAmount||(i.totalAmount/i.months),i.currency,fxRates),0);
    return{...c,allTx,thisM,spent,totalSpent,reimbursed,available,usagePct,targetAmt,instTotal,txCount:allTx.length,dueIn:daysUntil(c.dueDay),statIn:daysUntil(c.statementDay)};
  }),[cards,transactions,installments,curMonth,txIDR,fxRates]);

  // ── Budget stats
  const budgetStats = useMemo(()=>ENTITIES.map(e=>{
    const budget=budgets[e]||0;
    const spent=transactions.filter(t=>t.entity===e&&ym(t.date)===curMonth).reduce((s,t)=>s+txIDR(t),0);
    const pct=budget>0?(spent/budget*100):0;
    const remaining=Math.max(0,budget-spent);
    const prevMonth=transactions.filter(t=>t.entity===e&&ym(t.date)===ym(new Date(new Date().setMonth(new Date().getMonth()-1)).toISOString().slice(0,10))).reduce((s,t)=>s+txIDR(t),0);
    const trend=prevMonth>0?((spent-prevMonth)/prevMonth*100):0;
    return{entity:e,budget,spent,pct,remaining,trend};
  }),[budgets,transactions,curMonth,txIDR]);

  // ── Global stats
  const stats = useMemo(()=>{
    const total=transactions.reduce((s,t)=>s+txIDR(t),0);
    const totalFees=transactions.reduce((s,t)=>s+(t.fee||0),0);
    const reimbursed=transactions.filter(t=>t.reimbursed).reduce((s,t)=>s+toIDR(t.amount,t.currency,fxRates),0);
    const pending=transactions.filter(t=>!t.reimbursed).reduce((s,t)=>s+toIDR(t.amount,t.currency,fxRates),0);
    const byEntity=Object.fromEntries(ENTITIES.map(e=>[e,transactions.filter(t=>t.entity===e).reduce((s,t)=>s+txIDR(t),0)]));
    return{total,totalFees,reimbursed,pending,byEntity,txCount:transactions.length};
  },[transactions,txIDR,fxRates]);

  // ── Chart data
  const chartData = useMemo(()=>{
    const months=[...new Set(transactions.map(t=>ym(t.date)))].sort().slice(-6);
    return months.map(m=>{
      const txs=transactions.filter(t=>ym(t.date)===m);
      const r={month:mlShort(m),monthFull:mlFull(m)};
      ENTITIES.forEach(e=>{r[e]=txs.filter(t=>t.entity===e).reduce((s,t)=>s+txIDR(t),0);});
      r.Total=txs.reduce((s,t)=>s+txIDR(t),0);
      r.Reimburse=txs.filter(t=>t.reimbursed).reduce((s,t)=>s+toIDR(t.amount,t.currency,fxRates),0);
      return r;
    });
  },[transactions,txIDR,fxRates]);

  // ── Statement Simulator
  const statementData = useMemo(()=>{
    if(!statementCard) return null;
    const c=cardMap[statementCard]; if(!c) return null;
    const cs=cardStats.find(x=>x.id===statementCard); if(!cs) return null;
    const txThisMonth=cs.thisM;
    const instMonthly=installments.filter(i=>i.card===statementCard&&i.paidMonths<i.months).reduce((s,i)=>s+toIDR(i.monthlyAmount||(i.totalAmount/i.months),i.currency,fxRates),0);
    const fees=txThisMonth.reduce((s,t)=>s+(t.fee||0),0);
    const pokok=txThisMonth.reduce((s,t)=>s+toIDR(t.amount,t.currency,fxRates),0);
    const total=pokok+instMonthly+fees;
    const minPayment=Math.max(total*0.1,100000);
    return{c,cs,pokok,instMonthly,fees,total,minPayment,txCount:txThisMonth.length,dueIn:cs.dueIn};
  },[statementCard,cardMap,cardStats,installments,fxRates]);

  // ── All months
  const allMonths=useMemo(()=>[...new Set(transactions.map(t=>ym(t.date)))].sort().reverse(),[transactions]);

  // ── Filtered transactions
  const filtered=useMemo(()=>transactions
    .filter(t=>filterCard==="all"||t.card===filterCard)
    .filter(t=>filterReimb==="all"||String(t.reimbursed)===filterReimb)
    .filter(t=>filterMonth==="all"||ym(t.date)===filterMonth)
    .filter(t=>filterEntity==="all"||t.entity===filterEntity)
    .filter(t=>!searchQ||t.desc.toLowerCase().includes(searchQ.toLowerCase())||(t.notes||"").toLowerCase().includes(searchQ.toLowerCase()))
    .sort((a,b)=>b.date.localeCompare(a.date)),[transactions,filterCard,filterReimb,filterMonth,filterEntity,searchQ]);

  // ── Monthly summary
  const monthlySummary=useMemo(()=>allMonths.map(m=>{
    const txs=transactions.filter(t=>ym(t.date)===m);
    const total=txs.reduce((s,t)=>s+txIDR(t),0);
    const reimbursed=txs.filter(t=>t.reimbursed).reduce((s,t)=>s+toIDR(t.amount,t.currency,fxRates),0);
    const fees=txs.reduce((s,t)=>s+(t.fee||0),0);
    const byEntity=Object.fromEntries(ENTITIES.map(e=>[e,txs.filter(t=>t.entity===e).reduce((s,t)=>s+txIDR(t),0)]));
    const byCard=cards.map(c=>({...c,amt:txs.filter(t=>t.card===c.id).reduce((s,t)=>s+txIDR(t),0)})).filter(c=>c.amt>0);
    const byCategory=CATEGORIES.map(cat=>({cat,amt:txs.filter(t=>t.category===cat).reduce((s,t)=>s+txIDR(t),0)})).filter(c=>c.amt>0).sort((a,b)=>b.amt-a.amt);
    return{month:m,txs,total,reimbursed,pending:total-reimbursed-fees,fees,byEntity,byCard,byCategory,count:txs.length};
  }),[transactions,allMonths,cards,txIDR,fxRates]);

  const instStats=useMemo(()=>installments.map(i=>{
    const monthly=i.monthlyAmount||Math.round(i.totalAmount/i.months);
    const remaining=i.months-i.paidMonths;
    return{...i,monthly,remaining,remainingAmt:monthly*remaining,paidAmt:monthly*i.paidMonths,pct:(i.paidMonths/i.months)*100};
  }),[installments]);

  const entityPie=ENTITIES.map(e=>({name:e,value:stats.byEntity[e]||0})).filter(d=>d.value>0);

  // ─── HANDLERS ──────────────────────────────────────────────────────────────
  const newId=()=>{ const id=nextId; setNextId(n=>n+1); return id; };
  const submitTx=()=>{
    if(!txForm.desc||!txForm.amount||!txForm.card) return;
    const d={...txForm,amount:Number(txForm.amount),fee:Number(txForm.fee||0)};
    if(editTxId){setTransactions(p=>p.map(t=>t.id===editTxId?{...d,id:editTxId}:t));setEditTxId(null);}
    else{setTransactions(p=>[...p,{...d,id:newId()}]);}
    setTxForm({...ET,card:cards[0]?.id||""}); setShowTxForm(false);
  };
  const submitCard=()=>{
    if(!cardForm.name||!cardForm.last4||!cardForm.limit) return;
    const id=editCardId||cardForm.name.toLowerCase().replace(/\s+/g,"-")+"-"+Date.now();
    const d={...cardForm,limit:Number(cardForm.limit),statementDay:Number(cardForm.statementDay),dueDay:Number(cardForm.dueDay),targetPct:Number(cardForm.targetPct)};
    if(editCardId){setCards(p=>p.map(c=>c.id===editCardId?{...d,id:editCardId}:c));setEditCardId(null);}
    else setCards(p=>[...p,{...d,id}]);
    setCardForm(EC); setShowCardForm(false);
  };
  const submitInst=()=>{
    if(!instForm.desc||!instForm.totalAmount||!instForm.card) return;
    const monthly=Math.round(Number(instForm.totalAmount)/Number(instForm.months));
    const d={...instForm,totalAmount:Number(instForm.totalAmount),months:Number(instForm.months),monthlyAmount:monthly,paidMonths:0};
    if(editInstId){setInstallments(p=>p.map(i=>i.id===editInstId?{...d,id:editInstId,paidMonths:p.find(x=>x.id===editInstId)?.paidMonths||0}:i));setEditInstId(null);}
    else setInstallments(p=>[...p,{...d,id:newId()}]);
    setInstForm({...EI,card:cards[0]?.id||""}); setShowInstForm(false);
  };
  const submitRecur=()=>{
    if(!recurForm.desc||!recurForm.amount||!recurForm.card) return;
    const d={...recurForm,amount:Number(recurForm.amount),fee:Number(recurForm.fee||0),dayOfMonth:Number(recurForm.dayOfMonth)};
    if(editRecurId){setRecurringList(p=>p.map(r=>r.id===editRecurId?{...d,id:editRecurId}:r));setEditRecurId(null);}
    else setRecurringList(p=>[...p,{...d,id:newId()}]);
    setRecurForm({...ER,card:cards[0]?.id||""}); setShowRecurForm(false);
  };
  const saveBudgets=()=>{ setBudgets(budgetForm); setShowBudgetForm(false); };
  const editTx=t=>{ setTxForm({...t,amount:String(t.amount),fee:String(t.fee||"")}); setEditTxId(t.id); setShowTxForm(true); };
  const deleteTx=id=>setTransactions(p=>p.filter(t=>t.id!==id));
  const toggleReimb=id=>setTransactions(p=>p.map(t=>t.id===id?{...t,reimbursed:!t.reimbursed}:t));
  const editCard=c=>{ setCardForm({...c,limit:String(c.limit)}); setEditCardId(c.id); setShowCardForm(true); };
  const deleteCard=id=>{ if(window.confirm("Hapus kartu ini?")){ setCards(p=>p.filter(c=>c.id!==id)); setTransactions(p=>p.filter(t=>t.card!==id)); }};
  const markInstPaid=id=>setInstallments(p=>p.map(i=>i.id===id&&i.paidMonths<i.months?{...i,paidMonths:i.paidMonths+1}:i));
  const deleteInst=id=>setInstallments(p=>p.filter(i=>i.id!==id));
  const toggleRecur=id=>setRecurringList(p=>p.map(r=>r.id===id?{...r,active:!r.active}:r));
  const deleteRecur=id=>setRecurringList(p=>p.filter(r=>r.id!==id));
  const applyRecurNow=r=>{
    const t={...r,id:newId(),date:today(),notes:`Auto dari recurring (${r.frequency})`,reimbursed:false,recurring:true};
    setTransactions(p=>[...p,t]);
  };
  const dismissAlert=id=>setDismissedAlerts(p=>[...p,id]);

  const detailCard=detailCardId?cardStats.find(c=>c.id===detailCardId):null;

  // ─── TABS CONFIG ───────────────────────────────────────────────────────────
  const TABS=[
    {id:"dashboard",icon:"◈",label:"Dashboard"},
    {id:"cards",icon:"▣",label:"Kartu"},
    {id:"transactions",icon:"≡",label:"Transaksi"},
    {id:"installments",icon:"⟳",label:"Cicilan"},
    {id:"recurring",icon:"↺",label:"Recurring"},
    {id:"budget",icon:"◎",label:"Budget"},
    {id:"monthly",icon:"◷",label:"Bulanan"},
  ];

  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div style={S.root}>
      <style>{CSS}</style>

      {/* ── SIDEBAR (desktop) / BOTTOM NAV (mobile) */}
      <nav style={S.sidebar}>
        <div style={S.sideTop}>
          <div style={S.brandMark}>
            <div style={S.brandIcon}>💳</div>
            <div>
              <div style={S.brandName}>CC Tracker</div>
              <div style={S.brandSub}>Hamasa · SDC · Pribadi</div>
            </div>
          </div>
          <div style={{padding:"0 12px",marginBottom:8}}>
            {TABS.map(t=>(
              <button key={t.id} className={`side-btn ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>
                <span style={{fontSize:16,width:20,textAlign:"center"}}>{t.icon}</span>
                <span>{t.label}</span>
                {t.id==="dashboard"&&activeAlerts.length>0&&<span className="badge">{activeAlerts.length}</span>}
              </button>
            ))}
          </div>
        </div>
        <div style={{padding:"12px 16px",borderTop:"1px solid rgba(255,255,255,0.04)"}}>
          <button className="side-action" onClick={()=>setShowFxPanel(true)}>💱 Update Kurs</button>
          <button className="side-action" onClick={()=>{setStatementCard(cards[0]?.id||"");setShowStatementModal(true);}}>🧾 Statement Simulator</button>
          <button className="side-action" onClick={()=>exportCSV(transactions,cards)}>📥 Export CSV</button>
        </div>
      </nav>

      {/* ── MOBILE BOTTOM NAV */}
      <div style={S.bottomNav}>
        {TABS.slice(0,5).map(t=>(
          <button key={t.id} className={`bottom-btn ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>
            <span style={{fontSize:18}}>{t.icon}</span>
            <span style={{fontSize:9,marginTop:2}}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── MAIN CONTENT */}
      <main style={S.main}>

        {/* ── TOP BAR */}
        <div style={S.topbar}>
          <div>
            <div style={S.pageTitle}>{TABS.find(t=>t.id===tab)?.label}</div>
            <div style={S.pageSub}>{new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {activeAlerts.length>0&&(
              <div style={S.alertDot}>{activeAlerts.length}</div>
            )}
            <button className="btn-add" onClick={()=>{setEditTxId(null);setTxForm({...ET,card:cards[0]?.id||""});setShowTxForm(true);}}>
              <span style={{fontSize:18,lineHeight:1}}>+</span> Transaksi
            </button>
          </div>
        </div>

        <div style={S.content}>

          {/* ══ ALERTS BANNER ══ */}
          {activeAlerts.length>0&&tab==="dashboard"&&(
            <div style={{marginBottom:20}}>
              {activeAlerts.slice(0,3).map(a=>(
                <div key={a.id} className={`alert-bar alert-${a.type}`}>
                  <span style={{fontSize:16}}>{a.icon}</span>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:13}}>{a.title}</div>
                    <div style={{fontSize:11,opacity:0.8,marginTop:1}}>{a.msg}</div>
                  </div>
                  <button className="alert-dismiss" onClick={()=>dismissAlert(a.id)}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* ══════════ DASHBOARD ══════════ */}
          {tab==="dashboard"&&(<>
            {/* Hero stats */}
            <div style={S.heroGrid}>
              <div className="hero-card gradient-purple anim-in">
                <div style={S.heroLabel}>Total Pengeluaran</div>
                <div style={S.heroValue}>{fmtIDR(stats.total)}</div>
                <div style={S.heroSub}>{stats.txCount} transaksi · {cards.length} kartu aktif</div>
                <div style={S.heroDeco}>💳</div>
              </div>
              <div className="hero-card gradient-green anim-in" style={{animationDelay:".05s"}}>
                <div style={S.heroLabel}>Sudah Reimburse</div>
                <div style={S.heroValue}>{fmtIDR(stats.reimbursed)}</div>
                <div style={S.heroSub}>{transactions.filter(t=>t.reimbursed).length} transaksi</div>
                <div style={S.heroDeco}>✅</div>
              </div>
              <div className="hero-card gradient-amber anim-in" style={{animationDelay:".1s"}}>
                <div style={S.heroLabel}>Belum Reimburse</div>
                <div style={S.heroValue}>{fmtIDR(stats.pending)}</div>
                <div style={S.heroSub}>{transactions.filter(t=>!t.reimbursed).length} transaksi</div>
                <div style={S.heroDeco}>⏳</div>
              </div>
              <div className="hero-card gradient-slate anim-in" style={{animationDelay:".15s"}}>
                <div style={S.heroLabel}>Total Fee</div>
                <div style={S.heroValue}>{fmtIDR(stats.totalFees)}</div>
                <div style={S.heroSub}>Tidak direimburse</div>
                <div style={S.heroDeco}>💸</div>
              </div>
            </div>

            {/* Budget Overview */}
            <div style={S.sectionHead}>
              <div style={S.secLabel}>Budget Bulan Ini</div>
              <button className="link-btn" onClick={()=>{setBudgetForm({...budgets});setShowBudgetForm(true);}}>Edit Budget</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:24}}>
              {budgetStats.map(b=>{
                const over=b.pct>=100, warn=b.pct>=80;
                const barColor=over?"#ef4444":warn?"#f59e0b":ENTITY_COLORS[b.entity];
                return(
                  <div key={b.entity} className="glass-card anim-in" style={{padding:"14px 16px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:ENTITY_COLORS[b.entity]}}/>
                        <span style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>{b.entity}</span>
                      </div>
                      <span style={{fontSize:11,color:over?"#ef4444":warn?"#f59e0b":"#64748b",fontWeight:700}}>{b.pct.toFixed(0)}%{over?" 🚨":warn?" ⚠️":""}</span>
                    </div>
                    <div style={{height:6,background:"rgba(255,255,255,0.05)",borderRadius:3,overflow:"hidden",marginBottom:7,position:"relative"}}>
                      <div style={{height:"100%",width:Math.min(b.pct,100)+"%",background:barColor,borderRadius:3,transition:"width .6s cubic-bezier(.34,1.56,.64,1)"}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}>
                      <span style={{color:"#94a3b8",fontFamily:"monospace"}}>{fmtIDR(b.spent,true)}</span>
                      <span style={{color:"#475569",fontFamily:"monospace"}}>/ {fmtIDR(b.budget,true)}</span>
                    </div>
                    {b.trend!==0&&<div style={{fontSize:10,color:b.trend>0?"#f87171":"#4ade80",marginTop:3}}>{b.trend>0?"↑":"↓"} {Math.abs(b.trend).toFixed(0)}% vs bulan lalu</div>}
                  </div>
                );
              })}
            </div>

            {/* Charts */}
            <div style={S.sectionHead}><div style={S.secLabel}>Pemakaian 6 Bulan</div></div>
            <div className="glass-card anim-in" style={{padding:"16px",marginBottom:16}}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{top:0,right:0,left:-15,bottom:0}} barSize={28}>
                  <XAxis dataKey="month" tick={{fill:"#475569",fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"#475569",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtIDR(v,true)}/>
                  <Tooltip content={<CTip/>}/>
                  {ENTITIES.map((e,i)=><Bar key={e} dataKey={e} stackId="a" fill={ENTITY_COLORS[e]} radius={i===ENTITIES.length-1?[4,4,0,0]:[0,0,0,0]}/>)}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="glass-card anim-in" style={{padding:"16px",marginBottom:24}}>
              <div style={{fontSize:11,color:"#475569",fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:12}}>Trend Total vs Reimburse</div>
              <ResponsiveContainer width="100%" height={130}>
                <AreaChart data={chartData} margin={{top:5,right:5,left:-15,bottom:0}}>
                  <defs>
                    <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient>
                    <linearGradient id="gradReimb" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={{fill:"#475569",fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"#475569",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtIDR(v,true)}/>
                  <Tooltip content={<CTip/>}/>
                  <Area type="monotone" dataKey="Total" stroke="#6366f1" strokeWidth={2} fill="url(#gradTotal)" dot={{r:3,fill:"#6366f1"}}/>
                  <Area type="monotone" dataKey="Reimburse" stroke="#10b981" strokeWidth={2} fill="url(#gradReimb)" dot={{r:3,fill:"#10b981"}} strokeDasharray="5 3"/>
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Entity Pie */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:24}}>
              <div className="glass-card anim-in" style={{padding:"16px"}}>
                <div style={S.secLabel2}>Proporsi Entitas</div>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={entityPie} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={4} dataKey="value">
                      {entityPie.map((e,i)=><Cell key={i} fill={ENTITY_COLORS[e.name]}/>)}
                    </Pie>
                    <Tooltip formatter={v=>fmtIDR(v,true)} contentStyle={{background:"rgba(10,10,20,0.95)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,fontSize:11}}/>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center"}}>
                  {entityPie.map(e=>(
                    <div key={e.name} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:"#64748b"}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:ENTITY_COLORS[e.name]}}/>
                      {e.name}
                    </div>
                  ))}
                </div>
              </div>
              <div className="glass-card anim-in" style={{padding:"16px"}}>
                <div style={S.secLabel2}>Jatuh Tempo</div>
                {cardStats.map(c=>(
                  <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                    <div style={{fontSize:12,color:"#94a3b8"}}>{c.name.split(" ").slice(0,2).join(" ")}</div>
                    <div style={{fontSize:12,fontWeight:700,color:urgencyColor(c.dueIn),fontFamily:"monospace"}}>{c.dueIn}hr</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Card usage */}
            <div style={S.sectionHead}><div style={S.secLabel}>Kartu Bulan Ini</div></div>
            {cardStats.map((c,idx)=>{
              const over=c.usagePct>c.targetPct;
              const sc=c.usagePct>80?"#ef4444":over?"#f59e0b":"#22c55e";
              return(
                <div key={c.id} className="glass-card card-hover anim-in" style={{padding:"16px",marginBottom:10,cursor:"pointer",animationDelay:`${idx*0.05}s`}} onClick={()=>setDetailCardId(c.id)}>
                  <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:12}}>
                    <div style={{width:42,height:42,borderRadius:12,background:`linear-gradient(135deg,${c.color},${c.accent})`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>💳</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:14,color:"#f1f5f9"}}>{c.name}</div>
                      <div style={{fontSize:11,color:"#475569"}}>···· {c.last4} · JT Tgl {c.dueDay} · {c.dueIn} hari lagi</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"monospace",fontSize:15,fontWeight:800,color:sc}}>{fmtIDR(c.spent,true)}</div>
                      <div style={{fontSize:10,color:"#334155"}}>/ {fmtIDR(c.limit,true)}</div>
                    </div>
                  </div>
                  <div style={{position:"relative",height:6,background:"rgba(255,255,255,0.04)",borderRadius:3,overflow:"visible",marginBottom:6}}>
                    <div style={{height:"100%",width:Math.min(c.usagePct,100)+"%",background:`linear-gradient(90deg,${c.color},${c.accent})`,borderRadius:3,transition:"width .6s"}}/>
                    <div style={{position:"absolute",top:-4,left:c.targetPct+"%",width:2,height:14,background:"#f59e0b",borderRadius:1,opacity:.8}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#475569"}}>
                    <span style={{color:over?"#f59e0b":"#475569"}}>{c.usagePct.toFixed(1)}% {over?"⚠️ lewat target":""}</span>
                    <span>Target {c.targetPct}% · Sisa {fmtIDR(c.available,true)}</span>
                  </div>
                </div>
              );
            })}
          </>)}

          {/* ══════════ CARDS TAB ══════════ */}
          {tab==="cards"&&(<>
            <div style={S.tabHeader}>
              <div style={S.secLabel}>Kartu Kredit Saya</div>
              <button className="btn-add" onClick={()=>{setEditCardId(null);setCardForm(EC);setShowCardForm(true);}}>+ Kartu</button>
            </div>
            {cardStats.map((c,idx)=>(
              <div key={c.id} className="credit-card anim-in" style={{"--cc":c.color,"--ca":c.accent,animationDelay:`${idx*0.07}s`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                  <div>
                    <div style={{fontSize:11,opacity:.5,fontWeight:600,letterSpacing:1,textTransform:"uppercase",marginBottom:3}}>{c.bank} · {c.network}</div>
                    <div style={{fontSize:20,fontWeight:800,letterSpacing:-.3}}>{c.name}</div>
                  </div>
                  <div style={{fontSize:13,fontWeight:900,opacity:.7,letterSpacing:1}}>{c.network==="Visa"?"VISA":c.network==="Mastercard"?"MC":c.network}</div>
                </div>
                <div style={{fontFamily:"monospace",letterSpacing:4,fontSize:16,marginBottom:18,opacity:.85}}>•••• •••• •••• {c.last4}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
                  {[["Limit",fmtIDR(c.limit,true)],["Terpakai",fmtIDR(c.spent,true)],["Tersedia",fmtIDR(c.available,true)],["Cetak",`Tgl ${c.statementDay}`],["Jatuh Tempo",`Tgl ${c.dueDay}`],["Target",`${c.targetPct}%`]].map(([l,v])=>(
                    <div key={l} style={{background:"rgba(255,255,255,.1)",backdropFilter:"blur(4px)",borderRadius:9,padding:"7px 10px"}}>
                      <div style={{fontSize:9,opacity:.5,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
                      <div style={{fontSize:12,fontWeight:700,fontFamily:"monospace",marginTop:1}}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{height:4,background:"rgba(255,255,255,.15)",borderRadius:2,overflow:"hidden",marginBottom:10}}>
                  <div style={{height:"100%",width:Math.min(c.usagePct,100)+"%",background:c.usagePct>80?"rgba(239,68,68,.9)":"rgba(255,255,255,.7)",borderRadius:2,transition:"width .6s"}}/>
                </div>
                <div style={{fontSize:10,opacity:.4,marginBottom:12}}>{c.usagePct.toFixed(1)}% terpakai · {c.txCount} tx · Cicilan: {fmtIDR(c.instTotal,true)}/bln</div>
                <div style={{display:"flex",gap:8}}>
                  <button className="btn-cc-act" onClick={()=>editCard(c)}>✏️ Edit</button>
                  <button className="btn-cc-act" onClick={()=>{setDetailCardId(c.id);setTab("dashboard");}}>📊 Detail</button>
                  <button className="btn-cc-del" onClick={()=>deleteCard(c.id)}>🗑</button>
                </div>
              </div>
            ))}
          </>)}

          {/* ══════════ TRANSACTIONS ══════════ */}
          {tab==="transactions"&&(<>
            <div className="glass-card anim-in" style={{padding:"14px",marginBottom:14}}>
              <input className="search-box" placeholder="🔍 Cari transaksi, catatan..." value={searchQ} onChange={e=>setSearchQ(e.target.value)}/>
              <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
                <select className="mini-sel" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)}>
                  <option value="all">Semua Bulan</option>
                  {allMonths.map(m=><option key={m} value={m}>{mlFull(m)}</option>)}
                </select>
                <select className="mini-sel" value={filterCard} onChange={e=>setFilterCard(e.target.value)}>
                  <option value="all">Semua Kartu</option>
                  {cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className="mini-sel" value={filterEntity} onChange={e=>setFilterEntity(e.target.value)}>
                  <option value="all">Semua Entitas</option>
                  {ENTITIES.map(e=><option key={e} value={e}>{e}</option>)}
                </select>
                <select className="mini-sel" value={filterReimb} onChange={e=>setFilterReimb(e.target.value)}>
                  <option value="all">Semua Status</option>
                  <option value="false">Belum Reimburse</option>
                  <option value="true">Sudah Reimburse</option>
                </select>
              </div>
              <div style={{fontSize:11,color:"#334155",marginTop:8}}>{filtered.length} transaksi · {fmtIDR(filtered.reduce((s,t)=>s+txIDR(t),0))} · Fee: {fmtIDR(filtered.reduce((s,t)=>s+(t.fee||0),0))}</div>
            </div>
            {filtered.length===0
              ?<div style={{textAlign:"center",color:"#1e293b",padding:"60px 0",fontSize:14}}>Tidak ada transaksi</div>
              :filtered.map((t,idx)=>{
                const c=cardMap[t.card]||{name:"?",color:"#334155",accent:"#64748b",bank:"?"};
                const cur=getCur(t.currency);
                return(
                  <div key={t.id} className="tx-row anim-in" style={{animationDelay:`${Math.min(idx,10)*0.03}s`}}>
                    <div style={{width:40,height:40,borderRadius:11,background:`linear-gradient(135deg,${c.color},${c.accent})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{cur.flag}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:13,color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:5}}>{t.desc}</div>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                        <Tag>{t.date}</Tag>
                        <Tag>{t.category}</Tag>
                        <Tag color={c.accent} bg={c.color+"22"}>{c.bank}</Tag>
                        <Tag color={ENTITY_COLORS[t.entity]} bg={ENTITY_COLORS[t.entity]+"22"}>{t.entity}</Tag>
                        {t.currency!=="IDR"&&<Tag color="#f59e0b">🌏 {t.currency}</Tag>}
                        {t.fee>0&&<Tag color="#f97316">Fee</Tag>}
                        {t.recurring&&<Tag color="#a78bfa">↺</Tag>}
                      </div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                      <div style={{fontFamily:"monospace",fontSize:13,fontWeight:800,color:"#f1f5f9",marginBottom:2}}>{fmtCur(t.amount,t.currency)}</div>
                      {t.currency!=="IDR"&&<div style={{fontSize:10,color:"#334155",fontFamily:"monospace"}}>≈{fmtIDR(toIDR(t.amount,t.currency,fxRates),true)}</div>}
                      {t.fee>0&&<div style={{fontSize:10,color:"#f97316",fontFamily:"monospace"}}>+{fmtIDR(t.fee)}</div>}
                      <div style={{display:"flex",gap:4,justifyContent:"flex-end",marginTop:6}}>
                        <button className={`reimb-btn ${t.reimbursed?"done":""}`} onClick={()=>toggleReimb(t.id)}>{t.reimbursed?"✓ Reimb":"Reimb?"}</button>
                        <button className="icon-btn" onClick={()=>editTx(t)}>✏️</button>
                        <button className="icon-btn danger" onClick={()=>deleteTx(t.id)}>🗑</button>
                      </div>
                    </div>
                  </div>
                );
              })
            }
          </>)}

          {/* ══════════ INSTALLMENTS ══════════ */}
          {tab==="installments"&&(<>
            <div style={S.tabHeader}>
              <div style={S.secLabel}>Cicilan Aktif</div>
              <button className="btn-add" onClick={()=>{setEditInstId(null);setInstForm({...EI,card:cards[0]?.id||""});setShowInstForm(true);}}>+ Cicilan</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:16}}>
              {[
                ["Total Cicilan",fmtIDR(instStats.reduce((s,i)=>s+toIDR(i.totalAmount,i.currency,fxRates),0),true),"🔄","#818cf8"],
                ["Per Bulan",fmtIDR(instStats.reduce((s,i)=>s+toIDR(i.monthly,i.currency,fxRates),0),true),"📅","#34d399"],
                ["Terbayar",fmtIDR(instStats.reduce((s,i)=>s+toIDR(i.paidAmt,i.currency,fxRates),0),true),"✅","#4ade80"],
                ["Sisa Hutang",fmtIDR(instStats.reduce((s,i)=>s+toIDR(i.remainingAmt,i.currency,fxRates),0),true),"⏳","#f87171"],
              ].map(([l,v,ic,col])=>(
                <div key={l} className="glass-card anim-in" style={{padding:"14px",borderTop:`2px solid ${col}`}}>
                  <div style={{fontSize:18,marginBottom:4}}>{ic}</div>
                  <div style={{fontSize:10,color:"#475569",fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
                  <div style={{fontSize:15,fontWeight:800,fontFamily:"monospace",color:col,marginTop:2}}>{v}</div>
                </div>
              ))}
            </div>
            {instStats.map((i,idx)=>{
              const c=cardMap[i.card];
              return(
                <div key={i.id} className="glass-card anim-in" style={{padding:"16px",marginBottom:10,animationDelay:`${idx*0.06}s`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:14,color:"#f1f5f9"}}>{i.desc}</div>
                      <div style={{fontSize:11,color:"#475569",marginTop:2}}>{c?.name} · {i.entity} · {i.currency!=="IDR"&&i.currency+" "}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:16,fontWeight:800,fontFamily:"monospace",color:"#818cf8"}}>{fmtIDR(toIDR(i.monthly,i.currency,fxRates),true)}<span style={{fontSize:10,color:"#475569"}}>/bln</span></div>
                      <div style={{fontSize:11,color:"#334155"}}>Total: {fmtIDR(toIDR(i.totalAmount,i.currency,fxRates))}</div>
                    </div>
                  </div>
                  <div style={{height:8,background:"rgba(255,255,255,0.04)",borderRadius:4,overflow:"hidden",marginBottom:6}}>
                    <div style={{height:"100%",width:i.pct+"%",background:"linear-gradient(90deg,#6366f1,#10b981)",borderRadius:4,transition:"width .6s"}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#475569",marginBottom:12}}>
                    <span>{i.paidMonths}/{i.months} bulan ({i.pct.toFixed(0)}%)</span>
                    <span>Sisa: {fmtIDR(toIDR(i.remainingAmt,i.currency,fxRates),true)} ({i.remaining} bln)</span>
                  </div>
                  <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:12}}>
                    {Array.from({length:i.months}).map((_,idx)=>(
                      <div key={idx} style={{width:14,height:14,borderRadius:4,background:idx<i.paidMonths?"#10b981":"rgba(255,255,255,0.04)",border:`1px solid ${idx<i.paidMonths?"#059669":"rgba(255,255,255,0.06)"}`}}/>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn-sm-outline" onClick={()=>markInstPaid(i.id)} disabled={i.paidMonths>=i.months}>✓ Tandai Terbayar</button>
                    <button className="btn-sm-outline" onClick={()=>{setInstForm({...i,totalAmount:String(i.totalAmount),months:String(i.months)});setEditInstId(i.id);setShowInstForm(true);}}>✏️</button>
                    <button className="btn-sm-outline danger" onClick={()=>deleteInst(i.id)}>🗑</button>
                  </div>
                </div>
              );
            })}
          </>)}

          {/* ══════════ RECURRING ══════════ */}
          {tab==="recurring"&&(<>
            <div style={S.tabHeader}>
              <div style={S.secLabel}>Transaksi Recurring</div>
              <button className="btn-add" onClick={()=>{setEditRecurId(null);setRecurForm({...ER,card:cards[0]?.id||""});setShowRecurForm(true);}}>+ Recurring</button>
            </div>
            <div className="glass-card anim-in" style={{padding:"14px 16px",marginBottom:16,borderLeft:"3px solid #6366f1"}}>
              <div style={{fontSize:12,color:"#818cf8",fontWeight:700,marginBottom:4}}>💡 Cara Kerja Recurring</div>
              <div style={{fontSize:11,color:"#475569",lineHeight:1.6}}>Recurring adalah template transaksi yang sering berulang (langganan, tagihan rutin). Klik <strong style={{color:"#94a3b8"}}>Apply Now</strong> untuk langsung menambahkan ke daftar transaksi hari ini.</div>
            </div>
            {recurringList.length===0
              ?<div style={{textAlign:"center",color:"#1e293b",padding:"60px 0"}}>Belum ada recurring transaction</div>
              :recurringList.map((r,idx)=>{
                const c=cardMap[r.card];
                return(
                  <div key={r.id} className="glass-card anim-in" style={{padding:"14px 16px",marginBottom:8,opacity:r.active?1:0.5,animationDelay:`${idx*0.05}s`}}>
                    <div style={{display:"flex",gap:10,alignItems:"center"}}>
                      <div style={{width:38,height:38,borderRadius:10,background:r.active?`linear-gradient(135deg,${c?.color||"#334155"},${c?.accent||"#64748b"})`:"#1e293b",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>↺</div>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:700,fontSize:13,color:"#e2e8f0"}}>{r.desc}</div>
                        <div style={{display:"flex",gap:5,marginTop:4,flexWrap:"wrap"}}>
                          <Tag>{r.frequency} · Tgl {r.dayOfMonth}</Tag>
                          <Tag>{r.category}</Tag>
                          <Tag color={ENTITY_COLORS[r.entity]} bg={ENTITY_COLORS[r.entity]+"22"}>{r.entity}</Tag>
                          {c&&<Tag color={c.accent} bg={c.color+"22"}>{c.bank}</Tag>}
                        </div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:"#f1f5f9"}}>{fmtCur(r.amount,r.currency)}</div>
                        {r.fee>0&&<div style={{fontSize:10,color:"#f97316"}}>+fee {fmtIDR(r.fee)}</div>}
                        <div style={{display:"flex",gap:4,marginTop:6,justifyContent:"flex-end"}}>
                          <button className="btn-sm-outline" style={{fontSize:10,color:"#10b981",borderColor:"#064e3b"}} onClick={()=>applyRecurNow(r)}>▶ Apply</button>
                          <button className="btn-sm-outline" style={{fontSize:10,color:r.active?"#f59e0b":"#64748b"}} onClick={()=>toggleRecur(r.id)}>{r.active?"Pause":"Resume"}</button>
                          <button className="icon-btn" onClick={()=>{setRecurForm({...r,amount:String(r.amount),fee:String(r.fee||""),dayOfMonth:String(r.dayOfMonth)});setEditRecurId(r.id);setShowRecurForm(true);}}>✏️</button>
                          <button className="icon-btn danger" onClick={()=>deleteRecur(r.id)}>🗑</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            }
          </>)}

          {/* ══════════ BUDGET ══════════ */}
          {tab==="budget"&&(<>
            <div style={S.tabHeader}>
              <div style={S.secLabel}>Budget Planner</div>
              <button className="btn-add" onClick={()=>{setBudgetForm({...budgets});setShowBudgetForm(true);}}>Edit Budget</button>
            </div>
            {budgetStats.map((b,idx)=>{
              const txs=transactions.filter(t=>t.entity===b.entity&&ym(t.date)===curMonth);
              const over=b.pct>=100, warn=b.pct>=80;
              const barColor=over?"#ef4444":warn?"#f59e0b":ENTITY_COLORS[b.entity];
              return(
                <div key={b.entity} className="glass-card anim-in" style={{padding:"18px",marginBottom:12,animationDelay:`${idx*0.07}s`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:44,height:44,borderRadius:12,background:`linear-gradient(135deg,${ENTITY_GRADIENTS[b.entity][0]},${ENTITY_GRADIENTS[b.entity][1]})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>
                        {b.entity==="Pribadi"?"🏠":b.entity==="Hamasa"?"🏭":b.entity==="SDC"?"🔧":"📁"}
                      </div>
                      <div>
                        <div style={{fontWeight:800,fontSize:16,color:"#f1f5f9"}}>{b.entity}</div>
                        <div style={{fontSize:11,color:"#475569",marginTop:1}}>{txs.length} transaksi bulan ini</div>
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:11,color:"#475569"}}>Budget</div>
                      <div style={{fontFamily:"monospace",fontSize:16,fontWeight:800,color:"#94a3b8"}}>{fmtIDR(b.budget,true)}</div>
                    </div>
                  </div>
                  <div style={{height:10,background:"rgba(255,255,255,0.04)",borderRadius:5,overflow:"hidden",marginBottom:8,position:"relative"}}>
                    <div style={{height:"100%",width:Math.min(b.pct,100)+"%",background:barColor,borderRadius:5,transition:"width .7s cubic-bezier(.34,1.56,.64,1)",boxShadow:`0 0 12px ${barColor}66`}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
                    <div>
                      <div style={{fontSize:12,color:"#64748b"}}>Terpakai</div>
                      <div style={{fontFamily:"monospace",fontSize:16,fontWeight:800,color:barColor}}>{fmtIDR(b.spent,true)}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:12,color:"#64748b"}}>Persentase</div>
                      <div style={{fontSize:20,fontWeight:900,color:barColor}}>{b.pct.toFixed(0)}%</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:12,color:"#64748b"}}>Sisa</div>
                      <div style={{fontFamily:"monospace",fontSize:16,fontWeight:800,color:"#22c55e"}}>{fmtIDR(b.remaining,true)}</div>
                    </div>
                  </div>
                  {b.trend!==0&&(
                    <div style={{padding:"8px 12px",background:"rgba(255,255,255,0.02)",borderRadius:8,fontSize:11,color:b.trend>0?"#f87171":"#4ade80",display:"flex",alignItems:"center",gap:6}}>
                      {b.trend>0?"📈 Naik":"📉 Turun"} {Math.abs(b.trend).toFixed(0)}% dibanding bulan lalu
                    </div>
                  )}
                  {txs.length>0&&(
                    <div style={{marginTop:12}}>
                      <div style={{fontSize:10,color:"#334155",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Transaksi Bulan Ini</div>
                      {txs.slice(0,3).map(t=>(
                        <div key={t.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.03)",fontSize:11}}>
                          <span style={{color:"#64748b"}}>{t.date.slice(5)} · {t.desc}</span>
                          <span style={{fontFamily:"monospace",color:"#94a3b8"}}>{fmtIDR(txIDR(t),true)}</span>
                        </div>
                      ))}
                      {txs.length>3&&<div style={{fontSize:10,color:"#334155",marginTop:6,textAlign:"center"}}>+{txs.length-3} transaksi lainnya</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </>)}

          {/* ══════════ MONTHLY ══════════ */}
          {tab==="monthly"&&(<>
            <div style={S.secLabel}>Ringkasan Bulanan</div>
            {monthlySummary.map((m,idx)=>(
              <div key={m.month} className="glass-card anim-in" style={{padding:"16px",marginBottom:12,animationDelay:`${idx*0.05}s`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontWeight:800,fontSize:16,color:"#f1f5f9"}}>{mlFull(m.month)}</div>
                  <div style={{fontFamily:"monospace",fontSize:15,fontWeight:800,color:"#94a3b8"}}>{fmtIDR(m.total)}</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:14}}>
                  {[["Total",fmtIDR(m.total,true),"#94a3b8"],["Reimb",fmtIDR(m.reimbursed,true),"#4ade80"],["Pending",fmtIDR(m.pending,true),"#f87171"],["Fee",fmtIDR(m.fees,true),"#f59e0b"]].map(([l,v,col])=>(
                    <div key={l} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)",borderRadius:8,padding:"7px 9px"}}>
                      <div style={{fontSize:9,color:"#334155",fontWeight:700,textTransform:"uppercase"}}>{l}</div>
                      <div style={{fontSize:12,fontWeight:700,fontFamily:"monospace",color:col,marginTop:1}}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:10,color:"#334155",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Per Entitas</div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
                  {ENTITIES.map(e=>m.byEntity[e]>0&&(
                    <div key={e} style={{background:ENTITY_COLORS[e]+"15",border:`1px solid ${ENTITY_COLORS[e]}33`,borderRadius:6,padding:"4px 10px",fontSize:11}}>
                      <span style={{color:ENTITY_COLORS[e],fontWeight:700}}>{e}: </span>
                      <span style={{fontFamily:"monospace",color:"#94a3b8"}}>{fmtIDR(m.byEntity[e],true)}</span>
                    </div>
                  ))}
                </div>
                {m.byCard.length>0&&m.byCard.map(c=>{
                  const pct=m.total>0?c.amt/m.total*100:0;
                  return(
                    <div key={c.id} style={{marginBottom:7}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                        <span style={{color:c.accent}}>{c.name}</span>
                        <span style={{fontFamily:"monospace",color:"#64748b"}}>{fmtIDR(c.amt,true)} · {pct.toFixed(0)}%</span>
                      </div>
                      <div style={{height:3,background:"rgba(255,255,255,0.04)",borderRadius:2,overflow:"hidden"}}>
                        <div style={{height:"100%",width:pct+"%",background:`linear-gradient(90deg,${c.color},${c.accent})`,borderRadius:2}}/>
                      </div>
                    </div>
                  );
                })}
                <div style={{fontSize:10,color:"#1e293b",marginTop:8}}>{m.count} transaksi</div>
              </div>
            ))}
          </>)}
        </div>
      </main>

      {/* ══ CARD DETAIL MODAL ══ */}
      {detailCard&&(
        <Modal onClose={()=>setDetailCardId(null)} title={detailCard.name} wide>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
            {[["Limit",fmtIDR(detailCard.limit)],["Terpakai Bulan Ini",fmtIDR(detailCard.spent)],["Sisa Limit",fmtIDR(detailCard.available)],["Target",`${detailCard.targetPct}% = ${fmtIDR(detailCard.targetAmt,true)}`],["Tgl Cetak",`Tgl ${detailCard.statementDay} (${detailCard.statIn} hari)`],["Jatuh Tempo",`Tgl ${detailCard.dueDay} (${detailCard.dueIn} hari)`],["Total Semua",fmtIDR(detailCard.totalSpent)],["Total Reimburse",fmtIDR(detailCard.reimbursed)]].map(([l,v])=>(
              <div key={l} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:9,padding:"10px 12px"}}>
                <div style={{fontSize:9,color:"#334155",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:2}}>{l}</div>
                <div style={{fontSize:13,fontWeight:700,fontFamily:"monospace",color:"#e2e8f0"}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:10,color:"#334155",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Transaksi Terakhir</div>
          {detailCard.allTx.slice(-6).reverse().map(t=>(
            <div key={t.id} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid rgba(255,255,255,0.03)",fontSize:12}}>
              <span style={{color:"#475569"}}>{t.date.slice(5)} · {t.desc} <span style={{color:ENTITY_COLORS[t.entity],fontSize:10}}>[{t.entity}]</span></span>
              <span style={{fontFamily:"monospace",color:t.reimbursed?"#4ade80":"#f87171"}}>{fmtIDR(txIDR(t),true)}</span>
            </div>
          ))}
        </Modal>
      )}

      {/* ══ FX MODAL ══ */}
      {showFxPanel&&(
        <Modal onClose={()=>setShowFxPanel(false)} title="💱 Kurs Mata Uang">
          <div style={{fontSize:11,color:"#475569",marginBottom:16}}>Kurs konversi ke IDR. Update sesuai rate terkini.</div>
          {CURRENCIES.filter(c=>c.code!=="IDR").map(cur=>(
            <div key={cur.code} style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
              <span style={{fontSize:20}}>{cur.flag}</span>
              <span style={{fontSize:13,fontWeight:700,color:"#94a3b8",width:36}}>{cur.code}</span>
              <span style={{fontSize:12,color:"#334155",flex:1}}>1 {cur.code} =</span>
              <input className="inp" type="number" value={fxRates[cur.code]||cur.rate} onChange={e=>setFxRates(r=>({...r,[cur.code]:Number(e.target.value)}))} style={{width:120}}/>
              <span style={{fontSize:11,color:"#334155"}}>IDR</span>
            </div>
          ))}
          <div style={{marginTop:14,padding:"10px 14px",background:"rgba(16,185,129,0.05)",border:"1px solid rgba(16,185,129,0.15)",borderRadius:9,fontSize:11,color:"#10b981"}}>✓ Tersimpan otomatis ke storage</div>
        </Modal>
      )}

      {/* ══ STATEMENT SIMULATOR ══ */}
      {showStatementModal&&(
        <Modal onClose={()=>setShowStatementModal(false)} title="🧾 Statement Simulator" wide>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:10,color:"#475569",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>Pilih Kartu</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {cards.map(c=>(
                <button key={c.id} className={`card-sel-btn ${statementCard===c.id?"active":""}`} style={statementCard===c.id?{"--cc":c.color,"--ca":c.accent}:{}} onClick={()=>setStatementCard(c.id)}>
                  {c.name.split(" ").slice(0,2).join(" ")} ···· {c.last4}
                </button>
              ))}
            </div>
          </div>
          {statementData&&(<>
            <div style={{background:"rgba(99,102,241,0.05)",border:"1px solid rgba(99,102,241,0.15)",borderRadius:12,padding:"16px",marginBottom:16}}>
              <div style={{fontSize:11,color:"#6366f1",fontWeight:700,marginBottom:12,letterSpacing:.5,textTransform:"uppercase"}}>Estimasi Tagihan {mlFull(curMonth)}</div>
              {[["Transaksi Biasa",statementData.pokok,`${statementData.txCount} tx`],["Cicilan Aktif",statementData.instMonthly,"bulanan"],["Fee & Charge",statementData.fees,"tidak direimburse"]].map(([l,v,sub])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                  <div><div style={{fontSize:12,color:"#94a3b8"}}>{l}</div><div style={{fontSize:10,color:"#334155"}}>{sub}</div></div>
                  <div style={{fontFamily:"monospace",fontSize:14,fontWeight:700,color:"#e2e8f0"}}>{fmtIDR(v)}</div>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:12,marginTop:4}}>
                <div style={{fontWeight:800,fontSize:14,color:"#f1f5f9"}}>TOTAL TAGIHAN</div>
                <div style={{fontFamily:"monospace",fontSize:20,fontWeight:900,color:"#f59e0b"}}>{fmtIDR(statementData.total)}</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div style={{background:"rgba(239,68,68,0.05)",border:"1px solid rgba(239,68,68,0.15)",borderRadius:10,padding:"12px"}}>
                <div style={{fontSize:10,color:"#ef4444",fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>Pembayaran Minimum</div>
                <div style={{fontFamily:"monospace",fontSize:16,fontWeight:800,color:"#f87171",marginTop:4}}>{fmtIDR(statementData.minPayment)}</div>
                <div style={{fontSize:10,color:"#334155",marginTop:2}}>~10% dari total</div>
              </div>
              <div style={{background:"rgba(16,185,129,0.05)",border:"1px solid rgba(16,185,129,0.15)",borderRadius:10,padding:"12px"}}>
                <div style={{fontSize:10,color:"#10b981",fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>Jatuh Tempo</div>
                <div style={{fontFamily:"monospace",fontSize:16,fontWeight:800,color:"#4ade80",marginTop:4}}>{statementData.dueIn} hari lagi</div>
                <div style={{fontSize:10,color:"#334155",marginTop:2}}>Tgl {statementData.c.dueDay} setiap bulan</div>
              </div>
            </div>
            <div style={{padding:"10px 14px",background:"rgba(245,158,11,0.05)",border:"1px solid rgba(245,158,11,0.15)",borderRadius:9,fontSize:11,color:"#f59e0b"}}>
              💡 Bayar penuh untuk hindari bunga. Bunga keterlambatan biasanya 2–3.5% per bulan.
            </div>
          </>)}
        </Modal>
      )}

      {/* ══ TX FORM ══ */}
      {showTxForm&&(
        <Modal onClose={()=>setShowTxForm(false)} title={editTxId?"✏️ Edit Transaksi":"➕ Tambah Transaksi"}>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Row2>
              <F label="Tanggal"><input className="inp" type="date" value={txForm.date} onChange={e=>setTxForm(f=>({...f,date:e.target.value}))}/></F>
              <F label="Kartu"><select className="inp" value={txForm.card} onChange={e=>setTxForm(f=>({...f,card:e.target.value}))}>{cards.map(c=><option key={c.id} value={c.id}>{c.name} ···· {c.last4}</option>)}</select></F>
            </Row2>
            <F label="Keterangan"><input className="inp" placeholder="Contoh: Makan siang client..." value={txForm.desc} onChange={e=>setTxForm(f=>({...f,desc:e.target.value}))}/></F>
            <Row2>
              <F label="Jumlah">
                <div style={{display:"flex",gap:6}}>
                  <select className="inp" value={txForm.currency} onChange={e=>setTxForm(f=>({...f,currency:e.target.value}))} style={{width:90,flexShrink:0}}>
                    {CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
                  </select>
                  <input className="inp" type="number" placeholder="0" value={txForm.amount} onChange={e=>setTxForm(f=>({...f,amount:e.target.value}))}/>
                </div>
                {txForm.currency!=="IDR"&&txForm.amount&&<div style={{fontSize:10,color:"#475569",marginTop:3}}>≈ {fmtIDR(toIDR(Number(txForm.amount),txForm.currency,fxRates))}</div>}
              </F>
              <F label="Fee (Rp)"><input className="inp" type="number" placeholder="0" value={txForm.fee} onChange={e=>setTxForm(f=>({...f,fee:e.target.value}))}/><div style={{fontSize:9,color:"#334155",marginTop:3}}>Tidak akan direimburse</div></F>
            </Row2>
            <Row2>
              <F label="Kategori"><select className="inp" value={txForm.category} onChange={e=>setTxForm(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></F>
              <F label="Entitas"><select className="inp" value={txForm.entity} onChange={e=>setTxForm(f=>({...f,entity:e.target.value}))}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</select></F>
            </Row2>
            <F label="Catatan"><input className="inp" placeholder="Opsional..." value={txForm.notes} onChange={e=>setTxForm(f=>({...f,notes:e.target.value}))}/></F>
            <div className="toggle-row" onClick={()=>setTxForm(f=>({...f,reimbursed:!f.reimbursed}))}>
              <div className={`toggle-check ${txForm.reimbursed?"on":""}`}>{txForm.reimbursed?"✓":""}</div>
              <div><div style={{fontSize:13,color:txForm.reimbursed?"#4ade80":"#64748b",fontWeight:600}}>Sudah Direimburse</div><div style={{fontSize:10,color:"#334155"}}>Fee tidak termasuk</div></div>
            </div>
            <BtnRow onCancel={()=>setShowTxForm(false)} onOk={submitTx} label={editTxId?"Simpan":"Tambah"}/>
          </div>
        </Modal>
      )}

      {/* ══ CARD FORM ══ */}
      {showCardForm&&(
        <Modal onClose={()=>setShowCardForm(false)} title={editCardId?"✏️ Edit Kartu":"🏦 Tambah Kartu"}>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Row2>
              <F label="Nama Kartu"><input className="inp" placeholder="BCA Platinum" value={cardForm.name} onChange={e=>setCardForm(f=>({...f,name:e.target.value}))}/></F>
              <F label="Bank"><select className="inp" value={cardForm.bank} onChange={e=>setCardForm(f=>({...f,bank:e.target.value}))}>{BANKS.map(b=><option key={b}>{b}</option>)}</select></F>
            </Row2>
            <Row2>
              <F label="4 Digit Terakhir"><input className="inp" placeholder="1234" maxLength={4} value={cardForm.last4} onChange={e=>setCardForm(f=>({...f,last4:e.target.value}))}/></F>
              <F label="Network"><select className="inp" value={cardForm.network} onChange={e=>setCardForm(f=>({...f,network:e.target.value}))}>{NETWORKS.map(n=><option key={n}>{n}</option>)}</select></F>
            </Row2>
            <F label="Limit (Rp)"><input className="inp" type="number" value={cardForm.limit} onChange={e=>setCardForm(f=>({...f,limit:e.target.value}))}/></F>
            <Row2>
              <F label="Tgl Cetak Tagihan"><input className="inp" type="number" min={1} max={31} value={cardForm.statementDay} onChange={e=>setCardForm(f=>({...f,statementDay:e.target.value}))}/></F>
              <F label="Tgl Jatuh Tempo"><input className="inp" type="number" min={1} max={31} value={cardForm.dueDay} onChange={e=>setCardForm(f=>({...f,dueDay:e.target.value}))}/></F>
            </Row2>
            <F label={`Target Pemakaian: ${cardForm.targetPct}%`}>
              <input type="range" min={5} max={100} step={5} value={cardForm.targetPct} onChange={e=>setCardForm(f=>({...f,targetPct:Number(e.target.value)}))} style={{width:"100%",accentColor:"#6366f1"}}/>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#475569",marginTop:2}}>
                <span>5%</span><span style={{color:"#818cf8",fontWeight:700}}>{cardForm.targetPct}% = {fmtIDR(Number(cardForm.limit||0)*cardForm.targetPct/100,true)}</span><span>100%</span>
              </div>
            </F>
            <Row2>
              <F label="Warna Utama"><div style={{display:"flex",gap:8,alignItems:"center"}}><input type="color" value={cardForm.color} onChange={e=>setCardForm(f=>({...f,color:e.target.value}))} style={{width:44,height:36,border:"none",borderRadius:8,cursor:"pointer"}}/><span style={{fontSize:11,color:"#475569"}}>{cardForm.color}</span></div></F>
              <F label="Warna Aksen"><div style={{display:"flex",gap:8,alignItems:"center"}}><input type="color" value={cardForm.accent} onChange={e=>setCardForm(f=>({...f,accent:e.target.value}))} style={{width:44,height:36,border:"none",borderRadius:8,cursor:"pointer"}}/><span style={{fontSize:11,color:"#475569"}}>{cardForm.accent}</span></div></F>
            </Row2>
            <div style={{background:`linear-gradient(135deg,${cardForm.color},${cardForm.accent})`,borderRadius:12,padding:"14px 16px",color:"white"}}>
              <div style={{fontWeight:800,fontSize:14}}>{cardForm.name||"Nama Kartu"}</div>
              <div style={{fontFamily:"monospace",letterSpacing:3,margin:"8px 0",opacity:.85}}>•••• •••• •••• {cardForm.last4||"0000"}</div>
              <div style={{fontSize:11,opacity:.5}}>{cardForm.bank} · {cardForm.network} · Limit: {fmtIDR(Number(cardForm.limit||0),true)}</div>
            </div>
            <BtnRow onCancel={()=>setShowCardForm(false)} onOk={submitCard} label={editCardId?"Simpan":"Tambah"}/>
          </div>
        </Modal>
      )}

      {/* ══ INSTALLMENT FORM ══ */}
      {showInstForm&&(
        <Modal onClose={()=>setShowInstForm(false)} title={editInstId?"✏️ Edit Cicilan":"🔄 Tambah Cicilan"}>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <F label="Nama Item"><input className="inp" placeholder="iPhone 15 Pro, Laptop Dell..." value={instForm.desc} onChange={e=>setInstForm(f=>({...f,desc:e.target.value}))}/></F>
            <Row2>
              <F label="Kartu"><select className="inp" value={instForm.card} onChange={e=>setInstForm(f=>({...f,card:e.target.value}))}>{cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
              <F label="Entitas"><select className="inp" value={instForm.entity} onChange={e=>setInstForm(f=>({...f,entity:e.target.value}))}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</select></F>
            </Row2>
            <Row2>
              <F label="Mata Uang"><select className="inp" value={instForm.currency} onChange={e=>setInstForm(f=>({...f,currency:e.target.value}))}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select></F>
              <F label="Total Harga"><input className="inp" type="number" placeholder="18000000" value={instForm.totalAmount} onChange={e=>setInstForm(f=>({...f,totalAmount:e.target.value}))}/></F>
            </Row2>
            <Row2>
              <F label="Jumlah Bulan"><select className="inp" value={instForm.months} onChange={e=>setInstForm(f=>({...f,months:Number(e.target.value)}))}>
                {[3,6,9,12,18,24,36].map(m=><option key={m} value={m}>{m} bulan</option>)}
              </select></F>
              <F label="Mulai"><input className="inp" type="date" value={instForm.startDate} onChange={e=>setInstForm(f=>({...f,startDate:e.target.value}))}/></F>
            </Row2>
            {instForm.totalAmount&&instForm.months&&(
              <div style={{padding:"10px 14px",background:"rgba(99,102,241,0.08)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:9,fontFamily:"monospace",fontSize:13,color:"#818cf8",fontWeight:700}}>
                Cicilan/bulan: {fmtIDR(Math.round(Number(instForm.totalAmount)/Number(instForm.months)))}
              </div>
            )}
            <BtnRow onCancel={()=>setShowInstForm(false)} onOk={submitInst} label={editInstId?"Simpan":"Tambah"}/>
          </div>
        </Modal>
      )}

      {/* ══ RECURRING FORM ══ */}
      {showRecurForm&&(
        <Modal onClose={()=>setShowRecurForm(false)} title={editRecurId?"✏️ Edit Recurring":"↺ Tambah Recurring"}>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <F label="Nama"><input className="inp" placeholder="Netflix, Spotify, Listrik..." value={recurForm.desc} onChange={e=>setRecurForm(f=>({...f,desc:e.target.value}))}/></F>
            <Row2>
              <F label="Kartu"><select className="inp" value={recurForm.card} onChange={e=>setRecurForm(f=>({...f,card:e.target.value}))}>{cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
              <F label="Entitas"><select className="inp" value={recurForm.entity} onChange={e=>setRecurForm(f=>({...f,entity:e.target.value}))}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</select></F>
            </Row2>
            <Row2>
              <F label="Jumlah">
                <div style={{display:"flex",gap:6}}>
                  <select className="inp" value={recurForm.currency} onChange={e=>setRecurForm(f=>({...f,currency:e.target.value}))} style={{width:80,flexShrink:0}}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select>
                  <input className="inp" type="number" value={recurForm.amount} onChange={e=>setRecurForm(f=>({...f,amount:e.target.value}))}/>
                </div>
              </F>
              <F label="Fee (Rp)"><input className="inp" type="number" placeholder="0" value={recurForm.fee} onChange={e=>setRecurForm(f=>({...f,fee:e.target.value}))}/></F>
            </Row2>
            <Row2>
              <F label="Kategori"><select className="inp" value={recurForm.category} onChange={e=>setRecurForm(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></F>
              <F label="Frekuensi"><select className="inp" value={recurForm.frequency} onChange={e=>setRecurForm(f=>({...f,frequency:e.target.value}))}>{RECUR_FREQ.map(f=><option key={f}>{f}</option>)}</select></F>
            </Row2>
            <F label="Tanggal/Hari (dalam bulan)"><input className="inp" type="number" min={1} max={31} value={recurForm.dayOfMonth} onChange={e=>setRecurForm(f=>({...f,dayOfMonth:e.target.value}))}/></F>
            <BtnRow onCancel={()=>setShowRecurForm(false)} onOk={submitRecur} label={editRecurId?"Simpan":"Tambah"}/>
          </div>
        </Modal>
      )}

      {/* ══ BUDGET FORM ══ */}
      {showBudgetForm&&(
        <Modal onClose={()=>setShowBudgetForm(false)} title="◎ Edit Budget Bulanan">
          <div style={{fontSize:11,color:"#475569",marginBottom:16}}>Set budget pengeluaran per entitas untuk bulan ini dan bulan-bulan berikutnya.</div>
          {ENTITIES.map(e=>(
            <div key={e} style={{marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:ENTITY_COLORS[e]}}/>
                <span style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>{e}</span>
              </div>
              <input className="inp" type="number" placeholder="0 = tidak ada limit" value={budgetForm[e]||""} onChange={e2=>setBudgetForm(f=>({...f,[e]:Number(e2.target.value)}))}/>
              {budgetForm[e]>0&&<div style={{fontSize:10,color:ENTITY_COLORS[e],marginTop:3}}>{fmtIDR(budgetForm[e])} / bulan</div>}
            </div>
          ))}
          <BtnRow onCancel={()=>setShowBudgetForm(false)} onOk={saveBudgets} label="Simpan Budget"/>
        </Modal>
      )}
    </div>
  );
}

// ─── MINI COMPONENTS ──────────────────────────────────────────────────────────
const Modal=({children,onClose,title,wide})=>(
  <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" style={{maxWidth:wide?520:460}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontWeight:800,fontSize:16,color:"#f1f5f9"}}>{title}</div>
        <button className="close-x" onClick={onClose}>✕</button>
      </div>
      {children}
    </div>
  </div>
);
const Tag=({children,color="#475569",bg="rgba(255,255,255,0.04)"})=>(
  <span style={{display:"inline-block",padding:"2px 7px",borderRadius:20,fontSize:10,fontWeight:600,background:bg,color,border:`1px solid ${color}33`,whiteSpace:"nowrap"}}>{children}</span>
);
const F=({label,children})=>(
  <div style={{flex:1}}>
    <div style={{fontSize:10,color:"#475569",fontWeight:700,letterSpacing:.5,textTransform:"uppercase",marginBottom:5}}>{label}</div>
    {children}
  </div>
);
const Row2=({children})=><div style={{display:"flex",gap:10}}>{children}</div>;
const BtnRow=({onCancel,onOk,label})=>(
  <div style={{display:"flex",gap:10,marginTop:6}}>
    <button className="btn-cancel" onClick={onCancel}>Batal</button>
    <button className="btn-confirm" onClick={onOk}>{label}</button>
  </div>
);

// ─── STYLES ──────────────────────────────────────────────────────────────────
const S={
  root:{display:"flex",minHeight:"100vh",background:"#050510",color:"#e2e8f0",fontFamily:"'Plus Jakarta Sans',system-ui,sans-serif"},
  sidebar:{width:220,background:"rgba(8,8,20,0.95)",borderRight:"1px solid rgba(255,255,255,0.05)",display:"flex",flexDirection:"column",justifyContent:"space-between",position:"sticky",top:0,height:"100vh",flexShrink:0,backdropFilter:"blur(20px)"},
  sideTop:{flex:1,overflowY:"auto"},
  brandMark:{padding:"20px 16px 16px",display:"flex",alignItems:"center",gap:10,borderBottom:"1px solid rgba(255,255,255,0.04)",marginBottom:8},
  brandIcon:{width:36,height:36,background:"linear-gradient(135deg,#4f46e5,#7c3aed)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18},
  brandName:{fontWeight:800,fontSize:14,color:"#f1f5f9"},
  brandSub:{fontSize:9,color:"#334155",letterSpacing:.3},
  main:{flex:1,display:"flex",flexDirection:"column",minWidth:0,overflowX:"hidden"},
  topbar:{padding:"16px 24px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,0.04)",background:"rgba(5,5,16,0.8)",backdropFilter:"blur(20px)",position:"sticky",top:0,zIndex:40},
  pageTitle:{fontWeight:800,fontSize:20,color:"#f1f5f9",letterSpacing:-.3},
  pageSub:{fontSize:11,color:"#334155",marginTop:2},
  content:{padding:"20px 24px",maxWidth:800,width:"100%"},
  heroGrid:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:24},
  heroLabel:{fontSize:10,color:"rgba(255,255,255,0.5)",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:6},
  heroValue:{fontSize:16,fontWeight:900,fontFamily:"monospace",letterSpacing:-.5,marginBottom:4},
  heroSub:{fontSize:10,color:"rgba(255,255,255,0.35)"},
  heroDeco:{position:"absolute",right:14,top:14,fontSize:28,opacity:.15},
  sectionHead:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10},
  secLabel:{fontSize:10,color:"#334155",fontWeight:700,letterSpacing:1.5,textTransform:"uppercase"},
  secLabel2:{fontSize:10,color:"#334155",fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:10},
  tabHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14},
  alertDot:{background:"#ef4444",color:"white",borderRadius:20,padding:"2px 8px",fontSize:11,fontWeight:700},
  bottomNav:{display:"none",position:"fixed",bottom:0,left:0,right:0,background:"rgba(8,8,20,0.97)",borderTop:"1px solid rgba(255,255,255,0.06)",zIndex:50,backdropFilter:"blur(20px)"},
};

const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:2px}
.anim-in{animation:fu .3s cubic-bezier(.22,1,.36,1) both}
@keyframes fu{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}

.side-btn{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;border:none;background:transparent;color:#334155;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;border-radius:9px;margin-bottom:2px;transition:all .15s;text-align:left}
.side-btn:hover{background:rgba(255,255,255,0.04);color:#64748b}
.side-btn.active{background:rgba(99,102,241,0.12);color:#a5b4fc}
.side-btn .badge{background:#ef4444;color:white;borderRadius:20px;padding:1px 6px;fontSize:10px;fontWeight:700;marginLeft:auto}
.side-action{display:block;width:100%;padding:7px 10px;border:none;background:transparent;color:#334155;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;border-radius:7px;margin-bottom:4px;text-align:left;transition:all .15s}
.side-action:hover{background:rgba(255,255,255,0.03);color:#64748b}

.btn-add{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;padding:8px 18px;border-radius:9px;font-family:inherit;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:filter .15s,transform .1s}
.btn-add:hover{filter:brightness(1.15)}.btn-add:active{transform:scale(.97)}

.hero-card{position:relative;border-radius:14px;padding:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.06)}
.gradient-purple{background:linear-gradient(135deg,rgba(79,70,229,0.3),rgba(99,102,241,0.1));border-color:rgba(99,102,241,0.2)}
.gradient-green{background:linear-gradient(135deg,rgba(5,150,105,0.3),rgba(16,185,129,0.1));border-color:rgba(16,185,129,0.2)}
.gradient-amber{background:linear-gradient(135deg,rgba(217,119,6,0.3),rgba(245,158,11,0.1));border-color:rgba(245,158,11,0.2)}
.gradient-slate{background:linear-gradient(135deg,rgba(71,85,105,0.3),rgba(100,116,139,0.1));border-color:rgba(100,116,139,0.2)}

.glass-card{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);border-radius:14px;backdrop-filter:blur(10px)}
.card-hover{transition:transform .2s,background .15s,border-color .15s}
.card-hover:hover{transform:translateY(-2px);background:rgba(255,255,255,0.04);border-color:rgba(99,102,241,0.2)}

.credit-card{background:linear-gradient(135deg,var(--cc),var(--ca));border-radius:18px;padding:22px;color:white;box-shadow:0 12px 48px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.15);margin-bottom:14px;position:relative;overflow:hidden}
.credit-card::before{content:"";position:absolute;top:-40px;right:-40px;width:140px;height:140px;border-radius:50%;background:rgba(255,255,255,0.06)}
.btn-cc-act{background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.85);border:1px solid rgba(255,255,255,0.2);padding:7px 14px;border-radius:8px;font-family:inherit;font-weight:600;font-size:11px;cursor:pointer;transition:background .15s}
.btn-cc-act:hover{background:rgba(255,255,255,0.22)}
.btn-cc-del{background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3);padding:7px 12px;border-radius:8px;font-family:inherit;font-weight:600;font-size:11px;cursor:pointer}

.tx-row{display:flex;align-items:flex-start;gap:12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:12px 14px;margin-bottom:7px;transition:all .15s}
.tx-row:hover{background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.08)}
.reimb-btn{background:rgba(255,255,255,0.04);color:#475569;border:1px solid rgba(255,255,255,0.07);padding:3px 9px;border-radius:6px;font-family:inherit;font-weight:700;font-size:10px;cursor:pointer;transition:all .15s;white-space:nowrap}
.reimb-btn.done{background:rgba(16,185,129,0.1);color:#4ade80;border-color:rgba(16,185,129,0.25)}
.icon-btn{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);color:#475569;padding:3px 7px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
.icon-btn:hover{background:rgba(255,255,255,0.08);color:#94a3b8}
.icon-btn.danger{color:#f87171;border-color:rgba(239,68,68,0.2)}
.icon-btn.danger:hover{background:rgba(239,68,68,0.08)}

.link-btn{background:transparent;border:none;color:#6366f1;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;padding:4px 8px;border-radius:6px;transition:background .15s}
.link-btn:hover{background:rgba(99,102,241,0.1)}

.alert-bar{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:11px;margin-bottom:8px;animation:fu .3s ease both}
.alert-danger{background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2)}
.alert-warning{background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2)}
.alert-info{background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2)}
.alert-dismiss{background:transparent;border:none;color:#475569;cursor:pointer;font-size:13px;padding:4px;line-height:1;margin-left:auto}
.alert-dismiss:hover{color:#94a3b8}

.btn-sm-outline{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:#64748b;padding:5px 12px;border-radius:7px;font-family:inherit;font-weight:600;font-size:11px;cursor:pointer;transition:all .15s}
.btn-sm-outline:hover{background:rgba(255,255,255,0.06);color:#94a3b8}
.btn-sm-outline.danger{color:#f87171;border-color:rgba(239,68,68,0.2)}
.btn-sm-outline:disabled{opacity:0.3;cursor:not-allowed}

.search-box{width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);color:#e2e8f0;padding:10px 14px;border-radius:10px;font-family:inherit;font-size:13px;outline:none;transition:border-color .15s}
.search-box:focus{border-color:rgba(99,102,241,0.4);background:rgba(99,102,241,0.04)}
.mini-sel{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);color:#94a3b8;padding:6px 10px;border-radius:8px;font-family:inherit;font-size:11px;outline:none;cursor:pointer}
.mini-sel option{background:#0d0d20}

.card-sel-btn{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:#64748b;padding:8px 14px;border-radius:9px;font-family:inherit;font-weight:600;font-size:12px;cursor:pointer;transition:all .15s}
.card-sel-btn.active{background:linear-gradient(135deg,var(--cc),var(--ca));color:white;border-color:transparent;box-shadow:0 4px 16px rgba(0,0,0,0.3)}

.overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:200;padding:16px;overflow-y:auto;backdrop-filter:blur(4px)}
.modal{background:rgba(10,10,25,0.98);border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:22px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.6);backdrop-filter:blur(20px)}
.close-x{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);color:#475569;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;transition:all .15s;display:flex;align-items:center;justify-content:center}
.close-x:hover{background:rgba(255,255,255,0.1);color:#94a3b8}
.inp{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:#e2e8f0;padding:9px 12px;border-radius:9px;font-family:inherit;font-size:13px;width:100%;outline:none;transition:border-color .15s}
.inp:focus{border-color:rgba(99,102,241,0.5);background:rgba(99,102,241,0.04)}
.inp option{background:#0d0d20}
.toggle-row{display:flex;align-items:center;gap:12px;padding:11px 13px;background:rgba(16,185,129,0.04);border:1px solid rgba(16,185,129,0.12);border-radius:10px;cursor:pointer;transition:background .15s}
.toggle-row:hover{background:rgba(16,185,129,0.07)}
.toggle-check{width:20px;height:20px;border-radius:6px;border:2px solid rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;transition:all .2s}
.toggle-check.on{background:#10b981;border-color:#10b981;color:#fff}
.btn-confirm{flex:2;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;padding:11px;border-radius:10px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;transition:filter .15s}
.btn-confirm:hover{filter:brightness(1.1)}
.btn-cancel{flex:1;background:rgba(255,255,255,0.04);color:#64748b;border:1px solid rgba(255,255,255,0.08);padding:11px;border-radius:10px;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer;transition:all .15s}
.btn-cancel:hover{background:rgba(255,255,255,0.07);color:#94a3b8}

@media (max-width: 768px) {
  .anim-body{flex-direction:column!important}
  nav[style]{display:none!important}
  div[style*="position:fixed;bottom:0"]{display:flex!important;justify-content:space-around;padding:8px 0 12px}
  .bottom-btn{display:flex;flex-direction:column;align-items:center;background:transparent;border:none;color:#334155;font-family:inherit;font-size:11px;cursor:pointer;padding:6px 10px;border-radius:10px;transition:color .15s;min-width:48px}
  .bottom-btn.active{color:#a5b4fc}
  main{padding-bottom:80px!important}
  div[style*="padding:20px 24px"]{padding:16px!important}
  div[style*="gridTemplateColumns:repeat(4"]{grid-template-columns:repeat(2,1fr)!important}
}
`;
