ALTER TABLE public_data.scrape_runs
  ADD COLUMN IF NOT EXISTS total_attachment_extraction_succeeded_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_attachment_extraction_unsupported_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_attachment_extraction_failed_count integer NOT NULL DEFAULT 0;

ALTER TABLE public_data.scrape_run_sources
  ADD COLUMN IF NOT EXISTS attachment_extraction_succeeded_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachment_extraction_unsupported_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachment_extraction_failed_count integer NOT NULL DEFAULT 0;
