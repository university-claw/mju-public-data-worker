ALTER TABLE public_data.course_catalog_entries
  ADD COLUMN IF NOT EXISTS grade_level text;
