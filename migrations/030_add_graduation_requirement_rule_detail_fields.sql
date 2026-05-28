ALTER TABLE public_data.graduation_requirement_rules
  ADD COLUMN IF NOT EXISTS program_track text,
  ADD COLUMN IF NOT EXISTS min_courses integer,
  ADD COLUMN IF NOT EXISTS applies_to jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'graduation_requirement_rules_min_courses_positive'
  ) THEN
    ALTER TABLE public_data.graduation_requirement_rules
      ADD CONSTRAINT graduation_requirement_rules_min_courses_positive
      CHECK (min_courses IS NULL OR min_courses > 0) NOT VALID;
  END IF;
END
$$;
