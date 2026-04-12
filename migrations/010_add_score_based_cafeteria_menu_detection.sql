ALTER TABLE public_data.cafeteria_instagram_posts
  ADD COLUMN IF NOT EXISTS image_perceptual_hash text,
  ADD COLUMN IF NOT EXISTS post_kind_score integer,
  ADD COLUMN IF NOT EXISTS post_kind_signals text[];

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_instagram_posts_post_kind_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_instagram_posts
      DROP CONSTRAINT cafeteria_instagram_posts_post_kind_check;
  END IF;
END $$;

DO $$
BEGIN
  UPDATE public_data.cafeteria_instagram_posts
  SET post_kind = 'ignored'
  WHERE post_kind IN ('non_menu', 'unknown');
END $$;

ALTER TABLE public_data.cafeteria_instagram_posts
  ALTER COLUMN post_kind SET DEFAULT 'ignored';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_instagram_posts_post_kind_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_instagram_posts
      ADD CONSTRAINT cafeteria_instagram_posts_post_kind_check
      CHECK (post_kind IN ('menu_sheet', 'ignored'));
  END IF;
END $$;
