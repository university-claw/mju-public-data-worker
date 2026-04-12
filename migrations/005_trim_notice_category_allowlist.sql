UPDATE public_data.notice_items
SET category_label = NULL
WHERE category_label IN (
  '채용',
  '모집',
  '국제',
  '학생'
);
