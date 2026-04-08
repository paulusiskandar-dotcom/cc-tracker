import { supabase } from "./lib/supabase";

// ─── HELPERS ─────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);

// Which field stores the "balance" for each account type
const balField = (type) => {
  if (type === "bank" || type === "credit_card" || type === "debit_card") return "current_balance";
  if (type === "asset") return "current_value";
  if (type === "liability" || type === "receivable") return "outstanding_amount";
  return null;
};

// Signed delta to apply to from/to account balances
const getDeltas = (txType, amount) => {
  const map = {
    expense:        { from: { bank:-amount, credit_card:+amount }, to: null },
    income:         { from: null, to: { bank:+amount } },
    transfer:       { from: { bank:-amount, debit_card:-amount }, to: { bank:+amount } },
    pay_cc:         { from: { bank:-amount }, to: { credit_card:-amount } },
    buy_asset:      { from: { bank:-amount, credit_card:+amount }, to: { asset:+amount } },
    sell_asset:     { from: { asset:-amount }, to: { bank:+amount } },
    pay_liability:  { from: { bank:-amount }, to: { liability:-amount } },
    reimburse_out:  { from: { bank:-amount, credit_card:+amount }, to: { receivable:+amount } },
    reimburse_in:   { from: { receivable:-amount }, to: { bank:+amount } },
    give_loan:      { from: { bank:-amount }, to: { receivable:+amount } },
    collect_loan:   { from: { receivable:-amount }, to: { bank:+amount } },
    expense:     { from: { bank:-amount, debit_card:-amount }, to: null },
    fx_exchange:    { from: { bank:-amount }, to: { bank:+amount } },
    opening_balance:{ from: null, to: { bank:+amount, credit_card:+amount, asset:+amount, liability:+amount, receivable:+amount } },
    cc_installment: { from: { credit_card:+amount }, to: null },
  };
  return map[txType] || { from: null, to: null };
};

async function applyBalanceDelta(accountId, accountType, delta) {
  if (!accountId || !accountType || delta === 0) return;
  const field = balField(accountType);
  if (!field) return;
  // Use RPC for atomic increment
  const { error } = await supabase.rpc("increment_account_balance", {
    p_account_id: accountId,
    p_field: field,
    p_delta: delta,
  });
  if (error) {
    // Fallback: read → update
    const { data } = await supabase.from("accounts").select(field).eq("id", accountId).single();
    if (data) {
      const newVal = Number(data[field] || 0) + delta;
      await supabase.from("accounts").update({ [field]: newVal }).eq("id", accountId);
    }
  }
}

