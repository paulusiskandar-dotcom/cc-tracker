import { useState, useMemo } from "react";
import { accountsApi, ledgerApi, installmentsApi, recurringApi, fmtIDR, todayStr, ym, daysUntil } from "../api";
import { ENTITIES, EXPENSE_CATEGORIES } from "../constants";
import { Overlay, F, R2, BtnRow, SubTabs, Input, Select, Tag, EntityTag, CatPill,
         ProgressBar, Empty, SectionHeader, showToast, confirmDelete, MonthSelect } from "./shared";

const SUBTABS = [
  { id:"overview",     label:"Overview" },
  { id:"transactions", label:"Transactions" },
  { id:"installments", label:"Installments" },
  { id:"recurring",    label:"Recurring" },
];

export default function CreditCards({
  th, user, accounts, ledger, thisMonthLedger, categories, installments,
  recurTemplates, fxRates, CURRENCIES, onRefresh,
  setAccounts, setLedger, setInstallments, setRecurTemplates,
}) {
  const [subTab, setSubTab]         = useState("overview");
  const [selectedCard, setSelectedCard] = useState(null);
  const [filterMonth, setFilterMonth]   = useState(ym(todayStr()));
  const [showPayCC, setShowPayCC]       = useState(false);
  const [payCC, setPayCC]               = useState({ cardId:"", bankId:"", amount:"", notes:"" });
  const [showInstForm, setShowInstForm] = useState(false);
  const [instForm, setInstForm]         = useState({ account_id:"", description:"", total_amount:"", months:12, monthly_amount:"", start_date:todayStr(), entity:"Personal", currency:"IDR" });
  const [saving, setSaving]             = useState(false);

  const creditCards = useMemo(() => accounts.filter(a=>a.type==="credit_card"), [accounts]);
  const bankAccounts = useMemo(() => accounts.filter(a=>a.type==="bank"), [accounts]);

  // CC stats
  const cardStats = useMemo(() => creditCards.map(cc => {
    const debt = Number(cc.current_balance||0);
    const limit = Number(cc.card_limit||0);
    const util = limit>0?(debt/limit)*100:0;
    const target = Number(cc.monthly_target||0);
    const monthLedger = ledger.filter(e=>ym(e.date)===filterMonth&&e.from_account_id===cc.id&&["expense","qris_debit"].includes(e.type));
    const monthSpent = monthLedger.reduce((s,e)=>s+Number(e.amount_idr||e.amount||0),0);
    const dueIn = cc.due_day ? daysUntil(cc.due_day) : null;
    const stmtIn = cc.statement_day ? daysUntil(cc.statement_day) : null;
    return { ...cc, debt, limit, util, target, monthSpent, dueIn, stmtIn };
  }), [creditCards, ledger, filterMonth]);

  const activeCard = selectedCard ? cardStats.find(c=>c.id===selectedCard) : null;

  const payBill = async () => {
    if (!payCC.cardId || !payCC.bankId || !payCC.amount) return showToast("Fill all fields","error");
    setSaving(true);
    try {
      const amt = Number(payCC.amount);
      const cc  = accounts.find(a=>a.id===payCC.cardId);
      const bank= accounts.find(a=>a.id===payCC.bankId);
      const entry = {
        date:todayStr(), description:`Pay ${cc?.name||"CC"} bill`,
        amount:amt, currency:"IDR", amount_idr:amt,
        type:"pay_cc", from_account_id:payCC.bankId, to_account_id:payCC.cardId,
        entity:"Personal", notes:payCC.notes||"",
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(p=>[r,...p]);
      await onRefresh();
      showToast(`Paid ${fmtIDR(amt,true)} to ${cc?.name}`);
      setShowPayCC(false); setPayCC({cardId:"",bankId:"",amount:"",notes:""});
    } catch(e) { showToast(e.message,"error"); }
    setSaving(false);
  };

  const saveInst = async () => {
    if (!instForm.account_id||!instForm.description||!instForm.total_amount) return showToast("Fill required fields","error");
    setSaving(true);
    try {
      const monthlyAmt = instForm.monthly_amount||Math.round(Number(instForm.total_amount)/Number(instForm.months||12));
      const d = { ...instForm, monthly_amount:monthlyAmt, total_amount:Number(instForm.total_amount), months:Number(instForm.months), paid_months:0 };
      const r = await installmentsApi.create(user.id, d);
      if (r) setInstallments(p=>[r,...p]);
      showToast("Installment added");
      setShowInstForm(false);
    } catch(e) { showToast(e.message,"error"); }
    setSaving(false);
  };

  const markInstPaid = async (inst) => {
    try {
      const newPaid = Math.min(inst.paid_months+1, inst.months);
      await installmentsApi.update(inst.id,{paid_months:newPaid});
      setInstallments(p=>p.map(x=>x.id===inst.id?{...x,paid_months:newPaid}:x));
      // Create ledger entry
      const cc = accounts.find(a=>a.id===inst.account_id);
      const entry = { date:todayStr(), description:`${inst.description} — Month ${newPaid}/${inst.months}`, amount:Number(inst.monthly_amount), currency:inst.currency||"IDR", amount_idr:Number(inst.monthly_amount), type:"cc_installment", from_account_id:inst.account_id, entity:inst.entity||"Personal", notes:"CC Installment" };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(p=>[r,...p]);
      showToast(`Month ${newPaid} marked paid`);
    } catch(e) { showToast(e.message,"error"); }
  };

  const delInst = async (id) => {
    if (!window.confirm("Delete installment?")) return;
    await installmentsApi.delete(id);
    setInstallments(p=>p.filter(x=>x.id!==id));
    showToast("Deleted");
  };

  // Filter ledger for CC transactions
  const ccLedger = useMemo(()=>ledger.filter(e=>{
    const isCC = creditCards.some(c=>c.id===e.from_account_id);
    const inMonth = filterMonth==="all"||ym(e.date)===filterMonth;
    const forCard = !selectedCard||(e.from_account_id===selectedCard||e.to_account_id===selectedCard);
    return isCC&&inMonth&&forCard;
  }),[ledger,creditCards,filterMonth,selectedCard]);

  const ccInstallments = useMemo(()=>installments.filter(i=>creditCards.some(c=>c.id===i.account_id)),[installments,creditCards]);
  const ccRecurring = useMemo(()=>recurTemplates.filter(r=>creditCards.some(c=>c.id===r.from_account_id)),[recurTemplates,creditCards]);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:20, fontWeight:800, color:th.tx }}>Credit Cards</div>
        <div style={{ display:"flex", gap:6 }}>
          <button className="btn btn-ghost" onClick={()=>setShowInstForm(true)} style={{ fontSize:12, padding:"8px 12px", color:th.tx2, borderColor:th.bor }}>+ Installment</button>
          <button className="btn btn-primary" onClick={()=>setShowPayCC(true)}>💳 Pay Bill</button>
        </div>
      </div>

      <SubTabs tabs={SUBTABS} active={subTab} onChange={setSubTab} th={th}/>

      {/* ── OVERVIEW ── */}
      {subTab==="overview" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {creditCards.length===0
            ? <Empty icon="💳" message="No credit cards. Add one from Accounts." th={th}/>
            : cardStats.map(cc=>(
                <div key={cc.id} style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:16, overflow:"hidden" }}>
                  {/* Card visual */}
                  <div style={{ background:`linear-gradient(135deg,${cc.color||"#3b5bdb"},${cc.accent||"#7048e8"})`, padding:"18px 20px", color:"#fff", position:"relative", overflow:"hidden" }}>
                    <div style={{ position:"absolute", top:-15, right:-15, width:80, height:80, background:"rgba(255,255,255,.08)", borderRadius:"50%" }}/>
                    <div style={{ fontSize:10, opacity:.7, fontWeight:600, marginBottom:8 }}>{cc.bank_name||"Card"} · {cc.network||"Visa"}</div>
                    <div style={{ fontSize:18, fontWeight:800, letterSpacing:"3px" }}>···· ···· ···· {cc.last4||"????"}  </div>
                    <div style={{ marginTop:10, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                      <div>
                        <div style={{ fontSize:10, opacity:.7 }}>Current Debt</div>
                        <div className="num" style={{ fontSize:22, fontWeight:800 }}>{fmtIDR(cc.debt,true)}</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:10, opacity:.7 }}>Limit</div>
                        <div className="num" style={{ fontSize:14, fontWeight:700 }}>{fmtIDR(cc.limit,true)}</div>
                      </div>
                    </div>
                  </div>
                  {/* Stats */}
                  <div style={{ padding:"14px 16px" }}>
                    <ProgressBar value={cc.debt} max={cc.limit||1} color={cc.util>80?"#e03131":cc.util>60?"#e67700":"#0ca678"} height={6} th={th}/>
                    <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:11, color:th.tx3 }}>
                      <span>{cc.util.toFixed(0)}% utilized</span>
                      {cc.dueIn!==null&&<span style={{ color:cc.dueIn<=3?"#e03131":cc.dueIn<=7?"#e67700":th.tx3 }}>Due in {cc.dueIn}d</span>}
                      {cc.stmtIn!==null&&<span>Statement in {cc.stmtIn}d</span>}
                    </div>
                    {cc.target>0&&(
                      <div style={{ marginTop:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:4 }}>
                          <span style={{ color:th.tx3 }}>Monthly Spend vs Target</span>
                          <span className="num" style={{ fontWeight:700, color:cc.monthSpent>cc.target?"#e03131":"#0ca678" }}>
                            {fmtIDR(cc.monthSpent,true)} / {fmtIDR(cc.target,true)}
                          </span>
                        </div>
                        <ProgressBar value={cc.monthSpent} max={cc.target} color={cc.monthSpent>cc.target?"#e03131":"#0ca678"} height={5} th={th}/>
                      </div>
                    )}
                    <div style={{ display:"flex", gap:8, marginTop:12 }}>
                      <button onClick={()=>{setPayCC(p=>({...p,cardId:cc.id}));setShowPayCC(true);}} className="btn btn-primary" style={{ flex:1, fontSize:12 }}>💳 Pay Bill</button>
                      <button onClick={()=>{setSelectedCard(selectedCard===cc.id?null:cc.id);setSubTab("transactions");}} style={{ border:`1px solid ${th.bor}`, background:th.sur2, color:th.tx2, borderRadius:9, padding:"8px 14px", cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:"'Sora',sans-serif" }}>📋 Transactions</button>
                    </div>
                  </div>
                </div>
              ))
          }
        </div>
      )}

      {/* ── TRANSACTIONS ── */}
      {subTab==="transactions" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <MonthSelect value={filterMonth} onChange={setFilterMonth} th={th}/>
            <Select value={selectedCard||""} onChange={e=>setSelectedCard(e.target.value||null)} th={th} style={{ flex:1 }}>
              <option value="">All Cards</option>
              {creditCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div style={{ fontSize:12, color:th.tx3 }}>{ccLedger.length} transactions · Total: {fmtIDR(ccLedger.reduce((s,e)=>s+Number(e.amount_idr||e.amount||0),0),true)}</div>
          {ccLedger.length===0
            ? <Empty icon="📋" message="No CC transactions" th={th}/>
            : ccLedger.map(e=>{
                const cc = creditCards.find(c=>c.id===e.from_account_id);
                const cat = categories.find(c=>c.id===e.category_id);
                return(
                  <div key={e.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px", background:th.sur, border:`1px solid ${th.bor}`, borderRadius:11 }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:th.tx }}>{e.description}</div>
                      <div style={{ fontSize:11, color:th.tx3, marginTop:2, display:"flex", gap:8, flexWrap:"wrap" }}>
                        <span>{e.date}</span>
                        {cc&&<span style={{ color:cc.color||th.ac }}>····{cc.last4}</span>}
                        {(cat||e.category_label)&&<CatPill category={cat?.name||e.category_label} small th={th}/>}
                        {e.entity&&e.entity!=="Personal"&&<EntityTag entity={e.entity} small/>}
                        {e.is_reimburse&&<Tag bg={th.amBg} color={th.am} small>↗ Reimburse</Tag>}
                      </div>
                    </div>
                    <div className="num" style={{ fontSize:14, fontWeight:800, color:"#e03131" }}>−{fmtIDR(Number(e.amount_idr||e.amount||0),true)}</div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ── INSTALLMENTS ── */}
      {subTab==="installments" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ textAlign:"right" }}>
            <button className="btn btn-primary" onClick={()=>setShowInstForm(true)}>+ Add Installment</button>
          </div>
          {ccInstallments.length===0
            ? <Empty icon="📅" message="No installment plans" th={th}/>
            : ccInstallments.map(inst=>{
                const cc=creditCards.find(c=>c.id===inst.account_id);
                const pct=(inst.paid_months/inst.months)*100;
                const remaining=inst.months-inst.paid_months;
                return(
                  <div key={inst.id} style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:12, padding:"14px 16px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:700, color:th.tx }}>{inst.description}</div>
                        <div style={{ fontSize:11, color:th.tx3 }}>{cc?.name||"CC"} · {inst.months} months · {fmtIDR(inst.monthly_amount,true)}/mo</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div className="num" style={{ fontSize:13, fontWeight:800, color:th.ac }}>{fmtIDR(Number(inst.monthly_amount||0)*remaining,true)}</div>
                        <div style={{ fontSize:10, color:th.tx3 }}>remaining</div>
                      </div>
                    </div>
                    {/* Month dots */}
                    <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginBottom:8 }}>
                      {Array.from({length:inst.months}).map((_,i)=>(
                        <div key={i} style={{ width:14, height:14, borderRadius:3, background:i<inst.paid_months?th.gr:th.sur3, border:`1px solid ${i<inst.paid_months?th.gr:th.bor}` }}/>
                      ))}
                    </div>
                    <ProgressBar value={inst.paid_months} max={inst.months} color={th.gr} height={5} th={th} showPct/>
                    <div style={{ fontSize:10, color:th.tx3, marginTop:4 }}>{inst.paid_months}/{inst.months} months paid</div>
                    <div style={{ display:"flex", gap:6, marginTop:10 }}>
                      {inst.paid_months<inst.months&&<button className="btn btn-primary" onClick={()=>markInstPaid(inst)} style={{ fontSize:11, padding:"6px 12px" }}>✓ Mark Month Paid</button>}
                      <button onClick={()=>delInst(inst.id)} style={{ border:`1px solid ${th.rd}44`, background:th.rdBg, color:th.rd, borderRadius:7, padding:"6px 12px", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"'Sora',sans-serif" }}>🗑</button>
                    </div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ── RECURRING ── */}
      {subTab==="recurring" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {ccRecurring.length===0
            ? <Empty icon="🔄" message="No recurring CC templates. Add them in Settings." th={th}/>
            : ccRecurring.map(r=>{
                const cc=creditCards.find(c=>c.id===r.from_account_id);
                return(
                  <div key={r.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px", background:th.sur, border:`1px solid ${th.bor}`, borderRadius:11 }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:th.tx }}>{r.name}</div>
                      <div style={{ fontSize:11, color:th.tx3 }}>{cc?.name||"CC"} · {r.frequency} · Day {r.day_of_month}</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div className="num" style={{ fontSize:13, fontWeight:800, color:th.tx }}>{fmtIDR(Number(r.amount||0),true)}</div>
                      <Tag bg={r.active?th.grBg:th.sur3} color={r.active?th.gr:th.tx3} small>{r.active?"Active":"Paused"}</Tag>
                    </div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ── PAY CC MODAL ── */}
      {showPayCC&&(
        <Overlay onClose={()=>setShowPayCC(false)} th={th} title="💳 Pay Credit Card Bill">
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
            <F label="Credit Card" th={th}>
              <Select value={payCC.cardId} onChange={e=>setPayCC(p=>({...p,cardId:e.target.value}))} th={th}>
                <option value="">Select card…</option>
                {cardStats.map(c=><option key={c.id} value={c.id}>{c.name} — Debt: {fmtIDR(c.debt,true)}</option>)}
              </Select>
            </F>
            <F label="From Bank Account" th={th}>
              <Select value={payCC.bankId} onChange={e=>setPayCC(p=>({...p,bankId:e.target.value}))} th={th}>
                <option value="">Select bank…</option>
                {bankAccounts.map(b=><option key={b.id} value={b.id}>{b.name} — {fmtIDR(b.current_balance||0,true)}</option>)}
              </Select>
            </F>
            <F label="Payment Amount (IDR)" th={th}>
              <Input type="number" value={payCC.amount} onChange={e=>setPayCC(p=>({...p,amount:e.target.value}))} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/>
            </F>
            {payCC.cardId&&<div style={{ fontSize:11, color:th.am, padding:"6px 10px", background:th.amBg, borderRadius:7 }}>
              Full balance: {fmtIDR(cardStats.find(c=>c.id===payCC.cardId)?.debt||0)} — you can pay partial amount
            </div>}
            <F label="Notes" th={th}><Input value={payCC.notes} onChange={e=>setPayCC(p=>({...p,notes:e.target.value}))} placeholder="Optional" th={th}/></F>
            <BtnRow onCancel={()=>setShowPayCC(false)} onOk={payBill} label="Pay Now →" th={th} saving={saving}/>
          </div>
        </Overlay>
      )}

      {/* ── INSTALLMENT FORM ── */}
      {showInstForm&&(
        <Overlay onClose={()=>setShowInstForm(false)} th={th} title="Add Installment Plan">
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
            <F label="Credit Card" th={th}>
              <Select value={instForm.account_id} onChange={e=>setInstForm(f=>({...f,account_id:e.target.value}))} th={th}>
                <option value="">Select card…</option>
                {creditCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </F>
            <F label="Description" th={th} required><Input value={instForm.description} onChange={e=>setInstForm(f=>({...f,description:e.target.value}))} placeholder="e.g. MacBook Pro 0%" th={th}/></F>
            <R2>
              <F label="Total Amount" th={th}><Input type="number" value={instForm.total_amount} onChange={e=>setInstForm(f=>({...f,total_amount:e.target.value}))} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
              <F label="Months" th={th}><Input type="number" value={instForm.months} onChange={e=>setInstForm(f=>({...f,months:e.target.value}))} placeholder="12" th={th}/></F>
            </R2>
            <R2>
              <F label="Monthly Amount" th={th}><Input type="number" value={instForm.monthly_amount||Math.round(Number(instForm.total_amount||0)/Number(instForm.months||12))} onChange={e=>setInstForm(f=>({...f,monthly_amount:e.target.value}))} th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
              <F label="Start Date" th={th}><Input type="date" value={instForm.start_date} onChange={e=>setInstForm(f=>({...f,start_date:e.target.value}))} th={th}/></F>
            </R2>
            <F label="Entity" th={th}><Select value={instForm.entity} onChange={e=>setInstForm(f=>({...f,entity:e.target.value}))} th={th}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</Select></F>
            <BtnRow onCancel={()=>setShowInstForm(false)} onOk={saveInst} label="Add Installment" th={th} saving={saving}/>
          </div>
        </Overlay>
      )}
    </div>
  );
}
