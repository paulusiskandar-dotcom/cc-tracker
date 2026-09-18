-- Repayments made BEFORE the books start have no ledger row, so "total − Σ collect_loan"
-- overstated what is left. Lieche's 2025 loan: 10.000.000 lent 23 Jun 2025, seven
-- instalments of 500.000 paid Jun–Dec 2025 (before the ledger begins, proven by the
-- Mandiri Nov & Dec 2025 statements), eight more in 2026 in the ledger → 2.500.000 left,
-- not 6.000.000 (Paulus, 18 Sep 2026). The pre-book part is stated explicitly here rather
-- than inferred from total_paid / paid_months, which are counters that have drifted before.
ALTER TABLE employee_loans ADD COLUMN IF NOT EXISTS paid_before_books numeric NOT NULL DEFAULT 0;
UPDATE employee_loans SET paid_before_books = 3500000
 WHERE id = 'd3a63abe-0a6a-4450-af08-34e0c8880bb1' AND paid_before_books = 0;
NOTIFY pgrst, 'reload schema';
