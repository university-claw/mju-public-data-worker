UPDATE public_data.notice_items
SET category_label = NULL,
    updated_at = now()
WHERE category_label IN ('새글');
