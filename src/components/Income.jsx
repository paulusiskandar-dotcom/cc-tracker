import { useState, useMemo } from "react";
import { ledgerApi, incomeSrcApi, fmtIDR, todayStr, ym, mlShort } from "../api";
import { INCOME_CATEGORIES, ENTITIES, FREQUENCIES } from "../constants";
import { Overlay, F, R2, BtnRow, SubTabs, Input, Select, Tag, EntityTag,
         Empty, SectionHeader, showToast, MonthSelect, StatCard } from "./shared";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const SUBTABS = [
  { id:"sources",    label:"Sources" },
  { id:"thismonth",  label:"This Month" },
  { id:"cashflow",   label:"Cash Flow" },
];

export default function Income({
  th, user, accounts, ledger, thisMonthLedger, incomeSrcs, fxRates, CURRENCIES,
  curMonth, onRefresh, setLedger, setIncomeSrcs, receivables,
}) {
  const [subTab, setSubTab]       = useState("sources");
  const [showSrcForm, setShowSrcForm] = useState(false);
  const [editSrcId, setEditSrcId] = useState(null);
  const [srcForm, setSrcForm]     = useState({ name:"", category:"Salary", expected_amount:"", currency:"IDR", frequency:"Monthly", destination_account_id:"", entity:"Personal", is_active:true });
  const [showAddInc, setShowAddInc] = useState(false);
  const [incForm, setIncForm]     = useState({ income_source_id:"", date:todayStr(), description:"", amount:"", currency:"IDR", to_account_id:"", entity:"Personal", notes:"" });
  const [filterMonth, setFilterMonth] = useState(curMonth);
  const [saving, setSaving]       = useState(false);

  const bankAccounts = useMemo(()=>accounts.filter(a=>a.type==="bank"),[accounts]);
  const loanAccs = useMemo(()=>(receivables||accounts.filter(a=>a.type==="receivable")).filter(a=>a.receivable_type==="employee_loan"&&Number(a.outstanding_amount||0)>0),[receivables,accounts]);
  const totalLoanRecovery = loanAccs.reduce((s,l)=>s+Number(l.monthly_installment||0),0);
  const incomeLedger = useMemo(()=>ledger.filter(e=>e.type==="income"),[ledger]);

  const thisMonthIncome = useMemo(()=>
    incomeLedger.filter(e=>ym(e.date)===filterMonth), [incomeLedger, filterMonth]);

  const totalThisMonth = thisMonthIncome.reduce((s,e)=>s+Number(e.amount_idr||e.amount||0),0);
  const expectedThisMonth = incomeSrcs.filter(s=>s.is_active).reduce((s,src)=>s+Number(src.expected_amount||0),0)
    + totalLoanRecovery;

  // Cash flow last 12 months
  const cashFlow = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const m = d.toISOString().slice(0,7);
      const income  = incomeLedger.filter(e=>ym(e.date)===m).reduce((s,e)=>s+Number(e.amount_idr||e.amount||0),0);
      const expense = ledger.filter(e=>ym(e.date)===m&&["expense"].includes(e.type)).reduce((s,e)=>s+Number(e.amount_idr||e.amount||0),0);
      months.push({ month:mlShort(m), income, expense, surplus:income-expense });
    }
    return months;
  }, [ledger, incomeLedger]);

  const saveSrc = async () => {
    if (!srcForm.name||!srcForm.expected_amount) return showToast("Fill required fields","error");
    setSaving(true);
    try {
      const d = { ...srcForm, expected_amount:Number(srcForm.expected_amount) };
      if (editSrcId) {
        const r = await incomeSrcApi.update(editSrcId, d);
        setIncomeSrcs(p=>p.map(s=>s.id===editSrcId?r:s));
        showToast("Source updated");
      } else {
        const r = await incomeSrcApi.create(user.id, d);
        setIncomeSrcs(p=>[...p,r]);
        showToast("Income source added");
      }
      setShowSrcForm(false);
    } catch(e) { showToast(e.message,"error"); }
    setSaving(false);
  };

  const delSrc = async (id) => {
    if (!window.confirm("Delete this income source?")) return;
    try {
      await incomeSrcApi.delete(id);
      setIncomeSrcs(p=>p.filter(s=>s.id!==id));
      showToast("Deleted");
    } catch(e) { showToast(e.message,"error"); }
  };

  const addIncome = async () => {
    if (!incForm.description||!incForm.amount||!incForm.to_account_id) return showToast("Fill required fields","error");
    setSaving(true);
    try {
      const amt = Number(incForm.amount);
      const src = incomeSrcs.find(s=>s.id===incForm.income_source_id);
      const entry = {
        date:incForm.date, description:incForm.description,
        amount:amt, currency:incForm.currency||"IDR", amount_idr:amt,
        type:"income", from_account_id:null, to_account_id:incForm.to_account_id,
        entity:incForm.entity||"Personal", notes:incForm.notes||"",
        category_label:src?.category||"Salary",
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(p=>[r,...p]);
      await onRefresh();
      showToast(`Income ${fmtIDR(amt,true)} recorded`);
      setShowAddInc(false);
    } catch(e) { showToast(e.message,"error"); }
    setSaving(false);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:20, fontWeight:800, color:th.tx }}>Income</div>
        <div style={{ display:"flex", gap:6 }}>
          <button className="btn btn-ghost" onClick={()=>{setEditSrcId(null);setSrcForm({name:"",category:"Salary",expected_amount:"",currency:"IDR",frequency:"Monthly",destination_account_id:"",entity:"Personal",is_active:true});setShowSrcForm(true);}} style={{ fontSize:12, padding:"8px 12px", color:th.tx2, borderColor:th.bor }}>+ Source</button>
          <button className="btn btn-primary" onClick={()=>{setIncForm({income_source_id:"",date:todayStr(),description:"",amount:"",currency:"IDR",to_account_id:bankAccounts[0]?.id||"",entity:"Personal",notes:""});setShowAddInc(true);}}>+ Income</button>
        </div>
      </div>

      <SubTabs tabs={SUBTABS} active={subTab} onChange={setSubTab} th={th}/>

      {/* ── SOURCES ── */}
      {subTab==="sources" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {/* Loan recovery section */}
          {loanAccs.length > 0 && (
            <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:13, padding:"14px 16px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <div style={{ fontSize:12, fontWeight:700, color:th.tx3, textTransform:"uppercase", letterSpacing:.5 }}>💼 Loan Recovery</div>
                <div className="num" style={{ fontSize:13, fontWeight:800, color:th.gr }}>{fmtIDR(totalLoanRecovery,true)}/mo</div>
              </div>
              {loanAccs.map(l=>{
                const outstanding = Number(l.outstanding_amount||0);
                const total = Number(l.total_loan_amount||outstanding);
                const monthly = Number(l.monthly_installment||0);
                const remainMonths = monthly > 0 ? Math.ceil(outstanding/monthly) : 0;
                const nextDue = (() => {
                  if (!l.start_date || !monthly) return null;
                  const day = new Date(l.start_date).getDate();
                  const now = new Date();
                  let d = new Date(now.getFullYear(), now.getMonth(), day);
                  if (d <= now) d = new Date(now.getFullYear(), now.getMonth()+1, day);
                  return d.toLocaleDateString("en-US",{day:"numeric",month:"short"});
                })();
                return (
                  <div key={l.id} style={{ padding:"10px 12px", background:th.sur2, borderRadius:9, marginBottom:6, display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:th.tx }}>{l.contact_name||l.name}</div>
                      <div style={{ fontSize:11, color:th.tx3, marginTop:2 }}>
                        {remainMonths > 0 ? `${remainMonths} months remaining` : "Fully paid"}
                        {nextDue && ` · Next: ${nextDue}`}
                      </div>
                      <div style={{ fontSize:10, color:th.tx3 }}>
                        {l.deduction_method==="direct_payment" ? "Direct payment" : "Salary deduction"}
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div className="num" style={{ fontSize:14, fontWeight:800, color:th.gr }}>+{fmtIDR(monthly,true)}</div>
                      <div style={{ fontSize:10, color:th.tx3 }}>per month</div>
                      <Tag bg={th.grBg} color={th.gr} small>Active ●</Tag>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {incomeSrcs.length===0 && loanAccs.length===0
            ? <Empty icon="💰" message="No income sources. Add your salary, rent, etc." th={th}/>
            : incomeSrcs.map(src=>(
                <div key={src.id} style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:12, padding:"14px 16px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:700, color:th.tx }}>{src.name}</div>
                      <div style={{ fontSize:11, color:th.tx3, marginTop:2, display:"flex", gap:8 }}>
                        <span>{src.category}</span>
                        <span>{src.frequency}</span>
                        {src.entity&&src.entity!=="Personal"&&<EntityTag entity={src.entity} small/>}
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div className="num" style={{ fontSize:15, fontWeight:800, color:th.gr }}>{fmtIDR(Number(src.expected_amount||0),true)}</div>
                      <div style={{ fontSize:10, color:th.tx3 }}>expected/{src.frequency?.toLowerCase()}</div>
                      <Tag bg={src.is_active?th.grBg:th.sur3} color={src.is_active?th.gr:th.tx3} small>{src.is_active?"Active":"Inactive"}</Tag>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:6, marginTop:10 }}>
                    <button onClick={()=>{setEditSrcId(src.id);setSrcForm({...src});setShowSrcForm(true);}} style={{ border:`1px solid ${th.bor}`, background:th.sur2, color:th.tx2, borderRadius:7, padding:"5px 10px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"'Sora',sans-serif" }}>✏️ Edit</button>
                    <button onClick={()=>delSrc(src.id)} style={{ border:`1px solid ${th.rd}44`, background:th.rdBg, color:th.rd, borderRadius:7, padding:"5px 10px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"'Sora',sans-serif" }}>🗑</button>
                  </div>
                </div>
              ))
          }
        </div>
      )}

      {/* ── THIS MONTH ── */}
      {subTab==="thismonth" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <MonthSelect value={filterMonth} onChange={setFilterMonth} th={th}/>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <StatCard label="Actual Income" value={fmtIDR(totalThisMonth,true)} color={th.gr} icon="↓" th={th}/>
            <StatCard label="Expected" value={fmtIDR(expectedThisMonth,true)} color={th.te} icon="📋" th={th}
              sub={totalThisMonth>=expectedThisMonth?"✅ Target met":"⏳ Pending"}/>
          </div>
          {thisMonthIncome.length===0
            ? <Empty icon="💰" message="No income recorded this month" th={th}/>
            : thisMonthIncome.map(e=>{
                const dest = accounts.find(a=>a.id===e.to_account_id);
                return(
                  <div key={e.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px", background:th.sur, border:`1px solid ${th.bor}`, borderRadius:11 }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:th.tx }}>{e.description}</div>
                      <div style={{ fontSize:11, color:th.tx3, marginTop:2 }}>
                        {e.date}{dest&&` → ${dest.name}`}
                        {e.entity&&e.entity!=="Personal"&&<span style={{ marginLeft:6 }}><EntityTag entity={e.entity} small/></span>}
                      </div>
                    </div>
                    <div className="num" style={{ fontSize:14, fontWeight:800, color:th.gr }}>+{fmtIDR(Number(e.amount_idr||e.amount||0),true)}</div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ── CASH FLOW ── */}
      {subTab==="cashflow" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
            <SectionHeader title="Income vs Expense — Last 12 Months" th={th}/>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={cashFlow} barSize={10}>
                <XAxis dataKey="month" tick={{ fontSize:9, fill:th.tx3 }} axisLine={false} tickLine={false}/>
                <YAxis hide/>
                <Tooltip contentStyle={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:8, fontFamily:"'Sora',sans-serif", fontSize:11 }} formatter={v=>fmtIDR(v,true)}/>
                <Bar dataKey="income" fill={th.gr} radius={3} name="Income"/>
                <Bar dataKey="expense" fill={th.rd} radius={3} name="Expense"/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16, overflowX:"auto" }}>
            <SectionHeader title="Monthly Summary" th={th}/>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ color:th.tx3, textAlign:"left" }}>
                  {["Month","Income","Expense","Surplus"].map(h=><th key={h} style={{ padding:"6px 8px", borderBottom:`1px solid ${th.bor}`, fontWeight:700 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {cashFlow.slice().reverse().map(m=>(
                  <tr key={m.month}>
                    <td style={{ padding:"8px", color:th.tx2, fontWeight:600 }}>{m.month}</td>
                    <td className="num" style={{ padding:"8px", color:th.gr, fontWeight:700 }}>{fmtIDR(m.income,true)}</td>
                    <td className="num" style={{ padding:"8px", color:th.rd, fontWeight:700 }}>{fmtIDR(m.expense,true)}</td>
                    <td className="num" style={{ padding:"8px", color:m.surplus>=0?th.gr:th.rd, fontWeight:800 }}>
                      {m.surplus>=0?"+":""}{fmtIDR(m.surplus,true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SOURCE FORM ── */}
      {showSrcForm&&(
        <Overlay onClose={()=>setShowSrcForm(false)} th={th} title={editSrcId?"Edit Income Source":"Add Income Source"}>
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
            <F label="Name" th={th} required><Input value={srcForm.name} onChange={e=>setSrcForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Monthly Salary" th={th}/></F>
            <R2>
              <F label="Category" th={th}><Select value={srcForm.category} onChange={e=>setSrcForm(f=>({...f,category:e.target.value}))} th={th}>{INCOME_CATEGORIES.map(c=><option key={c}>{c}</option>)}</Select></F>
              <F label="Frequency" th={th}><Select value={srcForm.frequency} onChange={e=>setSrcForm(f=>({...f,frequency:e.target.value}))} th={th}>{FREQUENCIES.map(f=><option key={f}>{f}</option>)}</Select></F>
            </R2>
            <R2>
              <F label="Expected Amount" th={th} required><Input type="number" value={srcForm.expected_amount} onChange={e=>setSrcForm(f=>({...f,expected_amount:e.target.value}))} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
              <F label="Currency" th={th}><Select value={srcForm.currency} onChange={e=>setSrcForm(f=>({...f,currency:e.target.value}))} th={th}>{(CURRENCIES||[]).map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</Select></F>
            </R2>
            <F label="Destination Account" th={th}>
              <Select value={srcForm.destination_account_id} onChange={e=>setSrcForm(f=>({...f,destination_account_id:e.target.value}))} th={th}>
                <option value="">Select…</option>
                {bankAccounts.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </F>
            <R2>
              <F label="Entity" th={th}><Select value={srcForm.entity} onChange={e=>setSrcForm(f=>({...f,entity:e.target.value}))} th={th}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</Select></F>
              <F label="Status" th={th}>
                <label style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, cursor:"pointer" }}>
                  <input type="checkbox" checked={srcForm.is_active} onChange={e=>setSrcForm(f=>({...f,is_active:e.target.checked}))} style={{ accentColor:th.gr }}/>
                  <span style={{ fontSize:13, color:th.tx2 }}>Active</span>
                </label>
              </F>
            </R2>
            <BtnRow onCancel={()=>setShowSrcForm(false)} onOk={saveSrc} label={editSrcId?"Update":"Add Source"} th={th} saving={saving}/>
          </div>
        </Overlay>
      )}

      {/* ── ADD INCOME FORM ── */}
      {showAddInc&&(
        <Overlay onClose={()=>setShowAddInc(false)} th={th} title="Record Income">
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
            <F label="Income Source (optional)" th={th}>
              <Select value={incForm.income_source_id} onChange={e=>{
                const src=incomeSrcs.find(s=>s.id===e.target.value);
                setIncForm(f=>({...f,income_source_id:e.target.value,description:src?.name||f.description,amount:src?.expected_amount||f.amount,entity:src?.entity||f.entity,to_account_id:src?.destination_account_id||f.to_account_id}));
              }} th={th}>
                <option value="">— Manual entry —</option>
                {incomeSrcs.filter(s=>s.is_active).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </F>
            <R2>
              <F label="Date" th={th}><Input type="date" value={incForm.date} onChange={e=>setIncForm(f=>({...f,date:e.target.value}))} th={th}/></F>
              <F label="Entity" th={th}><Select value={incForm.entity} onChange={e=>setIncForm(f=>({...f,entity:e.target.value}))} th={th}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</Select></F>
            </R2>
            <F label="Description" th={th} required><Input value={incForm.description} onChange={e=>setIncForm(f=>({...f,description:e.target.value}))} placeholder="e.g. April Salary" th={th}/></F>
            <R2>
              <F label="Amount" th={th} required><Input type="number" value={incForm.amount} onChange={e=>setIncForm(f=>({...f,amount:e.target.value}))} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
              <F label="Currency" th={th}><Select value={incForm.currency} onChange={e=>setIncForm(f=>({...f,currency:e.target.value}))} th={th}>{(CURRENCIES||[]).map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</Select></F>
            </R2>
            <F label="To Bank Account" th={th} required>
              <Select value={incForm.to_account_id} onChange={e=>setIncForm(f=>({...f,to_account_id:e.target.value}))} th={th}>
                <option value="">Select bank…</option>
                {bankAccounts.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </F>
            <F label="Notes" th={th}><Input value={incForm.notes} onChange={e=>setIncForm(f=>({...f,notes:e.target.value}))} placeholder="Optional" th={th}/></F>
            <BtnRow onCancel={()=>setShowAddInc(false)} onOk={addIncome} label="Record Income →" th={th} saving={saving}/>
          </div>
        </Overlay>
      )}
    </div>
  );
}
