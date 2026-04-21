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
  DROP COLUMN IF EXISTS source_snapshot_id;

DROP TABLE IF EXISTS public_data.cafeteria_official_page_snapshots;
