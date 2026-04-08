import { useState, useMemo } from "react";
import { accountsApi, ledgerApi, fmtIDR, todayStr, agingLabel } from "../api";
import { ENTITIES, ENT_COL, ENT_BG } from "../constants";
import { Overlay, F, R2, BtnRow, SubTabs, Input, Select, Tag, EntityTag,
         ProgressBar, Empty, SectionHeader, showToast, confirmDelete } from "./shared";

const SUBTABS = [
  { id:"reimburse",   label:"Reimburse" },
  { id:"loans",       label:"Employee Loans" },
  { id:"history",     label:"History" },
];

export default function Receivables({
  th, user, accounts, ledger, onRefresh, setAccounts, setLedger, CURRENCIES,
}) {
  const [subTab, setSubTab] = useState("reimburse");
  const [showOut, setShowOut] = useState(false);  // reimburse_out form
  const [showIn, setShowIn]   = useState(false);  // reimburse_in form
  const [showLoan, setShowLoan] = useState(false);
  const [showCollect, setShowCollect] = useState(false);
  const [selectedRec, setSelectedRec] = useState(null);
  const [outForm, setOutForm] = useState({ date:todayStr(), description:"", amount:"", currency:"IDR", entity:"Hamasa", from_id:"", notes:"" });
  const [inForm, setInForm]   = useState({ date:todayStr(), amount:"", bank_id:"", notes:"" });
  const [loanForm, setLoanForm] = useState({ amount:"", bank_id:"", date:todayStr(), notes:"" });
  const [saving, setSaving]   = useState(false);

  const receivables = useMemo(() => accounts.filter(a=>a.type==="receivable"&&a.is_active!==false), [accounts]);
  const reimburseAccs = useMemo(() => receivables.filter(a=>a.receivable_type==="reimburse"), [receivables]);
  const loanAccs = useMemo(() => receivables.filter(a=>a.receivable_type==="employee_loan"), [receivables]);
  const bankAccounts = useMemo(() => accounts.filter(a=>a.type==="bank"), [accounts]);
  const spendAccounts = useMemo(() => accounts.filter(a=>["bank","credit_card"].includes(a.type)), [accounts]);

  // Outstanding + history per receivable
  const recStats = useMemo(() => receivables.map(r => {
    const entries = ledger.filter(e=>e.from_account_id===r.id||e.to_account_id===r.id).sort((a,b)=>a.date.localeCompare(b.date));
    const firstEntry = entries[0];
    const aging = firstEntry ? agingLabel(firstEntry.date) : null;
    return { ...r, entries, aging };
  }), [receivables, ledger]);

  const settledEntries = useMemo(() =>
    ledger.filter(e=>e.type==="reimburse_in"||e.type==="collect_loan"), [ledger]);

  // Reimburse Out (you pay on behalf)
  const doOut = async () => {
    if (!outForm.description||!outForm.amount||!outForm.from_id) return showToast("Fill required fields","error");
    setSaving(true);
    try {
      const rec = receivables.find(r=>r.entity===outForm.entity&&r.receivable_type==="reimburse");
      if (!rec) { showToast(`No receivable account for ${outForm.entity}. Add one in Accounts.`,"error"); setSaving(false); return; }
      const amt = Number(outForm.amount);
      const fromAcc = accounts.find(a=>a.id===outForm.from_id);
      const entry = {
        date:outForm.date, description:outForm.description, amount:amt,
        currency:outForm.currency||"IDR", amount_idr:amt,
        type:"reimburse_out", from_account_id:outForm.from_id, to_account_id:rec.id,
        entity:outForm.entity, notes:outForm.notes||"", is_reimburse:true,
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(p=>[r,...p]);
      await onRefresh();
      showToast(`Recorded: ${fmtIDR(amt,true)} for ${outForm.entity}`);
      setShowOut(false);
    } catch(e) { showToast(e.message,"error"); }
    setSaving(false);
  };

  // Reimburse In (entity pays back)
  const doIn = async () => {
    if (!selectedRec||!inForm.amount||!inForm.bank_id) return showToast("Fill required fields","error");
    setSaving(true);
    try {
      const amt = Number(inForm.amount);
      const entry = {
        date:inForm.date||todayStr(), description:`${selectedRec.entity} reimburse received`,
        amount:amt, currency:"IDR", amount_idr:amt,
        type:"reimburse_in", from_account_id:selectedRec.id, to_account_id:inForm.bank_id,
        entity:selectedRec.entity, notes:inForm.notes||"",
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(p=>[r,...p]);
      await onRefresh();
      showToast(`Received ${fmtIDR(amt,true)} from ${selectedRec.entity}`);
      setShowIn(false);
    } catch(e) { showToast(e.message,"error"); }
    setSaving(false);
  };

  // Give Loan
  const giveLoan = async () => {
    if (!selectedRec||!loanForm.amount||!loanForm.bank_id) return showToast("Fill required fields","error");
    setSaving(true);
    try {
      const amt = Number(loanForm.amount);
      const entry = {
        date:loanForm.date, description:`Loan to ${selectedRec.contact_name||selectedRec.name}`,
        amount:amt, currency:"IDR", amount_idr:amt,
        type:"give_loan", from_account_id:loanForm.bank_id, to_account_id:selectedRec.id,
        entity:"Personal", notes:loanForm.notes||"",
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(p=>[r,...p]);
      await onRefresh();
      showToast(`Loan disbursed: ${fmtIDR(amt,true)}`);
      setShowLoan(false);
    } catch(e) { showToast(e.message,"error"); }
    setSaving(false);
  };

  // Collect Loan Payment
  const collectLoan = async () => {
    if (!selectedRec||!loanForm.amount||!loanForm.bank_id) return showToast("Fill required fields","error");
    setSaving(true);
    try {
      const amt = Number(loanForm.amount);
      const entry = {
        date:loanForm.date, description:`Loan repayment from ${selectedRec.contact_name||selectedRec.name}`,
        amount:amt, currency:"IDR", amount_idr:amt,
        type:"collect_loan", from_account_id:selectedRec.id, to_account_id:loanForm.bank_id,
        entity:"Personal", notes:loanForm.notes||"",
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(p=>[r,...p]);
      await onRefresh();
      showToast(`Received ${fmtIDR(amt,true)} repayment`);
      setShowCollect(false);
    } catch(e) { showToast(e.message,"error"); }
    setSaving(false);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:20, fontWeight:800, color:th.tx }}>Receivables</div>
        <button className="btn btn-primary" onClick={()=>setShowOut(true)}>+ Record Expense</button>
      </div>

      <SubTabs tabs={SUBTABS} active={subTab} onChange={setSubTab} th={th}/>

      {/* ── REIMBURSE ── */}
      {subTab==="reimburse" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {reimburseAccs.length===0
            ? <Empty icon="📋" message='No reimburse accounts. Add one from Accounts (type: Receivable, type: reimburse).' th={th}/>
            : recStats.filter(r=>r.receivable_type==="reimburse").map(r=>{
                const outstanding = Number(r.outstanding_amount||0);
                const recentEntries = r.entries.slice(0,3);
                return(
                  <div key={r.id} style={{ background:th.sur, border:`1px solid ${ENT_COL[r.entity]||th.bor}22`, borderRadius:14, padding:"14px 16px", borderLeft:`4px solid ${ENT_COL[r.entity]||th.ac}` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                      <div>
                        <EntityTag entity={r.entity}/>
                        <div className="num" style={{ fontSize:22, fontWeight:800, color:ENT_COL[r.entity]||th.ac, marginTop:6 }}>{fmtIDR(outstanding)}</div>
                        <div style={{ fontSize:11, color:th.tx3 }}>outstanding</div>
                        {r.aging&&outstanding>0&&<div style={{ marginTop:4 }}><Tag bg={r.aging.color+"22"} color={r.aging.color} small>⏱ {r.aging.label}</Tag></div>}
                      </div>
                      <div style={{ display:"flex", gap:6, flexDirection:"column" }}>
                        <button className="btn btn-primary" onClick={()=>setShowOut(true)} style={{ fontSize:11, padding:"6px 12px" }}>+ Expense</button>
                        <button className="btn btn-ghost" onClick={()=>{setSelectedRec(r);setInForm({date:todayStr(),amount:"",bank_id:bankAccounts[0]?.id||"",notes:""});setShowIn(true);}} style={{ fontSize:11, padding:"6px 12px", color:th.gr, borderColor:th.gr }}>↙ Receive</button>
                      </div>
                    </div>
                    {recentEntries.length>0&&(
                      <div style={{ borderTop:`1px solid ${th.bor}`, paddingTop:8 }}>
                        {recentEntries.map(e=>(
                          <div key={e.id} style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:th.tx3, marginBottom:4 }}>
                            <span>{e.date} · {e.description}</span>
                            <span className="num" style={{ color:e.type==="reimburse_in"?th.gr:th.rd }}>
                              {e.type==="reimburse_in"?"-":"+"}{fmtIDR(Number(e.amount||0),true)}
                            </span>
                          </div>
                        ))}
                        {r.entries.length>3&&<div style={{ fontSize:10, color:th.tx3 }}>{r.entries.length-3} more entries</div>}
                      </div>
                    )}
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ── EMPLOYEE LOANS ── */}
      {subTab==="loans" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {loanAccs.length===0
            ? <Empty icon="👤" message="No employee loans. Add from Accounts (type: Receivable, subtype: employee_loan)." th={th}/>
            : recStats.filter(r=>r.receivable_type==="employee_loan").map(r=>{
                const outstanding    = Number(r.outstanding_amount||0);
                const total          = Number(r.total_loan_amount||r.outstanding_amount||0);
                const paid           = Math.max(0, total - outstanding);
                const paidPct        = total > 0 ? (paid/total)*100 : 0;
                const monthly        = Number(r.monthly_installment||0);
                const paidMonths     = monthly > 0 ? Math.floor(paid/monthly) : 0;
                const totalMonths    = monthly > 0 ? Math.ceil(total/monthly) : 0;
                // Next due date: same day-of-month as start_date
                const nextDue = (() => {
                  if (!r.start_date || !monthly) return null;
                  const day = new Date(r.start_date).getDate();
                  const now = new Date();
                  let d = new Date(now.getFullYear(), now.getMonth(), day);
                  if (d <= now) d = new Date(now.getFullYear(), now.getMonth()+1, day);
                  return d.toLocaleDateString("en-US",{day:"numeric",month:"short",year:"numeric"});
                })();
                // Expected end date
                const endDate = (() => {
                  if (!r.start_date || !totalMonths) return null;
                  const d = new Date(r.start_date);
                  d.setMonth(d.getMonth() + totalMonths);
                  return d.toLocaleDateString("en-US",{month:"short",year:"numeric"});
                })();
                const isFullyPaid = outstanding <= 0;

                return(
                  <div key={r.id} style={{ background:th.sur, border:`1px solid ${isFullyPaid?"#b2f2e8":th.bor}`, borderRadius:13, padding:"14px 16px", borderLeft:`4px solid ${isFullyPaid?"#0ca678":th.am}` }}>
                    {/* Header */}
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                      <div>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ fontSize:18 }}>👤</span>
                          <div>
                            <div style={{ fontSize:14, fontWeight:700, color:th.tx }}>{r.contact_name||r.name}</div>
                            <div style={{ fontSize:11, color:th.tx3 }}>{r.contact_dept||""}{r.deduction_method==="direct_payment"?" · Direct Payment":" · Salary Deduction"}</div>
                          </div>
                        </div>
                        {r.aging&&outstanding>0&&<div style={{ marginTop:4 }}><Tag bg={r.aging.color+"22"} color={r.aging.color} small>{r.aging.label}</Tag></div>}
                      </div>
                      <div style={{ textAlign:"right" }}>
                        {isFullyPaid
                          ? <div style={{ fontSize:13, fontWeight:800, color:"#0ca678" }}>🎉 Fully Paid</div>
                          : <>
                              <div className="num" style={{ fontSize:18, fontWeight:800, color:th.am }}>{fmtIDR(outstanding,true)}</div>
                              <div style={{ fontSize:10, color:th.tx3 }}>remaining</div>
                            </>
                        }
                        {monthly > 0 && <div style={{ fontSize:10, color:th.tx3, marginTop:2 }}>{fmtIDR(monthly,true)}/mo</div>}
                      </div>
                    </div>

                    {/* Progress bar */}
                    {total > 0 && (
                      <>
                        <ProgressBar value={paid} max={total} color={isFullyPaid?"#0ca678":"#0ca678"} height={6} th={th}/>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:th.tx3, marginTop:3 }}>
                          <span>{paidPct.toFixed(0)}% paid · {totalMonths>0?`${paidMonths}/${totalMonths} months`:fmtIDR(paid,true)+" paid"}</span>
                          <span className="num">{fmtIDR(paid,true)} / {fmtIDR(total,true)}</span>
                        </div>
                      </>
                    )}

                    {/* Schedule info */}
                    {!isFullyPaid && (nextDue || endDate) && (
                      <div style={{ display:"flex", gap:16, marginTop:8, fontSize:11, color:th.tx3 }}>
                        {nextDue && <span>📅 Next: <strong style={{ color:th.tx }}>{nextDue}</strong></span>}
                        {endDate && <span>🏁 End: <strong style={{ color:th.tx }}>{endDate}</strong></span>}
                      </div>
                    )}

                    {/* Actions */}
                    {!isFullyPaid && (
                      <div style={{ display:"flex", gap:6, marginTop:12 }}>
                        <button onClick={()=>{setSelectedRec(r);setLoanForm({amount:monthly||"",bank_id:r.default_bank_id||bankAccounts[0]?.id||"",date:todayStr(),notes:""});setShowCollect(true);}} className="btn btn-primary" style={{ fontSize:11, padding:"6px 14px" }}>+ Record Payment</button>
                        <button onClick={()=>{setSelectedRec(r);setLoanForm({amount:"",bank_id:bankAccounts[0]?.id||"",date:todayStr(),notes:""});setShowLoan(true);}} className="btn btn-ghost" style={{ fontSize:11, padding:"6px 12px", color:th.tx2, borderColor:th.bor }}>↗ Disburse More</button>
                      </div>
                    )}

                    {/* Recent entries */}
                    {r.entries.length > 0 && (
                      <div style={{ borderTop:`1px solid ${th.bor}`, marginTop:10, paddingTop:8 }}>
                        {r.entries.slice(0,3).map(e=>(
                          <div key={e.id} style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:th.tx3, marginBottom:3 }}>
                            <span>{e.date} · {e.description}</span>
                            <span className="num" style={{ color:e.type==="collect_loan"?th.gr:th.am }}>
                              {e.type==="collect_loan"?"-":"+"}{fmtIDR(Number(e.amount||0),true)}
                            </span>
                          </div>
                        ))}
                        {r.entries.length>3&&<div style={{ fontSize:10, color:th.tx3 }}>+{r.entries.length-3} more</div>}
                      </div>
                    )}
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ── HISTORY ── */}
      {subTab==="history" && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {settledEntries.length===0
            ? <Empty icon="📜" message="No settled receivables yet" th={th}/>
            : settledEntries.map(e=>{
                const rec = accounts.find(a=>a.id===(e.type==="reimburse_in"?e.from_account_id:e.from_account_id));
                return(
                  <div key={e.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", background:th.sur2, borderRadius:9 }}>
                    <div>
                      <div style={{ fontSize:12, fontWeight:600, color:th.tx }}>{e.description}</div>
                      <div style={{ fontSize:10, color:th.tx3 }}>{e.date} · {rec?.entity||rec?.contact_name||"—"}</div>
                    </div>
                    <div className="num" style={{ fontWeight:700, color:th.gr }}>+{fmtIDR(Number(e.amount||0),true)}</div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ── REIMBURSE OUT FORM ── */}
      {showOut&&(
        <Overlay onClose={()=>setShowOut(false)} th={th} title="Record Expense for Entity" sub="Paid on their behalf">
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
            <F label="Entity" th={th}>
              <Select value={outForm.entity} onChange={e=>setOutForm(f=>({...f,entity:e.target.value}))} th={th}>
                {["Hamasa","SDC","Travelio"].map(e=><option key={e}>{e}</option>)}
              </Select>
            </F>
            <F label="Description" th={th} required><Input value={outForm.description} onChange={e=>setOutForm(f=>({...f,description:e.target.value}))} placeholder="What was the expense?" th={th}/></F>
            <R2>
              <F label="Amount (IDR)" th={th} required><Input type="number" value={outForm.amount} onChange={e=>setOutForm(f=>({...f,amount:e.target.value}))} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
              <F label="Date" th={th}><Input type="date" value={outForm.date} onChange={e=>setOutForm(f=>({...f,date:e.target.value}))} th={th}/></F>
            </R2>
            <F label="Paid From" th={th}>
              <Select value={outForm.from_id} onChange={e=>setOutForm(f=>({...f,from_id:e.target.value}))} th={th}>
                <option value="">Select account…</option>
                {spendAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </F>
            <F label="Notes" th={th}><Input value={outForm.notes} onChange={e=>setOutForm(f=>({...f,notes:e.target.value}))} placeholder="Optional" th={th}/></F>
            <BtnRow onCancel={()=>setShowOut(false)} onOk={doOut} label="Record Expense →" th={th} saving={saving}/>
          </div>
        </Overlay>
      )}

      {/* ── REIMBURSE IN FORM ── */}
      {showIn&&selectedRec&&(
        <Overlay onClose={()=>setShowIn(false)} th={th} title="Receive Reimbursement" sub={selectedRec.entity}>
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
            <div style={{ padding:"10px 14px", background:ENT_BG[selectedRec.entity]||th.sur2, borderRadius:10 }}>
              <div style={{ fontSize:12, color:th.tx3 }}>Outstanding for {selectedRec.entity}</div>
              <div className="num" style={{ fontSize:18, fontWeight:800, color:ENT_COL[selectedRec.entity]||th.ac }}>{fmtIDR(Number(selectedRec.outstanding_amount||0))}</div>
            </div>
            <R2>
              <F label="Amount Received" th={th} required><Input type="number" value={inForm.amount} onChange={e=>setInForm(f=>({...f,amount:e.target.value}))} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
              <F label="Date" th={th}><Input type="date" value={inForm.date} onChange={e=>setInForm(f=>({...f,date:e.target.value}))} th={th}/></F>
            </R2>
            <F label="To Bank Account" th={th}>
              <Select value={inForm.bank_id} onChange={e=>setInForm(f=>({...f,bank_id:e.target.value}))} th={th}>
                <option value="">Select bank…</option>
                {bankAccounts.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </F>
            <F label="Notes" th={th}><Input value={inForm.notes} onChange={e=>setInForm(f=>({...f,notes:e.target.value}))} placeholder="Optional" th={th}/></F>
            <BtnRow onCancel={()=>setShowIn(false)} onOk={doIn} label="Record Reimbursement →" th={th} saving={saving}/>
          </div>
        </Overlay>
      )}

      {/* ── GIVE LOAN FORM ── */}
      {showLoan&&selectedRec&&(
        <Overlay onClose={()=>setShowLoan(false)} th={th} title="Disburse Loan" sub={selectedRec.contact_name||selectedRec.name}>
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
            <R2>
              <F label="Loan Amount" th={th} required><Input type="number" value={loanForm.amount} onChange={e=>setLoanForm(f=>({...f,amount:e.target.value}))} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
              <F label="Date" th={th}><Input type="date" value={loanForm.date} onChange={e=>setLoanForm(f=>({...f,date:e.target.value}))} th={th}/></F>
            </R2>
            <F label="From Bank Account" th={th}>
              <Select value={loanForm.bank_id} onChange={e=>setLoanForm(f=>({...f,bank_id:e.target.value}))} th={th}>
                <option value="">Select bank…</option>
                {bankAccounts.map(b=><option key={b.id} value={b.id}>{b.name} — {fmtIDR(b.current_balance||0,true)}</option>)}
              </Select>
            </F>
            <F label="Notes" th={th}><Input value={loanForm.notes} onChange={e=>setLoanForm(f=>({...f,notes:e.target.value}))} placeholder="Optional" th={th}/></F>
            <BtnRow onCancel={()=>setShowLoan(false)} onOk={giveLoan} label="Disburse Loan →" th={th} saving={saving}/>
          </div>
        </Overlay>
      )}

      {/* ── COLLECT LOAN FORM ── */}
      {showCollect&&selectedRec&&(
        <Overlay onClose={()=>setShowCollect(false)} th={th} title="Collect Loan Payment" sub={selectedRec.contact_name||selectedRec.name}>
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
            <div style={{ padding:"10px 14px", background:th.sur2, borderRadius:9, display:"flex", justifyContent:"space-between" }}>
              <span style={{ fontSize:12, color:th.tx3 }}>Outstanding</span>
              <span className="num" style={{ fontWeight:800, color:th.am }}>{fmtIDR(Number(selectedRec.outstanding_amount||0))}</span>
            </div>
            <R2>
              <F label="Payment Amount" th={th} required><Input type="number" value={loanForm.amount} onChange={e=>setLoanForm(f=>({...f,amount:e.target.value}))} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
              <F label="Date" th={th}><Input type="date" value={loanForm.date} onChange={e=>setLoanForm(f=>({...f,date:e.target.value}))} th={th}/></F>
            </R2>
            <F label="To Bank Account" th={th}>
              <Select value={loanForm.bank_id} onChange={e=>setLoanForm(f=>({...f,bank_id:e.target.value}))} th={th}>
                <option value="">Select bank…</option>
                {bankAccounts.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </F>
            <F label="Notes" th={th}><Input value={loanForm.notes} onChange={e=>setLoanForm(f=>({...f,notes:e.target.value}))} placeholder="Optional" th={th}/></F>
            <BtnRow onCancel={()=>setShowCollect(false)} onOk={collectLoan} label="Record Payment →" th={th} saving={saving}/>
          </div>
        </Overlay>
      )}
    </div>
  );
}
