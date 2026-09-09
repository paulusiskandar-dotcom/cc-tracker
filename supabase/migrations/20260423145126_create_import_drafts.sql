CREATE TABLE IF NOT EXISTS import_drafts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('ai_scan', 'estatement', 'gmail', 'reconcile')),
  state_json JSONB NOT NULL,
  account_id UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, source, account_id)
);

CREATE INDEX IF NOT EXISTS idx_import_drafts_user_source ON import_drafts(user_id, source);
ALTER TABLE import_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own drafts" ON import_drafts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
