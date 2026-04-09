import { supabase } from "./lib/supabase";

// ─── FROM_TYPE / TO_TYPE MAPPING ─────────────────────────────
export const getTxFromToTypes = (txType) => {
  const map = {
    expense:         { from_type: "account",        to_type: "expense"  },
    income:          { from_type: "income_source",  to_type: "account"  },
    transfer:        { from_type: "account",        to_type: "account"  },
    pay_cc:          { from_type: "account",        to_type: "account"  },
    buy_asset:       { from_type: "account",        to_type: "account"  },
    sell_asset:      { from_type: "account",        to_type: "account"  },
    pay_liability:   { from_type: "account",        to_type: "account"  },
    reimburse_out:   { from_type: "account",        to_type: "account"  },
    reimburse_in:    { from_type: "account",        to_type: "account"  },
    give_loan:       { from_type: "account",        to_type: "account"  },
    collect_loan:    { from_type: "account",        to_type: "account"  },
    fx_exchange:     { from_type: "account",        to_type: "account"  },
    cc_installment:  { from_type: "account",        to_type: "expense"  },
    opening_balance: { from_type: "account",        to_type: "account"  },
  };
  return map[txType] || { from_type: "account", to_type: "account" };
};

// ─── LEDGER VALIDATION ────────────────────────────────────────
const validateLedgerEntry = (entry) => {
  if (!entry.from_type) throw new Error("from_type is required");
  if (!entry.to_type)   throw new Error("to_type is required");
  if (!entry.tx_date)   throw new Error("Date is required");
  if (!entry.amount || Number(entry.amount) <= 0) throw new Error("Amount must be greater than 0");
  if (!entry.tx_type)   throw new Error("Transaction type is required");
  return true;
};

// Validate UUID by length — only a real 36-char UUID passes, everything else → null
const cleanUUID = (v) => (v && typeof v === "string" && v.length === 36) ? v : null;

