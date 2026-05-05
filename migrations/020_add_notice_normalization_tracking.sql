ALTER TABLE public_data.notice_items
  ADD COLUMN IF NOT EXISTS latest_normalization_status text,
  ADD COLUMN IF NOT EXISTS latest_normalization_error_message text,
  ADD COLUMN IF NOT EXISTS latest_normalized_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_notice_items_latest_normalization_status'
      AND conrelid = 'public_data.notice_items'::regclass
  ) THEN
    ALTER TABLE public_data.notice_items
      ADD CONSTRAINT chk_notice_items_latest_normalization_status
      CHECK (
        latest_normalization_status IS NULL
        OR latest_normalization_status IN ('succeeded', 'failed')
      );
  END IF;
END $$;

ALTER TABLE public_data.scrape_runs
  ADD COLUMN IF NOT EXISTS total_notice_normalization_succeeded_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_notice_normalization_failed_count integer NOT NULL DEFAULT 0;

ALTER TABLE public_data.scrape_run_sources
  ADD COLUMN IF NOT EXISTS notice_normalization_succeeded_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notice_normalization_failed_count integer NOT NULL DEFAULT 0;
