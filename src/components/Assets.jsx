import { useState, useMemo } from "react";
import { accountsApi, ledgerApi, fmtIDR, todayStr } from "../api";
import { ASSET_SUBTYPES, ASSET_ICON, ASSET_COL, ENTITIES } from "../constants";
import { Overlay, F, R2, BtnRow, SubTabs, Input, Select, Tag, EntityTag,
         ProgressBar, Empty, SectionHeader, showToast, confirmDelete, StatCard } from "./shared";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const SUBTABS = [
  { id:"overview",    label:"Overview" },
  { id:"assets",      label:"Assets" },
  { id:"liabilities", label:"Liabilities" },
];

export default function Assets({
  th, user, accounts, ledger, onRefresh, setAccounts, setLedger, CURRENCIES,
}) {
  const [subTab, setSubTab]           = useState("overview");
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [selectedAsset, setSelectedAsset]  = useState(null);
  const [updateVal, setUpdateVal]          = useState({ value:"", date:todayStr(), notes:"" });
  const [showPayForm, setShowPayForm]       = useState(false);
  const [payForm, setPayForm]               = useState({ liabId:"", bankId:"", amount:"", date:todayStr(), notes:"" });
  const [saving, setSaving]                 = useState(false);

  const assets      = useMemo(() => accounts.filter(a=>a.type==="asset"), [accounts]);
  const liabilities = useMemo(() => accounts.filter(a=>a.type==="liability"), [accounts]);
  const bankAccounts= useMemo(() => accounts.filter(a=>a.type==="bank"), [accounts]);

  const totalAssets = assets.reduce((s,a)=>s+Number(a.current_value||0),0);
  const totalLiab   = liabilities.reduce((s,l)=>s+Number(l.outstanding_amount||0),0);
  const netAssets   = totalAssets - totalLiab;
  const totalPurchase = assets.reduce((s,a)=>s+Number(a.purchase_value||0),0);
  const totalGain   = totalAssets - totalPurchase;

  // By category for pie
  const byCategory = useMemo(() => {
    const map = {};
    assets.forEach(a => { map[a.subtype||"Other"] = (map[a.subtype||"Other"]||0) + Number(a.current_value||0); });
    return Object.entries(map).map(([name,value])=>({name,value})).filter(x=>x.value>0);
  }, [assets]);

  const updateValue = async () => {
    if (!updateVal.value||!selectedAsset) return;
    setSaving(true);
    try {
      const newVal = Number(updateVal.value);
      await accountsApi.update(selectedAsset.id, { current_value:newVal });
      setAccounts(p=>p.map(a=>a.id===selectedAsset.id?{...a,current_value:newVal}:a));
      showToast(`${selectedAsset.name} updated to ${fmtIDR(newVal,true)}`);
      setShowUpdateForm(false);
    } catch(e) { showToast(e.message,"error"); }
    setSaving(false);
  };

  const payLiability = async () => {
    if (!payForm.liabId||!payForm.bankId||!payForm.amount) return showToast("Fill all fields","error");
    setSaving(true);
    try {
      const amt = Number(payForm.amount);
      const liab = accounts.find(a=>a.id===payForm.liabId);
      const bank = accounts.find(a=>a.id===payForm.bankId);
      const entry = {
        date:payForm.date, description:`Pay ${liab?.name||"Liability"}`,
        amount:amt, currency:"IDR", amount_idr:amt,
        type:"pay_liability", from_account_id:payForm.bankId, to_account_id:payForm.liabId,
        entity:liab?.entity||"Personal", notes:payForm.notes||"",
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(p=>[r,...p]);
      await onRefresh();
      showToast(`Paid ${fmtIDR(amt,true)} towards ${liab?.name}`);
      setShowPayForm(false);
    } catch(e) { showToast(e.message,"error"); }
    setSaving(false);
  };

  const PIE_COLORS = Object.values(ASSET_COL);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ fontSize:20, fontWeight:800, color:th.tx }}>Assets & Liabilities</div>

      <SubTabs tabs={SUBTABS} active={subTab} onChange={setSubTab} th={th}/>

      {/* ── OVERVIEW ── */}
      {subTab==="overview" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {/* Hero */}
          <div style={{ background:"linear-gradient(135deg,#0ca678,#0c8599)", borderRadius:16, padding:"20px", color:"#fff" }}>
            <div style={{ fontSize:11, fontWeight:700, opacity:.7, marginBottom:4 }}>NET ASSET VALUE</div>
            <div className="num" style={{ fontSize:30, fontWeight:800 }}>{fmtIDR(netAssets)}</div>
            <div style={{ display:"flex", gap:20, marginTop:12 }}>
              <div><div style={{ fontSize:10, opacity:.7 }}>Total Assets</div><div className="num" style={{ fontSize:14, fontWeight:700 }}>{fmtIDR(totalAssets,true)}</div></div>
              <div><div style={{ fontSize:10, opacity:.7 }}>Liabilities</div><div className="num" style={{ fontSize:14, fontWeight:700 }}>−{fmtIDR(totalLiab,true)}</div></div>
              <div><div style={{ fontSize:10, opacity:.7 }}>Gain/Loss</div><div className="num" style={{ fontSize:14, fontWeight:700, color:totalGain>=0?"#a7f3d0":"#fca5a5" }}>{totalGain>=0?"+":""}{fmtIDR(totalGain,true)}</div></div>
            </div>
          </div>

          {/* Pie + category list */}
          {byCategory.length > 0 && (
            <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
              <SectionHeader title="Asset Breakdown" th={th}/>
              <div style={{ display:"flex", gap:16, alignItems:"flex-start", flexWrap:"wrap" }}>
                <PieChart width={120} height={120}>
                  <Pie data={byCategory} cx={55} cy={55} innerRadius={30} outerRadius={55} dataKey="value" paddingAngle={2}>
                    {byCategory.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
                  </Pie>
                </PieChart>
                <div style={{ flex:1 }}>
                  {byCategory.map((c,i)=>(
                    <div key={c.name} style={{ display:"flex", justifyContent:"space-between", marginBottom:6, fontSize:12 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <div style={{ width:8, height:8, borderRadius:2, background:PIE_COLORS[i%PIE_COLORS.length] }}/>
                        <span style={{ color:th.tx2 }}>{ASSET_ICON[c.name]||"📦"} {c.name}</span>
                      </div>
                      <span className="num" style={{ fontWeight:700 }}>{fmtIDR(c.value,true)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ASSETS ── */}
      {subTab==="assets" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {assets.length===0
            ? <Empty icon="📈" message="No assets yet. Add them from Accounts." th={th}/>
            : assets.map(a=>{
                const gain = Number(a.current_value||0)-Number(a.purchase_value||0);
                const gainPct = a.purchase_value>0?(gain/a.purchase_value)*100:0;
                return(
                  <div key={a.id} style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:13, padding:"14px 16px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                          <span style={{ fontSize:20 }}>{ASSET_ICON[a.subtype]||"📦"}</span>
                          <span style={{ fontSize:14, fontWeight:700, color:th.tx }}>{a.name}</span>
                        </div>
                        <div style={{ fontSize:11, color:th.tx3, display:"flex", gap:8 }}>
                          <span>{a.subtype||"Asset"}</span>
                          {a.entity&&a.entity!=="Personal"&&<EntityTag entity={a.entity} small/>}
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div className="num" style={{ fontSize:16, fontWeight:800, color:ASSET_COL[a.subtype]||th.ac }}>{fmtIDR(Number(a.current_value||0),true)}</div>
                        {a.purchase_value>0&&(
                          <div style={{ fontSize:11, fontWeight:700, color:gain>=0?"#0ca678":"#e03131", marginTop:2 }}>
                            {gain>=0?"▲":"▼"}{fmtIDR(Math.abs(gain),true)} ({gainPct>=0?"+":""}{gainPct.toFixed(1)}%)
                          </div>
                        )}
                        <div style={{ fontSize:10, color:th.tx3 }}>Bought: {fmtIDR(a.purchase_value||0,true)}</div>
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:6, marginTop:10 }}>
                      <button onClick={()=>{setSelectedAsset(a);setUpdateVal({value:a.current_value||"",date:todayStr(),notes:""});setShowUpdateForm(true);}}
                        className="btn btn-ghost" style={{ fontSize:11, padding:"5px 12px", color:th.tx2, borderColor:th.bor }}>
                        ✏️ Update Value
                      </button>
                    </div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ── LIABILITIES ── */}
      {subTab==="liabilities" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ textAlign:"right" }}>
            <button className="btn btn-primary" onClick={()=>setShowPayForm(true)}>💳 Make Payment</button>
          </div>
          {liabilities.length===0
            ? <Empty icon="📉" message="No liabilities. Add them from Accounts." th={th}/>
            : liabilities.map(l=>{
                const paid = Number(l.original_amount||0)-Number(l.outstanding_amount||0);
                const pct = l.original_amount>0?(paid/l.original_amount)*100:0;
                return(
                  <div key={l.id} style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:13, padding:"14px 16px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                      <div>
                        <div style={{ fontSize:14, fontWeight:700, color:th.tx }}>{l.name}</div>
                        <div style={{ fontSize:11, color:th.tx3, marginTop:2 }}>
                          {l.creditor} · {l.subtype}
                          {l.interest_rate>0&&` · ${l.interest_rate}% p.a.`}
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:11, color:th.tx3 }}>Outstanding</div>
                        <div className="num" style={{ fontSize:16, fontWeight:800, color:"#e67700" }}>{fmtIDR(Number(l.outstanding_amount||0),true)}</div>
                        {l.monthly_payment>0&&<div style={{ fontSize:10, color:th.tx3 }}>{fmtIDR(l.monthly_payment,true)}/mo</div>}
                      </div>
                    </div>
                    {l.original_amount>0&&(
                      <>
                        <ProgressBar value={paid} max={Number(l.original_amount)} color="#0ca678" height={6} th={th}/>
                        <div style={{ fontSize:10, color:th.tx3, marginTop:3 }}>
                          {pct.toFixed(1)}% paid · {fmtIDR(paid,true)} of {fmtIDR(l.original_amount,true)}
                        </div>
                      </>
                    )}
                    {l.end_date&&<div style={{ fontSize:10, color:th.tx3, marginTop:4 }}>Ends: {l.end_date}</div>}
                    <button onClick={()=>{setPayForm(p=>({...p,liabId:l.id}));setShowPayForm(true);}}
                      className="btn btn-primary" style={{ marginTop:10, fontSize:11, padding:"6px 14px" }}>
                      Make Payment →
                    </button>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ── UPDATE VALUE MODAL ── */}
      {showUpdateForm&&selectedAsset&&(
        <Overlay onClose={()=>setShowUpdateForm(false)} th={th} title="Update Asset Value" sub={selectedAsset.name}>
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
            <div style={{ padding:"10px 14px", background:th.sur2, borderRadius:10, display:"flex", justifyContent:"space-between" }}>
              <div style={{ fontSize:12, color:th.tx3 }}>Current Value</div>
              <div className="num" style={{ fontWeight:800 }}>{fmtIDR(Number(selectedAsset.current_value||0))}</div>
            </div>
            <R2>
              <F label="New Value (IDR)" th={th} required><Input type="number" value={updateVal.value} onChange={e=>setUpdateVal(v=>({...v,value:e.target.value}))} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
              <F label="Date" th={th}><Input type="date" value={updateVal.date} onChange={e=>setUpdateVal(v=>({...v,date:e.target.value}))} th={th}/></F>
            </R2>
            <F label="Notes" th={th}><Input value={updateVal.notes} onChange={e=>setUpdateVal(v=>({...v,notes:e.target.value}))} placeholder="e.g. Annual appraisal" th={th}/></F>
            {updateVal.value&&(
              <div style={{ fontSize:11, color:Number(updateVal.value)>Number(selectedAsset.current_value||0)?"#0ca678":"#e03131" }}>
                Change: {Number(updateVal.value)>Number(selectedAsset.current_value||0)?"+":""}{fmtIDR(Number(updateVal.value)-Number(selectedAsset.current_value||0),true)}
              </div>
            )}
            <BtnRow onCancel={()=>setShowUpdateForm(false)} onOk={updateValue} label="Update Value" th={th} saving={saving}/>
          </div>
        </Overlay>
      )}

      {/* ── PAY LIABILITY MODAL ── */}
      {showPayForm&&(
        <Overlay onClose={()=>setShowPayForm(false)} th={th} title="Pay Liability">
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
            <F label="Liability" th={th}>
              <Select value={payForm.liabId} onChange={e=>setPayForm(f=>({...f,liabId:e.target.value}))} th={th}>
                <option value="">Select liability…</option>
                {liabilities.map(l=><option key={l.id} value={l.id}>{l.name} — {fmtIDR(l.outstanding_amount||0,true)}</option>)}
              </Select>
            </F>
            <F label="From Bank Account" th={th}>
              <Select value={payForm.bankId} onChange={e=>setPayForm(f=>({...f,bankId:e.target.value}))} th={th}>
                <option value="">Select bank…</option>
                {bankAccounts.map(b=><option key={b.id} value={b.id}>{b.name} — {fmtIDR(b.current_balance||0,true)}</option>)}
              </Select>
            </F>
            <R2>
              <F label="Amount (IDR)" th={th}><Input type="number" value={payForm.amount} onChange={e=>setPayForm(f=>({...f,amount:e.target.value}))} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
              <F label="Date" th={th}><Input type="date" value={payForm.date} onChange={e=>setPayForm(f=>({...f,date:e.target.value}))} th={th}/></F>
            </R2>
            <F label="Notes" th={th}><Input value={payForm.notes} onChange={e=>setPayForm(f=>({...f,notes:e.target.value}))} placeholder="Optional" th={th}/></F>
            <BtnRow onCancel={()=>setShowPayForm(false)} onOk={payLiability} label="Record Payment →" th={th} saving={saving}/>
          </div>
        </Overlay>
      )}
    </div>
  );
}
