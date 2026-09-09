-- Add card_image_url column to accounts for credit card photo background
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS card_image_url text;
