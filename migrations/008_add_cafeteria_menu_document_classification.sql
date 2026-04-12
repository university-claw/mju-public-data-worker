ALTER TABLE public_data.cafeteria_instagram_posts
  ADD COLUMN IF NOT EXISTS post_kind text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS post_kind_confidence numeric(4,2),
  ADD COLUMN IF NOT EXISTS post_kind_reason text,
  ADD COLUMN IF NOT EXISTS classified_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_instagram_posts_post_kind_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_instagram_posts
      ADD CONSTRAINT cafeteria_instagram_posts_post_kind_check
      CHECK (post_kind IN ('menu_sheet', 'non_menu', 'unknown'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public_data.cafeteria_menu_documents (
  id bigserial PRIMARY KEY,
  source_post_id bigint NOT NULL UNIQUE
    REFERENCES public_data.cafeteria_instagram_posts(id) ON DELETE CASCADE,
  source_id text NOT NULL
    REFERENCES public_data.cafeteria_instagram_sources(id),
  document_type text NOT NULL DEFAULT 'menu_sheet',
  detection_method text NOT NULL DEFAULT 'rule_based',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_menu_documents_document_type_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_menu_documents
      ADD CONSTRAINT cafeteria_menu_documents_document_type_check
      CHECK (document_type IN ('menu_sheet'));
  END IF;
END $$;
