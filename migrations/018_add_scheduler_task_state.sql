CREATE TABLE IF NOT EXISTS public_data.scheduler_tasks (
  task_key text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  collector_type text NOT NULL,
  task_type text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  schedule_kind text NOT NULL,
  schedule_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_evaluated_at timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_triggered_at timestamptz,
  last_status text,
  last_error_message text,
  last_result_summary jsonb,
  next_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_data.scheduler_task_runs (
  id bigserial PRIMARY KEY,
  task_key text NOT NULL REFERENCES public_data.scheduler_tasks(task_key) ON DELETE CASCADE,
  trigger_reason text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  result_summary jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduler_task_runs_task_key_started_at
  ON public_data.scheduler_task_runs (task_key, started_at DESC);
