CREATE TABLE IF NOT EXISTS public_data.cafeteria_instagram_sources (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  profile_url text NOT NULL,
  instagram_username text NOT NULL,
  menu_image_group text NOT NULL,
  supports_weekend_menu boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_data.cafeteria_instagram_scrape_run_sources (
  id bigserial PRIMARY KEY,
  scrape_run_id bigint NOT NULL REFERENCES public_data.scrape_runs(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES public_data.cafeteria_instagram_sources(id),
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  scraped_count integer NOT NULL DEFAULT 0,
  processed_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  error_message text
);

CREATE TABLE IF NOT EXISTS public_data.cafeteria_instagram_posts (
  id bigserial PRIMARY KEY,
  source_id text NOT NULL REFERENCES public_data.cafeteria_instagram_sources(id),
  instagram_post_code text NOT NULL,
  profile_url text NOT NULL,
  permalink text NOT NULL,
  caption text,
  posted_at timestamptz NOT NULL,
  posted_at_epoch bigint NOT NULL,
  image_url text,
  raw_item_json jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_scraped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, instagram_post_code)
);

CREATE INDEX IF NOT EXISTS idx_cafeteria_instagram_posts_source_posted_at
  ON public_data.cafeteria_instagram_posts (source_id, posted_at DESC);
