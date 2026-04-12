CREATE TABLE IF NOT EXISTS public_data.notice_image_ocr_results (
  id bigserial PRIMARY KEY,
  image_id bigint NOT NULL REFERENCES public_data.notice_images(id) ON DELETE CASCADE,
  image_sha256 text,
  ocr_status text NOT NULL DEFAULT 'pending',
  ocr_text text,
  text_sha256 text,
  ocr_confidence numeric(5,2),
  ocr_language text,
  ocr_extracted_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (image_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notice_image_ocr_results_status_check'
  ) THEN
    ALTER TABLE public_data.notice_image_ocr_results
      ADD CONSTRAINT notice_image_ocr_results_status_check
      CHECK (ocr_status IN ('pending', 'succeeded', 'failed', 'unsupported'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notice_image_ocr_results_status
  ON public_data.notice_image_ocr_results (ocr_status);

ALTER TABLE public_data.scrape_runs
  ADD COLUMN IF NOT EXISTS total_notice_image_ocr_succeeded_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_notice_image_ocr_unsupported_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_notice_image_ocr_failed_count integer NOT NULL DEFAULT 0;

ALTER TABLE public_data.scrape_run_sources
  ADD COLUMN IF NOT EXISTS notice_image_ocr_succeeded_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notice_image_ocr_unsupported_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notice_image_ocr_failed_count integer NOT NULL DEFAULT 0;
