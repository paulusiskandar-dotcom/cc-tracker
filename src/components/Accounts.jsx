import { useState, useMemo } from "react";
import { accountsApi, ledgerApi, fmtIDR, todayStr } from "../api";
import { ENTITIES, BANKS_L, NETWORKS, ASSET_SUBTYPES, LIAB_SUBTYPES, ACC_TYPE_LABEL, ACC_TYPE_ICON } from "../constants";
import { Overlay, F, R2, BtnRow, SubTabs, Input, Select, Textarea, Tag, EntityTag,
         ProgressBar, Empty, SectionHeader, confirmDelete, showToast, ColorDot } from "./shared";

const SUBTABS = [
  { id:"all",         label:"All" },
  { id:"bank",        label:"Bank" },
  { id:"credit_card", label:"Credit Cards" },
  { id:"asset",       label:"Assets" },
  { id:"liability",   label:"Liabilities" },
  { id:"receivable",  label:"Receivables" },
];

export default function Accounts({
  th, user, accounts, ledger, onRefresh, setAccounts, CURRENCIES,
}) {
  const [subTab, setSubTab]     = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState("bank");
  const [editId, setEditId]     = useState(null);
  const [form, setForm]         = useState({});
  const [saving, setSaving]     = useState(false);
  const [viewAccId, setViewAccId] = useState(null);

  const filtered = useMemo(() =>
    accounts.filter(a => subTab === "all" || a.type === subTab),
  [accounts, subTab]);

  const openNew = (type = "bank") => {
    setFormType(type);
    setForm(emptyForm(type));
    setEditId(null);
    setShowForm(true);
  };

  const openEdit = (a) => {
    setFormType(a.type);
    setForm({ ...a });
    setEditId(a.id);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name) return showToast("Name is required", "error");
    setSaving(true);
    try {
      if (editId) {
        const updated = await accountsApi.update(editId, form);
        setAccounts(p => p.map(a => a.id === editId ? updated : a));
        showToast("Account updated");
      } else {
        const created = await accountsApi.create(user.id, { ...form, type: formType, is_active: true, sort_order: accounts.length });
        setAccounts(p => [...p, created]);
        showToast("Account created");
      }
      setShowForm(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const del = async (a) => {
    if (!confirmDelete(a.name)) return;
    try {
      await accountsApi.delete(a.id);
      setAccounts(p => p.filter(x => x.id !== a.id));
      showToast("Deleted");
    } catch (e) { showToast(e.message, "error"); }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:20, fontWeight:800, color:th.tx }}>Accounts</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {["bank","credit_card","asset","liability","receivable"].map(t=>(
            <button key={t} className="btn btn-ghost" onClick={()=>openNew(t)} style={{ padding:"6px 10px", fontSize:11, color:th.tx2, borderColor:th.bor }}>
              + {ACC_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <SubTabs tabs={SUBTABS} active={subTab} onChange={setSubTab} th={th}/>

      {filtered.length === 0
        ? <Empty icon="🏦" message="No accounts yet. Add your first account." th={th}/>
        : <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {filtered.map(a => (
              <AccountCard key={a.id} account={a} th={th} ledger={ledger} accounts={accounts}
                onEdit={()=>openEdit(a)} onDelete={()=>del(a)} onView={()=>setViewAccId(a.id)}/>
            ))}
          </div>
      }

      {/* ── ACCOUNT FORM ── */}
      {showForm && (
        <Overlay onClose={()=>setShowForm(false)} th={th}
          title={editId?"Edit Account":"Add Account"}
          sub={ACC_TYPE_LABEL[formType]}>
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
            <AccountForm type={formType} form={form} setForm={setForm} th={th} accounts={accounts} CURRENCIES={CURRENCIES}/>
            <BtnRow onCancel={()=>setShowForm(false)} onOk={save} label={editId?"Update":"Create"} th={th} saving={saving}/>
          </div>
        </Overlay>
      )}

      {/* ── ACCOUNT HISTORY ── */}
      {viewAccId && (
        <AccountHistory accountId={viewAccId} accounts={accounts} ledger={ledger} th={th} onClose={()=>setViewAccId(null)}/>
      )}
    </div>
  );
}

// ─── ACCOUNT CARD ──────────────────────────────────────────
function AccountCard({ account: a, th, ledger, accounts, onEdit, onDelete, onView }) {
  const icon = ACC_TYPE_ICON[a.type] || "🏦";
  const txCount = ledger.filter(e=>e.from_account_id===a.id||e.to_account_id===a.id).length;

  const getBalanceDisplay = () => {
    if (a.type === "bank") return { label:"Balance", value:Number(a.current_balance||0), color:Number(a.current_balance||0)>=0?"#0ca678":"#e03131" };
    if (a.type === "credit_card") return { label:"Debt", value:Number(a.current_balance||0), color:Number(a.current_balance||0)>0?"#e03131":"#0ca678" };
    if (a.type === "asset") return { label:"Value", value:Number(a.current_value||0), color:"#3b5bdb" };
    if (a.type === "liability") return { label:"Outstanding", value:Number(a.outstanding_amount||0), color:"#e67700" };
    if (a.type === "receivable") return { label:"Outstanding", value:Number(a.outstanding_amount||0), color:"#0c8599" };
    return { label:"Balance", value:0, color:th.tx };
  };

  const bal = getBalanceDisplay();

  return (
    <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:"14px 16px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div style={{ display:"flex", gap:10, alignItems:"center", flex:1, minWidth:0 }}>
          <div style={{ width:38, height:38, borderRadius:10, background:`${a.color||"#3b5bdb"}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>
            {icon}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:700, color:th.tx, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{a.name}</div>
            <div style={{ fontSize:11, color:th.tx3, marginTop:2, display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
              <span>{a.bank_name||a.subtype||ACC_TYPE_LABEL[a.type]}</span>
              {a.last4 && <span>····{a.last4}</span>}
              {a.account_no && <span>···{a.account_no.slice(-4)}</span>}
              {a.currency && a.currency!=="IDR" && <Tag bg={th.sur3} color={th.tx3} small>{a.currency}</Tag>}
              {a.entity && a.entity!=="Personal" && <EntityTag entity={a.entity} small/>}
            </div>
          </div>
        </div>
        <div style={{ textAlign:"right", flexShrink:0 }}>
          <div style={{ fontSize:11, color:th.tx3, marginBottom:2 }}>{bal.label}</div>
          <div className="num" style={{ fontSize:16, fontWeight:800, color:bal.color }}>{fmtIDR(Math.abs(bal.value),true)}</div>
          {a.type==="credit_card"&&a.card_limit>0 && (
            <div style={{ fontSize:10, color:th.tx3, marginTop:2 }}>
              {((bal.value/a.card_limit)*100).toFixed(0)}% of {fmtIDR(a.card_limit,true)}
            </div>
          )}
        </div>
      </div>

      {/* Progress bar for CC */}
      {a.type==="credit_card"&&a.card_limit>0 && (
        <div style={{ marginTop:10 }}>
          <ProgressBar value={Number(a.current_balance||0)} max={Number(a.card_limit||1)}
            color={Number(a.current_balance/a.card_limit)>0.8?"#e03131":Number(a.current_balance/a.card_limit)>0.6?"#e67700":"#0ca678"}
            height={5} th={th}/>
        </div>
      )}

      {/* Progress bar for liability */}
      {a.type==="liability"&&a.original_amount>0 && (
        <div style={{ marginTop:10 }}>
          <div style={{ fontSize:10, color:th.tx3, marginBottom:3 }}>
            Paid: {fmtIDR(Number(a.original_amount)-Number(a.outstanding_amount||0),true)} / {fmtIDR(Number(a.original_amount),true)}
          </div>
          <ProgressBar value={Number(a.original_amount)-Number(a.outstanding_amount||0)} max={Number(a.original_amount||1)} color="#0ca678" height={5} th={th}/>
        </div>
      )}

      {/* Asset gain/loss */}
      {a.type==="asset"&&a.purchase_value>0 && (() => {
        const gain = Number(a.current_value||0) - Number(a.purchase_value);
        const pct = (gain/Number(a.purchase_value))*100;
        return (
          <div style={{ marginTop:6, fontSize:11, color:gain>=0?"#0ca678":"#e03131" }}>
            {gain>=0?"▲":"▼"} {fmtIDR(Math.abs(gain),true)} ({pct>=0?"+":""}{pct.toFixed(1)}%)
          </div>
        );
      })()}

      <div style={{ display:"flex", gap:6, marginTop:12, flexWrap:"wrap" }}>
        <button onClick={onView} style={{ border:`1px solid ${th.bor}`, background:th.sur2, color:th.tx3, borderRadius:7, padding:"5px 10px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"'Sora',sans-serif" }}>
          📋 History ({txCount})
        </button>
        <button onClick={onEdit} style={{ border:`1px solid ${th.bor}`, background:th.sur2, color:th.tx2, borderRadius:7, padding:"5px 10px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"'Sora',sans-serif" }}>✏️ Edit</button>
        <button onClick={onDelete} style={{ border:`1px solid ${th.rd}44`, background:th.rdBg, color:th.rd, borderRadius:7, padding:"5px 10px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"'Sora',sans-serif" }}>🗑</button>
      </div>
    </div>
  );
}

// ─── ACCOUNT HISTORY ──────────────────────────────────────────
function AccountHistory({ accountId, accounts, ledger, th, onClose }) {
  const account = accounts.find(a=>a.id===accountId);
  const entries = ledger.filter(e=>e.from_account_id===accountId||e.to_account_id===accountId).slice(0,50);
  if (!account) return null;
  return (
    <Overlay onClose={onClose} th={th} title={`${account.name} — History`} sub={`${entries.length} transactions`} maxWidth={560}>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {entries.length===0
          ? <Empty icon="📋" message="No transactions for this account" th={th}/>
          : entries.map(e=>{
              const isFrom = e.from_account_id===accountId;
              const amt = Number(e.amount_idr||e.amount||0);
              const other = accounts.find(a=>a.id===(isFrom?e.to_account_id:e.from_account_id));
              return(
                <div key={e.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 12px", background:th.sur2, borderRadius:9 }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:th.tx }}>{e.description}</div>
                    <div style={{ fontSize:10, color:th.tx3 }}>{e.date}{other&&` · ${isFrom?"→":"←"} ${other.name}`}</div>
                  </div>
                  <div className="num" style={{ fontWeight:700, color:isFrom?"#e03131":"#0ca678" }}>
                    {isFrom?"−":"+"}{fmtIDR(amt,true)}
                  </div>
                </div>
              );
            })
        }
      </div>
    </Overlay>
  );
}

// ─── ACCOUNT FORM ─────────────────────────────────────────────
function AccountForm({ type, form, setForm, th, accounts, CURRENCIES: C }) {
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const cur = C || [];

  const bankAccounts = accounts.filter(a=>a.type==="bank");

  return (
    <>
      <F label="Name" th={th} required><Input value={form.name||""} onChange={e=>set("name",e.target.value)} placeholder="e.g. BCA Main Account" th={th}/></F>

      {(type==="bank"||type==="credit_card") && (
        <R2>
          <F label="Bank" th={th}><Select value={form.bank_name||"BCA"} onChange={e=>set("bank_name",e.target.value)} th={th}>{BANKS_L.map(b=><option key={b}>{b}</option>)}</Select></F>
          <F label="Entity" th={th}><Select value={form.entity||"Personal"} onChange={e=>set("entity",e.target.value)} th={th}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</Select></F>
        </R2>
      )}

      {type==="bank" && (
        <>
          <R2>
            <F label="Account No." th={th}><Input value={form.account_no||""} onChange={e=>set("account_no",e.target.value)} placeholder="e.g. 1234567890" th={th}/></F>
            <F label="Currency" th={th}><Select value={form.currency||"IDR"} onChange={e=>set("currency",e.target.value)} th={th}>{cur.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</Select></F>
          </R2>
          <F label="Initial Balance (IDR)" th={th}><Input type="number" value={form.initial_balance||""} onChange={e=>{set("initial_balance",e.target.value);set("current_balance",e.target.value);}} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
          <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontSize:13, color:th.tx2 }}>
            <input type="checkbox" checked={form.include_networth!==false} onChange={e=>set("include_networth",e.target.checked)} style={{ accentColor:th.ac }}/>
            Include in Net Worth calculation
          </label>
        </>
      )}

      {type==="credit_card" && (
        <>
          <R2>
            <F label="Last 4 Digits" th={th}><Input value={form.last4||""} onChange={e=>set("last4",e.target.value)} placeholder="1234" th={th} maxLength={4}/></F>
            <F label="Network" th={th}><Select value={form.network||"Visa"} onChange={e=>set("network",e.target.value)} th={th}>{NETWORKS.map(n=><option key={n}>{n}</option>)}</Select></F>
          </R2>
          <R2>
            <F label="Credit Limit (IDR)" th={th}><Input type="number" value={form.card_limit||""} onChange={e=>set("card_limit",e.target.value)} placeholder="50000000" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
            <F label="Monthly Target (IDR)" th={th}><Input type="number" value={form.monthly_target||""} onChange={e=>set("monthly_target",e.target.value)} placeholder="10000000" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
          </R2>
          <R2>
            <F label="Statement Day" th={th}><Input type="number" value={form.statement_day||""} onChange={e=>set("statement_day",e.target.value)} placeholder="25" th={th}/></F>
            <F label="Due Day" th={th}><Input type="number" value={form.due_day||""} onChange={e=>set("due_day",e.target.value)} placeholder="17" th={th}/></F>
          </R2>
          <F label="Entity" th={th}><Select value={form.entity||"Personal"} onChange={e=>set("entity",e.target.value)} th={th}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</Select></F>
        </>
      )}

      {type==="debit_card" && (
        <>
          <R2>
            <F label="Card Last 4" th={th}><Input value={form.card_last4||""} onChange={e=>set("card_last4",e.target.value)} placeholder="5678" th={th} maxLength={4}/></F>
            <F label="Linked Bank Account" th={th}>
              <Select value={form.linked_account_id||""} onChange={e=>set("linked_account_id",e.target.value)} th={th}>
                <option value="">Select bank…</option>
                {bankAccounts.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </F>
          </R2>
        </>
      )}

      {type==="asset" && (
        <>
          <R2>
            <F label="Category" th={th}><Select value={form.subtype||"Property"} onChange={e=>set("subtype",e.target.value)} th={th}>{ASSET_SUBTYPES.map(s=><option key={s}>{s}</option>)}</Select></F>
            <F label="Entity" th={th}><Select value={form.entity||"Personal"} onChange={e=>set("entity",e.target.value)} th={th}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</Select></F>
          </R2>
          <R2>
            <F label="Current Value (IDR)" th={th}><Input type="number" value={form.current_value||""} onChange={e=>set("current_value",e.target.value)} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
            <F label="Purchase Price (IDR)" th={th}><Input type="number" value={form.purchase_value||""} onChange={e=>set("purchase_value",e.target.value)} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
          </R2>
          <F label="Purchase Date" th={th}><Input type="date" value={form.purchase_date||""} onChange={e=>set("purchase_date",e.target.value)} th={th}/></F>
        </>
      )}

      {type==="liability" && (
        <>
          <R2>
            <F label="Type" th={th}><Select value={form.subtype||"Mortgage"} onChange={e=>set("subtype",e.target.value)} th={th}>{LIAB_SUBTYPES.map(s=><option key={s}>{s}</option>)}</Select></F>
            <F label="Creditor" th={th}><Input value={form.creditor||""} onChange={e=>set("creditor",e.target.value)} placeholder="Bank/Lender" th={th}/></F>
          </R2>
          <R2>
            <F label="Outstanding (IDR)" th={th}><Input type="number" value={form.outstanding_amount||""} onChange={e=>set("outstanding_amount",e.target.value)} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
            <F label="Original Amount" th={th}><Input type="number" value={form.original_amount||""} onChange={e=>set("original_amount",e.target.value)} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
          </R2>
          <R2>
            <F label="Monthly Payment" th={th}><Input type="number" value={form.monthly_payment||""} onChange={e=>set("monthly_payment",e.target.value)} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
            <F label="Interest Rate (%/yr)" th={th}><Input type="number" value={form.interest_rate||""} onChange={e=>set("interest_rate",e.target.value)} placeholder="0" th={th}/></F>
          </R2>
          <R2>
            <F label="Start Date" th={th}><Input type="date" value={form.start_date||""} onChange={e=>set("start_date",e.target.value)} th={th}/></F>
            <F label="End Date" th={th}><Input type="date" value={form.end_date||""} onChange={e=>set("end_date",e.target.value)} th={th}/></F>
          </R2>
          <F label="Entity" th={th}><Select value={form.entity||"Personal"} onChange={e=>set("entity",e.target.value)} th={th}>{ENTITIES.map(e=><option key={e}>{e}</option>)}</Select></F>
        </>
      )}

      {type==="receivable" && (
        <>
          <R2>
            <F label="Type" th={th}><Select value={form.receivable_type||"reimburse"} onChange={e=>set("receivable_type",e.target.value)} th={th}><option value="reimburse">Reimburse</option><option value="employee_loan">Employee Loan</option></Select></F>
            <F label="Entity" th={th}><Select value={form.entity||"Hamasa"} onChange={e=>set("entity",e.target.value)} th={th}>{["Hamasa","SDC","Travelio","Personal","Other"].map(e=><option key={e}>{e}</option>)}</Select></F>
          </R2>
          <F label="Outstanding Amount (IDR)" th={th}><Input type="number" value={form.outstanding_amount||""} onChange={e=>set("outstanding_amount",e.target.value)} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
          {form.receivable_type==="employee_loan" && (
            <>
              <R2>
                <F label="Employee Name" th={th}><Input value={form.contact_name||""} onChange={e=>set("contact_name",e.target.value)} placeholder="Full name" th={th}/></F>
                <F label="Department" th={th}><Input value={form.contact_dept||""} onChange={e=>set("contact_dept",e.target.value)} placeholder="Dept" th={th}/></F>
              </R2>
              <F label="Monthly Installment" th={th}><Input type="number" value={form.monthly_installment||""} onChange={e=>set("monthly_installment",e.target.value)} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/></F>
            </>
          )}
        </>
      )}

      {/* Color picker */}
      {["bank","credit_card"].includes(type) && (
        <R2>
          <F label="Card Color" th={th}>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {["#3b5bdb","#0ca678","#e67700","#7048e8","#0c8599","#c2255c","#e03131","#1e1e2e"].map(c=>(
                <div key={c} onClick={()=>set("color",c)} style={{
                  width:24, height:24, borderRadius:"50%", background:c, cursor:"pointer",
                  border:form.color===c?`3px solid ${th.tx}`:"3px solid transparent",
                }}/>
              ))}
            </div>
          </F>
        </R2>
      )}

      <F label="Notes" th={th}><Input value={form.notes||""} onChange={e=>set("notes",e.target.value)} placeholder="Optional notes" th={th}/></F>
    </>
  );
}

function emptyForm(type) {
  const base = { name:"", entity:"Personal", color:"#3b5bdb", notes:"", is_active:true };
  if (type==="bank") return { ...base, bank_name:"BCA", account_no:"", currency:"IDR", initial_balance:0, current_balance:0, include_networth:true };
  if (type==="credit_card") return { ...base, bank_name:"BCA", last4:"", network:"Visa", card_limit:0, monthly_target:0, statement_day:25, due_day:17, current_balance:0 };
  if (type==="debit_card") return { ...base, card_last4:"", linked_account_id:"" };
  if (type==="asset") return { ...base, subtype:"Property", current_value:0, purchase_value:0, purchase_date:"" };
  if (type==="liability") return { ...base, subtype:"Mortgage", creditor:"", outstanding_amount:0, original_amount:0, monthly_payment:0, interest_rate:0, start_date:"", end_date:"" };
  if (type==="receivable") return { ...base, receivable_type:"reimburse", outstanding_amount:0, entity:"Hamasa", contact_name:"", contact_dept:"", monthly_installment:0 };
  return base;
}
