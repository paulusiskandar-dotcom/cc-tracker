-- v2.12: Drop tables never used by application
-- assets / liabilities: data was always written to accounts (type='asset'/'liability')
-- reconcile_transactions: dead code, never referenced by active application code
DROP TABLE IF EXISTS assets CASCADE;
DROP TABLE IF EXISTS liabilities CASCADE;
DROP TABLE IF EXISTS reconcile_transactions CASCADE;
