CREATE TABLE IF NOT EXISTS public_data.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_data.notice_sources (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  list_url text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_data.scrape_runs (
  id bigserial PRIMARY KEY,
  worker_name text NOT NULL,
  trigger_reason text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  total_scraped_count integer NOT NULL DEFAULT 0,
  total_upserted_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_data.scrape_run_sources (
  id bigserial PRIMARY KEY,
  scrape_run_id bigint NOT NULL REFERENCES public_data.scrape_runs(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES public_data.notice_sources(id),
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  scraped_count integer NOT NULL DEFAULT 0,
  upserted_count integer NOT NULL DEFAULT 0,
  error_message text
);

CREATE TABLE IF NOT EXISTS public_data.notice_items (
  id bigserial PRIMARY KEY,
  source_id text NOT NULL REFERENCES public_data.notice_sources(id),
  external_id text NOT NULL,
  title text NOT NULL,
  category_label text,
  detail_url text NOT NULL,
  list_url text NOT NULL,
  author text,
  published_at timestamptz NOT NULL,
  published_at_raw text NOT NULL,
  body_html text,
  body_text text,
  content_hash text,
  attachments_count integer NOT NULL DEFAULT 0,
  images_count integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_scraped_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_notice_items_source_published_at
  ON public_data.notice_items (source_id, published_at DESC);

CREATE TABLE IF NOT EXISTS public_data.notice_attachments (
  id bigserial PRIMARY KEY,
  notice_item_id bigint NOT NULL REFERENCES public_data.notice_items(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  download_url text NOT NULL,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_item_id, download_url)
);

CREATE TABLE IF NOT EXISTS public_data.notice_images (
  id bigserial PRIMARY KEY,
  notice_item_id bigint NOT NULL REFERENCES public_data.notice_items(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  alt_text text,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_item_id, image_url)
);
