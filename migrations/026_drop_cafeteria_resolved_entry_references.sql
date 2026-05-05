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
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_resolved_menu_entries_instagram_entry_fk'
  ) THEN
    ALTER TABLE public_data.cafeteria_resolved_menu_entries
      DROP CONSTRAINT cafeteria_resolved_menu_entries_instagram_entry_fk;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cafeteria_resolved_menu_entries_official_entry_fk'
  ) THEN
    ALTER TABLE public_data.cafeteria_resolved_menu_entries
      DROP CONSTRAINT cafeteria_resolved_menu_entries_official_entry_fk;
  END IF;
END $$;

ALTER TABLE public_data.cafeteria_resolved_menu_entries
  DROP COLUMN IF EXISTS selected_instagram_entry_id,
  DROP COLUMN IF EXISTS selected_official_entry_id,
  DROP COLUMN IF EXISTS selection_reason;