// Apply cleanUUID to every key ending in _id (except user_id which is added separately)
const sanitizeUUIDs = (obj) => {
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    if (key.endsWith("_id") && key !== "user_id") {
      out[key] = cleanUUID(out[key]);
    }
  }
  return out;
};

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
    validateLedgerEntry(entry);
    // Sanitize ALL _id UUID fields — empty string / name / "undefined" are invalid
    const safeEntry = sanitizeUUIDs(entry);

    console.log("[ledger.create] from_id:", safeEntry.from_id);
    console.log("[ledger.create] to_id:  ", safeEntry.to_id);
    console.log("[ledger.create] cat_id: ", safeEntry.category_id);

    const { data, error } = await supabase
      .from("ledger")
      .insert([{ ...safeEntry, user_id: userId }])
      .select()
      .single();
    if (error) throw new Error(error.message);

    const amount  = Number(safeEntry.amount_idr || safeEntry.amount || 0);
    const deltas  = getDeltas(safeEntry.tx_type, amount);
    const fromAcc = accounts.find(a => a.id === safeEntry.from_id);
    const toAcc   = accounts.find(a => a.id === safeEntry.to_id);

    if (fromAcc && deltas.from?.[fromAcc.type] !== undefined)
      await applyBalanceDelta(fromAcc.id, fromAcc.type, deltas.from[fromAcc.type]);
    if (toAcc && deltas.to?.[toAcc.type] !== undefined)
      await applyBalanceDelta(toAcc.id, toAcc.type, deltas.to[toAcc.type]);

    return data;
  },

  update: async (id, d) => {
    const { data, error } = await supabase
      .from("ledger")
      .update(sanitizeUUIDs(d))
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
      .or(`user_id.is.null,user_id.eq.${userId}`)
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
      .select("*, recurring_templates(name, tx_type, amount, currency, entity, from_id, to_id, category_id, day_of_month, frequency)")
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

// ─── ACCOUNT CURRENCIES ───────────────────────────────────────
export const accountCurrenciesApi = {
  getForAccount: async (accountId) => {
    const { data, error } = await supabase
      .from("account_currencies")
      .select("*")
      .eq("account_id", accountId);
    if (error) throw new Error(error.message);
    return data || [];
  },
  getAll: async (userId) => {
    const { data, error } = await supabase
      .from("account_currencies")
      .select("*, accounts!inner(user_id)")
      .eq("accounts.user_id", userId);
    if (error) throw new Error(error.message);
    return data || [];
  },
  upsert: async (accountId, currency, balance, initialBalance) => {
    const { error } = await supabase
      .from("account_currencies")
      .upsert(
        { account_id: accountId, currency, balance, initial_balance: initialBalance ?? balance },
        { onConflict: "account_id,currency" }
      );
    if (error) throw new Error(error.message);
  },
  delete: async (accountId, currency) => {
    const { error } = await supabase
      .from("account_currencies")
      .delete()
      .eq("account_id", accountId)
      .eq("currency", currency);
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

  saveHistory: async (userId, ratesObj) => {
    const rows = Object.entries(ratesObj).map(([currency, rate_to_idr]) => ({
      currency, rate_to_idr, recorded_at: new Date().toISOString(),
    }));
    await supabase.from("fx_rate_history").insert(rows);
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

// ─── AI RESPONSE JSON EXTRACTOR ───────────────────────────────
function extractJSON(text) {
  // Step 1: strip ```json / ``` fences from start and end
  let clean = text.trim();
  clean = clean.replace(/^```json\s*/i, "");
  clean = clean.replace(/^```\s*/i, "");
  clean = clean.replace(/\s*```\s*$/, "");
  clean = clean.trim();

  // Step 2: direct parse
  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed))  return parsed;
    if (parsed.transactions)    return parsed.transactions;
    if (parsed.data)            return parsed.data;
    return [parsed];
  } catch {}

  // Step 3: find JSON array in cleaned text
  const arrayMatch = clean.match(/\[[\s\S]*\]/s);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {}
  }

  // Step 4: find "transactions": [...] — fix truncation by balancing brackets
  const txMatch = clean.match(/"transactions"\s*:\s*(\[[\s\S]*)/s);
  if (txMatch) {
    let txText = txMatch[1];
    // Balance open/close brackets to repair truncated JSON
    let open  = (txText.match(/\[/g) || []).length;
    let close = (txText.match(/\]/g) || []).length;
    while (close < open) { txText += "]"; close++; }
    try { return JSON.parse(txText); } catch {}
  }

  // Step 5: find any JSON object, unwrap .transactions
  const objMatch = clean.match(/\{[\s\S]*\}/s);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (parsed.transactions) return parsed.transactions;
      return [parsed];
    } catch {}
  }

  console.error("Could not parse AI response:", text.slice(0, 400));
  throw new Error("Could not extract transactions. Try uploading a smaller file.");
}

// ─── SCAN BATCHES ─────────────────────────────────────────────
export const scanApi = {
  // Scan a file (image/PDF) via AI proxy → returns array of transaction objects
  scan: async (userId, file, { accounts = [], employeeLoans = [] } = {}) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64 = e.target.result.split(",")[1];
          const mime   = file.type || "image/jpeg";

          const accountsCtx = accounts.map(a =>
            `- ${a.name} (${a.type}${a.bank_name ? ", " + a.bank_name : ""}${a.last4 ? " ****" + a.last4 : ""}) id:${a.id}`
          ).join("\n");
          const loansCtx = employeeLoans.map(l =>
            `- ${l.employee_name} id:${l.id}`
          ).join("\n");

          const prompt = `You are a financial transaction extractor. Extract ALL transactions from this document.

${accountsCtx ? `Known accounts:\n${accountsCtx}\n` : ""}${loansCtx ? `Employee loans:\n${loansCtx}\n` : ""}
Return a JSON object with a "transactions" array. Each item must have:
- date: "YYYY-MM-DD"
- description: merchant or narration
- amount: number (positive)
- currency: "IDR" (or detected currency code)
- amount_idr: number in IDR (use 1:1 if IDR)
- type: one of expense|income|transfer|pay_cc|bank_interest|cashback|bank_charges|materai|tax
- from_account_id: matched account id or null
- to_account_id: matched account id or null
- category: expense category slug (food|transport|health|shopping|home|education|entertainment|business|finance|family|social|cash_advance_fee|other)
- entity: "Personal"
- notes: any extra detail

Return ONLY valid JSON, no markdown.`;

          const contentParts = [];
          // PDFs must use document type; images use image type
          if (mime === "application/pdf") {
            contentParts.push({
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            });
          } else {
            contentParts.push({
              type: "image",
              source: { type: "base64", media_type: mime, data: base64 },
            });
          }
          contentParts.push({ type: "text", text: prompt });

          const key = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
          const url = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/ai-proxy`;
          const r = await fetch(url, {
            method:  "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey":        key,
              "Authorization": `Bearer ${key}`,
            },
            body: JSON.stringify({
              model:      "claude-sonnet-4-20250514",
              max_tokens: 8000,
              messages: [{ role: "user", content: contentParts }],
            }),
          });

          if (!r.ok) {
            const e2  = await r.json().catch(() => ({}));
            const msg = e2?.error?.message || e2?.message ||
                        (typeof e2?.error === "string" ? e2.error : null) ||
                        `HTTP ${r.status}`;
            throw new Error(msg);
          }

          const d = await r.json();
          const raw = d?.content?.[0]?.text || "";
          console.log("AI raw response:", raw.slice(0, 500));
          resolve(extractJSON(raw));
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

// ─── EMPLOYEE LOANS ───────────────────────────────────────────
export const employeeLoanApi = {
  getAll: async (userId) => {
    const { data, error } = await supabase
      .from("employee_loans")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  create: async (userId, d) => {
    const { data, error } = await supabase
      .from("employee_loans")
      .insert([{ ...d, user_id: userId }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  update: async (id, d) => {
    const { data, error } = await supabase
      .from("employee_loans")
      .update(d)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  delete: async (id) => {
    const { error } = await supabase.from("employee_loans").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};

// ─── EMPLOYEE LOAN PAYMENTS ───────────────────────────────────
export const loanPaymentsApi = {
  getAll: async (userId) => {
    const { data, error } = await supabase
      .from("employee_loan_payments")
      .select("*")
      .eq("user_id", userId)
      .order("pay_date", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  create: async (userId, d) => {
    const { data, error } = await supabase
      .from("employee_loan_payments")
      .insert([{ ...d, user_id: userId }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  delete: async (id) => {
    const { error } = await supabase.from("employee_loan_payments").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};

const AI_MODEL = "claude-sonnet-4-20250514";

// ─── AI PROXY ─────────────────────────────────────────────────
export async function aiCall(body) {
  const proxy = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/ai-proxy`;
  const key   = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
  // Always ensure model is set — Anthropic rejects requests without it
  const payload = { model: AI_MODEL, max_tokens: 1024, ...body };
  const r = await fetch(proxy, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey":        key,
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error?.message || e.error || `HTTP ${r.status}`);
  }
  const d = await r.json();
  if (d.error) throw new Error(typeof d.error === "string" ? d.error : d.error.message || "AI error");
  return d;
}
