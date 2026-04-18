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
    reimburse_in:    { from_type: "expense",         to_type: "account"  },
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
    reimburse_in:    { from: null,               to: { bank: +a } },
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

    // Strip client-only fields before DB insert
    const { fx_direction: fxDirection, ...insertEntry } = entry;
    const safeEntry = sanitizeUUIDs(insertEntry);

    const { data, error } = await supabase
      .from("ledger")
      .insert([{ ...safeEntry, user_id: userId }])
      .select()
      .single();
    if (error) throw new Error(error.message);

    const amount  = Number(safeEntry.amount_idr || safeEntry.amount || 0);
    const fromAcc = accounts.find(a => a.id === safeEntry.from_id);
    const toAcc   = accounts.find(a => a.id === safeEntry.to_id);

    if (safeEntry.tx_type === "fx_exchange") {
      // Only update the IDR side — the caller handles account_currencies for the foreign side
      if ((fxDirection || "buy") === "buy") {
        // BUY: from-account loses IDR
        if (fromAcc) await applyBalanceDelta(fromAcc.id, fromAcc.type, -amount);
      } else {
        // SELL: to-account gains IDR
        if (toAcc) await applyBalanceDelta(toAcc.id, toAcc.type, +amount);
      }
    } else {
      const deltas = getDeltas(safeEntry.tx_type, amount);
      if (fromAcc && deltas.from?.[fromAcc.type] !== undefined)
        await applyBalanceDelta(fromAcc.id, fromAcc.type, deltas.from[fromAcc.type]);
      if (toAcc && deltas.to?.[toAcc.type] !== undefined)
        await applyBalanceDelta(toAcc.id, toAcc.type, deltas.to[toAcc.type]);
    }

    // Auto-create/update reimburse settlements
    const REIMBURSE_ENTITIES = ["Hamasa", "SDC", "Travelio"];
    if (safeEntry.tx_type === "reimburse_out" && REIMBURSE_ENTITIES.includes(safeEntry.entity) && data?.id) {
      // Create a new pending settlement for reimburse_out
      supabase.from("reimburse_settlements").insert([{
        user_id:              userId,
        entity:               safeEntry.entity,
        status:               "pending",
        total_out:            amount,
        out_ledger_ids:       [data.id],
        in_ledger_ids:        [],
        total_in:             0,
        reimbursable_expense: amount,
        settled_at:           null,
      }]).then(null, (e) => console.error("[reimburse_settlements]", e));
    }
    if (safeEntry.tx_type === "reimburse_in" && REIMBURSE_ENTITIES.includes(safeEntry.entity) && data?.id) {
      // Find pending settlement for same entity, update total_in
      (async () => {
        try {
          const { data: pending } = await supabase.from("reimburse_settlements")
            .select("*").eq("user_id", userId).eq("entity", safeEntry.entity)
            .eq("status", "pending").order("created_at", { ascending: false }).limit(1).single();
          if (pending) {
            const newTotalIn = Number(pending.total_in || 0) + amount;
            const newInIds = [...(pending.in_ledger_ids || []), data.id];
            const isSettled = newTotalIn >= Number(pending.total_out || 0);
            await supabase.from("reimburse_settlements").update({
              total_in:      newTotalIn,
              in_ledger_ids: newInIds,
              ...(isSettled ? { status: "settled", settled_at: new Date().toISOString() } : {}),
            }).eq("id", pending.id);
            // Link the ledger entry to the settlement
            await supabase.from("ledger").update({ reimburse_settlement_id: pending.id }).eq("id", data.id);
          }
        } catch (e) { console.error("[reimburse_settlements reimburse_in]", e); }
      })();
    }

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

