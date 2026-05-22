CREATE TABLE IF NOT EXISTS public_data.shuttle_timetable_versions (
  id bigserial PRIMARY KEY,
  source_id text NOT NULL DEFAULT 'general',
  source_external_id text NOT NULL,
  source_title text NOT NULL,
  source_url text NOT NULL,
  source_published_at timestamptz,
  academic_year integer,
  term_label text,
  is_active boolean NOT NULL DEFAULT false,
  normalization_status text NOT NULL,
  normalization_error_message text,
  departure_count integer NOT NULL DEFAULT 0,
  normalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_external_id),
  CONSTRAINT chk_shuttle_timetable_versions_status
    CHECK (normalization_status IN ('succeeded', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shuttle_timetable_versions_active
  ON public_data.shuttle_timetable_versions (is_active)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS public_data.shuttle_departures (
  id bigserial PRIMARY KEY,
  timetable_version_id bigint NOT NULL
    REFERENCES public_data.shuttle_timetable_versions(id) ON DELETE CASCADE,
  campus text,
  route_name text NOT NULL,
  direction text,
  stop_name text,
  day_type text NOT NULL DEFAULT 'weekday',
  departure_time time NOT NULL,
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shuttle_departures_lookup
  ON public_data.shuttle_departures (day_type, departure_time);

CREATE INDEX IF NOT EXISTS idx_shuttle_departures_version
  ON public_data.shuttle_departures (timetable_version_id, departure_time);
