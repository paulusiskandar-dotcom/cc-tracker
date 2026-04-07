// lib/supabase.js
// ─── Supabase client untuk CC Tracker
// Install: npm install @supabase/supabase-js

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error('Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY in .env.local');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── AUTH ─────────────────────────────────────────────────────────────────────

export const auth = {
  signUp:   (email, password) => supabase.auth.signUp({ email, password }),
  signIn:   (email, password) => supabase.auth.signInWithPassword({ email, password }),
  signOut:  ()                => supabase.auth.signOut(),
  getUser:  ()                => supabase.auth.getUser(),
  onAuthStateChange: (cb)     => supabase.auth.onAuthStateChange(cb),
};

// ─── FX RATES ─────────────────────────────────────────────────────────────────

export const fxApi = {
  async getAll(userId) {
    const { data, error } = await supabase
      .from('fx_rates')
      .select('*')
      .eq('user_id', userId);
    if (error) throw error;
    // Convert array to { USD: 16400, SGD: 12200, ... }
    return Object.fromEntries((data || []).map(r => [r.currency, r.rate_to_idr]));
  },

  async upsert(userId, currency, rateToIdr) {
    const { error } = await supabase
      .from('fx_rates')
      .upsert({ user_id: userId, currency, rate_to_idr: rateToIdr, updated_at: new Date().toISOString() },
               { onConflict: 'user_id,currency' });
    if (error) throw error;
  },

  async upsertAll(userId, ratesObj) {
    const rows = Object.entries(ratesObj).map(([currency, rate_to_idr]) => ({
      user_id: userId, currency, rate_to_idr, updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('fx_rates').upsert(rows, { onConflict: 'user_id,currency' });
    if (error) throw error;
  },
};

// ─── CARDS ────────────────────────────────────────────────────────────────────

export const cardsApi = {
  async getAll(userId) {
    const { data, error } = await supabase
      .from('cards')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data || []).map(dbToCard);
  },

  async create(userId, card) {
    const { data, error } = await supabase
      .from('cards')
      .insert([{ ...cardToDb(card), user_id: userId }])
      .select()
      .single();
    if (error) throw error;
    return dbToCard(data);
  },

  async update(id, card) {
    const { data, error } = await supabase
      .from('cards')
      .update(cardToDb(card))
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return dbToCard(data);
  },

  async delete(id) {
    const { error } = await supabase.from('cards').delete().eq('id', id);
    if (error) throw error;
  },
};

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────

export const txApi = {
  async getAll(userId) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*, cards(name, bank, color, accent, last4)')
      .eq('user_id', userId)
      .order('tx_date', { ascending: false });
    if (error) throw error;
    return (data || []).map(dbToTx);
  },

  async getByMonth(userId, yearMonth) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .gte('tx_date', `${yearMonth}-01`)
      .lte('tx_date', `${yearMonth}-31`);
    if (error) throw error;
    return (data || []).map(dbToTx);
  },

  async create(userId, tx) {
    const { data, error } = await supabase
      .from('transactions')
      .insert([{ ...txToDb(tx), user_id: userId }])
      .select()
      .single();
    if (error) throw error;
    return dbToTx(data);
  },

  async update(id, tx) {
    const { data, error } = await supabase
      .from('transactions')
      .update(txToDb(tx))
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return dbToTx(data);
  },

  async toggleReimburse(id, reimbursed) {
    const { error } = await supabase
      .from('transactions')
      .update({ reimbursed })
      .eq('id', id);
    if (error) throw error;
  },

  async delete(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;
  },
};

// ─── INSTALLMENTS ─────────────────────────────────────────────────────────────

