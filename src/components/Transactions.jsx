import { useState, useMemo, useRef } from "react";
import { ledgerApi, gmailApi, merchantApi, aiCall, parseJSON, fmtIDR, todayStr, ym, toIDR, agingLabel } from "../api";
import { EXPENSE_CATEGORIES, ENTITIES, TX_TYPES, CURRENCIES } from "../constants";
import { Overlay, F, R2, BtnRow, SubTabs, Input, Select, Textarea, Tag, EntityTag, TxTypeTag, Amount,
         CatPill, Empty, SectionHeader, Spinner, showToast, confirmDelete, MonthSelect } from "./shared";

const SUBTABS_BASE = [
  { id:"all",       label:"All" },
  { id:"expense",   label:"Expenses" },
  { id:"income",    label:"Income" },
  { id:"transfer",  label:"Transfers" },
  { id:"reimburse", label:"Reimburse" },
];

// Type choices for step-1 grid (2 per row)
const TYPE_CHOICES = [
  { id:"expense",       label:"Expense",       icon:"↑",  color:"#dc2626", desc:"Spending money" },
  { id:"income",        label:"Income",        icon:"↓",  color:"#059669", desc:"Receiving money" },
  { id:"transfer",      label:"Transfer",      icon:"↔",  color:"#3b5bdb", desc:"Between accounts" },
  { id:"pay_cc",        label:"Pay CC",        icon:"▭",  color:"#7048e8", desc:"Credit card payment" },
  { id:"buy_asset",     label:"Buy Asset",     icon:"▲",  color:"#0c8599", desc:"Purchase asset" },
  { id:"sell_asset",    label:"Sell Asset",    icon:"▽",  color:"#059669", desc:"Sell asset" },
  { id:"reimburse_out", label:"Reimburse",     icon:"↗",  color:"#d97706", desc:"Paid on behalf" },
  { id:"reimburse_in",  label:"Recv. Reimb",  icon:"↙",  color:"#059669", desc:"Get reimbursed" },
  { id:"give_loan",     label:"Give Loan",     icon:"↗",  color:"#d97706", desc:"Lend money" },
  { id:"collect_loan",  label:"Collect Loan",  icon:"↙",  color:"#059669", desc:"Receive repayment" },
  { id:"pay_liability", label:"Pay Liability", icon:"▼",  color:"#d97706", desc:"Pay off a debt" },
  { id:"fx_exchange",   label:"FX Exchange",   icon:"⇄",  color:"#0c8599", desc:"Currency exchange" },
];

const EMPTY_ENTRY = {
  date: todayStr(), description:"", merchant_name:"", amount:"", currency:"IDR",
  type:"expense", from_account_id:"", to_account_id:"", category_id:"", category_label:"",
  entity:"Personal", notes:"", is_reimburse:false,
};

function dateLabel(d) {
  const today = new Date().toISOString().slice(0,10);
  const yest  = new Date(Date.now()-864e5).toISOString().slice(0,10);
  if (d === today) return "Today";
  if (d === yest)  return "Yesterday";
  return new Date(d+"T12:00:00").toLocaleDateString("en-US", { weekday:"short", day:"numeric", month:"long", year:"numeric" });
}

