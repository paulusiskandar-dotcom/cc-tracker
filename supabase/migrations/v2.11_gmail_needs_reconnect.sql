-- Gmail token: track when refresh_token is invalid so UI can show reconnect banner
ALTER TABLE gmail_tokens
ADD COLUMN IF NOT EXISTS needs_reconnect BOOLEAN DEFAULT FALSE;
