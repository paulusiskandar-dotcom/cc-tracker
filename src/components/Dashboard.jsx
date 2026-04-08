import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { ledgerApi, recurringApi, fmtIDR, ym, mlShort, daysUntil, todayStr } from "../api";
import { EXPENSE_CATEGORIES, ENT_COL } from "../constants";
import { StatCard, EntityTag, CatPill, ProgressBar, Empty, SectionHeader, Tag, calcNetWorth, showToast } from "./shared";

export default function Dashboard({
  th, user, accounts, ledger, thisMonthLedger, categories, reminders,
  recurTemplates, netWorth, bankAccounts, creditCards, curMonth,
  fxRates, CURRENCIES, onRefresh, setTab,
  pendingSyncs, setPendingSyncs,
  setLedger, setReminders,
}) {
  const [confirmingId, setConfirmingId] = useState(null);

  const confirmReminder = async (r) => {
    if (confirmingId === r.id) return;
    setConfirmingId(r.id);
    const tmpl = r.recurring_templates || {};
    try {
      // If it's a loan collection, create a ledger entry
      if (tmpl.type === "collect_loan" && tmpl.from_account_id) {
        const fromAcc = accounts.find(a => a.id === tmpl.from_account_id);
        const toAccId = tmpl.to_account_id || bankAccounts[0]?.id || "";
        if (fromAcc) {
          const entry = {
            date: todayStr(),
            description: `${tmpl.name} — confirmed`,
            amount: Number(tmpl.amount || 0),
            currency: tmpl.currency || "IDR",
            amount_idr: Number(tmpl.amount || 0),
            type: "collect_loan",
            from_account_id: tmpl.from_account_id,
            to_account_id: toAccId,
            entity: tmpl.entity || "Personal",
            notes: `Via reminder confirmation`,
          };
          const created = await ledgerApi.create(user.id, entry, accounts);
          if (created) setLedger?.(p => [created, ...p]);
          // Check if loan fully paid
          const recAcc = accounts.find(a => a.id === tmpl.from_account_id);
          if (recAcc && Number(recAcc.outstanding_amount || 0) - Number(tmpl.amount || 0) <= 0) {
            showToast(`🎉 ${tmpl.name} — loan fully paid!`);
          } else {
            showToast(`Collected ${fmtIDR(tmpl.amount||0,true)} — ${tmpl.name}`);
          }
        }
      } else {
        showToast(`Confirmed: ${tmpl.name}`);
      }
      await recurringApi.confirmReminder(r.id);
      setReminders?.(p => p.filter(x => x.id !== r.id));
      await onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
    setConfirmingId(null);
  };

  const skipReminder = async (r) => {
    try {
      await recurringApi.skipReminder(r.id);
      setReminders?.(p => p.filter(x => x.id !== r.id));
      showToast("Skipped");
    } catch (e) { showToast(e.message, "error"); }
  };
  // ── Derived stats
  const nw = netWorth || calcNetWorth(accounts);

  const thisMonthIncome = useMemo(() =>
    thisMonthLedger.filter(e=>e.type==="income").reduce((s,e)=>s+Number(e.amount_idr||e.amount||0),0),
  [thisMonthLedger]);

  const thisMonthExpense = useMemo(() =>
    thisMonthLedger.filter(e=>["expense","qris_debit"].includes(e.type)).reduce((s,e)=>s+Number(e.amount_idr||e.amount||0),0),
  [thisMonthLedger]);

  // Last 6 months cash flow
  const cashFlowData = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const m = d.toISOString().slice(0,7);
      months.push({
        month: mlShort(m),
        income:  ledger.filter(e=>ym(e.date)===m&&e.type==="income").reduce((s,e)=>s+Number(e.amount_idr||e.amount||0),0),
        expense: ledger.filter(e=>ym(e.date)===m&&["expense","qris_debit"].includes(e.type)).reduce((s,e)=>s+Number(e.amount_idr||e.amount||0),0),
      });
    }
    return months;
  }, [ledger]);

  // Spending by category this month
  const catSpend = useMemo(() => {
    const map = {};
    thisMonthLedger.filter(e=>["expense","qris_debit"].includes(e.type)).forEach(e => {
      const k = e.category_label || e.category || "Other";
      map[k] = (map[k]||0) + Number(e.amount_idr||e.amount||0);
    });
    return Object.entries(map).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value).slice(0,6);
  }, [thisMonthLedger]);

  // CC utilization
  const ccStats = useMemo(() => creditCards.map(cc => {
    const debt = Number(cc.current_balance||0);
    const limit = Number(cc.card_limit||0);
    const util = limit > 0 ? (debt/limit)*100 : 0;
    const target = Number(cc.monthly_target||0);
    const thisMonthSpent = thisMonthLedger
      .filter(e=>["expense","qris_debit"].includes(e.type)&&e.from_account_id===cc.id)
      .reduce((s,e)=>s+Number(e.amount_idr||e.amount||0),0);
    return { ...cc, debt, limit, util, target, thisMonthSpent, daysUntilDue: cc.due_day ? daysUntil(cc.due_day) : null };
  }), [creditCards, thisMonthLedger]);

  const recentLedger = ledger.slice(0,5);
  const alertCC = ccStats.filter(cc=>cc.util>80);
  const overdueReminders = reminders.filter(r=>{
    const due = new Date(r.due_date); const now = new Date(); return due < now;
  });

  // PIE colors
  const PIE_COLORS = ["#3b5bdb","#0ca678","#e67700","#7048e8","#0c8599","#c2255c"];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

      {/* ── HERO NET WORTH ── */}
      <div style={{
        background:"linear-gradient(135deg,#3b5bdb,#7048e8)",
        borderRadius:18, padding:"24px 20px", color:"#fff", position:"relative", overflow:"hidden",
      }}>
        <div style={{ position:"absolute", top:-20, right:-20, width:100, height:100, background:"rgba(255,255,255,.06)", borderRadius:"50%" }}/>
        <div style={{ position:"absolute", bottom:-30, right:40, width:60, height:60, background:"rgba(255,255,255,.04)", borderRadius:"50%" }}/>
        <div style={{ fontSize:11, fontWeight:700, opacity:.7, textTransform:"uppercase", letterSpacing:.5, marginBottom:6 }}>Net Worth</div>
        <div className="num" style={{ fontSize:34, fontWeight:800, letterSpacing:"-.5px", marginBottom:4 }}>{fmtIDR(nw.total)}</div>
        <div style={{ fontSize:11, opacity:.7 }}>as of {new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>
        <div style={{ display:"flex", gap:16, marginTop:16, flexWrap:"wrap" }}>
          {[
            { label:"Bank", value:nw.bank,      color:"#a5f3fc" },
            { label:"Assets", value:nw.assets,  color:"#86efac" },
            { label:"Receivables", value:nw.receivables, color:"#fde68a" },
            { label:"CC Debt", value:-nw.ccDebt, color:"#fca5a5" },
            { label:"Liabilities", value:-nw.liabilities, color:"#fca5a5" },
          ].filter(x=>x.value!==0).map(x=>(
            <div key={x.label} style={{ fontSize:11 }}>
              <div style={{ opacity:.6, fontWeight:600 }}>{x.label}</div>
              <div className="num" style={{ fontWeight:700, color:x.color }}>{fmtIDR(Math.abs(x.value),true)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── PENDING EMAIL SYNC BANNER ── */}
      {pendingSyncs?.length > 0 && (
        <div style={{
          padding:"12px 16px", background:"#e3fafc", border:"1px solid #99e9f2",
          borderRadius:12, display:"flex", justifyContent:"space-between", alignItems:"center",
        }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:"#0c8599" }}>
              📧 {pendingSyncs.length} transaction{pendingSyncs.length>1?"s":""} pending from email
            </div>
            <div style={{ fontSize:11, color:"#0c8599", opacity:.8, marginTop:2 }}>
              {pendingSyncs[0]?.sender_email
                ? `From: ${pendingSyncs[0].sender_email}`
                : "Gmail sync found new transactions"}
            </div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => setTab?.("transactions")} className="btn btn-primary"
              style={{ fontSize:11, padding:"6px 12px", background:"#0c8599", border:"none" }}>
              Review Now
            </button>
          </div>
        </div>
      )}

      {/* ── ALERTS ── */}
      {(alertCC.length > 0 || overdueReminders.length > 0) && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {alertCC.map(cc => (
            <div key={cc.id} style={{ padding:"10px 14px", background:th.amBg, border:`1px solid ${th.am}44`, borderRadius:10, fontSize:12, color:th.am, display:"flex", gap:8, alignItems:"center" }}>
              <span>⚠️</span>
              <span><strong>{cc.name}</strong>: {cc.util.toFixed(0)}% utilized — Rp {fmtIDR(cc.debt,true)} of {fmtIDR(cc.limit,true)}</span>
            </div>
          ))}
          {overdueReminders.length > 0 && (
            <div style={{ padding:"10px 14px", background:th.rdBg, border:`1px solid ${th.rd}44`, borderRadius:10, fontSize:12, color:th.rd, display:"flex", gap:8, alignItems:"center" }}>
              <span>🔔</span><span><strong>{overdueReminders.length}</strong> overdue recurring reminders</span>
            </div>
          )}
        </div>
      )}

      {/* ── THIS MONTH STATS ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <StatCard label="Income This Month" value={fmtIDR(thisMonthIncome,true)} color={th.gr} icon="↓" th={th}
          sub={`Surplus: ${fmtIDR(thisMonthIncome-thisMonthExpense,true)}`}/>
        <StatCard label="Expenses This Month" value={fmtIDR(thisMonthExpense,true)} color={th.rd} icon="↑" th={th}
          sub={`${thisMonthLedger.filter(e=>["expense","qris_debit"].includes(e.type)).length} transactions`}/>
      </div>

      {/* ── CASH FLOW CHART ── */}
      <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:"16px" }}>
        <SectionHeader title="Cash Flow — Last 6 Months" th={th}/>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={cashFlowData} barSize={12} barGap={2}>
            <XAxis dataKey="month" tick={{ fontSize:10, fill:th.tx3 }} axisLine={false} tickLine={false}/>
            <YAxis hide/>
            <Tooltip contentStyle={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:8, fontFamily:"'Sora',sans-serif", fontSize:11 }}
              formatter={(v)=>fmtIDR(v,true)}/>
            <Bar dataKey="income"  fill={th.gr} radius={4} name="Income"/>
            <Bar dataKey="expense" fill={th.rd} radius={4} name="Expense"/>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display:"flex", gap:12, justifyContent:"center", marginTop:8 }}>
          {[["Income",th.gr],["Expense",th.rd]].map(([l,c])=>(
            <div key={l} style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, color:th.tx3 }}>
              <div style={{ width:8, height:8, borderRadius:2, background:c }}/>
              {l}
            </div>
          ))}
        </div>
      </div>

      {/* ── EXPENSE BY CATEGORY + CC UTILIZATION ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>

        {/* Category breakdown */}
        <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:"16px" }}>
          <div style={{ fontSize:11, fontWeight:800, color:th.tx, marginBottom:12, textTransform:"uppercase", letterSpacing:.5 }}>Top Categories</div>
          {catSpend.length === 0
            ? <div style={{ fontSize:12, color:th.tx3, textAlign:"center", padding:"20px 0" }}>No expenses this month</div>
            : <>
                <PieChart width={100} height={100} style={{ margin:"0 auto 8px" }}>
                  <Pie data={catSpend} cx={45} cy={45} innerRadius={28} outerRadius={46} dataKey="value" paddingAngle={2}>
                    {catSpend.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
                  </Pie>
                </PieChart>
                {catSpend.slice(0,4).map((c,i)=>(
                  <div key={c.name} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6, fontSize:11 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ width:8, height:8, borderRadius:2, background:PIE_COLORS[i%PIE_COLORS.length], flexShrink:0 }}/>
                      <span style={{ color:th.tx2 }}>{c.name}</span>
                    </div>
                    <span className="num" style={{ fontWeight:700, color:th.tx }}>{fmtIDR(c.value,true)}</span>
                  </div>
                ))}
              </>
          }
        </div>

        {/* CC utilization */}
        <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:"16px" }}>
          <div style={{ fontSize:11, fontWeight:800, color:th.tx, marginBottom:12, textTransform:"uppercase", letterSpacing:.5 }}>CC Utilization</div>
          {ccStats.length === 0
            ? <Empty icon="💳" message="No cards" th={th}/>
            : ccStats.slice(0,3).map(cc => (
                <div key={cc.id} style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4, fontSize:11 }}>
                    <span style={{ fontWeight:600, color:th.tx }}>{cc.name}</span>
                    <span className="num" style={{ color:cc.util>80?th.rd:cc.util>60?th.am:th.gr }}>{cc.util.toFixed(0)}%</span>
                  </div>
                  <ProgressBar value={cc.debt} max={cc.limit} color={cc.util>80?th.rd:cc.util>60?th.am:th.gr} height={5} th={th}/>
                  <div style={{ fontSize:10, color:th.tx3, marginTop:3 }}>
                    {fmtIDR(cc.debt,true)} / {fmtIDR(cc.limit,true)}
                    {cc.daysUntilDue!==null && <span style={{ marginLeft:8 }}>· Due in {cc.daysUntilDue}d</span>}
                  </div>
                </div>
              ))
          }
        </div>
      </div>

      {/* ── UPCOMING REMINDERS ── */}
      {reminders.length > 0 && (
        <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:"16px" }}>
          <SectionHeader title={`Reminders (${reminders.length})`} th={th}/>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {reminders.slice(0,5).map(r => {
              const tmpl = r.recurring_templates || {};
              const daysLeft = Math.ceil((new Date(r.due_date)-new Date())/86400000);
              const isLoan = tmpl.type === "collect_loan";
              const isIncome = tmpl.type === "income";
              const icon = isLoan ? "💼" : isIncome ? "💰" : "💳";
              const confirmLabel = isLoan ? "✓ Confirm Received" : isIncome ? "✓ Confirm Received" : "✓ Mark Paid";
              const urgentColor = daysLeft <= 0 ? th.rd : daysLeft <= 3 ? th.am : th.tx3;
              return (
                <div key={r.id} style={{
                  padding:"10px 12px", background:th.sur2, borderRadius:10,
                  border:`1px solid ${daysLeft<=0?th.rd+"44":daysLeft<=3?th.am+"33":"transparent"}`,
                }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                    <div>
                      <div style={{ fontSize:12, fontWeight:700, color:th.tx }}>
                        {icon} {tmpl.name || "Recurring"}
                      </div>
                      <div style={{ fontSize:11, color:urgentColor, marginTop:2 }}>
                        {daysLeft <= 0 ? "⏰ Overdue!"
                          : daysLeft === 0 ? "⏰ Today"
                          : daysLeft === 1 ? "⏰ Tomorrow"
                          : `Due in ${daysLeft} days`}
                        {" · "}{new Date(r.due_date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                      </div>
                    </div>
                    <div className="num" style={{ fontSize:13, fontWeight:800, color:th.tx, textAlign:"right" }}>
                      {fmtIDR(Number(tmpl.amount||0),true)}
                      <div style={{ marginTop:2 }}><EntityTag entity={tmpl.entity||"Personal"} small/></div>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={() => confirmReminder(r)} disabled={confirmingId===r.id} className="btn btn-primary"
                      style={{ fontSize:10, padding:"4px 10px", flex:1 }}>
                      {confirmingId===r.id ? "…" : confirmLabel}
                    </button>
                    <button onClick={() => skipReminder(r)} className="btn btn-ghost"
                      style={{ fontSize:10, padding:"4px 10px", color:th.tx3, borderColor:th.bor }}>
                      Skip
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── RECENT TRANSACTIONS ── */}
      <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:"16px" }}>
        <SectionHeader title="Recent Transactions" th={th}
          action={<button onClick={()=>typeof setTab==="function"&&setTab("transactions")} style={{ background:"none", border:"none", color:th.ac, fontSize:12, fontWeight:700, cursor:"pointer" }}>View all →</button>}
        />
        {recentLedger.length === 0
          ? <Empty icon="📋" message="No transactions yet" th={th}/>
          : recentLedger.map(e => {
              const isOut = ["expense","pay_cc","buy_asset","pay_liability","reimburse_out","give_loan","qris_debit"].includes(e.type);
              const isIn  = ["income","sell_asset","reimburse_in","collect_loan"].includes(e.type);
              const amt = Number(e.amount_idr||e.amount||0);
              const acc = accounts.find(a=>a.id===(isOut?e.from_account_id:e.to_account_id));
              return (
                <div key={e.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:`1px solid ${th.bor}` }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:th.tx, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{e.description}</div>
                    <div style={{ fontSize:10, color:th.tx3, marginTop:2 }}>
                      {e.date} · {acc?.name||"—"}
                      {e.entity && e.entity!=="Personal" && <span style={{ marginLeft:6 }}><EntityTag entity={e.entity} small/></span>}
                    </div>
                  </div>
                  <div className="num" style={{ fontSize:13, fontWeight:800, color:isOut?th.rd:isIn?th.gr:th.ac, marginLeft:12, flexShrink:0 }}>
                    {isOut?"−":isIn?"+":""}{fmtIDR(amt,true)}
                  </div>
                </div>
              );
            })
        }
      </div>

      {/* ── QUICK BANK BALANCES ── */}
      {bankAccounts.length > 0 && (
        <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:"16px" }}>
          <SectionHeader title="Bank Accounts" th={th}/>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {bankAccounts.map(b => (
              <div key={b.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:b.color||"#3b5bdb", flexShrink:0 }}/>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:th.tx }}>{b.name}</div>
                    <div style={{ fontSize:10, color:th.tx3 }}>{b.bank_name} · {b.currency||"IDR"}</div>
                  </div>
                </div>
                <div className="num" style={{ fontSize:13, fontWeight:800, color:th.tx }}>{fmtIDR(Number(b.current_balance||0),true)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
