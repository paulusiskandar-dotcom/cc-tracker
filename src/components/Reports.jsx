import { useState, useMemo } from "react";
import { fmtIDR, ym, mlShort } from "../api";
import { EXPENSE_CATEGORIES } from "../constants";
import { SubTabs, SectionHeader, Empty, StatCard, showToast } from "./shared";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const SUBTABS = [
  { id:"cashflow",  label:"Cash Flow" },
  { id:"expenses",  label:"Expenses" },
  { id:"networth",  label:"Net Worth" },
  { id:"aging",     label:"Receivables" },
];

const MONTHS_BACK = 12;

function monthRange(n) {
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push(ym(d.toISOString().slice(0, 10)));
  }
  return months;
}

export default function Reports({
  th, ledger, accounts, receivables,
}) {
  const [subTab, setSubTab] = useState("cashflow");
  const [entityFilter, setEntityFilter] = useState("All");
  const [months] = useState(() => monthRange(MONTHS_BACK));

  // ── Cash Flow data ──────────────────────────────────────────
  const cashFlowData = useMemo(() => {
    return months.map(mo => {
      const entries = ledger.filter(e => e.date?.slice(0, 7) === mo);
      const filtered = entityFilter === "All" ? entries : entries.filter(e => e.entity === entityFilter);
      const income  = filtered.filter(e => e.type === "income").reduce((s, e) => s + Number(e.amount_idr || 0), 0);
      const expense = filtered.filter(e => ["expense"].includes(e.type)).reduce((s, e) => s + Number(e.amount_idr || 0), 0);
      const surplus = income - expense;
      return { month: mlShort(mo + "-01"), income, expense, surplus };
    });
  }, [ledger, months, entityFilter]);

  const totalIncome  = cashFlowData.reduce((s, r) => s + r.income, 0);
  const totalExpense = cashFlowData.reduce((s, r) => s + r.expense, 0);
  const totalSurplus = totalIncome - totalExpense;
  const avgMonthly   = totalExpense / MONTHS_BACK;

  // ── Expense by category ─────────────────────────────────────
  const catData = useMemo(() => {
    const filtered = entityFilter === "All" ? ledger : ledger.filter(e => e.entity === entityFilter);
    const expEntries = filtered.filter(e => ["expense"].includes(e.type));
    const map = {};
    expEntries.forEach(e => {
      const cat = e.category || "other";
      map[cat] = (map[cat] || 0) + Number(e.amount_idr || 0);
    });
    return Object.entries(map)
      .map(([id, value]) => {
        const def = EXPENSE_CATEGORIES.find(c => c.id === id) || EXPENSE_CATEGORIES.find(c => c.id === "other");
        return { id, name: def?.label || id, value, color: def?.color || "#8a90aa", icon: def?.icon || "❓" };
      })
      .sort((a, b) => b.value - a.value);
  }, [ledger, entityFilter]);

  const catTotal = catData.reduce((s, c) => s + c.value, 0);

  // ── Monthly expense by category (stacked bar) ───────────────
  const catMonthData = useMemo(() => {
    return months.map(mo => {
      const entries = ledger.filter(e =>
        e.date?.slice(0, 7) === mo && ["expense"].includes(e.type) &&
        (entityFilter === "All" || e.entity === entityFilter)
      );
      const row = { month: mlShort(mo + "-01") };
      EXPENSE_CATEGORIES.forEach(c => {
        row[c.label] = entries.filter(e => (e.category || "other") === c.id)
          .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
      });
      return row;
    });
  }, [ledger, months, entityFilter]);

  // ── Net worth trend (bank + assets - cc - liabilities) ──────
  const netWorthData = useMemo(() => {
    const bankAccts   = accounts.filter(a => a.type === "bank");
    const assetAccts  = accounts.filter(a => a.type === "asset");
    const ccAccts     = accounts.filter(a => a.type === "credit_card");
    const liabAccts   = accounts.filter(a => a.type === "liability");
    const recvAccts   = accounts.filter(a => a.type === "receivable");
    const currentBank = bankAccts.reduce((s, a) => s + Number(a.current_balance || 0), 0);
    const currentAssets = assetAccts.reduce((s, a) => s + Number(a.current_value || 0), 0);
    const currentCC   = ccAccts.reduce((s, a) => s + Number(a.current_balance || 0), 0);
    const currentLiab = liabAccts.reduce((s, a) => s + Number(a.outstanding_amount || 0), 0);
    const currentRecv = recvAccts.reduce((s, a) => s + Number(a.outstanding_amount || 0), 0);

    return months.map((mo, i) => {
      // Reconstruct historical net worth by reversing transactions after this month
      const futureEntries = ledger.filter(e => e.date?.slice(0, 7) > mo);
      let bankAdj = 0, ccAdj = 0;
      futureEntries.forEach(e => {
        const amt = Number(e.amount_idr || 0);
        if (e.type === "income") bankAdj -= amt;
        if (e.type === "expense" || e.type === "expense") ccAdj -= amt;
        if (e.type === "pay_cc") { bankAdj += amt; ccAdj += amt; }
      });
      const histBank = currentBank + bankAdj;
      const net = histBank + currentAssets + currentRecv - Math.max(0, currentCC + ccAdj) - currentLiab;
      return { month: mlShort(mo + "-01"), net: Math.max(0, net) };
    });
  }, [accounts, ledger, months]);

  // ── Receivables aging ───────────────────────────────────────
  const agingData = useMemo(() => {
    const recvAccts = accounts.filter(a => a.type === "receivable" && Number(a.outstanding_amount || 0) > 0);
    return recvAccts.map(r => {
      const lastEntry = ledger.filter(e =>
        (e.from_account_id === r.id || e.to_account_id === r.id) &&
        ["reimburse_out","give_loan"].includes(e.type)
      ).sort((a, b) => b.date.localeCompare(a.date))[0];
      const daysSince = lastEntry
        ? Math.floor((Date.now() - new Date(lastEntry.date).getTime()) / 86400000)
        : null;
      return { ...r, daysSince, lastDate: lastEntry?.date };
    }).sort((a, b) => (b.outstanding_amount || 0) - (a.outstanding_amount || 0));
  }, [accounts, ledger]);

  const totalReceivable = agingData.reduce((s, r) => s + Number(r.outstanding_amount || 0), 0);

  // ── CSV Export ──────────────────────────────────────────────
  const exportCSV = (type) => {
    let csv = "";
    if (type === "cashflow") {
      csv = "Month,Income,Expense,Surplus\n";
      cashFlowData.forEach(r => { csv += `${r.month},${r.income},${r.expense},${r.surplus}\n`; });
    } else if (type === "expenses") {
      csv = "Category,Amount,% of Total\n";
      catData.forEach(c => { csv += `${c.name},${c.value},${catTotal > 0 ? ((c.value/catTotal)*100).toFixed(1) : 0}%\n`; });
    } else if (type === "transactions") {
      csv = "Date,Type,Description,Category,Entity,Amount IDR,Currency\n";
      const src = entityFilter === "All" ? ledger : ledger.filter(e => e.entity === entityFilter);
      src.forEach(e => {
        csv += `${e.date},${e.type},"${(e.description||"").replace(/"/g,'""')}",${e.category||""},${e.entity||""},${e.amount_idr||e.amount},${e.currency||"IDR"}\n`;
      });
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `paulus-finance-${type}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${type} CSV`);
  };

  const EntityFilter = () => (
    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
      {["All","Personal","Hamasa","SDC","Travelio"].map(e => (
        <button key={e} onClick={() => setEntityFilter(e)} className="btn"
          style={{ fontSize:11, padding:"4px 10px", borderRadius:20,
            background: entityFilter===e ? th.ac : "transparent",
            color: entityFilter===e ? "#fff" : th.tx3,
            border: `1px solid ${entityFilter===e ? th.ac : th.bor}` }}>
          {e}
        </button>
      ))}
    </div>
  );

  const tooltipStyle = { background:th.sur, border:`1px solid ${th.bor}`, borderRadius:8, fontSize:11, color:th.tx };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:20, fontWeight:800, color:th.tx }}>Reports</div>
        <button className="btn btn-ghost" onClick={() => exportCSV("transactions")}
          style={{ fontSize:11, padding:"5px 12px", color:th.tx2, borderColor:th.bor }}>
          ⬇ Export CSV
        </button>
      </div>

      <SubTabs tabs={SUBTABS} active={subTab} onChange={setSubTab} th={th}/>
      <EntityFilter/>

      {/* ── CASH FLOW ── */}
      {subTab === "cashflow" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
            <StatCard label="Total Income" value={fmtIDR(totalIncome,true)} color="#0ca678" th={th}/>
            <StatCard label="Total Expense" value={fmtIDR(totalExpense,true)} color="#e03131" th={th}/>
            <StatCard label="Net Surplus" value={fmtIDR(totalSurplus,true)} color={totalSurplus>=0?"#0ca678":"#e03131"} th={th}/>
          </div>
          <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <SectionHeader title="12-Month Cash Flow" th={th}/>
              <button className="btn btn-ghost" onClick={() => exportCSV("cashflow")}
                style={{ fontSize:10, padding:"4px 10px", color:th.tx3, borderColor:th.bor }}>
                CSV
              </button>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={cashFlowData} margin={{ top:4, right:4, bottom:0, left:0 }}>
                <XAxis dataKey="month" tick={{ fontSize:9, fill:th.tx3 }} axisLine={false} tickLine={false}/>
                <YAxis hide/>
                <Tooltip contentStyle={tooltipStyle} formatter={v => fmtIDR(v,true)}/>
                <Legend wrapperStyle={{ fontSize:10 }}/>
                <Bar dataKey="income"  name="Income"  fill="#0ca678" radius={[3,3,0,0]}/>
                <Bar dataKey="expense" name="Expense" fill="#e03131" radius={[3,3,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Detailed table */}
          <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
            <SectionHeader title="Monthly Detail" th={th}/>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                <thead>
                  <tr style={{ color:th.tx3 }}>
                    {["Month","Income","Expense","Surplus"].map(h => (
                      <th key={h} style={{ textAlign: h==="Month"?"left":"right", padding:"6px 8px", fontWeight:600, borderBottom:`1px solid ${th.bor}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...cashFlowData].reverse().map((r, i) => (
                    <tr key={i} style={{ borderBottom:`1px solid ${th.bor}2` }}>
                      <td style={{ padding:"6px 8px", color:th.tx }}>{r.month}</td>
                      <td className="num" style={{ padding:"6px 8px", textAlign:"right", color:"#0ca678" }}>{fmtIDR(r.income,true)}</td>
                      <td className="num" style={{ padding:"6px 8px", textAlign:"right", color:"#e03131" }}>{fmtIDR(r.expense,true)}</td>
                      <td className="num" style={{ padding:"6px 8px", textAlign:"right", color:r.surplus>=0?"#0ca678":"#e03131", fontWeight:700 }}>
                        {r.surplus>=0?"+":""}{fmtIDR(r.surplus,true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight:800, borderTop:`2px solid ${th.bor}` }}>
                    <td style={{ padding:"8px 8px", color:th.tx }}>Total</td>
                    <td className="num" style={{ padding:"8px 8px", textAlign:"right", color:"#0ca678" }}>{fmtIDR(totalIncome,true)}</td>
                    <td className="num" style={{ padding:"8px 8px", textAlign:"right", color:"#e03131" }}>{fmtIDR(totalExpense,true)}</td>
                    <td className="num" style={{ padding:"8px 8px", textAlign:"right", color:totalSurplus>=0?"#0ca678":"#e03131" }}>
                      {totalSurplus>=0?"+":""}{fmtIDR(totalSurplus,true)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div style={{ marginTop:10, fontSize:11, color:th.tx3 }}>
              Monthly avg expense: <span className="num" style={{ color:th.tx, fontWeight:700 }}>{fmtIDR(avgMonthly,true)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── EXPENSES ── */}
      {subTab === "expenses" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {catData.length === 0
            ? <Empty icon="📊" message="No expense data yet." th={th}/>
            : (
              <>
                <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                    <SectionHeader title="Expense by Category" th={th}/>
                    <button className="btn btn-ghost" onClick={() => exportCSV("expenses")}
                      style={{ fontSize:10, padding:"4px 10px", color:th.tx3, borderColor:th.bor }}>
                      CSV
                    </button>
                  </div>
                  <div style={{ display:"flex", gap:16, alignItems:"center", flexWrap:"wrap" }}>
                    <PieChart width={140} height={140}>
                      <Pie data={catData} cx={65} cy={65} innerRadius={35} outerRadius={65} dataKey="value" paddingAngle={2}>
                        {catData.map((c, i) => <Cell key={i} fill={c.color}/>)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={v => fmtIDR(v,true)}/>
                    </PieChart>
                    <div style={{ flex:1, minWidth:120 }}>
                      {catData.map((c, i) => (
                        <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7, fontSize:11 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                            <div style={{ width:8, height:8, borderRadius:2, background:c.color, flexShrink:0 }}/>
                            <span style={{ color:th.tx2 }}>{c.icon} {c.name}</span>
                          </div>
                          <div style={{ textAlign:"right" }}>
                            <span className="num" style={{ fontWeight:700 }}>{fmtIDR(c.value,true)}</span>
                            <span style={{ color:th.tx3, marginLeft:5 }}>
                              {catTotal > 0 ? ((c.value/catTotal)*100).toFixed(1) : 0}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
                  <SectionHeader title="Monthly Expense Trend (Top Categories)" th={th}/>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={catMonthData} margin={{ top:4, right:4, bottom:0, left:0 }}>
                      <XAxis dataKey="month" tick={{ fontSize:9, fill:th.tx3 }} axisLine={false} tickLine={false}/>
                      <YAxis hide/>
                      <Tooltip contentStyle={tooltipStyle} formatter={v => fmtIDR(v,true)}/>
                      {catData.slice(0, 5).map(c => (
                        <Bar key={c.id} dataKey={c.name} stackId="a" fill={c.color}/>
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )
          }
        </div>
      )}

      {/* ── NET WORTH ── */}
      {subTab === "networth" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
            <SectionHeader title="Net Worth Trend (12 months)" th={th}/>
            {netWorthData.every(d => d.net === 0)
              ? <Empty icon="📈" message="Not enough data to show trend." th={th}/>
              : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={netWorthData} margin={{ top:4, right:4, bottom:0, left:0 }}>
                    <defs>
                      <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b5bdb" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#3b5bdb" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="month" tick={{ fontSize:9, fill:th.tx3 }} axisLine={false} tickLine={false}/>
                    <YAxis hide/>
                    <Tooltip contentStyle={tooltipStyle} formatter={v => fmtIDR(v,true)}/>
                    <Area type="monotone" dataKey="net" name="Net Worth" stroke="#3b5bdb" strokeWidth={2} fill="url(#netGrad)"/>
                  </AreaChart>
                </ResponsiveContainer>
              )
            }
          </div>

          {/* Asset breakdown */}
          <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
            <SectionHeader title="Current Portfolio Breakdown" th={th}/>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:8 }}>
              {[
                { label:"Bank Accounts", value: accounts.filter(a=>a.type==="bank").reduce((s,a)=>s+Number(a.current_balance||0),0), color:"#3b5bdb" },
                { label:"Assets", value: accounts.filter(a=>a.type==="asset").reduce((s,a)=>s+Number(a.current_value||0),0), color:"#0ca678" },
                { label:"Receivables", value: accounts.filter(a=>a.type==="receivable").reduce((s,a)=>s+Number(a.outstanding_amount||0),0), color:"#0c8599" },
                { label:"CC Debt", value: -accounts.filter(a=>a.type==="credit_card").reduce((s,a)=>s+Math.max(0,Number(a.current_balance||0)),0), color:"#e67700" },
                { label:"Liabilities", value: -accounts.filter(a=>a.type==="liability").reduce((s,a)=>s+Number(a.outstanding_amount||0),0), color:"#e03131" },
              ].map((item, i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 10px", background:th.bg, borderRadius:8 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:10, height:10, borderRadius:3, background:item.color }}/>
                    <span style={{ fontSize:12, color:th.tx2 }}>{item.label}</span>
                  </div>
                  <span className="num" style={{ fontSize:13, fontWeight:700, color:item.value >= 0 ? th.tx : "#e03131" }}>
                    {item.value < 0 ? "−" : ""}{fmtIDR(Math.abs(item.value),true)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── RECEIVABLES AGING ── */}
      {subTab === "aging" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <SectionHeader title="Receivables Aging" th={th}/>
              <span className="num" style={{ fontSize:13, fontWeight:800, color:"#e67700" }}>{fmtIDR(totalReceivable,true)}</span>
            </div>
            {agingData.length === 0
              ? <Empty icon="📋" message="No outstanding receivables." th={th}/>
              : agingData.map(r => {
                  const days = r.daysSince;
                  const agingColor = days == null ? th.tx3 : days > 90 ? "#e03131" : days > 30 ? "#e67700" : "#0ca678";
                  return (
                    <div key={r.id} style={{ padding:"12px 14px", background:th.bg, borderRadius:10, marginBottom:8, border:`1px solid ${th.bor}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                        <div>
                          <div style={{ fontSize:13, fontWeight:700, color:th.tx }}>{r.name}</div>
                          <div style={{ fontSize:11, color:th.tx3, marginTop:2 }}>
                            {r.entity && r.entity !== "Personal" && <span style={{ marginRight:6 }}>{r.entity}</span>}
                            {r.subtype && <span>{r.subtype}</span>}
                          </div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div className="num" style={{ fontSize:14, fontWeight:800, color:"#e67700" }}>{fmtIDR(Number(r.outstanding_amount||0),true)}</div>
                          {days != null && (
                            <div style={{ fontSize:10, color:agingColor, fontWeight:700, marginTop:2 }}>
                              {days === 0 ? "Today" : `${days}d ago`}
                              {days > 90 ? " ⚠️ Overdue" : days > 30 ? " ⚡ Follow up" : ""}
                            </div>
                          )}
                        </div>
                      </div>
                      {r.lastDate && <div style={{ fontSize:10, color:th.tx3, marginTop:6 }}>Last activity: {r.lastDate}</div>}
                    </div>
                  );
                })
            }
          </div>

          {/* Aging summary buckets */}
          {agingData.length > 0 && (
            <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
              <SectionHeader title="Aging Summary" th={th}/>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginTop:10 }}>
                {[
                  { label:"< 30 days",  color:"#0ca678", filter: r => (r.daysSince||0) <= 30 },
                  { label:"30–60 days", color:"#e67700", filter: r => (r.daysSince||0) > 30 && (r.daysSince||0) <= 60 },
                  { label:"60–90 days", color:"#e03131", filter: r => (r.daysSince||0) > 60 && (r.daysSince||0) <= 90 },
                  { label:"> 90 days",  color:"#c01a1a", filter: r => (r.daysSince||0) > 90 },
                ].map((b, i) => {
                  const items = agingData.filter(b.filter);
                  const total = items.reduce((s, r) => s + Number(r.outstanding_amount || 0), 0);
                  return (
                    <div key={i} style={{ background:th.bg, border:`1px solid ${th.bor}`, borderRadius:10, padding:"10px 12px", textAlign:"center" }}>
                      <div style={{ fontSize:10, color:th.tx3, marginBottom:4 }}>{b.label}</div>
                      <div className="num" style={{ fontSize:13, fontWeight:800, color:b.color }}>{fmtIDR(total,true)}</div>
                      <div style={{ fontSize:10, color:th.tx3, marginTop:2 }}>{items.length} items</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
