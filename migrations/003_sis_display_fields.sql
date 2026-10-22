-- Display fields the student app needs from the SIS. They are not part of the attendance
-- ERM; until the real SIS is connected, the simulator fills them. All nullable, so the
-- ERM tables keep working without them.

CREATE TABLE IF NOT EXISTS students (
  student_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  program TEXT
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS instructor TEXT;
