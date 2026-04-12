-- v2.7 Category system backfill
-- Fixes category_name (slug → display label) for existing ledger rows,
-- then backfills category_id UUID via JOIN with expense_categories.

-- Step 1: Fix category_name from slug to proper display label
UPDATE ledger SET category_name = CASE category_name
  WHEN 'food'             THEN 'Food & Drinks'
  WHEN 'home'             THEN 'Home & Utilities'
  WHEN 'transport'        THEN 'Transport'
  WHEN 'health'           THEN 'Health'
  WHEN 'shopping'         THEN 'Personal Shopping'
  WHEN 'education'        THEN 'Education'
  WHEN 'entertainment'    THEN 'Entertainment'
  WHEN 'business'         THEN 'Business & Ops'
  WHEN 'finance'          THEN 'Finance'
  WHEN 'family'           THEN 'Family'
  WHEN 'social'           THEN 'Social & Gifts'
  WHEN 'cash_advance_fee' THEN 'Cash Advance Fee'
  WHEN 'bank_charges'     THEN 'Bank Charges'
  WHEN 'materai'          THEN 'Stamp Duty'
  WHEN 'tax'              THEN 'Tax'
  WHEN 'other'            THEN 'Other'
  WHEN 'salary'           THEN 'Salary'
  WHEN 'rental_income'    THEN 'Rental Income'
  WHEN 'dividend'         THEN 'Dividend'
  WHEN 'freelance'        THEN 'Freelance'
  WHEN 'loan_collection'  THEN 'Loan Collection'
  WHEN 'bank_interest'    THEN 'Bank Interest'
  WHEN 'cashback'         THEN 'Cashback'
  WHEN 'other_income'     THEN 'Other Income'
  ELSE category_name
END
WHERE category_name IN (
  'food','home','transport','health','shopping','education',
  'entertainment','business','finance','family','social',
  'cash_advance_fee','bank_charges','materai','tax','other',
  'salary','rental_income','dividend','freelance','loan_collection',
  'bank_interest','cashback','other_income'
);

-- Step 2: Backfill category_id UUID from expense_categories by name match
UPDATE ledger l
SET category_id = ec.id
FROM expense_categories ec
WHERE l.category_id IS NULL
  AND l.category_name IS NOT NULL
  AND ec.name ILIKE l.category_name;