export default function Transactions({
  th, user, accounts, ledger, categories, fxRates, CURRENCIES: C,
  bankAccounts, creditCards, assets, liabilities, receivables,
  onRefresh, setLedger, pendingSyncs, setPendingSyncs,
}) {
  const pendingCount = pendingSyncs?.length || 0;
  const SUBTABS = pendingCount > 0
    ? [...SUBTABS_BASE, { id:"pending", label:`Pending (${pendingCount})` }]
    : SUBTABS_BASE;

  const [subTab, setSubTab]         = useState("all");
  const [showForm, setShowForm]     = useState(false);
  const [formStep, setFormStep]     = useState(1);   // 1=type selection, 2=fields
  const [editId, setEditId]         = useState(null);
  const [form, setForm]             = useState(EMPTY_ENTRY);
  const [saving, setSaving]         = useState(false);
  const [filterMonth, setFilterMonth] = useState("all");
  const [search, setSearch]         = useState("");
  const [selected, setSelected]     = useState({});
  const [showAI, setShowAI]         = useState(false);
  const fileRef = useRef(null);

  const allCurrencies = C || CURRENCIES;

  const filtered = useMemo(() => {
    let list = [...ledger];
    if (subTab === "reimburse") list = list.filter(e => e.is_reimburse);
    else if (subTab === "expense") list = list.filter(e => e.type === "expense");
    else if (subTab === "income")  list = list.filter(e => e.type === "income");
    else if (subTab === "transfer") list = list.filter(e => ["transfer","pay_cc","fx_exchange"].includes(e.type));
    if (filterMonth !== "all") list = list.filter(e => ym(e.date) === filterMonth);
    if (search) list = list.filter(e =>
      e.description?.toLowerCase().includes(search.toLowerCase()) ||
      e.merchant_name?.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [ledger, subTab, filterMonth, search]);

  // Group by date for display
  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(e => { if (!map[e.date]) map[e.date]=[]; map[e.date].push(e); });
    return Object.entries(map).sort(([a],[b]) => b.localeCompare(a));
  }, [filtered]);

  const fromOptions = useMemo(() => {
    const maps = {
      expense:      [...bankAccounts,...creditCards],
      income:       accounts,
      transfer:     bankAccounts,
      pay_cc:       bankAccounts,
      buy_asset:    [...bankAccounts,...creditCards],
      sell_asset:   assets,
      pay_liability:bankAccounts,
      reimburse_out:[...bankAccounts,...creditCards],
      reimburse_in: receivables,
      give_loan:    bankAccounts,
      collect_loan: receivables,
      fx_exchange:  bankAccounts,
    };
    return maps[form.type] || accounts;
  }, [form.type, accounts, bankAccounts, creditCards, assets, liabilities, receivables]);

  const toOptions = useMemo(() => {
    const maps = {
      expense:      [],
      income:       bankAccounts,
      transfer:     bankAccounts,
      pay_cc:       creditCards,
      buy_asset:    assets,
      sell_asset:   bankAccounts,
      pay_liability:liabilities,
      reimburse_out:receivables,
      reimburse_in: bankAccounts,
      give_loan:    receivables,
      collect_loan: bankAccounts,
      fx_exchange:  bankAccounts,
    };
    return maps[form.type] || [];
  }, [form.type, bankAccounts, creditCards, assets, liabilities, receivables]);

  const needsCategory  = ["expense","reimburse_out"].includes(form.type);
  const needsToAccount = toOptions.length > 0;
  const amtIDR = toIDR(Number(form.amount||0), form.currency||"IDR", fxRates, allCurrencies);

  const openNew = () => { setForm({...EMPTY_ENTRY}); setEditId(null); setFormStep(1); setShowForm(true); };
  const openEdit = (e) => {
    setForm({ date:e.date, description:e.description, merchant_name:e.merchant_name||"",
      amount:e.amount, currency:e.currency||"IDR", type:e.type,
      from_account_id:e.from_account_id||"", to_account_id:e.to_account_id||"",
      category_id:e.category_id||"", category_label:e.category_label||"",
      entity:e.entity||"Personal", notes:e.notes||"", is_reimburse:e.is_reimburse||false });
    setEditId(e.id); setFormStep(2); setShowForm(true);
  };

  const save = async () => {
    if (!form.description || !form.amount) return showToast("Fill in description and amount","error");
    setSaving(true);
    try {
      const cat = categories.find(c=>c.id===form.category_id);
      const entry = { ...form, amount:Number(form.amount), amount_idr:amtIDR,
        category_label: cat?.name||form.category_label||"" };
      if (editId) {
        const updated = await ledgerApi.update(editId, entry);
        setLedger(p => p.map(e => e.id===editId ? updated : e));
        showToast("Transaction updated");
      } else {
        const created = await ledgerApi.create(user.id, entry, accounts);
        setLedger(p => [created,...p]);
        showToast("Transaction added");
        await onRefresh();
      }
      if (form.merchant_name && form.category_id)
        merchantApi.upsertMapping(user.id, form.merchant_name, form.category_id, form.category_label).catch(()=>{});
      setShowForm(false);
    } catch (e) { showToast(e.message,"error"); }
    setSaving(false);
  };

  const del = async (entry) => {
    if (!confirmDelete(entry.description)) return;
    try {
      await ledgerApi.delete(entry.id, entry, accounts);
      setLedger(p => p.filter(e => e.id!==entry.id));
      showToast("Deleted"); await onRefresh();
    } catch (e) { showToast(e.message,"error"); }
  };

  const bulkDelete = async () => {
    const ids = Object.keys(selected).filter(k=>selected[k]);
    if (!ids.length || !window.confirm(`Delete ${ids.length} transactions?`)) return;
    for (const id of ids) { const e=ledger.find(x=>x.id===id); if(e) await ledgerApi.delete(id,e,accounts); }
    setLedger(p=>p.filter(e=>!ids.includes(e.id))); setSelected({});
    showToast(`${ids.length} deleted`); await onRefresh();
  };

  const selCount = Object.values(selected).filter(Boolean).length;
  const outTotal = filtered.filter(e=>["expense","pay_cc","buy_asset","pay_liability","reimburse_out","give_loan"].includes(e.type)).reduce((s,e)=>s+Number(e.amount_idr||e.amount||0),0);
  const inTotal  = filtered.filter(e=>["income","sell_asset","reimburse_in","collect_loan"].includes(e.type)).reduce((s,e)=>s+Number(e.amount_idr||e.amount||0),0);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:0 }}>

      {/* ── Action bar ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ display:"flex", gap:8, flex:1 }}>
          <MonthSelect value={filterMonth} onChange={setFilterMonth} th={th} style={{ maxWidth:160 }}/>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search transactions…" th={th} style={{ flex:1 }}/>
        </div>
        <div style={{ display:"flex", gap:8, marginLeft:12 }}>
          <button className="btn btn-ghost btn-sm" onClick={()=>setShowAI(true)}>AI Import</button>
          <button className="btn btn-primary btn-sm" onClick={openNew}>+ Add</button>
        </div>
      </div>

      {/* ── Sub-tabs ── */}
      <SubTabs tabs={SUBTABS} active={subTab} onChange={setSubTab}/>

      {/* ── Summary strip ── */}
      {subTab !== "pending" && (
        <div style={{ display:"flex", gap:16, padding:"10px 0", borderBottom:`1px solid ${th.bor}`, marginBottom:4, fontSize:12 }}>
          <span style={{ color:th.tx3 }}>{filtered.length} items</span>
          <span className="num" style={{ color:th.rd }}>−{fmtIDR(outTotal,true)}</span>
          <span className="num" style={{ color:th.gr }}>+{fmtIDR(inTotal,true)}</span>
          {selCount>0 && <>
            <span style={{ marginLeft:"auto", color:th.ac, fontWeight:600 }}>{selCount} selected</span>
            <button onClick={bulkDelete} style={{ background:"none", border:"none", color:th.rd, cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:"'Sora',sans-serif" }}>Delete</button>
            <button onClick={()=>setSelected({})} style={{ background:"none", border:"none", color:th.tx3, cursor:"pointer", fontSize:12, fontFamily:"'Sora',sans-serif" }}>Clear</button>
          </>}
        </div>
      )}

      {/* ── Pending tab ── */}
      {subTab === "pending" && (
        <PendingReview th={th} user={user} accounts={accounts} categories={categories}
          pendingSyncs={pendingSyncs} setPendingSyncs={setPendingSyncs}
          ledger={ledger} setLedger={setLedger} onRefresh={onRefresh}/>
      )}

      {/* ── Transaction list grouped by date ── */}
      {subTab !== "pending" && (
        grouped.length === 0
          ? <Empty icon="◎" message="No transactions found" th={th}/>
          : grouped.map(([date, rows]) => (
              <div key={date}>
                <div className="tx-date-header" style={{ color:th.tx3 }}>{dateLabel(date)}</div>
                {rows.map(e => {
                  const isOut = ["expense","pay_cc","buy_asset","pay_liability","reimburse_out","give_loan"].includes(e.type);
                  const isIn  = ["income","sell_asset","reimburse_in","collect_loan"].includes(e.type);
                  const amt   = Number(e.amount_idr||e.amount||0);
                  const fromAcc = accounts.find(a=>a.id===e.from_account_id);
                  const toAcc   = accounts.find(a=>a.id===e.to_account_id);
                  const catDef  = EXPENSE_CATEGORIES.find(c=>c.id===e.category_id||c.label===e.category_label);
                  const iconBg  = catDef ? catDef.color+"22" : isOut ? th.rdBg : isIn ? th.grBg : th.acBg;
                  const iconCol = catDef ? catDef.color : isOut ? th.rd : isIn ? th.gr : th.ac;
                  const icon    = catDef?.icon || (isOut?"↑":isIn?"↓":"↔");
                  return (
                    <div key={e.id} className="tx-row"
                      style={{ background:selected[e.id]?th.acBg:"transparent" }}
                      onClick={()=>setSelected(s=>({...s,[e.id]:!s[e.id]}))}>
                      {/* Category icon */}
                      <div style={{ width:36,height:36,borderRadius:"50%",background:iconBg,
                        display:"flex",alignItems:"center",justifyContent:"center",
                        fontSize:16,flexShrink:0,color:iconCol }}>{icon}</div>
                      {/* Description + meta */}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:14, fontWeight:500, color:th.tx, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.description}</div>
                        <div style={{ fontSize:12, color:th.tx3, marginTop:1, display:"flex", gap:6, flexWrap:"wrap" }}>
                          {fromAcc && <span>{fromAcc.name}{toAcc&&<> → {toAcc.name}</>}</span>}
                          {catDef && <span>{catDef.label}</span>}
                          {e.entity&&e.entity!=="Personal" && <span style={{ color:th.ac }}>{e.entity}</span>}
                        </div>
                      </div>
                      {/* Amount */}
                      <div className="num" style={{ fontSize:14, fontWeight:700, color:isOut?th.rd:isIn?th.gr:th.ac, flexShrink:0 }}>
                        {isOut?"−":isIn?"+":""}{fmtIDR(amt,true)}
                      </div>
                      {/* Actions */}
                      <div style={{ display:"flex", gap:4, flexShrink:0 }} onClick={ev=>ev.stopPropagation()}>
                        <button className="btn-icon" onClick={()=>openEdit(e)} style={{ color:th.tx3 }}>✎</button>
                        <button className="btn-icon" onClick={()=>del(e)} style={{ color:th.rd, borderColor:th.rdBg }}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
      )}

      {/* ── ADD/EDIT FORM ── */}
      {showForm && (
        <Overlay onClose={()=>setShowForm(false)} th={th}
          title={editId ? "Edit Transaction" : formStep===1 ? "Add Transaction" : TYPE_CHOICES.find(t=>t.id===form.type)?.label||"Add Transaction"}
          sub={formStep===2 ? "Step 2 of 2" : !editId ? "Step 1 of 2" : undefined}>

          {/* Step 1: type grid */}
          {formStep === 1 && !editId && (
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              <div style={{ fontSize:13, color:th.tx3 }}>What type of transaction?</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {TYPE_CHOICES.map(t => (
                  <button key={t.id} onClick={()=>{ setForm(f=>({...f,type:t.id,from_account_id:"",to_account_id:"",category_id:""})); setFormStep(2); }}
                    style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px",
                      border:`1px solid ${th.bor}`, borderRadius:10, background:th.sur,
                      cursor:"pointer", textAlign:"left", transition:"all .12s", fontFamily:"'Sora',sans-serif" }}>
                    <div style={{ width:32,height:32,borderRadius:8,background:t.color+"18",
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:16,color:t.color,flexShrink:0 }}>{t.icon}</div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color:th.tx }}>{t.label}</div>
                      <div style={{ fontSize:11, color:th.tx3 }}>{t.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
              <div style={{ paddingBottom:8 }}>
                <button className="btn btn-ghost" onClick={()=>setShowForm(false)} style={{ width:"100%", height:40 }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Step 2: form fields */}
          {(formStep === 2 || editId) && (
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              {/* Back to type selection (new only) */}
              {!editId && (
                <button onClick={()=>setFormStep(1)} style={{ background:"none", border:"none", cursor:"pointer", color:th.tx3, fontSize:12, fontFamily:"'Sora',sans-serif", textAlign:"left", padding:0, display:"flex", alignItems:"center", gap:4 }}>
                  ← Back to type
                </button>
              )}

              <R2>
                <F label="Date" th={th}><Input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} th={th}/></F>
                <F label="Currency" th={th}>
                  <Select value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))} th={th}>
                    {allCurrencies.map(c=><option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
                  </Select>
                </F>
              </R2>

              <F label="Description" th={th} required>
                <Input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="What was this for?" th={th}/>
              </F>

              <R2>
                <F label="Amount" th={th} required>
                  <Input type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0" th={th}
                    style={{ fontFamily:"'JetBrains Mono',monospace" }}/>
                </F>
                <F label="Entity" th={th}>
                  <Select value={form.entity} onChange={e=>setForm(f=>({...f,entity:e.target.value}))} th={th}>
                    {ENTITIES.map(e=><option key={e}>{e}</option>)}
                  </Select>
                </F>
              </R2>

              {fromOptions.length > 0 && (
                <F label={["income","sell_asset","reimburse_in","collect_loan"].includes(form.type)?"Source":"From Account"} th={th}>
                  <Select value={form.from_account_id} onChange={e=>setForm(f=>({...f,from_account_id:e.target.value}))} th={th}>
                    <option value="">Select account…</option>
                    {fromOptions.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </F>
              )}

              {needsToAccount && (
                <F label={form.type==="income"?"To Account":"Destination"} th={th}>
                  <Select value={form.to_account_id} onChange={e=>setForm(f=>({...f,to_account_id:e.target.value}))} th={th}>
                    <option value="">Select account…</option>
                    {toOptions.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </F>
              )}

              {needsCategory && (
                <F label="Category" th={th}>
                  <Select value={form.category_id} onChange={e=>{
                    const cat=categories.find(c=>c.id===e.target.value);
                    setForm(f=>({...f,category_id:e.target.value,category_label:cat?.name||""}));
                  }} th={th}>
                    <option value="">Select category…</option>
                    {categories.map(c=><option key={c.id} value={c.id}>{c.icon||""} {c.name}</option>)}
                  </Select>
                </F>
              )}

              {form.type==="expense" && (
                <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontSize:13, color:th.tx2 }}>
                  <input type="checkbox" checked={form.is_reimburse} onChange={e=>setForm(f=>({...f,is_reimburse:e.target.checked}))}
                    style={{ accentColor:th.am, width:16, height:16 }}/>
                  Mark as reimbursable
                </label>
              )}

              <F label="Notes" th={th}>
                <Input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Optional notes" th={th}/>
              </F>

              {form.currency !== "IDR" && (
                <div style={{ fontSize:12, color:th.tx3, textAlign:"right" }}>≈ {fmtIDR(amtIDR)} IDR</div>
              )}

              <BtnRow onCancel={()=>setShowForm(false)} onOk={save} label={editId?"Save Changes":"Add Transaction"} th={th} saving={saving}/>
            </div>
          )}
        </Overlay>
      )}

      {/* ── AI IMPORT ── */}
      {showAI && (
        <AIImportPanel th={th} user={user} accounts={accounts} categories={categories}
          fxRates={fxRates} CURRENCIES={allCurrencies}
          onClose={()=>setShowAI(false)}
          onImported={(rows)=>{ setLedger(p=>[...rows,...p]); onRefresh(); }}/>
      )}
    </div>
  );
}

// ─── AI IMPORT PANEL ─────────────────────────────────────────
function AIImportPanel({ th, user, accounts, categories, fxRates, CURRENCIES: C, onClose, onImported }) {
  const [rows, setRows]       = useState([]);
  const [sel, setSel]         = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [saving, setSaving]   = useState(false);
  const fileRef = useRef(null);

  const bankAccounts = accounts.filter(a=>a.type==="bank");
  const creditCards  = accounts.filter(a=>a.type==="credit_card");

  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const mime = file.type || "image/jpeg";
    setError(null); setRows([]); setSel({});
    const reader = new FileReader();
    reader.onload = async ev => {
      const b64 = ev.target.result.split(",")[1];
      setLoading(true);
      try {
        const isPdf = mime === "application/pdf";
        const contentBlock = isPdf
          ? { type:"document", source:{ type:"base64", media_type:"application/pdf", data:b64 } }
          : { type:"image",    source:{ type:"base64", media_type:mime, data:b64 } };
        const prompt = `You are a financial transaction extractor. Analyze this document and extract ALL transactions.
Return ONLY a JSON array with objects:
[{
  "date": "YYYY-MM-DD",
  "description": "merchant or description",
  "merchant_name": "normalized merchant name",
  "amount": number,
  "currency": "IDR",
  "type": "expense|income|transfer|pay_cc",
  "card_last4": "1234 or null",
  "from_account_no": "account number or null",
  "to_account_no": "account number or null",
  "from_bank_name": "bank name or null",
  "to_bank_name": "bank name or null",
  "is_qris": false,
  "is_debit": false,
  "is_transfer": false,
  "is_cc_payment": false,
  "suggested_category": "Food & Drinks|Transport|Shopping|etc",
  "confidence": 0.9
}]
Rules: TRSF/Transfer→transfer, QRIS/QR→is_qris=true, CC/Credit Card payment→is_cc_payment=true, negative amount→expense. Return ONLY JSON array.`;
        const d = await aiCall({ model:"claude-sonnet-4-20250514", max_tokens:8000, messages:[{ role:"user", content:[contentBlock,{type:"text",text:prompt}] }] });
        const raw = parseJSON(d.content?.[0]?.text||"[]", []);
        // Smart match
        const enriched = raw.map(tx => {
          let fromAcc = null, toAcc = null;
          // Match by last4
          if (tx.card_last4) {
            const cc = creditCards.find(c=>c.last4===String(tx.card_last4));
            if (cc) fromAcc = cc;
          }
          // Match by account number
          if (!fromAcc && tx.from_account_no) {
            const b = bankAccounts.find(b=>b.account_no&&b.account_no.includes(tx.from_account_no.slice(-4)));
            if (b) fromAcc = b;
          }
          if (tx.to_account_no) {
            const b = bankAccounts.find(b=>b.account_no&&b.account_no.includes(tx.to_account_no.slice(-4)));
            if (b) toAcc = b;
          }
          // Resolve type
          let type = tx.type;
          if (fromAcc && toAcc) type = "transfer";
          else if (tx.is_cc_payment) type = "pay_cc";
          else if (tx.is_qris || tx.is_debit) type = "expense";
          // Category match
          const cat = categories.find(c=>c.name===tx.suggested_category);
          return {
            ...tx, type, amount_idr: tx.amount,
            from_account_id: fromAcc?.id || bankAccounts[0]?.id || "",
            to_account_id: toAcc?.id || (type==="pay_cc"?creditCards[0]?.id:"") || "",
            category_id: cat?.id || "", category_label: cat?.name || tx.suggested_category || "Other",
            entity: "Personal", _matched_from: fromAcc, _matched_to: toAcc,
          };
        });
        setRows(enriched);
        const s = {}; enriched.forEach((_,i)=>{ s[i]=true; }); setSel(s);
      } catch(e) { setError(e.message||"AI failed to read file"); }
      setLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const editRow = (i,k,v) => setRows(p=>p.map((r,idx)=>idx===i?{...r,[k]:v}:r));

  const doImport = async () => {
    const toImport = rows.filter((_,i)=>sel[i]);
    if (!toImport.length) return;
    setSaving(true);
    const created = [];
    try {
      for (const row of toImport) {
        const entry = {
          date: row.date||todayStr(), description: row.description, merchant_name: row.merchant_name||"",
          amount: Number(row.amount||0), currency: row.currency||"IDR", amount_idr: Number(row.amount_idr||row.amount||0),
          type: row.type||"expense", from_account_id: row.from_account_id||"", to_account_id: row.to_account_id||"",
          category_id: row.category_id||"", category_label: row.category_label||"",
          entity: row.entity||"Personal", notes:"AI Import", confidence: row.confidence||1,
        };
        const r = await ledgerApi.create(user.id, entry, accounts);
        if (r) created.push(r);
      }
      onImported(created);
      showToast(`✅ ${created.length} transactions imported`);
      // Learn merchant → category for all confirmed imports
      for (const row of toImport) {
        if (row.merchant_name && row.category_id) {
          merchantApi.upsertMapping(user.id, row.merchant_name, row.category_id, row.category_label).catch(()=>{});
        }
      }
      onClose();
    } catch(e) { showToast(e.message,"error"); }
    setSaving(false);
  };

  return (
    <Overlay onClose={onClose} th={th} title="🤖 AI Smart Import" maxWidth={760}>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {rows.length===0&&!loading&&(
          <>
            <div onClick={()=>fileRef.current?.click()} style={{
              border:`2px dashed ${th.ac}`, borderRadius:14, padding:"32px 20px",
              textAlign:"center", cursor:"pointer", background:th.acBg,
            }}>
              <div style={{ fontSize:36, marginBottom:8 }}>🤖</div>
              <div style={{ fontSize:14, fontWeight:700, color:th.ac }}>Upload photo or PDF</div>
              <div style={{ fontSize:11, color:th.tx3, marginTop:4 }}>Receipt · Bank statement · CC bill · Screenshot</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display:"none" }} onChange={handleFile}/>
          </>
        )}
        {loading&&(
          <div style={{ display:"flex", gap:12, alignItems:"center", padding:16, background:th.acBg, borderRadius:12 }}>
            <Spinner size={24} color={th.ac}/>
            <div style={{ fontSize:13, fontWeight:700, color:th.ac }}>AI extracting transactions… (10–30s)</div>
          </div>
        )}
        {error&&(
          <div style={{ padding:"12px 14px", background:th.rdBg, border:`1px solid ${th.rd}44`, borderRadius:10, fontSize:12, color:th.rd }}>
            ⚠️ {error}
            <button onClick={()=>fileRef.current?.click()} style={{ marginLeft:12, background:th.rd, color:"#fff", border:"none", padding:"4px 10px", borderRadius:6, fontSize:11, fontWeight:700, cursor:"pointer" }}>Retry</button>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display:"none" }} onChange={handleFile}/>
          </div>
        )}
        {rows.length>0&&(
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:12, fontWeight:700, color:th.tx }}>{rows.length} transactions extracted · <span style={{ color:th.ac }}>{Object.values(sel).filter(Boolean).length} selected</span></div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={()=>{const s={};rows.forEach((_,i)=>s[i]=true);setSel(s);}} style={{ border:`1px solid ${th.ac}`, background:"none", color:th.ac, borderRadius:7, padding:"3px 10px", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"'Sora',sans-serif" }}>All</button>
                <button onClick={()=>setSel({})} style={{ border:`1px solid ${th.bor}`, background:"none", color:th.tx3, borderRadius:7, padding:"3px 10px", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"'Sora',sans-serif" }}>None</button>
                <button onClick={()=>fileRef.current?.click()} style={{ border:`1px solid ${th.bor}`, background:"none", color:th.tx3, borderRadius:7, padding:"3px 10px", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"'Sora',sans-serif" }}>📁 Change</button>
                <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display:"none" }} onChange={handleFile}/>
              </div>
            </div>
            {/* Header */}
            <div style={{ display:"grid", gridTemplateColumns:"20px 88px 1fr 80px 88px 110px 110px", gap:4, fontSize:9, fontWeight:700, color:th.tx3, textTransform:"uppercase", letterSpacing:.5, padding:"2px 8px" }}>
              <span/><span>Date</span><span>Description</span><span>Amount</span><span>Type</span><span>Account</span><span>Category</span>
            </div>
            <div style={{ maxHeight:360, overflowY:"auto", display:"flex", flexDirection:"column", gap:3 }}>
              {rows.map((row,i)=>{
                const lowConf=(row.confidence||1)<0.7;
                const bg=lowConf?th.amBg:i%2===0?th.sur:th.sur2;
                return(
                  <div key={i} style={{ display:"grid", gridTemplateColumns:"20px 88px 1fr 80px 88px 110px 110px", gap:4, padding:"5px 8px", background:bg, borderRadius:8, alignItems:"center", opacity:sel[i]?1:.45 }}>
                    <input type="checkbox" checked={!!sel[i]} onChange={e=>setSel(s=>({...s,[i]:e.target.checked}))} style={{ accentColor:th.ac }}/>
                    <input className="inp" type="date" value={row.date||""} onChange={e=>editRow(i,"date",e.target.value)} style={{ padding:"2px 4px", fontSize:10, background:th.sur, borderColor:th.bor2, color:th.tx }}/>
                    <input className="inp" value={row.description||""} onChange={e=>editRow(i,"description",e.target.value)} style={{ padding:"2px 4px", fontSize:11, background:th.sur, borderColor:th.bor2, color:th.tx }}/>
                    <input className="inp" type="number" value={row.amount||""} onChange={e=>editRow(i,"amount",e.target.value)} style={{ padding:"2px 4px", fontSize:11, textAlign:"right", fontFamily:"'JetBrains Mono',monospace", background:th.sur, borderColor:th.bor2, color:th.tx }}/>
                    <select className="inp" value={row.type||"expense"} onChange={e=>editRow(i,"type",e.target.value)} style={{ padding:"2px 4px", fontSize:10, background:th.sur, borderColor:th.bor2, color:th.tx }}>
                      <option value="expense">↑ Out</option>
                      <option value="income">↓ In</option>
                      <option value="transfer">↔ Trf</option>
                      <option value="pay_cc">💳 CC</option>
                      <option value="expense">📱 QRIS</option>
                    </select>
                    <select className="inp" value={row.from_account_id||""} onChange={e=>editRow(i,"from_account_id",e.target.value)} style={{ padding:"2px 4px", fontSize:10, background:th.sur, borderColor:th.bor2, color:th.tx }}>
                      <option value="">— Account —</option>
                      {accounts.filter(a=>["bank","credit_card"].includes(a.type)).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <select className="inp" value={row.category_id||""} onChange={e=>{const cat=categories.find(c=>c.id===e.target.value);editRow(i,"category_id",e.target.value);editRow(i,"category_label",cat?.name||"");}}
                      style={{ padding:"2px 4px", fontSize:10, background:lowConf&&row.category_label==="Other"?th.amBg:th.sur, borderColor:lowConf&&row.category_label==="Other"?th.am:th.bor2, color:th.tx }}>
                      <option value="">— Category —</option>
                      {categories.map(c=><option key={c.id} value={c.id}>{c.icon||""} {c.name}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
            <div style={{ display:"flex", gap:16, padding:"8px 12px", background:th.sur2, borderRadius:9, fontSize:12 }}>
              <span style={{ color:th.tx3 }}>Selected: <strong style={{ color:th.tx }}>{Object.values(sel).filter(Boolean).length}</strong></span>
              {rows.some(r=>(r.confidence||1)<0.7)&&<span style={{ color:th.am }}>⚠️ {rows.filter(r=>(r.confidence||1)<0.7).length} need review</span>}
            </div>
            <BtnRow onCancel={onClose} onOk={doImport} label={`Import ${Object.values(sel).filter(Boolean).length} Transactions →`} th={th} saving={saving} disabled={Object.values(sel).filter(Boolean).length===0}/>
          </>
        )}
        {rows.length===0&&!loading&&!error&&<button onClick={onClose} style={{ padding:10, borderRadius:9, border:`1px solid ${th.bor}`, background:th.sur2, color:th.tx3, fontFamily:"'Sora',sans-serif", fontWeight:600, fontSize:13, cursor:"pointer" }}>Cancel</button>}
      </div>
    </Overlay>
  );
}

// ─── PENDING REVIEW COMPONENT ─────────────────────────────────
function PendingReview({
  th, user, accounts, categories, pendingSyncs, setPendingSyncs,
  ledger, setLedger, onRefresh,
}) {
  const [saving, setSaving] = useState(false);

  const confirmOne = async (sync) => {
    if (!sync.ai_raw_result) return showToast("No transaction data to import","error");
    setSaving(true);
    try {
      const txs = Array.isArray(sync.ai_raw_result) ? sync.ai_raw_result : [sync.ai_raw_result];
      for (const tx of txs) {
        const entry = {
          date: tx.date || sync.received_at?.slice(0,10) || new Date().toISOString().slice(0,10),
          description: tx.description || tx.merchant_name || sync.subject || "Email import",
          merchant_name: tx.merchant_name || "",
          amount: Number(tx.amount || 0),
          currency: tx.currency || "IDR",
          amount_idr: Number(tx.amount_idr || tx.amount || 0),
          type: tx.suggested_tx_type || tx.type || "expense",
          from_account_id: tx.from_account_id || "",
          to_account_id: tx.to_account_id || "",
          category_id: tx.category_id || "",
          category_label: tx.category_label || tx.suggested_category || "",
          entity: tx.suggested_entity || "Personal",
          notes: `Imported from email (${sync.sender_email || "Gmail"})`,
        };
        const created = await ledgerApi.create(user.id, entry, accounts);
        if (created) setLedger(p => [created, ...p]);
      }
      await gmailApi.updateSync(sync.id, { status: "confirmed" });
      setPendingSyncs(p => p.filter(s => s.id !== sync.id));
      showToast(`Imported from ${sync.sender_email || "email"}`);
      // Learn merchant mappings from confirmed email transactions
      for (const tx of txs) {
        if (tx.merchant_name && (tx.category_id || tx.suggested_category)) {
          merchantApi.upsertMapping(
            user.id, tx.merchant_name,
            tx.category_id || tx.suggested_category,
            tx.category_label || tx.suggested_category
          ).catch(()=>{});
        }
      }
      await onRefresh();
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const skipOne = async (sync) => {
    try {
      await gmailApi.updateSync(sync.id, { status: "skipped" });
      setPendingSyncs(p => p.filter(s => s.id !== sync.id));
      showToast("Skipped");
    } catch (e) { showToast(e.message, "error"); }
  };

  const checkDuplicate = (sync) => {
    const txs = Array.isArray(sync.ai_raw_result) ? sync.ai_raw_result : sync.ai_raw_result ? [sync.ai_raw_result] : [];
    for (const tx of txs) {
      const amt = Number(tx.amount_idr || tx.amount || 0);
      const date = tx.date || sync.received_at?.slice(0,10);
      const dupe = ledger.find(e => {
        const dateDiff = date ? Math.abs(new Date(e.date) - new Date(date)) / 86400000 : 999;
        return dateDiff <= 1 && Math.abs(Number(e.amount_idr || e.amount || 0) - amt) < 500;
      });
      if (dupe) return { isDuplicate: true, existingEntry: dupe };
    }
    return { isDuplicate: false };
  };

  const confirmAll = async () => {
    const fresh = pendingSyncs.filter(s => !checkDuplicate(s).isDuplicate);
    if (!fresh.length) return showToast("No new (non-duplicate) items", "error");
    for (const s of fresh) await confirmOne(s);
  };

  const skipAllDupes = async () => {
    const dupes = pendingSyncs.filter(s => checkDuplicate(s).isDuplicate);
    for (const s of dupes) await skipOne(s);
  };

  const dupeCount = pendingSyncs.filter(s => checkDuplicate(s).isDuplicate).length;
  const newCount  = pendingSyncs.filter(s => !checkDuplicate(s).isDuplicate).length;

  if (!pendingSyncs?.length) {
    return (
      <div style={{ padding:"32px", textAlign:"center", background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14 }}>
        <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
        <div style={{ fontSize:14, fontWeight:700, color:th.tx }}>No pending email transactions</div>
        <div style={{ fontSize:12, color:th.tx3, marginTop:4 }}>Connect Gmail in Settings → Email Sync to auto-import</div>
      </div>
    );
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {/* Stats + batch actions */}
      <div style={{ padding:"12px 14px", background:th.sur, border:`1px solid ${th.bor}`, borderRadius:12, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
        <div style={{ fontSize:12, color:th.tx2 }}>
          <span style={{ fontWeight:700, color:"#0ca678" }}>{newCount} new</span>
          {dupeCount > 0 && <span style={{ color:"#e67700", marginLeft:10 }}>⚠️ {dupeCount} possible duplicates</span>}
        </div>
        <div style={{ display:"flex", gap:6 }}>
          {newCount > 0 && (
            <button className="btn btn-primary" onClick={confirmAll} disabled={saving}
              style={{ fontSize:11, padding:"5px 12px" }}>
              ✓ Confirm All New ({newCount})
            </button>
          )}
          {dupeCount > 0 && (
            <button className="btn btn-ghost" onClick={skipAllDupes}
              style={{ fontSize:11, padding:"5px 12px", color:"#e67700", borderColor:"#ffd43b" }}>
              Skip Duplicates ({dupeCount})
            </button>
          )}
        </div>
      </div>

      {/* Individual cards */}
      {pendingSyncs.map(sync => {
        const txs = Array.isArray(sync.ai_raw_result) ? sync.ai_raw_result
          : sync.ai_raw_result ? [sync.ai_raw_result] : [];
        const { isDuplicate: isDupe, existingEntry } = checkDuplicate(sync);
        const mainTx = txs[0] || {};
        const fromAcc = accounts.find(a => a.id === mainTx.from_account_id);
        const amt = Number(mainTx.amount_idr || mainTx.amount || 0);
        const txDate = mainTx.date || sync.received_at?.slice(0,10) || "—";
        const catDef = EXPENSE_CATEGORIES.find(c => c.id === mainTx.category_id || c.label === mainTx.suggested_category);

        return (
          <div key={sync.id} style={{
            background: th.sur, borderRadius: 13, padding: "14px 16px",
            border: `1px solid ${isDupe ? "#ffd43b" : th.bor}`,
            borderLeft: `4px solid ${isDupe ? "#e67700" : "#0ca678"}`,
          }}>
            {/* Email source */}
            <div style={{ fontSize:10, color:th.tx3, marginBottom:8, display:"flex", gap:8, flexWrap:"wrap" }}>
              <span>📧 {sync.sender_email || "Gmail"}</span>
              {sync.received_at && <span>· {sync.received_at.slice(0,10)}</span>}
              {isDupe && <span style={{ color:"#e67700", fontWeight:700 }}>⚠️ Possible Duplicate</span>}
            </div>

            {/* Tx info */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:th.tx }}>
                  {mainTx.description || mainTx.merchant_name || sync.subject || "Unknown transaction"}
                </div>
                <div style={{ fontSize:11, color:th.tx3, marginTop:2, display:"flex", gap:8, flexWrap:"wrap" }}>
                  {catDef && <span>{catDef.icon} {catDef.label}</span>}
                  {mainTx.suggested_entity && mainTx.suggested_entity !== "Personal" && <span>· {mainTx.suggested_entity}</span>}
                  {fromAcc && <span>· {fromAcc.name}</span>}
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div className="num" style={{ fontSize:15, fontWeight:800, color:th.rd }}>{fmtIDR(amt,true)}</div>
                <div style={{ fontSize:10, color:th.tx3 }}>{txDate}</div>
              </div>
            </div>

            {/* Duplicate info */}
            {isDupe && existingEntry && (
              <div style={{ padding:"8px 10px", background:"#fff9db", border:"1px solid #ffd43b", borderRadius:8, marginBottom:10, fontSize:11 }}>
                <div style={{ fontWeight:700, color:"#e67700", marginBottom:2 }}>Already in ledger:</div>
                <div style={{ color:"#7c5800" }}>
                  {existingEntry.date} · {existingEntry.description} · {fmtIDR(existingEntry.amount_idr || existingEntry.amount || 0, true)}
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {!isDupe ? (
                <button onClick={() => confirmOne(sync)} disabled={saving} className="btn btn-primary"
                  style={{ fontSize:11, padding:"5px 12px" }}>
                  ✓ Confirm
                </button>
              ) : (
                <>
                  <button onClick={() => skipOne(sync)} className="btn btn-ghost"
                    style={{ fontSize:11, padding:"5px 12px", color:"#0ca678", borderColor:"#b2f2e8" }}>
                    ↩ Skip — Already Exists
                  </button>
                  <button onClick={() => confirmOne(sync)} disabled={saving} className="btn btn-ghost"
                    style={{ fontSize:11, padding:"5px 12px", color:th.tx2, borderColor:th.bor }}>
                    Import Anyway
                  </button>
                </>
              )}
              <button onClick={() => skipOne(sync)} className="btn btn-ghost"
                style={{ fontSize:11, padding:"5px 12px", color:"#e03131", borderColor:"#ffc9c9" }}>
                ✗ Skip
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
