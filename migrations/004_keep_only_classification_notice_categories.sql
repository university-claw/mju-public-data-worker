UPDATE public_data.notice_items
SET category_label = NULL,
    updated_at = now()
WHERE category_label IS NOT NULL
  AND category_label NOT IN (
    '학사',
    '행정',
    '장학',
    '행사',
    '취업',
    '진로',
    '창업',
    '채용',
    '모집',
    '국제',
    '학생'
  );
