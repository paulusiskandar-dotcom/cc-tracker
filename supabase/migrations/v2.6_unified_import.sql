-- v2.6: Unified import system — scan_batches file path + ledger source tracing
ALTER TABLE scan_batches ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE ledger       ADD COLUMN IF NOT EXISTS source             text;
ALTER TABLE ledger       ADD COLUMN IF NOT EXISTS email_sync_id      uuid;
ALTER TABLE ledger       ADD COLUMN IF NOT EXISTS estatement_pdf_id  uuid;
