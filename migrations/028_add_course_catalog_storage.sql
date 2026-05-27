CREATE TABLE IF NOT EXISTS public_data.course_catalog_snapshots (
  id bigserial PRIMARY KEY,
  year integer NOT NULL,
  term_code text NOT NULL,
  term_label text NOT NULL,
  source_kind text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  entry_count integer NOT NULL DEFAULT 0,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_catalog_snapshots_year_term_unique UNIQUE (year, term_code),
  CONSTRAINT course_catalog_snapshots_source_kind_check
    CHECK (source_kind IN ('json_import', 'html_import', 'fixture_import', 'mju_cli_msi_timetable', 'mju_cli_msi_department_timetable')),
  CONSTRAINT course_catalog_snapshots_entry_count_check
    CHECK (entry_count >= 0)
);

CREATE TABLE IF NOT EXISTS public_data.course_catalog_entries (
  id bigserial PRIMARY KEY,
  snapshot_id bigint NOT NULL REFERENCES public_data.course_catalog_snapshots(id) ON DELETE CASCADE,
  year integer NOT NULL,
  term_code text NOT NULL,
  term_label text NOT NULL,
  category text NOT NULL,
  category_label text NOT NULL,
  course_code text,
  curriculum_number text,
  course_title text NOT NULL,
  section text,
  professor text,
  credit numeric(4, 1),
  department text,
  campus text,
  meetings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_catalog_entries_category_not_empty CHECK (category <> ''),
  CONSTRAINT course_catalog_entries_meetings_array_check
    CHECK (jsonb_typeof(meetings) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_course_catalog_entries_snapshot
  ON public_data.course_catalog_entries (snapshot_id);

CREATE INDEX IF NOT EXISTS idx_course_catalog_entries_term_title
  ON public_data.course_catalog_entries (year, term_code, course_title);

CREATE INDEX IF NOT EXISTS idx_course_catalog_entries_course_code
  ON public_data.course_catalog_entries (course_code)
  WHERE course_code IS NOT NULL;