// ─── RECALCULATE BALANCE ──────────────────────────────────────
// Recomputes current_balance from scratch.
// Bank/cash: to_id=account → credit (+), from_id=account → debit (-)
// Credit card: from_id=cc → charge/debt (+), to_id=cc → payment/debt (-)
export const recalculateBalance = async (accountId, userId) => {
  if (!accountId || !userId) return null;
  const { data: acc } = await supabase
    .from("accounts").select("initial_balance, type").eq("id", accountId).single();
  const { data: txns } = await supabase
    .from("ledger")
    .select("amount_idr, from_id, from_type, to_id, to_type")
    .eq("user_id", userId)
    .or(`from_id.eq.${accountId},to_id.eq.${accountId}`);
  let balance = Number(acc?.initial_balance || 0);
  const isCC  = acc?.type === "credit_card";
  for (const tx of (txns || [])) {
    const amt = Number(tx.amount_idr || 0);
    if (isCC) {
      // CC: spending charges add to debt; payments reduce it
      if (tx.from_id === accountId && tx.from_type === "account") balance += amt;
      if (tx.to_id   === accountId && tx.to_type   === "account") balance -= amt;
    } else {
      // Bank/cash/receivable: incoming credits add; outgoing debits subtract
      if (tx.to_id   === accountId && tx.to_type   === "account") balance += amt;
      if (tx.from_id === accountId && tx.from_type === "account") balance -= amt;
    }
  }
  await supabase.from("accounts").update({ current_balance: balance }).eq("id", accountId);
  return balance;
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

  // Create installment + recurring template from an import row, link to ledger entry
  createFromImport: async (userId, { ledgerId, description, accountId, amount, totalMonths, paidMonths, currency, txDate, categoryId }) => {
    const monthlyAmount = Number(amount);
    const paid = Number(paidMonths) || 1;
    // Compute start_date: txDate minus (paidMonths - 1) months
    let startDate = txDate;
    if (txDate && paid > 1) {
      const d = new Date(txDate + "T00:00:00");
      d.setMonth(d.getMonth() - (paid - 1));
      startDate = d.toISOString().slice(0, 10);
    }
    const inst = await installmentsApi.create(userId, {
      description,
      purchase_ledger_id: ledgerId,
      account_id:    accountId,
      total_amount:  monthlyAmount * totalMonths,
      monthly_amount: monthlyAmount,
      total_months:  totalMonths,
      paid_months:   paid,
      start_date:    startDate,
      currency:      currency || "IDR",
      status:        paid >= totalMonths ? "settled" : "active",
    });
    // Link ledger entry to installment
    await supabase.from("ledger").update({ installment_id: inst.id }).eq("id", ledgerId);
    // Create recurring template
    const day = txDate ? new Date(txDate + "T00:00:00").getDate() : 1;
    await recurringApi.createTemplate(userId, {
      name:        description,
      description: `Cicilan ${description} ${totalMonths}x`,
      amount:      monthlyAmount,
      currency:    currency || "IDR",
      tx_type:     "expense",
      from_type:   "account",
      from_id:     accountId,
      to_type:     "expense_category",
      to_id:       categoryId || null,
      category_id: categoryId || null,
      frequency:   "monthly",
      day_of_month: day,
      is_active:   paid < totalMonths,
    });
    return inst;
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
    // Use raw SQL increment for confidence so it accumulates across calls
    const { data: existing } = await supabase
      .from("merchant_mappings")
      .select("confidence")
      .eq("user_id", userId)
      .eq("merchant_name", merchantName.toLowerCase())
      .maybeSingle();
    const newConfidence = (existing?.confidence || 0) + 1;
    const { error } = await supabase.from("merchant_mappings").upsert(
      {
        user_id:       userId,
        merchant_name: merchantName.toLowerCase(),
        category_id:   categoryId,
        category_name: categoryLabel,
        confidence:    newConfidence,
        last_seen:     new Date().toISOString(),
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
  upsert: async (accountId, currency, balance, initialBalance, userId) => {
    let uid = userId;
    if (!uid) {
      const { data: { user } } = await supabase.auth.getUser();
      uid = user?.id;
    }
    const { error } = await supabase
      .from("account_currencies")
      .upsert(
        { account_id: accountId, currency, balance, initial_balance: initialBalance ?? balance, user_id: uid },
        { onConflict: "account_id,currency" }
      );
    if (error) throw new Error(error.message);
  },
  // Increment (or decrement if delta < 0) a foreign currency balance.
  // Creates the row if it doesn't exist.
  addBalance: async (accountId, currency, delta, userId) => {
    if (!accountId || !currency || !delta) return;
    const { data: row } = await supabase
      .from("account_currencies")
      .select("balance")
      .eq("account_id", accountId)
      .eq("currency", currency)
      .maybeSingle();

    if (row !== null) {
      const { error } = await supabase
        .from("account_currencies")
        .update({ balance: Number(row.balance || 0) + delta })
        .eq("account_id", accountId)
        .eq("currency", currency);
      if (error) throw new Error(error.message);
    } else {
      let uid = userId;
      if (!uid) {
        const { data: { user } } = await supabase.auth.getUser();
        uid = user?.id;
      }
      const { error } = await supabase.from("account_currencies").insert({
        account_id: accountId, currency,
        balance: delta, initial_balance: delta, user_id: uid,
      });
      if (error) throw new Error(error.message);
    }
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

// ─── ASSETS ───────────────────────────────────────────────────
export const assetsApi = {
  getAll: async (userId) => {
    const { data, error } = await supabase
      .from("assets")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },
  create: async (userId, d) => {
    const { data, error } = await supabase
      .from("assets")
      .insert([{ ...d, user_id: userId }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  update: async (id, d) => {
    const { error } = await supabase.from("assets").update(d).eq("id", id);
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
  // Step 1: strip ```json / ``` fences
  let clean = text.trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  // Step 2: direct parse
  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed))  return parsed;
    if (parsed.transactions)    return parsed.transactions;
    if (parsed.data)            return parsed.data;
    return [parsed];
  } catch {}

  // Step 3: find JSON array
  const arrayMatch = clean.match(/\[[\s\S]*\]/s);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {}
  }

  // Step 4: find "transactions": [...] — repair truncation by closing brackets
  const txMatch = clean.match(/"transactions"\s*:\s*(\[[\s\S]*)/s);
  if (txMatch) {
    let txText = txMatch[1];
    let open  = (txText.match(/\[/g) || []).length;
    let close = (txText.match(/\]/g) || []).length;
    while (close < open) { txText += "]"; close++; }
    try { return JSON.parse(txText); } catch {}
  }

  // Step 5: find any JSON object
  const objMatch = clean.match(/\{[\s\S]*\}/s);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (parsed.transactions) return parsed.transactions;
      return [parsed];
    } catch {}
  }

  // Step 6: salvage — extract individual complete transaction objects
  // Handles mid-array truncation where the outer [] is cut off
  const salvaged = [];
  const objRegex = /\{[^{}]*"date"[^{}]*\}/gs;
  let m;
  while ((m = objRegex.exec(clean)) !== null) {
    try {
      const tx = JSON.parse(m[0]);
      if (tx.date && (tx.amount !== undefined)) salvaged.push(tx);
    } catch {}
  }
  if (salvaged.length > 0) {
    console.warn(`Salvaged ${salvaged.length} transactions from truncated JSON`);
    return salvaged;
  }

  console.error("Could not parse AI response:", text.slice(0, 400));
  throw new Error("Could not extract transactions. Try uploading a smaller file.");
}

// ─── SCAN BATCHES ─────────────────────────────────────────────
export const scanApi = {
  // Scan a file (image/PDF) via AI proxy → returns array of transaction objects
  scan: async (userId, file, { accounts = [], employeeLoans = [], bankHint = "", model = "claude-haiku-4-5-20251001" } = {}) => {
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

          // ── Mandiri-specific detection ───────────────────────────
          const isMandiri = /mandiri/i.test(bankHint);

          // Mandiri page-targeted prompt
          const buildMandiriPrompt = (page) => `This is a Bank Mandiri (Tabungan Mandiri) e-Statement PDF.
The table columns are: No | Tanggal/Date | Keterangan/Remarks | Nominal(IDR) | Saldo(IDR)

Extract transactions from PAGE ${page} ONLY.

CRITICAL RULES:
1. Each numbered row (1, 2, 3...) = exactly ONE transaction
2. Positive Nominal (+) = incoming money (Dana Masuk / Kredit) — DO NOT SKIP THESE
3. Negative Nominal (-) = outgoing money (Dana Keluar / Debet)
4. Multi-line Keterangan = still one transaction — combine all description lines
5. Extract ALL numbered rows visible on page ${page} — do not skip any
6. Include the row number (No column) in your output

Return ONLY a JSON array, no other text:
[{"no":1,"date":"YYYY-MM-DD","description":"full description here","amount":123456,"balance":9876543}]

Amount rules: positive = money IN, negative = money OUT.
Dates format: convert DD-MMM-YYYY or DD/MM/YYYY to YYYY-MM-DD.

IMPORTANT - Year detection rules:
- If the document clearly shows a year, use that year
- If no year is visible or it is ambiguous, use the current year (2026)
- Never use years before 2026 unless explicitly stated in the document
- For bank statements dated Jan-Dec without a year, assume 2026
- Double-check: if a transaction date would result in a year before 2024, it is likely wrong — default to 2026`;

          // Normalize Mandiri row → generic AI transaction shape
          const normMandiri = (tx) => {
            const amt    = Number(tx.amount || 0);
            const absAmt = Math.abs(amt);
            return {
              date:        tx.date,
              description: tx.description || "",
              amount:      absAmt,
              currency:    "IDR",
              amount_idr:  absAmt,
              type:        amt >= 0 ? "income" : "expense",
              category:    amt >= 0 ? "other_income" : "other",
              entity:      "Personal",
              _no:         tx.no,
            };
          };

          const buildPrompt = (pass = 1, skipCount = 0) => `You are a financial transaction extractor for an Indonesian bank statement (Mandiri/BCA/BNI/BRI format).

═══ CRITICAL INSTRUCTIONS ═══
1. Extract EVERY SINGLE row from the transaction table — ALL pages, ALL rows.
2. The table has columns: Tanggal | Keterangan | Debet | Kredit | Saldo
3. DEBET column = money leaving account (blank for credit rows)
4. KREDIT column = money entering account (blank for debit rows)
5. ⚠ DO NOT skip rows where DEBET is blank — those are KREDIT (incoming) transactions.
6. Each table row = one transaction object. No exceptions.
7. Log "total_rows_in_document" as the count of ALL rows you see in the table.${skipCount > 0 ? `\n8. SKIP first ${skipCount} rows already extracted — start from row #${skipCount + 1}.` : ""}

${accountsCtx ? `Known accounts:\n${accountsCtx}\n` : ""}${loansCtx ? `Employee loans:\n${loansCtx}\n` : ""}
═══ TYPE RULES ═══
KREDIT (incoming, + amount) → type: income (default for unknown source)
DEBET (outgoing, - amount) → type: expense (default for unknown dest)

Mandiri-specific patterns:
• "Transfer BI Fast dari [BANK] [NAME]" = KREDIT → type: income
• "Transfer dari BANK MANDIRI [NAME] [ACCOUNT]" = KREDIT → type: income (if description contains "cicilan" → collect_loan)
• "Penyetoran tunai" / "Setoran tunai" = KREDIT → type: income
• "Pembayaran kartu kredit [ACCOUNT]" = DEBET → type: pay_cc
• "Biaya administrasi" / "Biaya transfer" = DEBET → type: expense, category: bank_charges
• "Bunga tabungan" / "Jasa giro" = KREDIT → type: income, category: bank_interest
• "PPh bunga" / "Pajak bunga" = DEBET → type: expense, category: tax
• "Bea materai" / "Materai" = DEBET → type: expense, category: materai
• "Transfer ke" / "TRF KE" = DEBET → type: expense (or transfer if dest account is known)
• "Transfer BI Fast ke [BANK]" / "Bifast ke [BANK]" = DEBET → type: transfer IF destination bank matches known accounts below; otherwise type: expense
• "ATM" / "Tarik tunai" = DEBET → type: expense
• If the description contains an account number that matches one of the known accounts below → type: transfer

Own accounts (use for transfer detection — if description contains own bank name or account number → type: transfer):
${accountsCtx || "none"}
Note: SMBC Indonesia = Jenius (same bank, different name). Treat as the same institution.

═══ OUTPUT FORMAT ═══
Return ONLY valid JSON — no markdown, no explanation:
{"transactions":[...],"total_rows_in_document":N}

Each transaction (use minimal field values, max 60 chars for description):
{"date":"YYYY-MM-DD","description":"short desc","amount":123456,"currency":"IDR","amount_idr":123456,"type":"income|expense|transfer|pay_cc|collect_loan|give_loan|reimburse_in|reimburse_out","category":"other","entity":"Personal"}

Omit from_account_id and to_account_id unless you can match them to known accounts above.

IMPORTANT - Year detection rules:
- If the document clearly shows a year, use that year
- If no year is visible or it is ambiguous, use the current year (2026)
- Never use years before 2026 unless explicitly stated in the document
- For bank statements dated Jan-Dec without a year, assume 2026
- Double-check: if a transaction date would result in a year before 2024, it is likely wrong — default to 2026`;

          let _aiPass = 0;
          const callAI = async (prompt) => {
            _aiPass++;
            const contentParts = [];
            if (mime === "application/pdf") {
              contentParts.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } });
            } else {
              contentParts.push({ type: "image", source: { type: "base64", media_type: mime, data: base64 } });
            }
            contentParts.push({ type: "text", text: prompt });

            const key = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
            const url = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/ai-proxy`;
            const r = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json", "apikey": key, "Authorization": `Bearer ${key}` },
              body: JSON.stringify({
                model:      model,
                max_tokens: 32000,
                messages: [{ role: "user", content: contentParts }],
              }),
            });
            if (!r.ok) {
              const e2  = await r.json().catch(() => ({}));
              const msg = e2?.error?.message || e2?.message ||
                          (typeof e2?.error === "string" ? e2.error : null) || `HTTP ${r.status}`;
              throw new Error(msg);
            }
            const d   = await r.json();
            const raw = d?.content?.[0]?.text || "";
            const stopReason = d?.stop_reason || "";
            // Log usage for token debugging
            const usage = d?.usage || {};
            console.log(`[AI scan] pass=${_aiPass} stop_reason=${stopReason} raw_len=${raw.length} input_tokens=${usage.input_tokens} output_tokens=${usage.output_tokens}`);
            console.log("[AI scan] raw preview:", raw.slice(0, 400));
            return { raw, stopReason };
          };

          // ── Mandiri 2-page extraction ────────────────────────────
          if (isMandiri) {
            console.log("[AI scan] Mandiri format detected — running 2-page extraction");
            const { raw: mRaw1 } = await callAI(buildMandiriPrompt(1));
            const { raw: mRaw2 } = await callAI(buildMandiriPrompt(2));
            const page1 = extractJSON(mRaw1).map(normMandiri);
            const page2 = extractJSON(mRaw2).map(normMandiri);
            console.log(`[AI scan] Mandiri page1=${page1.length} page2=${page2.length}`);
            // Deduplicate by row number
            const seen = new Set(page1.map(t => t._no).filter(Boolean));
            const merged = [
              ...page1,
              ...page2.filter(t => !t._no || !seen.has(t._no)),
            ].sort((a, b) => (a._no || 0) - (b._no || 0));
            console.log(`[AI scan] Mandiri merged=${merged.length} transactions`);
            resolve(merged);
            return;
          }

          // Pass 1
          const { raw: raw1, stopReason: stop1 } = await callAI(buildPrompt(1, 0));
          let parsed1 = extractJSON(raw1);

          // Log total_rows_in_document if AI reported it
          try {
            const meta = JSON.parse(raw1.replace(/^```json\s*/i,"").replace(/```\s*$/,"").trim());
            if (meta?.total_rows_in_document) {
              console.log(`[AI scan] AI reports total_rows_in_document=${meta.total_rows_in_document}, extracted=${parsed1.length}`);
              if (meta.total_rows_in_document > parsed1.length) {
                console.warn(`[AI scan] ⚠ Missing ${meta.total_rows_in_document - parsed1.length} rows!`);
              }
            }
          } catch {}

          console.log(`[AI scan] pass 1: ${parsed1.length} transactions extracted, stop_reason=${stop1}`);

          // Pass 2: if output was truncated (max_tokens hit), do a second pass for remaining rows
          let allTx = parsed1;
          if (stop1 === "max_tokens" && parsed1.length > 0) {
            console.warn(`[AI scan] Output truncated after ${parsed1.length} rows — running pass 2`);
            try {
              const { raw: raw2, stopReason: stop2 } = await callAI(buildPrompt(2, parsed1.length));
              const parsed2 = extractJSON(raw2);
              console.log(`[AI scan] pass 2: ${parsed2.length} additional transactions, stop_reason=${stop2}`);
              // Deduplicate by date+amount
              const seen = new Set(parsed1.map(t => `${t.date}|${t.amount}`));
              const newRows = parsed2.filter(t => !seen.has(`${t.date}|${t.amount}`));
              allTx = [...parsed1, ...newRows];
              console.log(`[AI scan] merged total: ${allTx.length} transactions`);
            } catch (e2) {
              console.warn("[AI scan] pass 2 failed:", e2.message);
            }
          }

          resolve(allTx);
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

  loadBatches: async (userId) => {
    const { data, error } = await supabase
      .from("scan_batches")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "extracted")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },
};

// ─── GMAIL ────────────────────────────────────────────────────
// Map AI-generated pseudo tx types to real ledger tx types.
// AI returns things like "qris_debit", "bank_debit" — normalize to real types.
const EMAIL_TX_TYPE_NORM = {
  qris_debit:    "expense",
  debit:         "expense",
  bank_debit:    "expense",
  cc_debit:      "expense",
  payment:       "expense",
  bank_charges:  "expense",
  withdrawal:    "expense",
  purchase:      "expense",
};
const VALID_TX_TYPES = new Set(["expense","income","transfer","pay_cc","reimburse_out","reimburse_in","give_loan","collect_loan","fx_exchange"]);
const normEmailTxType = (raw) => {
  if (!raw) return "expense";
  if (VALID_TX_TYPES.has(raw)) return raw;
  return EMAIL_TX_TYPE_NORM[raw] || "expense";
};

// Flatten email_sync rows (ai_raw_result arrays) into individual transaction objects
// with normalized field names expected by EmailPendingTab and PendingTab.
export function flattenEmailSync(rows) {
  const flat = [];
  for (const row of rows) {
    const txs = Array.isArray(row.ai_raw_result) ? row.ai_raw_result : [];
    if (txs.length === 0) continue;
    txs.forEach((tx, i) => {
      flat.push({
        id:                      txs.length === 1 ? row.id : `${row.id}_${i}`,
        email_sync_id:           row.id,
        tx_index:                i,
        ai_raw_result:           row.ai_raw_result,
        subject:                 row.subject,
        received_at:             row.received_at,
        raw_body:                row.raw_body,
        transaction_date:        tx.date,
        merchant_name:           tx.merchant_name || tx.description,
        amount:                  tx.amount,
        currency:                tx.currency || "IDR",
        amount_idr:              tx.amount_idr || tx.amount,
        // If a card_last4 is present it's a CC debit — never classify as transfer
        tx_type: (tx.card_last4 && normEmailTxType(tx.suggested_tx_type) === "transfer")
          ? "expense"
          : normEmailTxType(tx.suggested_tx_type),
        matched_account_id:      tx.from_account_id,
        to_account_id:           tx.to_account_id,
        suggested_category_label: tx.suggested_category,
        entity:                  tx.suggested_entity || "Personal",
        from_bank_name:          tx.from_bank_name,
        card_last4:              tx.card_last4,
        is_qris:                 tx.is_qris,
        is_transfer:             tx.is_transfer,
        is_cc_payment:           tx.is_cc_payment,
      });
    });
  }
  return flat;
}

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
      .not("ai_raw_result", "is", null)
      .gt("extracted_count", 0)
      .order("received_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data || [];
  },

  updateSync: async (id, updates) => {
    const { error } = await supabase.from("email_sync").update(updates).eq("id", id);
    if (error) throw new Error(error.message);
  },

  getFailedPending: async (userId) => {
    const { data, error } = await supabase
      .from("email_sync")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["pending", "review"])
      .or("extracted_count.eq.0,ai_raw_result.is.null")
      .order("received_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data || [];
  },

  reprocess: async (userId, ids) => {
    const key = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
    const url = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-sync`;
    const r = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey":        key,
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({ user_id: userId, reprocess_ids: ids }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || `HTTP ${r.status}`);
    }
    return r.json();
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

  triggerSync: async (userId, fromDate, toDate) => {
    const key = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
    const url = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-sync`;
    const body = { user_id: userId };
    if (fromDate) body.from_date = fromDate;
    if (toDate)   body.to_date   = toDate;
    const r = await fetch(url, {
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
      throw new Error(e.error || `HTTP ${r.status}`);
    }
    return r.json();
  },

  getSkipped: async (userId) => {
    const { data, error } = await supabase
      .from("email_sync")
      .select("id,subject,sender_email,received_at,extracted_count")
      .eq("user_id", userId)
      .eq("status", "skipped")
      .order("received_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data || [];
  },

  restoreSkipped: async (id) => {
    const { error } = await supabase.from("email_sync").update({ status: "pending" }).eq("id", id);
    if (error) throw new Error(error.message);
  },

  deleteSkipped: async (id) => {
    const { error } = await supabase.from("email_sync").delete().eq("id", id);
    if (error) throw new Error(error.message);
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

  // Insert a payment record AND increment employee_loans.paid_months by 1
  recordAndIncrement: async (userId, { loanId, payDate, amount, notes }) => {
    const { error: payErr } = await supabase.from("employee_loan_payments").insert({
      user_id: userId, loan_id: loanId,
      pay_date: payDate, amount, notes: notes || "Collected via import",
    });
    if (payErr) throw new Error(payErr.message);
    const { data: loan } = await supabase
      .from("employee_loans").select("paid_months").eq("id", loanId).maybeSingle();
    if (loan != null) {
      await supabase.from("employee_loans")
        .update({ paid_months: (loan.paid_months || 0) + 1 }).eq("id", loanId);
    }
  },
};

// ─── REIMBURSE SETTLEMENTS ────────────────────────────────────
export const reimburseSettlementsApi = {
  getPending: async (userId) => {
    const { data, error } = await supabase
      .from("reimburse_settlements")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  update: async (id, updates) => {
    const { data, error } = await supabase
      .from("reimburse_settlements")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const AI_MODEL = "claude-haiku-4-5-20251001";

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
