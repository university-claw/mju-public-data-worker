ALTER TABLE public_data.cafeteria_official_menu_documents
  ADD COLUMN IF NOT EXISTS raw_html text,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'succeeded',
  ADD COLUMN IF NOT EXISTS error_message text;

UPDATE public_data.cafeteria_official_menu_documents AS document
SET
  raw_html = COALESCE(document.raw_html, snapshot.raw_html),
  content_hash = COALESCE(document.content_hash, snapshot.snapshot_hash),
  fetched_at = COALESCE(document.fetched_at, snapshot.fetched_at),
  status = COALESCE(snapshot.status, document.status, 'succeeded'),
  error_message = COALESCE(document.error_message, snapshot.error_message)
FROM public_data.cafeteria_official_page_snapshots AS snapshot
WHERE document.source_snapshot_id = snapshot.id;

UPDATE public_data.cafeteria_official_menu_documents
SET
  raw_html = COALESCE(raw_html, ''),
  content_hash = COALESCE(content_hash, md5(COALESCE(raw_html, ''))),
  fetched_at = COALESCE(fetched_at, normalized_at, updated_at, created_at),
  status = COALESCE(status, 'succeeded');

CREATE TEMP TABLE temp_cafeteria_official_document_rankings AS
SELECT
  document.id AS document_id,
  document.source_id,
  document.week_start_date,
  first_value(document.id) OVER (
    PARTITION BY document.source_id, document.week_start_date
    ORDER BY
      CASE document.status
        WHEN 'succeeded' THEN 0
        WHEN 'empty' THEN 1
        ELSE 2
      END ASC,
      COALESCE(document.fetched_at, document.normalized_at, document.updated_at, document.created_at) DESC,
      document.id DESC
  ) AS kept_document_id,
  row_number() OVER (
    PARTITION BY document.source_id, document.week_start_date
    ORDER BY
      CASE document.status
        WHEN 'succeeded' THEN 0
        WHEN 'empty' THEN 1
        ELSE 2
      END ASC,
      COALESCE(document.fetched_at, document.normalized_at, document.updated_at, document.created_at) DESC,
      document.id DESC
  ) AS document_rank
FROM public_data.cafeteria_official_menu_documents AS document;

CREATE TEMP TABLE temp_cafeteria_official_duplicate_documents AS
SELECT document_id, kept_document_id
FROM temp_cafeteria_official_document_rankings
WHERE document_id <> kept_document_id;

CREATE TEMP TABLE temp_cafeteria_official_entry_rankings AS
SELECT
  entry.id AS entry_id,
  rankings.kept_document_id,
  first_value(entry.id) OVER (
    PARTITION BY rankings.source_id, rankings.week_start_date, entry.service_date, entry.meal_type
    ORDER BY rankings.document_rank ASC, entry.id DESC
  ) AS kept_entry_id
FROM public_data.cafeteria_official_menu_entries AS entry
INNER JOIN temp_cafeteria_official_document_rankings AS rankings
  ON rankings.document_id = entry.source_document_id;

UPDATE public_data.cafeteria_resolved_menu_entries AS resolved
SET
  selected_official_entry_id = kept_entry.id,
  is_closed = kept_entry.is_closed,
  menu_text = kept_entry.menu_text,
  menu_items = kept_entry.menu_items,
  updated_at = now()
FROM temp_cafeteria_official_entry_rankings AS ranking
INNER JOIN public_data.cafeteria_official_menu_entries AS old_entry
  ON old_entry.id = ranking.entry_id
INNER JOIN public_data.cafeteria_official_menu_entries AS kept_entry
  ON kept_entry.id = ranking.kept_entry_id
WHERE resolved.selected_official_entry_id = old_entry.id
  AND old_entry.id <> kept_entry.id;

DELETE FROM public_data.cafeteria_official_menu_entries AS entry
USING temp_cafeteria_official_entry_rankings AS ranking
WHERE entry.id = ranking.entry_id
  AND ranking.entry_id <> ranking.kept_entry_id;

CREATE TEMP TABLE temp_cafeteria_official_entry_winners AS
SELECT DISTINCT ranking.kept_entry_id, ranking.kept_document_id
FROM temp_cafeteria_official_entry_rankings AS ranking;

UPDATE public_data.cafeteria_official_menu_entries AS entry
SET source_document_id = winners.kept_document_id
FROM temp_cafeteria_official_entry_winners AS winners
WHERE entry.id = winners.kept_entry_id
  AND entry.source_document_id <> winners.kept_document_id;

DELETE FROM public_data.cafeteria_official_menu_documents AS document
USING temp_cafeteria_official_duplicate_documents AS duplicate_document
WHERE document.id = duplicate_document.document_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_official_menu_documents_snapshot_source_fk'
  ) THEN
    ALTER TABLE public_data.cafeteria_official_menu_documents
      DROP CONSTRAINT cafeteria_official_menu_documents_snapshot_source_fk;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_official_menu_documents_source_snapshot_id_fkey'
  ) THEN
    ALTER TABLE public_data.cafeteria_official_menu_documents
      DROP CONSTRAINT cafeteria_official_menu_documents_source_snapshot_id_fkey;
  END IF;
END $$;

ALTER TABLE public_data.cafeteria_official_menu_documents
  ALTER COLUMN source_snapshot_id DROP NOT NULL,
  ALTER COLUMN raw_html SET NOT NULL,
  ALTER COLUMN content_hash SET NOT NULL,
  ALTER COLUMN fetched_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_official_menu_documents_status_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_official_menu_documents
      ADD CONSTRAINT cafeteria_official_menu_documents_status_check
      CHECK (status IN ('succeeded', 'empty', 'failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_official_menu_documents_source_week_unique'
  ) THEN
    ALTER TABLE public_data.cafeteria_official_menu_documents
      ADD CONSTRAINT cafeteria_official_menu_documents_source_week_unique
      UNIQUE (source_id, week_start_date);
  END IF;
END $$;
