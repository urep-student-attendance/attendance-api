import { pool } from "../db.js";
import { HttpError } from "../errors.js";

// Everything the student app needs for one student, as raw table rows. The app runs the
// same mapping and attendance rules client side (to explain each scan and to preview
// parameter changes), and shows the stored student_attendance rows as the official result.
export async function getStudentOverview(studentId: number) {
  const [student, palm, sections, attendance, parameters] = await Promise.all([
    pool.query(`SELECT student_id, name, program FROM students WHERE student_id = $1`, [studentId]),
    pool.query(
      `SELECT student_id, student_palm, created_at FROM palm_reg
       WHERE student_id = $1 ORDER BY created_at DESC, id DESC`,
      [studentId],
    ),
    pool.query(
      `SELECT s.id, s.academic_year, s.semester, s.course_id, s.room_id, s.section, s.instructor
       FROM schedule s
       JOIN registration r ON r.schedule_id = s.id
       WHERE r.student_id = $1
       ORDER BY s.id`,
      [studentId],
    ),
    pool.query(
      `SELECT sa.lecture_id, sa.student_id, sa.status, sa.scan_time, sa.late_minutes, sa.reason
       FROM student_attendance sa
       WHERE sa.student_id = $1
       ORDER BY sa.lecture_id`,
      [studentId],
    ),
    pool.query(`SELECT name, value FROM parameters`),
  ]);

  if (!student.rowCount && !palm.rowCount && !sections.rowCount) {
    throw new HttpError(404, `Unknown student: ${studentId}`);
  }

  const sectionIds = sections.rows.map((s) => s.id);
  const palms = palm.rows.map((p) => p.student_palm);

  const [courses, lectures, rooms, devices, timeLogs] = await Promise.all([
    pool.query(
      `SELECT DISTINCT c.id, c.subject, c.course_num, c.title
       FROM courses c JOIN schedule s ON s.course_id = c.id
       WHERE s.id = ANY($1::bigint[])
       ORDER BY c.id`,
      [sectionIds],
    ),
    pool.query(
      `SELECT id, schedule_id, to_char(lecture_date, 'YYYY-MM-DD') AS lecture_date,
              to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time
       FROM lectures
       WHERE schedule_id = ANY($1::bigint[])
       ORDER BY lecture_date, start_time, id`,
      [sectionIds],
    ),
    pool.query(`SELECT id, room FROM rooms ORDER BY id`),
    pool.query(`SELECT device_id, room_id FROM device_room ORDER BY device_id`),
    pool.query(
      `SELECT id, device_id, time, student_palm FROM time_log
       WHERE student_palm = ANY($1::text[])
       ORDER BY time, id`,
      [palms],
    ),
  ]);

  const parameter = (name: string) =>
    parameters.rows.find((p) => p.name === name)?.value ?? null;

  return {
    student: student.rows[0] ?? { student_id: studentId, name: null, program: null },
    palm_reg: palm.rows,
    parameters: {
      Time_before_lecture_start: parameter("Time_before_lecture_start"),
      Time_after_lecture_start: parameter("Time_after_lecture_start"),
    },
    rooms: rooms.rows,
    devices: devices.rows,
    courses: courses.rows,
    sections: sections.rows,
    lectures: lectures.rows,
    attendance: attendance.rows,
    time_logs: timeLogs.rows,
  };
}
