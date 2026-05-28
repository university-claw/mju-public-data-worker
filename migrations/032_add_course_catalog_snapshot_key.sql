ALTER TABLE public_data.course_catalog_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_key text NOT NULL DEFAULT 'legacy';

ALTER TABLE public_data.course_catalog_snapshots
  DROP CONSTRAINT IF EXISTS course_catalog_snapshots_year_term_unique;

CREATE UNIQUE INDEX IF NOT EXISTS course_catalog_snapshots_term_key_unique
  ON public_data.course_catalog_snapshots (year, term_code, snapshot_key);