export const instApi = {
  async getAll(userId) {
    const { data, error } = await supabase
      .from('installments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(dbToInst);
  },

  async create(userId, inst) {
    const { data, error } = await supabase
      .from('installments')
      .insert([{ ...instToDb(inst), user_id: userId }])
      .select().single();
    if (error) throw error;
    return dbToInst(data);
  },

  async update(id, inst) {
    const { data, error } = await supabase
      .from('installments')
      .update(instToDb(inst))
      .eq('id', id)
      .select().single();
    if (error) throw error;
    return dbToInst(data);
  },

  async markPaid(id, paidMonths) {
    const { error } = await supabase
      .from('installments')
      .update({ paid_months: paidMonths })
      .eq('id', id);
    if (error) throw error;
  },

  async delete(id) {
    const { error } = await supabase.from('installments').delete().eq('id', id);
    if (error) throw error;
  },
};

// ─── BUDGETS ──────────────────────────────────────────────────────────────────

export const budgetsApi = {
  async getMonth(userId, monthYear) {
    const { data, error } = await supabase
      .from('budgets')
      .select('*')
      .eq('user_id', userId)
      .eq('month_year', monthYear);
    if (error) throw error;
    // Convert to { Pribadi: 3000000, Hamasa: 8000000, ... }
    const result = { Pribadi: 0, Hamasa: 0, SDC: 0, Lainnya: 0 };
    (data || []).forEach(b => { result[b.entity] = Number(b.amount); });
    return result;
  },

  async upsertAll(userId, monthYear, budgetObj) {
    const rows = Object.entries(budgetObj).map(([entity, amount]) => ({
      user_id: userId, entity, amount, month_year: monthYear,
    }));
    const { error } = await supabase
      .from('budgets')
      .upsert(rows, { onConflict: 'user_id,entity,month_year' });
    if (error) throw error;
  },
};

// ─── RECURRING ────────────────────────────────────────────────────────────────

export const recurApi = {
  async getAll(userId) {
    const { data, error } = await supabase
      .from('recurring_templates')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(dbToRecur);
  },

  async create(userId, r) {
    const { data, error } = await supabase
      .from('recurring_templates')
      .insert([{ ...recurToDb(r), user_id: userId }])
      .select().single();
    if (error) throw error;
    return dbToRecur(data);
  },

  async update(id, r) {
    const { data, error } = await supabase
      .from('recurring_templates')
      .update(recurToDb(r))
      .eq('id', id)
      .select().single();
    if (error) throw error;
    return dbToRecur(data);
  },

  async toggleActive(id, active) {
    const { error } = await supabase
      .from('recurring_templates')
      .update({ active })
      .eq('id', id);
    if (error) throw error;
  },

  async delete(id) {
    const { error } = await supabase.from('recurring_templates').delete().eq('id', id);
    if (error) throw error;
  },
};

// ─── DATA MAPPERS (DB ↔ App) ──────────────────────────────────────────────────

const dbToCard = r => ({
  id: r.id, name: r.name, bank: r.bank, last4: r.last4,
  color: r.color, accent: r.accent, network: r.network,
  limit: Number(r.card_limit), statementDay: r.statement_day,
  dueDay: r.due_day, targetPct: r.target_pct,
});

const cardToDb = c => ({
  name: c.name, bank: c.bank, last4: c.last4,
  color: c.color, accent: c.accent, network: c.network,
  card_limit: c.limit, statement_day: c.statementDay,
  due_day: c.dueDay, target_pct: c.targetPct,
});

const dbToTx = r => ({
  id: r.id, date: r.tx_date, card: r.card_id,
  desc: r.description, amount: Number(r.amount),
  currency: r.currency, amountIDR: Number(r.amount_idr),
  fee: Number(r.fee), category: r.category,
  entity: r.entity, reimbursed: r.reimbursed,
  notes: r.notes || '', recurring: r.is_recurring,
  cardInfo: r.cards || null,
});

const txToDb = t => ({
  tx_date: t.date, card_id: t.card,
  description: t.desc, amount: t.amount,
  currency: t.currency, amount_idr: t.amountIDR || t.amount,
  fee: t.fee || 0, category: t.category,
  entity: t.entity, reimbursed: t.reimbursed,
  notes: t.notes || '', is_recurring: t.recurring || false,
});

const dbToInst = r => ({
  id: r.id, card: r.card_id, desc: r.description,
  totalAmount: Number(r.total_amount), currency: r.currency,
  months: r.months, monthlyAmount: Number(r.monthly_amount),
  startDate: r.start_date, paidMonths: r.paid_months,
  entity: r.entity,
});

const instToDb = i => ({
  card_id: i.card, description: i.desc,
  total_amount: i.totalAmount, currency: i.currency,
  months: i.months, monthly_amount: i.monthlyAmount,
  start_date: i.startDate, paid_months: i.paidMonths || 0,
  entity: i.entity,
});

const dbToRecur = r => ({
  id: r.id, card: r.card_id, desc: r.description,
  amount: Number(r.amount), currency: r.currency,
  fee: Number(r.fee), category: r.category,
  entity: r.entity, frequency: r.frequency,
  dayOfMonth: r.day_of_month, active: r.active,
});

const recurToDb = r => ({
  card_id: r.card, description: r.desc,
  amount: r.amount, currency: r.currency,
  fee: r.fee || 0, category: r.category,
  entity: r.entity, frequency: r.frequency,
  day_of_month: r.dayOfMonth, active: r.active,
});
