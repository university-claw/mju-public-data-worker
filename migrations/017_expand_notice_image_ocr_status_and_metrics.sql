DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notice_image_ocr_results_status_check'
  ) THEN
    ALTER TABLE public_data.notice_image_ocr_results
      DROP CONSTRAINT notice_image_ocr_results_status_check;
  END IF;

  ALTER TABLE public_data.notice_image_ocr_results
    ADD CONSTRAINT notice_image_ocr_results_status_check
    CHECK (ocr_status IN ('pending', 'succeeded', 'failed', 'unsupported'));
END $$;

ALTER TABLE public_data.scrape_runs
  ADD COLUMN IF NOT EXISTS total_notice_image_ocr_unsupported_count integer NOT NULL DEFAULT 0;

ALTER TABLE public_data.scrape_run_sources
  ADD COLUMN IF NOT EXISTS notice_image_ocr_unsupported_count integer NOT NULL DEFAULT 0;
