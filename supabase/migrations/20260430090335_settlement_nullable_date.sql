-- Make settled_at nullable (pending settlements have no settled date)
ALTER TABLE reimburse_settlements
  ALTER COLUMN settled_at DROP NOT NULL;

-- Enforce logical constraint: settled rows must have a date
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settled_status_has_date'
  ) THEN
    ALTER TABLE reimburse_settlements
      ADD CONSTRAINT settled_status_has_date
      CHECK (
        (status = 'pending'  AND settled_at IS NULL) OR
        (status = 'settled'  AND settled_at IS NOT NULL) OR
        status IS NULL
      );
  END IF;
END $$;
