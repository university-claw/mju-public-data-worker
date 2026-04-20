CREATE TABLE IF NOT EXISTS public_data.cafeteria_official_page_sources (
  source_id text PRIMARY KEY
    REFERENCES public_data.cafeteria_instagram_sources(id),
  page_key text NOT NULL UNIQUE,
  page_url text NOT NULL,
  view_action_path text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_data.cafeteria_official_page_snapshots (
  id bigserial PRIMARY KEY,
  source_id text NOT NULL
    REFERENCES public_data.cafeteria_official_page_sources(source_id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  week_scope text NOT NULL DEFAULT 'current',
  snapshot_hash text NOT NULL,
  raw_html text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'succeeded',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_official_page_snapshots_week_scope_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_official_page_snapshots
      ADD CONSTRAINT cafeteria_official_page_snapshots_week_scope_check
      CHECK (week_scope IN ('current', 'previous', 'next'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_official_page_snapshots_status_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_official_page_snapshots
      ADD CONSTRAINT cafeteria_official_page_snapshots_status_check
      CHECK (status IN ('succeeded', 'empty', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cafeteria_official_page_snapshots_source_week
  ON public_data.cafeteria_official_page_snapshots (source_id, week_start_date, fetched_at DESC);

CREATE TABLE IF NOT EXISTS public_data.cafeteria_official_menu_documents (
  id bigserial PRIMARY KEY,
  source_snapshot_id bigint NOT NULL UNIQUE
    REFERENCES public_data.cafeteria_official_page_snapshots(id) ON DELETE CASCADE,
  source_id text NOT NULL
    REFERENCES public_data.cafeteria_official_page_sources(source_id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  document_scope text NOT NULL DEFAULT 'weekday',
  service_start_date date,
  service_end_date date,
  breakfast_available boolean NOT NULL DEFAULT false,
  lunch_available boolean NOT NULL DEFAULT false,
  dinner_available boolean NOT NULL DEFAULT false,
  normalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_official_menu_documents_document_scope_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_official_menu_documents
      ADD CONSTRAINT cafeteria_official_menu_documents_document_scope_check
      CHECK (document_scope IN ('weekday', 'weekend', 'unknown'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public_data.cafeteria_official_menu_entries (
  id bigserial PRIMARY KEY,
  source_document_id bigint NOT NULL
    REFERENCES public_data.cafeteria_official_menu_documents(id) ON DELETE CASCADE,
  source_id text NOT NULL
    REFERENCES public_data.cafeteria_official_page_sources(source_id) ON DELETE CASCADE,
  service_date date NOT NULL,
  meal_type text NOT NULL,
  is_closed boolean NOT NULL DEFAULT false,
  menu_text text NOT NULL,
  menu_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  parse_confidence numeric(4,2),
  normalization_method text NOT NULL DEFAULT 'html_table',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_document_id, service_date, meal_type)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_official_menu_entries_meal_type_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_official_menu_entries
      ADD CONSTRAINT cafeteria_official_menu_entries_meal_type_check
      CHECK (meal_type IN ('breakfast', 'lunch', 'dinner'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cafeteria_official_menu_entries_source_date
  ON public_data.cafeteria_official_menu_entries (source_id, service_date, meal_type);

CREATE TABLE IF NOT EXISTS public_data.cafeteria_resolved_menu_entries (
  id bigserial PRIMARY KEY,
  source_id text NOT NULL
    REFERENCES public_data.cafeteria_instagram_sources(id),
  service_date date NOT NULL,
  meal_type text NOT NULL,
  selected_source_kind text NOT NULL,
  selected_instagram_entry_id bigint
    REFERENCES public_data.cafeteria_menu_entries(id) ON DELETE SET NULL,
  selected_official_entry_id bigint
    REFERENCES public_data.cafeteria_official_menu_entries(id) ON DELETE SET NULL,
  is_closed boolean NOT NULL DEFAULT false,
  menu_text text NOT NULL,
  menu_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  selection_reason text,
  selected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, service_date, meal_type)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_resolved_menu_entries_meal_type_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_resolved_menu_entries
      ADD CONSTRAINT cafeteria_resolved_menu_entries_meal_type_check
      CHECK (meal_type IN ('breakfast', 'lunch', 'dinner'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_resolved_menu_entries_selected_source_kind_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_resolved_menu_entries
      ADD CONSTRAINT cafeteria_resolved_menu_entries_selected_source_kind_check
      CHECK (selected_source_kind IN ('instagram_ocr', 'official_page'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cafeteria_resolved_menu_entries_source_date
  ON public_data.cafeteria_resolved_menu_entries (source_id, service_date, meal_type);