// ─── ACCOUNTS ─────────────────────────────────────────────────
export const accountsApi = {
  getAll: async (userId) => {
    const { data, error } = await supabase
      .from("accounts").select("*").eq("user_id", userId).eq("is_active", true).order("sort_order");
    if (error) throw new Error(error.message);
    return data || [];
  },
  getByType: async (userId, type) => {
    const { data, error } = await supabase
      .from("accounts").select("*").eq("user_id", userId).eq("type", type).eq("is_active", true).order("sort_order");
    if (error) throw new Error(error.message);
    return data || [];
  },
  create: async (userId, d) => {
    const { data, error } = await supabase
      .from("accounts").insert([{ ...d, user_id: userId }]).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
  update: async (id, d) => {
    const { data, error } = await supabase
      .from("accounts").update(d).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
  updateBalance: async (id, newBalance, field = "current_balance") => {
    const { error } = await supabase.from("accounts").update({ [field]: newBalance }).eq("id", id);
    if (error) throw new Error(error.message);
  },
  delete: async (id) => {
    const { error } = await supabase.from("accounts").update({ is_active: false }).eq("id", id);
    if (error) throw new Error(error.message);
  },
};

// ─── LEDGER ───────────────────────────────────────────────────
export const ledgerApi = {
  getAll: async (userId, filters = {}) => {
    let q = supabase.from("ledger").select("*").eq("user_id", userId).order("date", { ascending: false });
    if (filters.from) q = q.gte("date", filters.from);
    if (filters.to)   q = q.lte("date", filters.to);
    if (filters.type) q = q.eq("type", filters.type);
    if (filters.entity) q = q.eq("entity", filters.entity);
    if (filters.accountId) q = q.or(`from_account_id.eq.${filters.accountId},to_account_id.eq.${filters.accountId}`);
    if (filters.limit) q = q.limit(filters.limit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  },
  getByAccount: async (userId, accountId) => {
    const { data, error } = await supabase.from("ledger").select("*").eq("user_id", userId)
      .or(`from_account_id.eq.${accountId},to_account_id.eq.${accountId}`)
      .order("date", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },
  create: async (userId, entry, accounts = []) => {
    const { data, error } = await supabase
      .from("ledger").insert([{ ...entry, user_id: userId }]).select().single();
    if (error) throw new Error(error.message);
    // Update account balances
    const deltas = getDeltas(entry.type, Number(entry.amount_idr || entry.amount || 0));
    const fromAcc = accounts.find(a => a.id === entry.from_account_id);
    const toAcc   = accounts.find(a => a.id === entry.to_account_id);
    if (fromAcc && deltas.from && deltas.from[fromAcc.type] !== undefined)
      await applyBalanceDelta(fromAcc.id, fromAcc.type, deltas.from[fromAcc.type]);
    if (toAcc   && deltas.to   && deltas.to[toAcc.type]   !== undefined)
      await applyBalanceDelta(toAcc.id,   toAcc.type,   deltas.to[toAcc.type]);
    return data;
  },
  update: async (id, d) => {
    const { data, error } = await supabase.from("ledger").update(d).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
  delete: async (id, entry, accounts = []) => {
    const { error } = await supabase.from("ledger").delete().eq("id", id);
    if (error) throw new Error(error.message);
    // Reverse balance updates
    if (entry) {
      const deltas = getDeltas(entry.type, Number(entry.amount_idr || entry.amount || 0));
      const fromAcc = accounts.find(a => a.id === entry.from_account_id);
      const toAcc   = accounts.find(a => a.id === entry.to_account_id);
      if (fromAcc && deltas.from && deltas.from[fromAcc.type] !== undefined)
        await applyBalanceDelta(fromAcc.id, fromAcc.type, -deltas.from[fromAcc.type]);
      if (toAcc   && deltas.to   && deltas.to[toAcc.type]   !== undefined)
        await applyBalanceDelta(toAcc.id,   toAcc.type,   -deltas.to[toAcc.type]);
    }
  },
};

// ─── EXPENSE CATEGORIES ───────────────────────────────────────
export const categoriesApi = {
  getAll: async (userId) => {
    const { data, error } = await supabase
      .from("expense_categories").select("*")
      .or(`user_id.eq.${userId},is_system.eq.true`)
      .order("sort_order");
    if (error) throw new Error(error.message);
    return data || [];
  },
  create: async (userId, d) => {
    const { data, error } = await supabase
      .from("expense_categories").insert([{ ...d, user_id: userId }]).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
  update: async (id, d) => {
    const { data, error } = await supabase
      .from("expense_categories").update(d).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
  delete: async (id) => {
    const { error } = await supabase.from("expense_categories").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};

// ─── INCOME SOURCES ───────────────────────────────────────────
export const incomeSrcApi = {
  getAll: async (userId) => {
    const { data, error } = await supabase
      .from("income_sources").select("*").eq("user_id", userId).order("created_at");
    if (error) throw new Error(error.message);
    return data || [];
  },
  create: async (userId, d) => {
    const { data, error } = await supabase
      .from("income_sources").insert([{ ...d, user_id: userId }]).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
  update: async (id, d) => {
    const { data, error } = await supabase
      .from("income_sources").update(d).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
  delete: async (id) => {
    const { error } = await supabase.from("income_sources").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};

// ─── INSTALLMENTS ─────────────────────────────────────────────
export const installmentsApi = {
  getAll: async (userId) => {
    const { data, error } = await supabase
      .from("installments").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },
  create: async (userId, d) => {
    const { data, error } = await supabase
      .from("installments").insert([{ ...d, user_id: userId }]).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
  update: async (id, d) => {
    const { data, error } = await supabase
      .from("installments").update(d).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
  delete: async (id) => {
    const { error } = await supabase.from("installments").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};

// ─── RECURRING ────────────────────────────────────────────────
export const recurringApi = {
  getTemplates: async (userId) => {
    const { data, error } = await supabase
      .from("recurring_templates").select("*").eq("user_id", userId).order("created_at");
    if (error) throw new Error(error.message);
    return data || [];
  },
  getReminders: async (userId) => {
    const { data, error } = await supabase
      .from("recurring_reminders").select("*, recurring_templates(name,type,amount,currency,entity)")
      .eq("user_id", userId).eq("status", "pending").order("due_date");
    if (error) throw new Error(error.message);
    return data || [];
  },
  createTemplate: async (userId, d) => {
    const { data, error } = await supabase
      .from("recurring_templates").insert([{ ...d, user_id: userId }]).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
  updateTemplate: async (id, d) => {
    const { data, error } = await supabase
      .from("recurring_templates").update(d).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
  deleteTemplate: async (id) => {
    const { error } = await supabase.from("recurring_templates").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
  confirmReminder: async (reminderId) => {
    const { error } = await supabase
      .from("recurring_reminders").update({ status: "confirmed", confirmed_at: new Date().toISOString() }).eq("id", reminderId);
    if (error) throw new Error(error.message);
  },
  skipReminder: async (reminderId) => {
    const { error } = await supabase
      .from("recurring_reminders").update({ status: "skipped" }).eq("id", reminderId);
    if (error) throw new Error(error.message);
  },
};

// ─── MERCHANT MAPPINGS ────────────────────────────────────────
export const merchantApi = {
  getMappings: async (userId) => {
    const { data, error } = await supabase
      .from("merchant_mappings").select("*").eq("user_id", userId);
    if (error) throw new Error(error.message);
    return data || [];
  },
  upsertMapping: async (userId, merchantName, categoryId, categoryLabel) => {
    const { error } = await supabase.from("merchant_mappings").upsert(
      { user_id: userId, merchant_name: merchantName.toLowerCase(), category_id: categoryId, category_label: categoryLabel },
      { onConflict: "user_id,merchant_name" }
    );
    if (error) throw new Error(error.message);
  },
  bulkUpsert: async (userId, mappings) => {
    if (!mappings.length) return;
    const rows = mappings.map(m => ({
      user_id: userId, merchant_name: m.merchant.toLowerCase(),
      category_id: m.categoryId, category_label: m.categoryLabel,
    }));
    const { error } = await supabase.from("merchant_mappings").upsert(rows, { onConflict: "user_id,merchant_name" });
    if (error) throw new Error(error.message);
  },
};

// ─── FX RATES ─────────────────────────────────────────────────
export const fxApi = {
  getAll: async (userId) => {
    const { data, error } = await supabase.from("fx_rates").select("*").eq("user_id", userId);
    if (error) throw new Error(error.message);
    return Object.fromEntries((data || []).map(r => [r.currency, r.rate_to_idr]));
  },
  upsertAll: async (userId, ratesObj) => {
    const rows = Object.entries(ratesObj).map(([currency, rate_to_idr]) => ({ user_id: userId, currency, rate_to_idr }));
    const { error } = await supabase.from("fx_rates").upsert(rows, { onConflict: "user_id,currency" });
    if (error) throw new Error(error.message);
  },
};

// ─── SETTINGS ─────────────────────────────────────────────────
export const settingsApi = {
  get: async (userId, key, defaultVal) => {
    const { data } = await supabase.from("app_settings").select("value").eq("user_id", userId).eq("key", key).single();
    return data?.value !== undefined ? JSON.parse(data.value) : defaultVal;
  },
  set: async (userId, key, value) => {
    await supabase.from("app_settings").upsert(
      { user_id: userId, key, value: JSON.stringify(value) }, { onConflict: "user_id,key" }
    );
  },
};

// ─── SCAN BATCHES ─────────────────────────────────────────────
export const scanApi = {
  createBatch: async (userId, d) => {
    const { data, error } = await supabase
      .from("scan_batches").insert([{ ...d, user_id: userId }]).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
  updateBatch: async (id, d) => {
    const { error } = await supabase.from("scan_batches").update(d).eq("id", id);
    if (error) throw new Error(error.message);
  },
};

// ─── GMAIL OAUTH + SYNC ───────────────────────────────────────
export const gmailApi = {
  getToken: async (userId) => {
    const { data } = await supabase.from("gmail_tokens").select("*").eq("user_id", userId).single();
    return data || null;
  },
  getPending: async (userId, limit = 100) => {
    const { data, error } = await supabase.from("email_sync")
      .select("*").eq("user_id", userId).eq("status", "pending")
      .order("received_at", { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return data || [];
  },
  updateSync: async (id, updates) => {
    const { error } = await supabase.from("email_sync").update(updates).eq("id", id);
    if (error) throw new Error(error.message);
  },
  getHistory: async (userId, limit = 50) => {
    const { data, error } = await supabase.from("email_sync")
      .select("*").eq("user_id", userId)
      .in("status", ["confirmed","skipped","error"])
      .order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return data || [];
  },
  disconnect: async (userId) => {
    await supabase.from("gmail_tokens").delete().eq("user_id", userId);
  },
  triggerSync: async (userId) => {
    const key = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
    const url = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-sync`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type":"application/json", "apikey":key, "Authorization":`Bearer ${key}` },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || `HTTP ${r.status}`); }
    return await r.json();
  },
};

// ─── AI PROXY ─────────────────────────────────────────────────
export async function aiCall(body) {
  const proxy = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/ai-proxy`;
  const key   = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
  const r = await fetch(proxy, {
    method: "POST",
    headers: { "Content-Type":"application/json", "apikey":key, "Authorization":`Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error?.message||e.error||`HTTP ${r.status}`); }
  const d = await r.json();
  if (d.error) throw new Error(typeof d.error==="string"?d.error:d.error.message||"AI error");
  return d;
}

export function parseJSON(text, fallback) {
  try { return JSON.parse((text||"").replace(/```json|```/g,"").trim()); }
  catch { return fallback; }
}

// ─── HELPERS ─────────────────────────────────────────────────
export const getCur    = (c, CURRENCIES) => CURRENCIES.find(x=>x.code===c)||CURRENCIES[0];
export const toIDR     = (a, c, fx={}, CURRENCIES=[]) => {
  if (c === "IDR") return a;
  return a * (fx[c] || getCur(c, CURRENCIES)?.rate || 1);
};
export const fmtIDR    = (n, short=false) => {
  const v = Math.abs(Number(n||0));
  if (short && v>=1e9) return "Rp "+(v/1e9).toFixed(1)+"B";
  if (short && v>=1e6) return "Rp "+(v/1e6).toFixed(1)+"M";
  if (short && v>=1e3) return "Rp "+(v/1e3).toFixed(0)+"K";
  return "Rp "+v.toLocaleString("id-ID");
};
export const fmtCur    = (a, c) => c==="IDR" ? fmtIDR(a) : (({USD:"$",SGD:"S$",MYR:"RM",JPY:"¥",EUR:"€",AUD:"A$"}[c]||c)+" "+Number(a||0).toFixed(2));
export const todayStr  = today;
export const ym        = d => d?.slice(0,7)||"";
export const mlFull    = s => { try{ const[y,m]=s.split("-"); return new Date(y,m-1).toLocaleDateString("en-US",{month:"long",year:"numeric"}); }catch{ return s; } };
export const mlShort   = s => { try{ const[y,m]=s.split("-"); return new Date(y,m-1).toLocaleDateString("en-US",{month:"short",year:"2-digit"}); }catch{ return s; } };
export const daysUntil = d => { const n=new Date();let t=new Date(n.getFullYear(),n.getMonth(),d);if(t<=n)t=new Date(n.getFullYear(),n.getMonth()+1,d);return Math.ceil((t-n)/86400000); };
export const agingLabel= d => { const days=Math.floor((new Date()-new Date(d))/86400000); if(days<=30)return{label:"< 30d",color:"#0ca678"};if(days<=60)return{label:"31–60d",color:"#e67700"};return{label:"60d+",color:"#e03131"}; };
