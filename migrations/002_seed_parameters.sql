INSERT INTO parameters (name, value, description)
VALUES
  (
    'Time_before_lecture_start',
    10,
    'Valid early scan margin in minutes before lecture start. Scans earlier than this do not count.'
  ),
  (
    'Time_after_lecture_start',
    20,
    'Valid late scan margin in minutes after lecture start. If null, record late minutes until lecture end instead of marking absent.'
  )
ON CONFLICT (name) DO UPDATE
SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = now();
