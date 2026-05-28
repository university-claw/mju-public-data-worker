ALTER TABLE public_data.graduation_requirement_rules
  ADD COLUMN IF NOT EXISTS course_groups jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'graduation_requirement_rules_course_groups_array'
  ) THEN
    ALTER TABLE public_data.graduation_requirement_rules
      ADD CONSTRAINT graduation_requirement_rules_course_groups_array
      CHECK (jsonb_typeof(course_groups) = 'array') NOT VALID;
  END IF;
END
$$;
