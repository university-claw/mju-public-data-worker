ALTER TABLE public_data.notice_attachments
  ADD COLUMN IF NOT EXISTS storage_provider text,
  ADD COLUMN IF NOT EXISTS storage_key text,
  ADD COLUMN IF NOT EXISTS content_type text,
  ADD COLUMN IF NOT EXISTS size_bytes bigint,
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS downloaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS download_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public_data.notice_images
  ADD COLUMN IF NOT EXISTS storage_provider text,
  ADD COLUMN IF NOT EXISTS storage_key text,
  ADD COLUMN IF NOT EXISTS content_type text,
  ADD COLUMN IF NOT EXISTS size_bytes bigint,
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS downloaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS download_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notice_attachments_download_status_check'
  ) THEN
    ALTER TABLE public_data.notice_attachments
      ADD CONSTRAINT notice_attachments_download_status_check
      CHECK (download_status IN ('pending', 'succeeded', 'failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notice_images_download_status_check'
  ) THEN
    ALTER TABLE public_data.notice_images
      ADD CONSTRAINT notice_images_download_status_check
      CHECK (download_status IN ('pending', 'succeeded', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notice_attachments_download_status
  ON public_data.notice_attachments (download_status);

CREATE INDEX IF NOT EXISTS idx_notice_images_download_status
  ON public_data.notice_images (download_status);
