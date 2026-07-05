-- Statement-based CC pending-due (accurate "lunas" detection).
-- Stores the last statement's bill amount + date per card, so:
--   pending due = last_statement_amount − payments since last_statement_date
-- Post-statement charges (next bill) are correctly ignored.
-- Run in: Supabase Dashboard → SQL Editor.

alter table accounts add column if not exists last_statement_amount numeric;
alter table accounts add column if not exists last_statement_date    date;
