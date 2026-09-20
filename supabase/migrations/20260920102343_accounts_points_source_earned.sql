-- 'statement_earned': the card holds no balance (BCA KrisFlyer); the figure is the miles of the latest cycle incl. bonus.
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_points_source_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_points_source_check CHECK (points_source IN ('statement','manual','statement_earned'));
UPDATE accounts SET points_balance = 2806, points_source = 'statement_earned' WHERE name = 'BCA Krisflyer' AND points_balance = 1806 AND points_as_of = '2026-09-18';
NOTIFY pgrst, 'reload schema';
