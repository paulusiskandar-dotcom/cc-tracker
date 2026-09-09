-- Add account_id to estatement_pdfs so the source account is persisted per statement
ALTER TABLE estatement_pdfs ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
