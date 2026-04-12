ALTER TABLE public_data.cafeteria_menu_documents
  ADD COLUMN IF NOT EXISTS normalization_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS normalization_confidence numeric(4,2),
  ADD COLUMN IF NOT EXISTS normalization_reason text,
  ADD COLUMN IF NOT EXISTS normalized_entry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS normalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS normalization_error_message text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_menu_documents_normalization_status_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_menu_documents
      ADD CONSTRAINT cafeteria_menu_documents_normalization_status_check
      CHECK (normalization_status IN ('pending', 'succeeded', 'partial', 'failed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public_data.cafeteria_menu_entries (
  id bigserial PRIMARY KEY,
  source_document_id bigint NOT NULL
    REFERENCES public_data.cafeteria_menu_documents(id) ON DELETE CASCADE,
  source_post_id bigint NOT NULL
    REFERENCES public_data.cafeteria_instagram_posts(id) ON DELETE CASCADE,
  source_id text NOT NULL
    REFERENCES public_data.cafeteria_instagram_sources(id),
  service_date date NOT NULL,
  meal_type text NOT NULL,
  is_closed boolean NOT NULL DEFAULT false,
  menu_text text NOT NULL,
  menu_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  normalization_confidence numeric(4,2),
  normalization_method text NOT NULL DEFAULT 'cell_ocr',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_document_id, service_date, meal_type)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_menu_entries_meal_type_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_menu_entries
      ADD CONSTRAINT cafeteria_menu_entries_meal_type_check
      CHECK (meal_type IN ('breakfast', 'lunch', 'dinner'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cafeteria_menu_entries_source_date
  ON public_data.cafeteria_menu_entries (source_id, service_date, meal_type);
