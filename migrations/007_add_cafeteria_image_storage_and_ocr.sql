ALTER TABLE public_data.cafeteria_instagram_posts
  ADD COLUMN IF NOT EXISTS image_storage_provider text,
  ADD COLUMN IF NOT EXISTS image_storage_key text,
  ADD COLUMN IF NOT EXISTS image_content_type text,
  ADD COLUMN IF NOT EXISTS image_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS image_sha256 text,
  ADD COLUMN IF NOT EXISTS image_downloaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS ocr_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ocr_text text,
  ADD COLUMN IF NOT EXISTS ocr_confidence numeric(5,2),
  ADD COLUMN IF NOT EXISTS ocr_language text,
  ADD COLUMN IF NOT EXISTS ocr_extracted_at timestamptz,
  ADD COLUMN IF NOT EXISTS ocr_error_message text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_instagram_posts_ocr_status_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_instagram_posts
      ADD CONSTRAINT cafeteria_instagram_posts_ocr_status_check
      CHECK (ocr_status IN ('pending', 'succeeded', 'failed', 'skipped'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cafeteria_instagram_posts_image_sha256
  ON public_data.cafeteria_instagram_posts (image_sha256);
