-- Add income_source_id and next_due_date to recurring_templates
ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS income_source_id UUID REFERENCES income_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS next_due_date DATE;

CREATE INDEX IF NOT EXISTS idx_recurring_templates_income_source_id
  ON recurring_templates(income_source_id);
