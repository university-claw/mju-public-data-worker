ALTER TABLE public_data.notice_attachment_extractions
  ADD COLUMN IF NOT EXISTS attachment_sha256 text;
