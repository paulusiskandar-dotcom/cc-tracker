-- Add tx_type column to merchant_mappings so rules can be income- or expense-specific
-- Run in Supabase SQL editor

ALTER TABLE merchant_mappings
  ADD COLUMN IF NOT EXISTS tx_type TEXT;

-- Seed merchant_rules from ledger history (one rule per merchant_name found in ledger)
-- Only inserts where there is no existing mapping for that merchant
INSERT INTO merchant_mappings (user_id, merchant_name, category_id, category_name, tx_type, confidence)
SELECT DISTINCT ON (user_id, lower(merchant_name))
  user_id,
  lower(merchant_name) AS merchant_name,
  category_id,
  category_name,
  tx_type,
  1 AS confidence
FROM ledger
WHERE merchant_name IS NOT NULL
  AND merchant_name <> ''
  AND category_id IS NOT NULL
ORDER BY user_id, lower(merchant_name), created_at DESC
ON CONFLICT (user_id, merchant_name) DO NOTHING;

-- RPC: increment usage count when a rule is applied
CREATE OR REPLACE FUNCTION increment_merchant_rule_usage(p_user_id UUID, p_merchant_name TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE merchant_mappings
  SET confidence = COALESCE(confidence, 0) + 1,
      last_seen  = NOW()
  WHERE user_id      = p_user_id
    AND merchant_name = lower(p_merchant_name);
END;
$$;
