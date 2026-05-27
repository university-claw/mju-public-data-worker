CREATE TABLE IF NOT EXISTS public_data.graduation_requirement_sources (
  id bigserial PRIMARY KEY,
  department text NOT NULL,
  admission_year integer NOT NULL,
  source_kind text NOT NULL,
  source_title text NOT NULL,
  source_url text NOT NULL,
  source_published_at timestamptz,
  source_retrieved_at timestamptz NOT NULL DEFAULT now(),
  content_hash text NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graduation_requirement_sources_department_not_empty CHECK (department <> ''),
  CONSTRAINT graduation_requirement_sources_title_not_empty CHECK (source_title <> ''),
  CONSTRAINT graduation_requirement_sources_url_not_empty CHECK (source_url <> ''),
  CONSTRAINT graduation_requirement_sources_kind_check
    CHECK (source_kind IN ('official_notice', 'official_handbook', 'msi_graduation', 'department_page')),
  CONSTRAINT graduation_requirement_sources_department_year_url_unique
    UNIQUE (department, admission_year, source_url)
);

CREATE TABLE IF NOT EXISTS public_data.graduation_requirement_rules (
  id bigserial PRIMARY KEY,
  source_id bigint NOT NULL REFERENCES public_data.graduation_requirement_sources(id) ON DELETE CASCADE,
  department text NOT NULL,
  admission_year integer NOT NULL,
  requirement_key text NOT NULL,
  label text NOT NULL,
  category text NOT NULL,
  required_credits numeric(5, 2),
  required_course_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_course_titles jsonb NOT NULL DEFAULT '[]'::jsonb,
  rule_status text NOT NULL DEFAULT 'confirmed',
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graduation_requirement_rules_key_not_empty CHECK (requirement_key <> ''),
  CONSTRAINT graduation_requirement_rules_label_not_empty CHECK (label <> ''),
  CONSTRAINT graduation_requirement_rules_category_not_empty CHECK (category <> ''),
  CONSTRAINT graduation_requirement_rules_status_check
    CHECK (rule_status IN ('confirmed', 'unprovided')),
  CONSTRAINT graduation_requirement_rules_source_key_unique UNIQUE (source_id, requirement_key)
);

CREATE INDEX IF NOT EXISTS idx_graduation_requirement_sources_department_year
  ON public_data.graduation_requirement_sources (department, admission_year);

CREATE INDEX IF NOT EXISTS idx_graduation_requirement_rules_department_year
  ON public_data.graduation_requirement_rules (department, admission_year, category);
