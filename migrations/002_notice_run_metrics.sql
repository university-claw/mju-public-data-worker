ALTER TABLE public_data.scrape_runs
  ADD COLUMN IF NOT EXISTS total_processed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_inserted_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_updated_count integer NOT NULL DEFAULT 0;

ALTER TABLE public_data.scrape_run_sources
  ADD COLUMN IF NOT EXISTS processed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inserted_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_count integer NOT NULL DEFAULT 0;
