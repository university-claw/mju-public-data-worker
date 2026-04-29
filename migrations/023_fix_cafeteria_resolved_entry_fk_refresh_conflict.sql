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
