-- v3.0 — record each statement's own header dates on the reconcile session.
--
-- Why: accounts.last_statement_date drives statement-based pending-due
--   pending = last_statement_amount − Σ(payments to card where tx_date >= last_statement_date)
-- It used to be derived from the LAST TRANSACTION ROW on the statement. When that
-- last row is a payment (very common — the previous cycle's bill lands mid-cycle),
-- the payment is already reflected in closing_balance AND gets subtracted again,
-- so the card reports Rp 0 due when money is actually owed. The statement's own
-- cut date ("Tgl. Cetak" / "Statement Date") is the correct anchor.
--
-- due_date is stored alongside it because issuers move the due date with the cut
-- date (Maybank prints cut 21-07 → due 06-08, cut 19-07 → due 04-08), so a fixed
-- accounts.due_day cannot represent it.

alter table reconcile_sessions add column if not exists statement_date date;
alter table reconcile_sessions add column if not exists due_date date;

comment on column reconcile_sessions.statement_date is
  'Date the statement was cut/printed, from the PDF header. Anchor for accounts.last_statement_date; always >= the last transaction row.';
comment on column reconcile_sessions.due_date is
  'Payment due date printed on the statement. Authoritative for this cycle; accounts.due_day is only a fallback estimate.';
