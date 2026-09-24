-- How a liability instalment is usually paid, so the email debit can be recognised and pre-shaped
-- (BYD Seal: from BCA IDR through Blibli). pay_via is matched against the merchant text.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pay_via text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pay_from_id uuid REFERENCES accounts(id);
UPDATE accounts SET pay_via = 'blibli', pay_from_id = '37792960-f924-4182-9362-5987e8fd1c13' WHERE id = '9fa17a23-bef3-4426-b8d3-ced20e532dcf';
NOTIFY pgrst, 'reload schema';
