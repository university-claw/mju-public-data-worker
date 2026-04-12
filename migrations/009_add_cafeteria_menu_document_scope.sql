ALTER TABLE public_data.cafeteria_menu_documents
  ADD COLUMN IF NOT EXISTS document_scope text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS scope_confidence numeric(4,2),
  ADD COLUMN IF NOT EXISTS scope_reason text,
  ADD COLUMN IF NOT EXISTS service_start_date date,
  ADD COLUMN IF NOT EXISTS service_end_date date,
  ADD COLUMN IF NOT EXISTS breakfast_available boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lunch_available boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dinner_available boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS structured_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_menu_documents_document_scope_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_menu_documents
      ADD CONSTRAINT cafeteria_menu_documents_document_scope_check
      CHECK (document_scope IN ('weekday', 'weekend', 'unknown'));
  END IF;
END $$;
