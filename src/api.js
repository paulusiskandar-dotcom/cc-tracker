import { supabase } from "./lib/supabase";

// ─── BALANCE FIELD PER ACCOUNT TYPE ───────────────────────────
const balField = (type) => {
  if (type === "bank")                               return "current_balance";
  if (type === "credit_card")                        return "current_balance";
  if (type === "asset")                              return "current_value";
  if (type === "liability")  return "outstanding_amount";
  if (type === "receivable") return "receivable_outstanding";
  return null;
};

// ─── BALANCE DELTAS PER TX TYPE ───────────────────────────────
// Signed amount to apply to from_account and to_account
const getDeltas = (txType, amount) => {
  const a = amount;
  const map = {
    expense:         { from: { bank: -a, credit_card: +a }, to: null },
    income:          { from: null,        to: { bank: +a } },
    transfer:        { from: { bank: -a }, to: { bank: +a } },
    pay_cc:          { from: { bank: -a }, to: { credit_card: -a } },
    buy_asset:       { from: { bank: -a, credit_card: +a }, to: { asset: +a } },
    sell_asset:      { from: { asset: -a }, to: { bank: +a } },
    pay_liability:   { from: { bank: -a }, to: { liability: -a } },
    reimburse_out:   { from: { bank: -a, credit_card: +a }, to: { receivable: +a } },
    reimburse_in:    { from: { receivable: -a }, to: { bank: +a } },
    give_loan:       { from: { bank: -a }, to: { receivable: +a } },
    collect_loan:    { from: { receivable: -a }, to: { bank: +a } },
    fx_exchange:     { from: { bank: -a }, to: { bank: +a } },
    opening_balance: { from: null, to: { bank: +a, credit_card: +a, asset: +a, liability: +a, receivable: +a } },
    cc_installment:  { from: { credit_card: +a }, to: null },
  };
  return map[txType] || { from: null, to: null };
};

async function applyBalanceDelta(accountId, accountType, delta) {
  if (!accountId || !accountType || delta === 0) return;
  const field = balField(accountType);
  if (!field) return;

  // Try atomic RPC first, fallback to read-modify-write
  const { error } = await supabase.rpc("increment_account_balance", {
    p_account_id: accountId,
    p_field:      field,
    p_delta:      delta,
  });

  if (error) {
    const { data } = await supabase
      .from("accounts").select(field).eq("id", accountId).single();
    if (data) {
      const newVal = Number(data[field] || 0) + delta;
      await supabase.from("accounts").update({ [field]: newVal }).eq("id", accountId);
    }
  }
}

