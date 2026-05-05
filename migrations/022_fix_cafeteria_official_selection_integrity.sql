DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_official_page_snapshots_id_source_unique'
  ) THEN
    ALTER TABLE public_data.cafeteria_official_page_snapshots
      ADD CONSTRAINT cafeteria_official_page_snapshots_id_source_unique
      UNIQUE (id, source_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_official_menu_documents_id_source_unique'
  ) THEN
    ALTER TABLE public_data.cafeteria_official_menu_documents
      ADD CONSTRAINT cafeteria_official_menu_documents_id_source_unique
      UNIQUE (id, source_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_menu_entries_id_source_service_date_meal_type_unique'
  ) THEN
    ALTER TABLE public_data.cafeteria_menu_entries
      ADD CONSTRAINT cafeteria_menu_entries_id_source_service_date_meal_type_unique
      UNIQUE (id, source_id, service_date, meal_type);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_official_menu_entries_id_source_service_date_meal_type_unique'
  ) THEN
    ALTER TABLE public_data.cafeteria_official_menu_entries
      ADD CONSTRAINT cafeteria_official_menu_entries_id_source_service_date_meal_type_unique
      UNIQUE (id, source_id, service_date, meal_type);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_official_menu_documents_snapshot_source_fk'
  ) THEN
    ALTER TABLE public_data.cafeteria_official_menu_documents
      ADD CONSTRAINT cafeteria_official_menu_documents_snapshot_source_fk
      FOREIGN KEY (source_snapshot_id, source_id)
      REFERENCES public_data.cafeteria_official_page_snapshots(id, source_id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_official_menu_entries_document_source_fk'
  ) THEN
    ALTER TABLE public_data.cafeteria_official_menu_entries
      ADD CONSTRAINT cafeteria_official_menu_entries_document_source_fk
      FOREIGN KEY (source_document_id, source_id)
      REFERENCES public_data.cafeteria_official_menu_documents(id, source_id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_resolved_menu_entries_selected_entry_shape_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_resolved_menu_entries
      ADD CONSTRAINT cafeteria_resolved_menu_entries_selected_entry_shape_check
      CHECK (
        (
          selected_source_kind = 'instagram_ocr'
          AND selected_instagram_entry_id IS NOT NULL
          AND selected_official_entry_id IS NULL
        )
        OR (
          selected_source_kind = 'official_page'
          AND selected_official_entry_id IS NOT NULL
          AND selected_instagram_entry_id IS NULL
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_resolved_menu_entries_instagram_entry_fk'
  ) THEN
    ALTER TABLE public_data.cafeteria_resolved_menu_entries
      ADD CONSTRAINT cafeteria_resolved_menu_entries_instagram_entry_fk
      FOREIGN KEY (
        selected_instagram_entry_id,
        source_id,
        service_date,
        meal_type
      )
      REFERENCES public_data.cafeteria_menu_entries(
        id,
        source_id,
        service_date,
        meal_type
      )
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_resolved_menu_entries_official_entry_fk'
  ) THEN
    ALTER TABLE public_data.cafeteria_resolved_menu_entries
      ADD CONSTRAINT cafeteria_resolved_menu_entries_official_entry_fk
      FOREIGN KEY (
        selected_official_entry_id,
        source_id,
        service_date,
        meal_type
      )
      REFERENCES public_data.cafeteria_official_menu_entries(
        id,
        source_id,
        service_date,
        meal_type
      )
      ON DELETE SET NULL;
  END IF;
END $$;
