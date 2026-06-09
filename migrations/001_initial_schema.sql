CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS palm_reg (
  id BIGSERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL,
  student_palm TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id BIGSERIAL PRIMARY KEY,
  room TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS device_room (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS time_log (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  time TIMESTAMPTZ NOT NULL,
  student_palm TEXT NOT NULL,
  transferred BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS time_log_mapping (
  id BIGSERIAL PRIMARY KEY,
  time_log_id BIGINT NOT NULL UNIQUE REFERENCES time_log(id) ON DELETE CASCADE,
  room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  student_id INTEGER NOT NULL,
  time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
  id BIGSERIAL PRIMARY KEY,
  subject CHAR(4) NOT NULL,
  course_num CHAR(4) NOT NULL,
  UNIQUE (subject, course_num)
);

CREATE TABLE IF NOT EXISTS schedule (
  id BIGSERIAL PRIMARY KEY,
  academic_year INTEGER NOT NULL,
  semester SMALLINT NOT NULL,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  section TEXT NOT NULL,
  UNIQUE (academic_year, semester, course_id, section)
);

CREATE TABLE IF NOT EXISTS registration (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT NOT NULL REFERENCES schedule(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL,
  UNIQUE (schedule_id, student_id)
);

CREATE TABLE IF NOT EXISTS lectures (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT NOT NULL REFERENCES schedule(id) ON DELETE CASCADE,
  lecture_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (end_time > start_time)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status') THEN
    CREATE TYPE attendance_status AS ENUM ('present', 'absent');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS student_attendance (
  id BIGSERIAL PRIMARY KEY,
  lecture_id BIGINT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL,
  status attendance_status NOT NULL,
  scan_time TIMESTAMPTZ,
  late_minutes INTEGER,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lecture_id, student_id)
);

CREATE TABLE IF NOT EXISTS parameters (
  name TEXT PRIMARY KEY,
  value INTEGER,
  description TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_log_mapping_student_time
  ON time_log_mapping (student_id, time);

CREATE INDEX IF NOT EXISTS idx_time_log_mapping_room_time
  ON time_log_mapping (room_id, time);

CREATE INDEX IF NOT EXISTS idx_student_attendance_filters
  ON student_attendance (student_id, lecture_id, status);
