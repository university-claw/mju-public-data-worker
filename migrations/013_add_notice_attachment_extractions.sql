CREATE TABLE IF NOT EXISTS public_data.notice_attachment_extractions (
  id bigserial PRIMARY KEY,
  attachment_id bigint NOT NULL REFERENCES public_data.notice_attachments(id) ON DELETE CASCADE,
  extractor_type text,
  extraction_status text NOT NULL DEFAULT 'pending',
  extracted_text text,
  text_sha256 text,
  extracted_char_count integer,
  extracted_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attachment_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notice_attachment_extractions_status_check'
  ) THEN
    ALTER TABLE public_data.notice_attachment_extractions
      ADD CONSTRAINT notice_attachment_extractions_status_check
      CHECK (extraction_status IN ('pending', 'succeeded', 'failed', 'unsupported'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notice_attachment_extractions_status
  ON public_data.notice_attachment_extractions (extraction_status);