// ─── ACCOUNTS ─────────────────────────────────────────────────
export const accountsApi = {
  getAll: async (userId) => {
    console.log("[accountsApi.getAll] fetching for user:", userId);
    const { data, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("user_id", userId)
      .neq("is_active", false)
      .order("sort_order", { nullsLast: true })
      .order("created_at", { ascending: false });
    console.log("[accountsApi.getAll] result:", data?.length ?? 0, "error:", error?.message);
    if (error) throw new Error(error.message);
    return data || [];
  },

  getByType: async (userId, type) => {
    const { data, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("user_id", userId)
      .eq("type", type)
      .eq("is_active", true)
      .order("sort_order");
    if (error) throw new Error(error.message);
    return data || [];
  },

  create: async (userId, d) => {
    const { data, error } = await supabase
      .from("accounts")
      .insert([{ ...d, user_id: userId, is_active: true }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  update: async (id, d) => {
    const { data, error } = await supabase
      .from("accounts")
      .update(d)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  delete: async (id) => {
    const { error } = await supabase
      .from("accounts")
      .update({ is_active: false })
      .eq("id", id);
    if (error) throw new Error(error.message);
  },
};

// ─── LEDGER ───────────────────────────────────────────────────
export const ledgerApi = {
  getAll: async (userId, filters = {}) => {
    let q = supabase
      .from("ledger")
      .select("*")
      .eq("user_id", userId)
      .order("tx_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (filters.from)      q = q.gte("tx_date", filters.from);
    if (filters.to)        q = q.lte("tx_date", filters.to);
    if (filters.type)      q = q.eq("tx_type", filters.type);
    if (filters.entity)    q = q.eq("entity", filters.entity);
    if (filters.accountId) q = q.or(`from_id.eq.${filters.accountId},to_id.eq.${filters.accountId}`);
    if (filters.search)    q = q.ilike("description", `%${filters.search}%`);
    if (filters.limit)     q = q.limit(filters.limit);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  },

  getByAccount: async (userId, accountId) => {
    const { data, error } = await supabase
      .from("ledger")
      .select("*")
      .eq("user_id", userId)
      .or(`from_id.eq.${accountId},to_id.eq.${accountId}`)
      .order("tx_date", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  // Create entry + update balances
  create: async (userId, entry, accounts = []) => {
    const { data, error } = await supabase
      .from("ledger")
      .insert([{ ...entry, user_id: userId }])
      .select()
      .single();
    if (error) throw new Error(error.message);

    const amount  = Number(entry.amount_idr || entry.amount || 0);
    const deltas  = getDeltas(entry.tx_type, amount);
    const fromAcc = accounts.find(a => a.id === entry.from_id);
    const toAcc   = accounts.find(a => a.id === entry.to_id);

    if (fromAcc && deltas.from?.[fromAcc.type] !== undefined)
      await applyBalanceDelta(fromAcc.id, fromAcc.type, deltas.from[fromAcc.type]);
    if (toAcc && deltas.to?.[toAcc.type] !== undefined)
      await applyBalanceDelta(toAcc.id, toAcc.type, deltas.to[toAcc.type]);

    return data;
  },

  update: async (id, d) => {
    const { data, error } = await supabase
      .from("ledger")
      .update(d)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  // Delete entry + reverse balance updates
  delete: async (id, entry, accounts = []) => {
    const { error } = await supabase.from("ledger").delete().eq("id", id);
    if (error) throw new Error(error.message);

    if (entry) {
      const amount  = Number(entry.amount_idr || entry.amount || 0);
      const deltas  = getDeltas(entry.tx_type, amount);
      const fromAcc = accounts.find(a => a.id === entry.from_id);
      const toAcc   = accounts.find(a => a.id === entry.to_id);

      if (fromAcc && deltas.from?.[fromAcc.type] !== undefined)
        await applyBalanceDelta(fromAcc.id, fromAcc.type, -deltas.from[fromAcc.type]);
      if (toAcc && deltas.to?.[toAcc.type] !== undefined)
        await applyBalanceDelta(toAcc.id, toAcc.type, -deltas.to[toAcc.type]);
    }
  },
};

// ─── EXPENSE CATEGORIES ───────────────────────────────────────
export const categoriesApi = {
  getAll: async (userId) => {
    const { data, error } = await supabase
      .from("expense_categories")
      .select("*")
      .or(`user_id.eq.${userId},is_system.eq.true`)
      .order("sort_order");
    if (error) throw new Error(error.message);
    return data || [];
  },

  create: async (userId, d) => {
    const { data, error } = await supabase
      .from("expense_categories")
      .insert([{ ...d, user_id: userId }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  update: async (id, d) => {
    const { data, error } = await supabase
      .from("expense_categories")
      .update(d)
      .eq("id", id)
      .select()
      .single();
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
      .from("income_sources")
      .select("*")
      .eq("user_id", userId)
      .order("created_at");
    if (error) throw new Error(error.message);
    return data || [];
  },

  create: async (userId, d) => {
    const { data, error } = await supabase
      .from("income_sources")
      .insert([{ ...d, user_id: userId }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  update: async (id, d) => {
    const { data, error } = await supabase
      .from("income_sources")
      .update(d)
      .eq("id", id)
      .select()
      .single();
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
      .from("installments")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  create: async (userId, d) => {
    const { data, error } = await supabase
      .from("installments")
      .insert([{ ...d, user_id: userId }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  update: async (id, d) => {
    const { data, error } = await supabase
      .from("installments")
      .update(d)
      .eq("id", id)
      .select()
      .single();
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
      .from("recurring_templates")
      .select("*")
      .eq("user_id", userId)
      .order("created_at");
    if (error) throw new Error(error.message);
    return data || [];
  },

  getReminders: async (userId) => {
    const { data, error } = await supabase
      .from("recurring_reminders")
      .select("*, recurring_templates(name, tx_type, amount, currency, entity)")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("due_date");
    if (error) throw new Error(error.message);
    return data || [];
  },

  createTemplate: async (userId, d) => {
    const { data, error } = await supabase
      .from("recurring_templates")
      .insert([{ ...d, user_id: userId }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  updateTemplate: async (id, d) => {
    const { data, error } = await supabase
      .from("recurring_templates")
      .update(d)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  deleteTemplate: async (id) => {
    const { error } = await supabase.from("recurring_templates").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  confirmReminder: async (reminderId) => {
    const { error } = await supabase
      .from("recurring_reminders")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("id", reminderId);
    if (error) throw new Error(error.message);
  },

  skipReminder: async (reminderId) => {
    const { error } = await supabase
      .from("recurring_reminders")
      .update({ status: "skipped" })
      .eq("id", reminderId);
    if (error) throw new Error(error.message);
  },
};

// ─── MERCHANT MAPPINGS ────────────────────────────────────────
export const merchantApi = {
  getMappings: async (userId) => {
    const { data, error } = await supabase
      .from("merchant_mappings")
      .select("*")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return data || [];
  },

  upsert: async (userId, merchantName, categoryId, categoryLabel) => {
    const { error } = await supabase.from("merchant_mappings").upsert(
      {
        user_id:        userId,
        merchant_name:  merchantName.toLowerCase(),
        category_id:    categoryId,
        category_name:  categoryLabel,
      },
      { onConflict: "user_id,merchant_name" }
    );
    if (error) throw new Error(error.message);
  },

  bulkUpsert: async (userId, mappings) => {
    if (!mappings.length) return;
    const rows = mappings.map(m => ({
      user_id:        userId,
      merchant_name:  m.merchant.toLowerCase(),
      category_id:    m.categoryId,
      category_name:  m.categoryLabel,
    }));
    const { error } = await supabase
      .from("merchant_mappings")
      .upsert(rows, { onConflict: "user_id,merchant_name" });
    if (error) throw new Error(error.message);
  },
};

// ─── FX RATES ─────────────────────────────────────────────────
export const fxApi = {
  getAll: async (userId) => {
    const { data, error } = await supabase
      .from("fx_rates")
      .select("*")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return Object.fromEntries((data || []).map(r => [r.currency, r.rate_to_idr]));
  },

  upsertAll: async (userId, ratesObj) => {
    const rows = Object.entries(ratesObj).map(([currency, rate_to_idr]) => ({
      user_id: userId, currency, rate_to_idr,
    }));
    const { error } = await supabase
      .from("fx_rates")
      .upsert(rows, { onConflict: "user_id,currency" });
    if (error) throw new Error(error.message);
  },
};

// ─── SETTINGS ─────────────────────────────────────────────────
export const settingsApi = {
  get: async (userId, key, defaultVal) => {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("user_id", userId)
      .eq("key", key)
      .single();
    return data?.value !== undefined ? JSON.parse(data.value) : defaultVal;
  },

  set: async (userId, key, value) => {
    await supabase.from("app_settings").upsert(
      { user_id: userId, key, value: JSON.stringify(value) },
      { onConflict: "user_id,key" }
    );
  },
};

// ─── SCAN BATCHES ─────────────────────────────────────────────
export const scanApi = {
  // Scan a file (image/PDF) via AI proxy → returns array of transaction objects
  scan: async (userId, file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64 = e.target.result.split(",")[1];
          const mime   = file.type || "image/jpeg";
          const key    = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
          const url    = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/ai-proxy`;
          const r = await fetch(url, {
            method:  "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey":        key,
              "Authorization": `Bearer ${key}`,
            },
            body: JSON.stringify({
              action: "scan_document",
              user_id: userId,
              file_base64: base64,
              file_mime: mime,
              file_name: file.name,
            }),
          });
          if (!r.ok) { const e2 = await r.json().catch(() => ({})); throw new Error(e2.error || `HTTP ${r.status}`); }
          const d = await r.json();
          resolve(d.transactions || d.data || []);
        } catch (err) { reject(err); }
      };
      reader.readAsDataURL(file);
    });
  },

  createBatch: async (userId, d) => {
    const { data, error } = await supabase
      .from("scan_batches")
      .insert([{ ...d, user_id: userId }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  updateBatch: async (id, d) => {
    const { error } = await supabase.from("scan_batches").update(d).eq("id", id);
    if (error) throw new Error(error.message);
  },
};

// ─── GMAIL ────────────────────────────────────────────────────
export const gmailApi = {
  getToken: async (userId) => {
    const { data } = await supabase
      .from("gmail_tokens")
      .select("*")
      .eq("user_id", userId)
      .single();
    return data || null;
  },

  getPending: async (userId, limit = 100) => {
    const { data, error } = await supabase
      .from("email_sync")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("received_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data || [];
  },

  updateSync: async (id, updates) => {
    const { error } = await supabase.from("email_sync").update(updates).eq("id", id);
    if (error) throw new Error(error.message);
  },

  getHistory: async (userId, limit = 50) => {
    const { data, error } = await supabase
      .from("email_sync")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["confirmed", "skipped", "error"])
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data || [];
  },

  disconnect: async (userId) => {
    await supabase.from("gmail_tokens").delete().eq("user_id", userId);
  },

  markImported: async (userId, id) => {
    await supabase.from("email_sync").update({ status: "confirmed" }).eq("id", id).eq("user_id", userId);
  },

  markSkipped: async (userId, id) => {
    await supabase.from("email_sync").update({ status: "skipped" }).eq("id", id).eq("user_id", userId);
  },

  triggerSync: async (userId) => {
    const key = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
    const url = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-sync`;
    const r = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey":        key,
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || `HTTP ${r.status}`);
    }
    return r.json();
  },
};

// ─── AI PROXY ─────────────────────────────────────────────────
export async function aiCall(body) {
  const proxy = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/ai-proxy`;
  const key   = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
  const r = await fetch(proxy, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey":        key,
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error?.message || e.error || `HTTP ${r.status}`);
  }
  const d = await r.json();
  if (d.error) throw new Error(typeof d.error === "string" ? d.error : d.error.message || "AI error");
  return d;
}
