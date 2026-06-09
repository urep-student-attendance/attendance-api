import { pool } from "../db.js";
import { getConfig } from "../config.js";

export type AttendanceProcessFilters = {
  lecture_id?: number;
  schedule_id?: number;
  from_date?: string;
  to_date?: string;
};

export async function processAttendance(filters: AttendanceProcessFilters) {
  const result = await pool.query(
    `
      WITH params AS (
        SELECT
          max(value) FILTER (WHERE name = 'Time_before_lecture_start') AS before_minutes,
          max(value) FILTER (WHERE name = 'Time_after_lecture_start') AS after_minutes
        FROM parameters
      ),
      target_lectures AS (
        SELECT
          l.id AS lecture_id,
          l.schedule_id,
          s.room_id,
          (l.lecture_date + l.start_time) AT TIME ZONE $5 AS lecture_start,
          (l.lecture_date + l.end_time) AT TIME ZONE $5 AS lecture_end
        FROM lectures l
        JOIN schedule s ON s.id = l.schedule_id
        WHERE ($1::bigint IS NULL OR l.id = $1)
          AND ($2::bigint IS NULL OR l.schedule_id = $2)
          AND ($3::date IS NULL OR l.lecture_date >= $3)
          AND ($4::date IS NULL OR l.lecture_date <= $4)
      ),
      expected_attendance AS (
        SELECT
          tl.lecture_id,
          tl.room_id,
          tl.lecture_start,
          tl.lecture_end,
          r.student_id,
          p.before_minutes,
          p.after_minutes
        FROM target_lectures tl
        JOIN registration r ON r.schedule_id = tl.schedule_id
        CROSS JOIN params p
      ),
      valid_scans AS (
        SELECT DISTINCT ON (ea.lecture_id, ea.student_id)
          ea.lecture_id,
          ea.student_id,
          tlm.time AS scan_time,
          greatest(
            0,
            floor(extract(epoch FROM (tlm.time - ea.lecture_start)) / 60)::int
          ) AS late_minutes
        FROM expected_attendance ea
        JOIN time_log_mapping tlm
          ON tlm.student_id = ea.student_id
         AND tlm.room_id = ea.room_id
         AND tlm.time >= ea.lecture_start - make_interval(mins => ea.before_minutes)
         AND tlm.time <= CASE
           WHEN ea.after_minutes IS NULL THEN ea.lecture_end
           ELSE ea.lecture_start + make_interval(mins => ea.after_minutes)
         END
        ORDER BY ea.lecture_id, ea.student_id, tlm.time
      ),
      upserted AS (
        INSERT INTO student_attendance (
          lecture_id,
          student_id,
          status,
          scan_time,
          late_minutes,
          reason,
          updated_at
        )
        SELECT
          ea.lecture_id,
          ea.student_id,
          CASE WHEN vs.scan_time IS NULL THEN 'absent'::attendance_status ELSE 'present'::attendance_status END,
          vs.scan_time,
          CASE
            WHEN vs.scan_time IS NULL THEN NULL
            WHEN ea.after_minutes IS NULL THEN vs.late_minutes
            ELSE NULL
          END,
          CASE
            WHEN vs.scan_time IS NULL THEN 'No valid scan found for this lecture window'
            WHEN ea.after_minutes IS NULL AND vs.late_minutes > 0 THEN 'Late scan accepted because Time_after_lecture_start is null'
            WHEN vs.late_minutes > 0 THEN 'Late scan inside allowed threshold'
            ELSE 'Scan inside allowed threshold'
          END,
          now()
        FROM expected_attendance ea
        LEFT JOIN valid_scans vs
          ON vs.lecture_id = ea.lecture_id
         AND vs.student_id = ea.student_id
        ON CONFLICT (lecture_id, student_id) DO UPDATE
        SET
          status = EXCLUDED.status,
          scan_time = EXCLUDED.scan_time,
          late_minutes = EXCLUDED.late_minutes,
          reason = EXCLUDED.reason,
          updated_at = now()
        RETURNING status
      )
      SELECT
        count(*)::int AS processed_count,
        count(*) FILTER (WHERE status = 'present')::int AS present_count,
        count(*) FILTER (WHERE status = 'absent')::int AS absent_count
      FROM upserted
    `,
    [
      filters.lecture_id ?? null,
      filters.schedule_id ?? null,
      filters.from_date ?? null,
      filters.to_date ?? null,
      getConfig().attendanceTimeZone,
    ],
  );

  return result.rows[0] ?? { processed_count: 0, present_count: 0, absent_count: 0 };
}

export type AttendanceFilters = {
  student_id?: number;
  lecture_id?: number;
  schedule_id?: number;
  status?: "present" | "absent";
};

export async function listAttendance(filters: AttendanceFilters) {
  const result = await pool.query(
    `
      SELECT
        sa.id,
        sa.lecture_id,
        l.schedule_id,
        sa.student_id,
        sa.status,
        sa.scan_time,
        sa.late_minutes,
        sa.reason,
        sa.created_at,
        sa.updated_at
      FROM student_attendance sa
      JOIN lectures l ON l.id = sa.lecture_id
      WHERE ($1::integer IS NULL OR sa.student_id = $1)
        AND ($2::bigint IS NULL OR sa.lecture_id = $2)
        AND ($3::bigint IS NULL OR l.schedule_id = $3)
        AND ($4::attendance_status IS NULL OR sa.status = $4)
      ORDER BY l.lecture_date, l.start_time, sa.student_id
    `,
    [
      filters.student_id ?? null,
      filters.lecture_id ?? null,
      filters.schedule_id ?? null,
      filters.status ?? null,
    ],
  );

  return result.rows;
}
