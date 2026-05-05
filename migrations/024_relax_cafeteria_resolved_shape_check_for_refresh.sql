DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_resolved_menu_entries_selected_entry_shape_check'
  ) THEN
    ALTER TABLE public_data.cafeteria_resolved_menu_entries
      DROP CONSTRAINT cafeteria_resolved_menu_entries_selected_entry_shape_check;
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
          AND selected_official_entry_id IS NULL
        )
        OR (
          selected_source_kind = 'official_page'
          AND selected_instagram_entry_id IS NULL
        )
      );
  END IF;
END $$;
