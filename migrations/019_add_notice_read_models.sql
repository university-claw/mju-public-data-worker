CREATE TABLE IF NOT EXISTS public_data.notice_read_models (
  id bigserial PRIMARY KEY,
  notice_item_id bigint NOT NULL UNIQUE REFERENCES public_data.notice_items(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES public_data.notice_sources(id),
  external_id text NOT NULL,
  notice_kind text,
  issuer_name text,
  issuer_scope text,
  target_campuses text[] NOT NULL DEFAULT '{}',
  target_audiences text[] NOT NULL DEFAULT '{}',
  target_program_levels text[] NOT NULL DEFAULT '{}',
  target_departments text[] NOT NULL DEFAULT '{}',
  target_grade_years integer[] NOT NULL DEFAULT '{}',
  primary_time_kind text,
  primary_start_at timestamptz,
  primary_end_at timestamptz,
  primary_deadline_at timestamptz,
  has_deadline boolean NOT NULL DEFAULT false,
  action_required boolean NOT NULL DEFAULT false,
  action_kind text,
  primary_action_channel text,
  primary_action_url text,
  primary_location text,
  participation_mode text,
  has_benefit boolean NOT NULL DEFAULT false,
  benefit_kind text,
  benefit_amount_krw integer,
  selection_count integer,
  summary text,
  details_jsonb jsonb,
  normalized_confidence double precision NOT NULL,
  normalized_at timestamptz NOT NULL,
  normalization_status text NOT NULL,
  normalization_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id),
  CONSTRAINT chk_notice_read_models_notice_kind
    CHECK (
      notice_kind IS NULL
      OR notice_kind IN (
        'announcement',
        'scholarship',
        'recruitment',
        'event',
        'survey',
        'system_notice',
        'application',
        'contest',
        'result',
        'other'
      )
    ),
  CONSTRAINT chk_notice_read_models_issuer_scope
    CHECK (
      issuer_scope IS NULL
      OR issuer_scope IN ('internal', 'external')
    ),
  CONSTRAINT chk_notice_read_models_primary_time_kind
    CHECK (
      primary_time_kind IS NULL
      OR primary_time_kind IN (
        'application_period',
        'event_period',
        'operation_period',
        'response_deadline',
        'announcement_period',
        'other'
      )
    ),
  CONSTRAINT chk_notice_read_models_action_kind
    CHECK (
      action_kind IS NULL
      OR action_kind IN (
        'apply',
        'register',
        'participate',
        'respond',
        'check',
        'support',
        'other'
      )
    ),
  CONSTRAINT chk_notice_read_models_primary_action_channel
    CHECK (
      primary_action_channel IS NULL
      OR primary_action_channel IN (
        'web_form',
        'system',
        'email',
        'in_person',
        'onsite',
        'phone',
        'other'
      )
    ),
  CONSTRAINT chk_notice_read_models_participation_mode
    CHECK (
      participation_mode IS NULL
      OR participation_mode IN (
        'online',
        'offline',
        'hybrid',
        'remote',
        'onsite',
        'other'
      )
    ),
  CONSTRAINT chk_notice_read_models_benefit_kind
    CHECK (
      benefit_kind IS NULL
      OR benefit_kind IN (
        'scholarship',
        'grant',
        'tuition',
        'interest_support',
        'prize',
        'free_issue',
        'coupon',
        'other'
      )
    ),
  CONSTRAINT chk_notice_read_models_normalized_confidence
    CHECK (normalized_confidence >= 0 AND normalized_confidence <= 1),
  CONSTRAINT chk_notice_read_models_normalization_status
    CHECK (normalization_status IN ('succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_notice_read_models_notice_kind
  ON public_data.notice_read_models (notice_kind);

CREATE INDEX IF NOT EXISTS idx_notice_read_models_primary_deadline_at
  ON public_data.notice_read_models (primary_deadline_at DESC);

CREATE INDEX IF NOT EXISTS idx_notice_read_models_action_required
  ON public_data.notice_read_models (action_required);

CREATE INDEX IF NOT EXISTS idx_notice_read_models_has_benefit
  ON public_data.notice_read_models (has_benefit);

CREATE INDEX IF NOT EXISTS idx_notice_read_models_normalization_status
  ON public_data.notice_read_models (normalization_status);

CREATE INDEX IF NOT EXISTS idx_notice_read_models_target_campuses
  ON public_data.notice_read_models USING GIN (target_campuses);

CREATE INDEX IF NOT EXISTS idx_notice_read_models_target_audiences
  ON public_data.notice_read_models USING GIN (target_audiences);

CREATE INDEX IF NOT EXISTS idx_notice_read_models_target_program_levels
  ON public_data.notice_read_models USING GIN (target_program_levels);

CREATE INDEX IF NOT EXISTS idx_notice_read_models_target_departments
  ON public_data.notice_read_models USING GIN (target_departments);

CREATE INDEX IF NOT EXISTS idx_notice_read_models_target_grade_years
  ON public_data.notice_read_models USING GIN (target_grade_years);
